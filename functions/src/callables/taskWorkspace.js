import { buildPermissionContext, evaluatePermission } from '../services/permissionEngine.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { FieldValue } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { CALLABLE_OPTIONS } from '../config.js';
import { adminDb } from '../services/firebaseAdmin.js';
import { requireActor } from '../services/authorization.js';
import { resolveActorRoleAuthority, requireRoleAction } from '../services/roleAuthorization.js';
import { permissionDenied, publicError, toPublicError } from '../services/errors.js';
import { enforceRateLimit } from '../services/rateLimit.js';
import { assignedIds, initializeAssignments, progressSummary, reconcileSource, uniqueIds } from '../domain/taskWorkspace.js';
const id = z.string().regex(/^[\w-]{1,128}$/u);
const schema = z.object({ schoolId: id, requestId: id, operation: z.enum(['create', 'edit', 'progress', 'list', 'invite', 'respond', 'move', 'invite_task', 'respond_task', 'unassign', 'list_member']), taskId: id.optional(), userId: id.optional(), storage: z.enum(['personal','nested','legacy']).default('nested'), listId: id.optional(), name: z.string().trim().min(1).max(120).optional(), archived: z.boolean().optional(), title: z.string().trim().min(1).max(180).optional(), titles: z.array(z.string().trim().min(1).max(180)).max(30).optional(), description: z.string().max(8000).optional(), details: z.object({ priority: z.enum(['low','medium','high']).optional(), startDate: z.string().max(10).optional(), endDate: z.string().max(10).optional(), reminderAt: z.string().max(40).optional(), completionCriteria: z.string().max(1000).optional() }).optional(), dueDate: z.string().regex(/^$|^\d{4}-\d{2}-\d{2}$/).optional(), teamId: id.optional(), recipientIds: z.array(id).max(50).default([]), expectedRecipientIds: z.array(id).max(100).optional(), confirmed: z.boolean().default(false), invitationId: id.optional(), accept: z.boolean().optional(), status: z.enum(['todo','in_progress','done']).optional() });
const hash = (...parts) => createHash('sha256').update(parts.join(':')).digest('hex').slice(0,40);
const fail = message => publicError('failed-precondition', 'workspace-invalid', message);
export async function taskWorkspaceHandler(request) {
  const actor = await requireActor(request);
  const input = schema.parse(request.data);
  if (!actor.schoolIds.has(input.schoolId) && !actor.globalAdmin) throw permissionDenied();
  const authority = await resolveActorRoleAuthority(actor, input.schoolId);
  const can = capability => { try { requireRoleAction(authority, capability); return true; } catch { return false; } };
  await enforceRateLimit({ uid: actor.uid, action: 'taskWorkspace', limit: 100, windowSeconds: 300 });
  if (input.taskId && input.storage !== 'personal') {
    const resource = { resourceType: 'task', resourceId: input.taskId };
    const context = await buildPermissionContext({ userId: actor.uid, schoolId: input.schoolId, resource });
    if (context.resourceAcls.length && !evaluatePermission(context, { ...resource, resource, capability: 'tasks.viewOwn', accessLevel: input.operation === 'progress' ? 'view' : 'edit' }).allowed) throw permissionDenied();
  }
  const root = `schools/${input.schoolId}`;
  const operationId = hash(actor.uid, input.requestId);
  const receiptRef = adminDb.doc(`${root}/taskWorkspaceReceipts/${operationId}`);
  const taskRef = input.taskId ? adminDb.doc(input.storage === 'personal' ? `users/${actor.uid}/personalTasks/${input.taskId}` : input.storage === 'legacy' ? `tasks_${input.schoolId}/${input.taskId}` : `${root}/tasks/${input.taskId}`) : null;
  if (input.operation === 'invite_task' || input.operation === 'respond_task') return taskInvitationAction({actor,input,root,operationId,receiptRef,taskRef});
  return adminDb.runTransaction(async tx => {
    const receipt = await tx.get(receiptRef);
    if (receipt.exists) { if (receipt.data().payloadHash && receipt.data().payloadHash !== hash(JSON.stringify(input))) throw fail('הבקשה כבר בוצעה עם פרטים אחרים. יש לפתוח את המשימה שנוצרה.'); return receipt.data().result; }
    const taskSnap = taskRef ? await tx.get(taskRef) : null;
    let task = taskSnap?.exists ? taskSnap.data() : null;
    if (task && task.schoolId && task.schoolId !== input.schoolId) throw permissionDenied();
    if (input.taskId && !task) throw fail('המשימה אינה זמינה.');
    if (task?.scope === 'personal' && task.ownerId !== actor.uid) throw permissionDenied();
    const listId = input.listId || task?.listId;
    const listRef = listId ? adminDb.doc(`${root}/taskLists/${listId}`) : null;
    const listSnap = listRef ? await tx.get(listRef) : null;
    const list = listSnap?.exists ? listSnap.data() : null;
    if (listId && !list) throw fail('הרשימה אינה זמינה.');
    if (input.operation !== 'respond' && list && !list.memberIds.includes(actor.uid) && !(list.kind === 'shared' && can('tasks.editAll'))) throw permissionDenied();
    const teamId = input.teamId || task?.teamId || task?.assigneeTeamId;
    let team = null;
    if (teamId) {
      const nested = await tx.get(adminDb.doc(`${root}/teams/${teamId}`));
      const legacy = nested.exists ? null : await tx.get(adminDb.doc(`teams_${input.schoolId}/${teamId}`));
      team = nested.exists ? nested.data() : legacy?.data();
      if (!team || team.status === 'archived') throw fail('הצוות אינו זמין.');
    }
    const targetIds = uniqueIds([...input.recipientIds, ...(input.teamId ? team?.memberIds || [] : []), ...(list?.kind === 'shared' ? list.memberIds : [])]);
    const validateIds = ['create','move','invite'].includes(input.operation) ? uniqueIds([...targetIds, ...(team?.memberIds || [])]) : [];
    for (const uid of validateIds) {
      const member = await tx.get(adminDb.doc(`users/${uid}`));
      const data = member.data();
      if (!data || (data.accountStatus && data.accountStatus !== 'active') || !(data.schoolId === input.schoolId || data.schoolIds?.includes(input.schoolId))) throw fail('אחד המשתתפים אינו פעיל במוסד.');
    }
    const visible = !task || task.scope === 'personal' || task.createdBy === actor.uid || task.participantIds?.includes(actor.uid) || task.assigneeIds?.includes(actor.uid) || team?.memberIds?.includes(actor.uid) || can('tasks.editAll');
    if (!visible) throw permissionDenied();
    const editable = task && (task.createdBy === actor.uid || task.ownerId === actor.uid || can('tasks.editAll'));
    if (input.expectedRecipientIds && [...targetIds].sort().join() !== [...input.expectedRecipientIds].sort().join()) throw fail('המשתתפים השתנו. יש לבדוק ולאשר שוב.');
    // Gather all reads before applying any mutation.
    let invitation = null, invitationRef = null, affected = [];
    if (input.operation === 'respond') {
      if (!input.invitationId) throw fail('חסרה הזמנה.');
      invitationRef = adminDb.doc(`${root}/taskListInvitations/${input.invitationId}`);
      const snap = await tx.get(invitationRef);
      invitation = snap.data();
      if (!invitation || invitation.recipientId !== actor.uid || invitation.status !== 'pending') throw permissionDenied();
      if (!list || listId !== invitation.listId) throw permissionDenied();
      affected = (await tx.get(adminDb.collection(`${root}/tasks`).where('listId','==',listId))).docs;
    }
    if (input.operation === 'list_member' && list) {
      affected = (await tx.get(adminDb.collection(`${root}/tasks`).where('listId','==',listId))).docs;
    }
    if (input.operation === 'invite' && list) {
      affected = (await tx.get(adminDb.collection(`users/${actor.uid}/personalTasks`).where('listId','==',listId))).docs;
    }
    const stamp = FieldValue.serverTimestamp();
    const notify = (uid, title, body, link, suffix = '') => tx.set(adminDb.doc(`notifications/workspace_${operationId}_${uid}${suffix}`), { userId: uid, schoolId: input.schoolId, title, body, link, type: 'task', read: false, createdAt: stamp });
    let result = { ok: true };
    if (input.operation === 'list') {
      if (list && list.ownerId !== actor.uid) throw permissionDenied();
      if (!list && !input.name) throw fail('יש להזין שם לרשימה.');
      const ref = listRef || adminDb.doc(`${root}/taskLists/${operationId}`);
      tx.set(ref, { ...(list ? {} : { schoolId: input.schoolId, ownerId: actor.uid, memberIds: [actor.uid], kind: 'personal', createdAt: stamp }), ...(input.name ? { name: input.name } : {}), ...(input.archived !== undefined ? { archived: input.archived } : {}), updatedAt: stamp }, { merge: true });
      result.listId = ref.id;
    } else if (input.operation === 'list_member') {
      if (!list || list.ownerId !== actor.uid || !input.userId || input.userId === list.ownerId || !input.confirmed) throw permissionDenied();
      const members = list.memberIds.filter(uid => uid !== input.userId);
      tx.update(listRef, { memberIds: members, updatedAt: stamp });
      for (const snapshot of affected) {
        const old = initializeAssignments(snapshot.data());
        const next = reconcileSource(old, `list:${listId}`, members);
        tx.update(snapshot.ref, { assignmentVersion: 2, assignmentSources: next.assignmentSources, progressBy: next.progressBy, assigneeIds: assignedIds(next), participantIds: members, status: ['done','completed'].includes(old.status) ? old.status : next.status, updatedAt: stamp });
      }
    } else if (input.operation === 'create') {
      if (actor.data.permissions?.['tasks.create'] === false && !can('tasks.create')) throw permissionDenied();
      const titles = input.titles || (input.title ? [input.title] : []);
      if (!titles.length || list?.archived) throw fail('יש להזין משימה ולבחור רשימה פעילה.');
      if (targetIds.length && !(list?.kind === 'shared' && list.memberIds.includes(actor.uid))) requireRoleAction(authority, 'tasks.assign');
      result.taskIds = [];
      titles.forEach((title, index) => {
        const taskId = `${operationId}_${index}`;
        const personal = !targetIds.length && !input.teamId && list?.kind !== 'shared';
        const ref = adminDb.doc(personal ? `users/${actor.uid}/personalTasks/${taskId}` : `${root}/tasks/${taskId}`);
        const sources = Object.fromEntries(targetIds.map(uid => [uid, uniqueIds([...(input.recipientIds.includes(uid) ? ['direct'] : []), ...(input.teamId && team.memberIds.includes(uid) ? [`team:${input.teamId}`] : []), ...(list?.kind === 'shared' ? [`list:${listId}`] : [])])]));
        tx.create(ref, { schoolId: input.schoolId, title, description: input.description || '', dueDate: input.dueDate || '', scope: personal ? 'personal' : input.teamId ? 'team' : 'assigned', ownerId: personal ? actor.uid : '', createdBy: actor.uid, createdByName: actor.data.fullName || '', assigneeType: personal ? 'personal' : input.teamId ? 'team' : 'individual', assigneeIds: targetIds, participantIds: targetIds, teamId: input.teamId || '', assigneeTeamId: input.teamId || '', listId: listId || '', status: 'todo', assignmentVersion: 2, assignmentSources: sources, progressBy: Object.fromEntries(targetIds.map(uid => [uid,{status:'todo'}])), createdAt: stamp, updatedAt: stamp });
        result.taskIds.push(taskId);
      });
      targetIds.filter(uid => uid !== actor.uid).forEach(uid => notify(uid, titles.length > 1 ? `${titles.length} משימות חדשות` : 'משימה חדשה', titles[0], `/tasks?task=${result.taskIds[0]}`));
    } else if (input.operation === 'progress') {
      if (!task || !input.status) throw fail('חסר מצב משימה.');
      if (task.scope === 'personal') tx.update(taskRef, { status: input.status, completedAt: input.status === 'done' ? stamp : null, updatedAt: stamp });
      else {
        task = initializeAssignments(task, team?.memberIds || []);
        if (!assignedIds(task).includes(actor.uid)) throw permissionDenied();
        const progressBy = { ...task.progressBy, [actor.uid]: { status: input.status, updatedAt: stamp, inherited: false } };
        const status = progressSummary({ ...task, progressBy }).status;
        tx.update(taskRef, { assignmentVersion: 2, assignmentSources: task.assignmentSources, assigneeIds: assignedIds(task), progressBy, status, completedAt: status === 'done' ? stamp : null, updatedAt: stamp });
        tx.set(taskRef.collection('participants').doc(actor.uid), { userId: actor.uid, workStatus: input.status, completedAt: input.status === 'done' ? stamp : null }, { merge: true });
      }
    } else if (input.operation === 'unassign') {
      if (!editable || !input.confirmed || !input.userId) throw permissionDenied();
      requireRoleAction(authority, 'tasks.assign');
      const normalized = initializeAssignments(task, team?.memberIds || []);
      const assignmentExclusions = { ...normalized.assignmentExclusions };
      for (const source of normalized.assignmentSources[input.userId] || []) assignmentExclusions[source] = uniqueIds([...(assignmentExclusions[source] || []), input.userId]);
      const next = { ...normalized, assignmentExclusions, assignmentSources: { ...normalized.assignmentSources, [input.userId]: [] } };
      tx.update(taskRef, { assignmentVersion: 2, assignmentExclusions, assignmentSources: next.assignmentSources, progressBy: next.progressBy, assigneeIds: assignedIds(next), participantIds: list?.memberIds || (task.participantIds || []).filter(uid => uid !== input.userId), status: progressSummary(next).status, updatedAt: stamp });
    } else if (input.operation === 'edit') {
      if (!editable) throw permissionDenied();
      tx.update(taskRef, { ...(input.details || {}), ...(input.title ? { title: input.title } : {}), ...(input.description !== undefined ? { description: input.description } : {}), ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}), updatedAt: stamp });
    } else if (input.operation === 'move') {
      if (!editable || !input.confirmed) throw permissionDenied();
      if (list?.kind === 'shared' && input.recipientIds.some(uid => !list.memberIds.includes(uid))) throw fail('יש להזמין את המשתתפים לרשימה תחילה.');
      if (!targetIds.length) throw fail('יש לבחור משתתפים.');
      if (!list || list.kind !== 'shared') requireRoleAction(authority, 'tasks.assign');
      task = initializeAssignments(task, team?.memberIds || []);
      let next = task;
      if (input.teamId) next = reconcileSource(next, `team:${input.teamId}`, team.memberIds);
      if (list?.kind === 'shared') next = reconcileSource(next, `list:${listId}`, list.memberIds);
      if (input.recipientIds.length) next = reconcileSource(next, 'direct', uniqueIds([...assignedIds(next).filter(uid => next.assignmentSources[uid].includes('direct')), ...input.recipientIds]));
      const patch = { assignmentVersion: 2, assignmentSources: next.assignmentSources, progressBy: next.progressBy, assigneeIds: assignedIds(next), participantIds: uniqueIds([...(task.participantIds || []), ...assignedIds(next)]), status: progressSummary(next).status, scope: input.teamId ? 'team' : 'assigned', assigneeType: input.teamId ? 'team' : 'individual', ...(input.teamId ? { teamId: input.teamId, assigneeTeamId: input.teamId } : {}), ...(list?.kind === 'shared' ? { listId } : input.storage === 'personal' ? { listId: '' } : {}), updatedAt: stamp };
      if (input.storage === 'personal') {
        const ref = adminDb.doc(`${root}/tasks/shared_${hash(actor.uid, input.taskId)}`);
        tx.set(ref, { ...task, ...patch, ownerId: '', sourcePersonalTaskId: input.taskId });
        tx.update(taskRef, { redirectedTo: ref.id, updatedAt: stamp });
        result.taskId = ref.id;
      } else tx.update(taskRef, patch);
      targetIds.filter(uid => !assignedIds(task).includes(uid) && uid !== actor.uid).forEach(uid => notify(uid,'שותפת במשימה',task.title,`/tasks?task=${result.taskId || input.taskId}`));
    } else if (input.operation === 'invite') {
      if (!list || list.ownerId !== actor.uid || !input.confirmed) throw permissionDenied();
      if (actor.data.permissions?.['tasks.inviteCollaborators'] === false && !can('tasks.inviteCollaborators')) throw permissionDenied();
      tx.update(listRef,{kind:'shared',updatedAt:stamp});
      for (const snap of affected) {
        const old = snap.data();
        if (old.redirectedTo) continue;
        const ref = adminDb.doc(`${root}/tasks/shared_${hash(actor.uid,snap.id)}`);
        const normalized = initializeAssignments({...old,assignmentVersion:1,assigneeIds:[actor.uid],scope:'shared'});
        tx.set(ref,{...normalized,ownerId:'',participantIds:[actor.uid],assignmentSources:{[actor.uid]:[`list:${listId}`]},sourcePersonalTaskId:snap.id,updatedAt:stamp});
        tx.update(snap.ref,{redirectedTo:ref.id,updatedAt:stamp});
      }
      input.recipientIds.filter(uid => !list.memberIds.includes(uid)).forEach(uid => {
        const invitationId = hash(listId,uid);
        tx.set(adminDb.doc(`${root}/taskListInvitations/${invitationId}`),{listId,schoolId:input.schoolId,recipientId:uid,inviterId:actor.uid,title:list.name,status:'pending',createdAt:stamp});
        notify(uid,'הזמנה לרשימה משותפת',list.name,`/tasks?list=${listId}`);
      });
    } else if (input.operation === 'respond') {
      tx.update(invitationRef,{status:input.accept?'accepted':'declined',updatedAt:stamp});
      if (input.accept) {
        const members = uniqueIds([...list.memberIds,actor.uid]);
        tx.update(listRef,{memberIds:members,updatedAt:stamp});
        for (const snap of affected) {
          const old = snap.data();
          const next = ['done','completed'].includes(old.status) ? old : reconcileSource(initializeAssignments(old),`list:${listId}`,members);
          tx.update(snap.ref,{...(next.assignmentVersion === 2 ? {assignmentVersion:2,assignmentSources:next.assignmentSources,progressBy:next.progressBy,assigneeIds:assignedIds(next),status:next.status} : {}),participantIds:uniqueIds([...(old.participantIds||[]),actor.uid]),updatedAt:stamp});
        }
      }
      notify(invitation.inviterId,input.accept?'ההזמנה התקבלה':'ההזמנה נדחתה',list.name,`/tasks?list=${listId}`);
    }
    tx.create(receiptRef,{payloadHash:hash(JSON.stringify(input)),actorUid:actor.uid,operation:input.operation,result,createdAt:stamp});
    return result;
  });
}
export const taskWorkspace = onCall(CALLABLE_OPTIONS, async request => { try { return await taskWorkspaceHandler(request); } catch(error) { throw toPublicError(error); } });

