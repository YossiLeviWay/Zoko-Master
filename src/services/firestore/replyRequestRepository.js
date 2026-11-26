import { addDoc, getDocs, onSnapshot, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { schoolCollection, schoolDoc } from './paths.js';
import { buildReplyAnswer, buildReplyRequest, rulesNotReady, taskStatusForChoice } from '../../utils/replyRequests.js';
import { updateTaskStatus } from './taskRepository.js';
import { createNotifications } from '../../utils/notifications.js';

export function listenReplyRequests({ db, schoolId, uid, canAssign, onData, onError }) {
  const col = schoolCollection(db, schoolId, 'replyRequests');
  const seen = new Map();
  const publish = () => onData([...seen.values()]);
  const watch = (constraints, bucket) => onSnapshot(query(col, ...constraints), snap => {
    for (const [id, item] of seen) if (item._bucket === bucket) seen.delete(id);
    snap.docs.forEach(item => seen.set(item.id, { id: item.id, ...item.data(), _bucket: bucket }));
    publish();
  }, error => onError?.(error));
  const stops = [
    watch([where('schoolId', '==', schoolId), where('assigneeId', '==', uid)], 'assignee'),
    watch([where('schoolId', '==', schoolId), where('requesterId', '==', uid)], 'requester'),
  ];
  if (canAssign) stops.push(watch([where('schoolId', '==', schoolId)], 'school'));
  return () => stops.forEach(stop => stop());
}

export async function listOpenReplyRequests({ db, schoolId }) {
  const snap = await getDocs(query(schoolCollection(db, schoolId, 'replyRequests'), where('schoolId', '==', schoolId), where('status', '==', 'open')));
  return snap.docs.map(item => ({ id: item.id, ...item.data() }));
}

export async function createReplyRequest({ db, schoolId, actor, input, notify = createNotifications }) {
  const built = buildReplyRequest(input, actor, schoolId);
  if (built.error) throw Object.assign(new Error(built.error), { code: 'invalid-input' });
  const ref = await addDoc(schoolCollection(db, schoolId, 'replyRequests'), {
    ...built.value,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  let notified = false;
  try {
    await notify([built.value.assigneeId], {
      schoolId,
      title: 'בקשת עדכון',
      body: built.value.question,
      type: 'task',
      link: '/',
    });
    notified = true;
  } catch { notified = false; }
  return { id: ref.id, notified };
}

export async function answerReplyRequest({ db, schoolId, actor, request, choice, note, date, task = null }) {
  const built = buildReplyAnswer(request, { choice, note, date }, actor);
  if (built.error) throw Object.assign(new Error(built.error), { code: 'permission-denied' });
  await updateDoc(schoolDoc(db, schoolId, 'replyRequests', request.id), {
    ...built.value,
    updatedAt: serverTimestamp(),
  });
  let taskUpdated = false;
  const status = taskStatusForChoice(choice);
  if (task && request.sourceType === 'task' && status) {
    try {
      await updateTaskStatus({ db, schoolId, uid: actor.uid, task, status });
      taskUpdated = true;
    } catch { taskUpdated = false; }
  }
  return { saved: true, taskUpdated };
}

export function replyFailureText(error) {
  if (rulesNotReady(error)) return 'כללי האבטחה לבקשות עדכון עדיין לא אושרו. לא נשמר דבר.';
  if (error?.code === 'invalid-input') return error.message;
  return 'השמירה נדחתה. לא נשמר דבר.';
}
