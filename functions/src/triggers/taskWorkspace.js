import { createHash } from 'node:crypto';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../services/firebaseAdmin.js';
import { REGION } from '../config.js';
import { initializeAssignments, reconcileSource, assignedIds, uniqueIds } from '../domain/taskWorkspace.js';
export async function syncWorkspaceTeam(event) {
  const before=event.data?.before.data(),after=event.data?.after.data();
  if(!before||JSON.stringify(before.memberIds||[])===JSON.stringify(after?.memberIds||[]))return;
  const schoolId=event.params.schoolId,teamId=event.params.teamId;
  const source=`team:${teamId}`,newMembers=after?.status==='archived'?[]:after?.memberIds||[];
  const added=newMembers.filter(uid=>!before.memberIds?.includes(uid));
  for(const collectionPath of [`schools/${schoolId}/tasks`,`tasks_${schoolId}`]) {
    // Pagination keeps membership reconciliation bounded and retryable.
    let cursor=null;
    for(;;){let query=adminDb.collection(collectionPath).orderBy('__name__').limit(100);if(cursor)query=query.startAfter(cursor);const page=await query.get();if(page.empty)break;
      for(const snapshot of page.docs){const data=snapshot.data();if(data.teamId!==teamId&&data.assigneeTeamId!==teamId&&!Object.values(data.assignmentSources||{}).some(sources=>sources.includes(source)))continue;
        await adminDb.runTransaction(async tx=>{const [fresh,currentTeam]=await Promise.all([tx.get(snapshot.ref),tx.get(event.data.after.ref)]);if(!fresh.exists)return;const liveMembers=currentTeam.exists&&currentTeam.data().status!=='archived'?currentTeam.data().memberIds||[]:[];const task=fresh.data();if(['done','completed'].includes(task.status))return;
          const normalized=initializeAssignments(task,before.memberIds||[]);const next=reconcileSource(normalized,source,liveMembers);
          const oldAssigned=assignedIds(normalized);const viewers=(task.participantIds||[]).filter(uid=>!oldAssigned.includes(uid));
          tx.update(snapshot.ref,{assignmentVersion:2,assignmentSources:next.assignmentSources,progressBy:next.progressBy,assigneeIds:assignedIds(next),participantIds:uniqueIds([...viewers,...assignedIds(next)]),status:next.status,updatedAt:FieldValue.serverTimestamp()});
        });
      }
      cursor=page.docs.at(-1);if(page.size<100)break;
    }
  }
  const eventId=createHash('sha256').update(JSON.stringify([schoolId,teamId,[...(before.memberIds||[])].sort(),[...newMembers].sort()])).digest('hex').slice(0,24);
  for(const uid of added)await adminDb.doc(`notifications/team_tasks_${eventId}_${uid}`).create({userId:uid,schoolId,title:'משימות הצוות זמינות לך',body:after?.name||'צוות',link:`/tasks?list=team:${teamId}`,type:'task',read:false,createdAt:FieldValue.serverTimestamp()}).catch(error=>{if(error.code!==6&&error.code!=='already-exists')throw error;});
}
export const syncNestedTaskTeam=onDocumentWritten({region:REGION,retry:true,document:'schools/{schoolId}/teams/{teamId}'},syncWorkspaceTeam);
export const syncLegacyTaskTeam=onDocumentWritten({region:REGION,retry:true,document:'teams_{schoolId}/{teamId}'},syncWorkspaceTeam);