async function taskInvitationAction({actor,input,root,operationId,receiptRef,taskRef}) {
  return adminDb.runTransaction(async tx=>{
    const prior=await tx.get(receiptRef);if(prior.exists)return prior.data().result;
    const stamp=FieldValue.serverTimestamp();
    if(input.operation==='invite_task'){
      if(!input.confirmed||!taskRef)throw permissionDenied();
      const source=await tx.get(taskRef),task=source.data();
      if(!task||task.schoolId!==input.schoolId||task.createdBy!==actor.uid||task.listId)throw permissionDenied();
      const people=await Promise.all(input.recipientIds.map(uid=>tx.get(adminDb.doc(`users/${uid}`))));
      if(people.some(snap=>!snap.exists||(snap.data().accountStatus&&snap.data().accountStatus!=='active')||!(snap.data().schoolId===input.schoolId||snap.data().schoolIds?.includes(input.schoolId))))throw permissionDenied();
      for(const uid of input.recipientIds.filter(uid=>uid!==actor.uid)){
        const invitationId=hash(taskRef.path,uid);
        tx.set(adminDb.doc(`${root}/taskListInvitations/${invitationId}`),{kind:'task',taskId:input.taskId,sourcePath:taskRef.path,recipientId:uid,inviterId:actor.uid,schoolId:input.schoolId,title:task.title,status:'pending',createdAt:stamp});
        tx.set(adminDb.doc(`notifications/task_invite_${operationId}_${uid}`),{userId:uid,schoolId:input.schoolId,title:'הזמנה למשימה משותפת',body:task.title,link:'/tasks',type:'task',read:false,createdAt:stamp});
      }
    } else {
      if(!input.invitationId)throw permissionDenied();
      const ref=adminDb.doc(`${root}/taskListInvitations/${input.invitationId}`),invitation=(await tx.get(ref)).data();
      if(!invitation||invitation.kind!=='task'||invitation.recipientId!==actor.uid||invitation.status!=='pending')throw permissionDenied();
      const sourceRef=adminDb.doc(invitation.sourcePath),source=(await tx.get(sourceRef)).data();
      if(!source)throw fail('המשימה אינה זמינה.');
      const sharedRef=source.scope==='personal'?adminDb.doc(`${root}/tasks/shared_${hash(invitation.inviterId,invitation.taskId)}`):sourceRef;
      const existing=(await tx.get(sharedRef)).data();
      if(input.accept){
        let task=initializeAssignments(existing||{...source,assignmentVersion:1,scope:'shared',assigneeIds:[invitation.inviterId]});
        task=reconcileSource(task,'direct',uniqueIds([...assignedIds(task),actor.uid]));
        tx.set(sharedRef,{...task,ownerId:'',scope:'shared',assigneeType:'participants',participantIds:uniqueIds([...(task.participantIds||[]),...assignedIds(task)]),updatedAt:stamp});
        if(source.scope==='personal')tx.update(sourceRef,{redirectedTo:sharedRef.id,updatedAt:stamp});
      }
      tx.update(ref,{status:input.accept?'accepted':'declined',updatedAt:stamp});
    }
    const result={ok:true};tx.create(receiptRef,{result,actorUid:actor.uid,createdAt:stamp});return result;
  });
}
