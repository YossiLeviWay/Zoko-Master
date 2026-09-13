import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../../firebase.js';
import { privateSessionGuard } from '../../utils/browserPrivacy.js';

// Only tasks explicitly created by the local pilot use this Spark path. Other
// task operations retain the existing backend and rollout switches.
export async function updatePilotTaskProgress(input) {
  if (input.storage === 'personal' || input.storage === 'legacy' || !auth.currentUser || !['todo', 'in_progress', 'done'].includes(input.status)) return null;
  const valid = privateSessionGuard();
  const uid = auth.currentUser.uid;
  const ref = doc(db, 'schools', input.schoolId, 'tasks', input.taskId);
  return runTransaction(db, async tx => {
    valid();
    const snapshot = await tx.get(ref); const task = snapshot.data();
    if (!task?.localPilot) return null;
    if (task.status === 'archived' || !task.assigneeIds.includes(uid)) throw new Error('permission-denied');
    const previous = task.progressBy[uid].status;
    const completionCount = task.completionCount + Number(input.status === 'done') - Number(previous === 'done');
    const startedCount = task.startedCount + Number(input.status !== 'todo') - Number(previous !== 'todo');
    const status = completionCount === task.assigneeIds.length ? 'done' : startedCount ? 'in_progress' : 'todo';
    valid();
    tx.update(ref, { progressBy: { ...task.progressBy, [uid]: { status: input.status, inherited: false, updatedAt: serverTimestamp() } }, completionCount, startedCount, status, completedAt: status === 'done' ? serverTimestamp() : null, updatedAt: serverTimestamp() });
    return { ok: true };
  });
}

export async function updatePilotTaskDetails(input) {
  if (input.storage === 'personal' || input.storage === 'legacy' || !auth.currentUser) return null;
  const valid = privateSessionGuard(); const uid = auth.currentUser.uid;
  return runTransaction(db, async tx => {
    valid(); const ref = doc(db, 'schools', input.schoolId, 'tasks', input.taskId);
    const task = (await tx.get(ref)).data(); if (!task?.localPilot) return null;
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 180) throw new Error('invalid-input');
    const patch = { title: input.title.trim(), description: input.description ?? task.description, dueDate: input.dueDate ?? task.dueDate, updatedBy: uid, updatedAt: serverTimestamp() };
    if (typeof patch.description !== 'string' || patch.description.length > 8000 || (patch.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(patch.dueDate))) throw new Error('invalid-input');
    valid(); tx.update(ref, patch); return { ok: true };
  });
}
