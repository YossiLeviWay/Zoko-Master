import { serverTimestamp, setDoc } from 'firebase/firestore';
import { normalizeTaskPlaybook, resolveTaskPlaybooks } from '../../config/taskPlaybooks.js';
import { schoolDoc } from './paths.js';

const safeRules = rules => [...new Set((Array.isArray(rules) ? rules : [])
  .map(rule => typeof rule === 'string' ? rule.trim().slice(0, 240) : '')
  .filter(Boolean))].slice(0, 20);

export async function saveInstitutionalTaskPlaybook({
  db,
  schoolId,
  playbook,
  currentPlaybooks = [],
  approvedRules = [],
  authorized = false,
  actorId = '',
}) {
  if (!db || !schoolId || !actorId || !authorized) throw new Error('permission-denied');
  const normalized = normalizeTaskPlaybook(playbook);
  const merged = new Map(resolveTaskPlaybooks(currentPlaybooks).map(item => [item.id, item]));
  merged.set(normalized.id, normalized);
  await setDoc(schoolDoc(db, schoolId, 'settings', 'task_agent'), {
    schoolId,
    taskPlaybooks: [...merged.values()],
    approvedRules: safeRules(approvedRules),
    taskPlaybooksUpdatedBy: actorId,
    taskPlaybooksUpdatedAt: serverTimestamp(),
  }, { merge: true });
  return normalized;
}
