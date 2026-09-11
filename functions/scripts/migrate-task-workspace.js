// Dry run by default. Explicit --apply writes only to the selected school.
import { adminDb } from '../src/services/firebaseAdmin.js';
import { initializeAssignments, assignedIds, progressSummary } from '../src/domain/taskWorkspace.js';
import { FieldValue } from 'firebase-admin/firestore';
const schoolId=process.argv.find(arg=>arg.startsWith('--school='))?.split('=')[1];
if(!schoolId||!/^\w[\w-]{0,127}$/.test(schoolId))throw new Error('Use --school=ID [--apply]');
const apply=process.argv.includes('--apply');
const report={schoolId,apply,scanned:0,updated:0,alreadyCurrent:0,conflicts:[]};
const teams=new Map();for(const path of [`teams_${schoolId}`,`schools/${schoolId}/teams`])for(const doc of (await adminDb.collection(path).get()).docs)teams.set(doc.id,doc.data());
const seen=new Map(), candidates=[];
for(const path of [`schools/${schoolId}/tasks`,`tasks_${schoolId}`]){
  let cursor=null;for(;;){let query=adminDb.collection(path).orderBy('__name__').limit(100);if(cursor)query=query.startAfter(cursor);const page=await query.get();if(page.empty)break;
    for(const snapshot of page.docs){const task=snapshot.data();report.scanned++;
      if(seen.has(snapshot.id)&&JSON.stringify([task.title,task.description,task.status])!==seen.get(snapshot.id)){report.conflicts.push({taskId:snapshot.id,reason:'conflicting-legacy-copy'});continue;}
      seen.set(snapshot.id,JSON.stringify([task.title,task.description,task.status]));
      if(task.assignmentVersion===2){report.alreadyCurrent++;continue;}
      if(task.schoolId&&task.schoolId!==schoolId){report.conflicts.push({taskId:snapshot.id,reason:'school-mismatch'});continue;}
      report.updated++;
      candidates.push(snapshot);
    }
    cursor=page.docs.at(-1);if(page.size<100)break;
  }
}
const conflictingIds = new Set(report.conflicts.map(item => item.taskId));
for (const snapshot of candidates.filter(item => !conflictingIds.has(item.id))) {
      if(apply)await adminDb.runTransaction(async tx=>{const fresh=await tx.get(snapshot.ref);if(!fresh.exists||fresh.data().assignmentVersion===2)return;const current=fresh.data(),next=initializeAssignments(current,teams.get(current.teamId||current.assigneeTeamId)?.memberIds||[]);tx.update(snapshot.ref,{schoolId,assignmentVersion:2,assignmentSources:next.assignmentSources,progressBy:next.progressBy,assigneeIds:assignedIds(next),status:['done','completed'].includes(current.status)?'done':progressSummary(next).status,updatedAt:current.updatedAt||FieldValue.serverTimestamp(),workspaceMigratedAt:FieldValue.serverTimestamp()});});
}
report.skippedConflicts = candidates.filter(item => conflictingIds.has(item.id)).length;
report.updated -= report.skippedConflicts;
console.log(JSON.stringify(report,null,2));
