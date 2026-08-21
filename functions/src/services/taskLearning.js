import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebaseAdmin.js';
import { requestGeminiEmbedding } from './geminiTaskAgent.js';

const clean = (value, max = 180) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const ids = value => [...new Set((Array.isArray(value) ? value : []).filter(item => typeof item === 'string' && item))].slice(0, 50);
const STOP = new Set(['של', 'את', 'עם', 'על', 'עבור', 'משימה', 'צריך', 'צריכה', 'חדש', 'חדשה', 'לכל']);

export function normalizedTaskIntent(task = {}) {
  return clean(task.title, 500).toLocaleLowerCase('he')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/u)
    .filter(word => word.length > 1 && !STOP.has(word))
    .slice(0, 12)
    .sort()
    .join(' ');
}

export function taskDomain(task = {}) {
  const source = `${task.title || ''} ${task.description || ''}`;
  if (/מבחן|מבחנים|בחינה|בחינות|הערכה/u.test(source)) return 'exams';
  if (/טיול|סיור|מסע/u.test(source)) return 'trips';
  if (/טקס|אירוע|מסיבה/u.test(source)) return 'events';
  if (/הורה|הורים/u.test(source)) return 'parents';
  if (/פדגוג|הוראה|למידה/u.test(source)) return 'pedagogy';
  if (/בטיחות|חירום|ביטחון/u.test(source)) return 'safety';
  return 'general';
}

export function taskPatternId(task = {}) {
  const value = `${taskDomain(task)}:${normalizedTaskIntent(task) || 'general'}`;
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function taskShape(task = {}) {
  return {
    normalizedIntent: normalizedTaskIntent(task),
    domain: taskDomain(task),
    teamIds: ids([task.teamId, task.assigneeTeamId].filter(Boolean)),
    collaboratorIds: ids([...(task.responsibleIds || []), ...(task.partnerIds || []), ...(task.informedIds || []), ...(task.participantIds || [])]),
    responsibleIds: ids(task.responsibleIds),
    partnerIds: ids(task.partnerIds),
    informedIds: ids(task.informedIds),
    classIds: ids(task.classIds),
    steps: (Array.isArray(task.workPlanSteps) ? task.workPlanSteps : []).slice(0, 20).map(step => ({
      title: clean(step?.title, 180), phase: clean(step?.phase, 80), relativeDays: Number(step?.relativeDays) || 0,
    })).filter(step => step.title),
    commonDocuments: ids(task.commonDocuments),
  };
}

async function updatePersonalProfile({ uid, schoolId, task }) {
  if (!uid || !schoolId) return;
  const shape = taskShape(task);
  const update = {
    schoolId,
    userId: uid,
    createdCount: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  };
  shape.teamIds.forEach(id => { update[`teamFrequency.${id}`] = FieldValue.increment(1); });
  shape.collaboratorIds.forEach(id => { update[`collaboratorFrequency.${id}`] = FieldValue.increment(1); });
  if (shape.domain) update[`domainFrequency.${shape.domain}`] = FieldValue.increment(1);
  await adminDb.doc(`users/${uid}/taskAgentProfiles/${schoolId}`).set(update, { merge: true });
}

async function sessionDiff(schoolId, task) {
  if (!task.agentSessionId) return null;
  const snapshot = await adminDb.doc(`schools/${schoolId}/taskAgentSessions/${task.agentSessionId}`).get();
  if (!snapshot.exists || snapshot.data().actorId !== task.createdBy) return null;
  const suggestion = snapshot.data().proposal || {};
  const suggestedIds = Object.values(suggestion.assignmentPlan || {}).flatMap(items => ids(items?.map(item => item.id)));
  const finalIds = taskShape(task).collaboratorIds;
  return {
    sessionId: task.agentSessionId,
    acceptedCollaboratorIds: finalIds.filter(id => suggestedIds.includes(id)),
    removedCollaboratorIds: suggestedIds.filter(id => !finalIds.includes(id)),
    titleChanged: clean(suggestion.title, 180) !== clean(task.title, 180),
    stepsChanged: (suggestion.workPlanSteps || []).length !== (task.workPlanSteps || []).length,
    commonDocuments: ids(suggestion.commonDocuments),
    suggestedDomain: clean(suggestion.domain, 80),
  };
}

export async function recordTaskCreated({ schoolId, taskId, task, apiKey = '', embeddingModel = 'gemini-embedding-001' }) {
  if (!schoolId || !taskId || !task?.createdBy) return;
  await updatePersonalProfile({ uid: task.createdBy, schoolId, task });
  if (task.scope === 'personal') return;
  const shape = taskShape(task);
  const patternId = taskPatternId(task);
  const diff = await sessionDiff(schoolId, task);
  if (!shape.commonDocuments.length && diff?.commonDocuments?.length) shape.commonDocuments = diff.commonDocuments;
  if (shape.domain === 'general' && diff?.suggestedDomain) shape.domain = diff.suggestedDomain;
  const embeddingValues = await requestGeminiEmbedding({ apiKey, model: embeddingModel, text: shape.normalizedIntent }).catch(() => null);
  const eventRef = adminDb.doc(`schools/${schoolId}/taskLearningEvents/create_${taskId}`);
  await eventRef.set({
    schoolId,
    taskId,
    actorId: task.createdBy,
    eventType: 'created',
    creationSource: task.creationSource === 'agent' ? 'agent' : 'manual',
    patternId,
    ...shape,
    suggestionDiff: diff,
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: false });
  const patternRef = adminDb.doc(`schools/${schoolId}/taskPatterns/${patternId}`);
  await adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(patternRef);
    const current = snapshot.exists ? snapshot.data() : {};
    transaction.set(patternRef, {
      schoolId,
      name: current.name || clean(task.title, 120),
      status: current.status === 'approved' ? 'approved' : current.status === 'rejected' ? 'rejected' : 'candidate',
      ...shape,
      evidenceCount: Number(current.evidenceCount || 0) + 1,
      successCount: Number(current.successCount || 0),
      confidence: Math.min(0.95, 0.25 + (Number(current.evidenceCount || 0) + 1) * 0.1),
      sourceTaskIds: [...new Set([...(current.sourceTaskIds || []), taskId])].slice(-25),
      ...(embeddingValues ? { embedding: FieldValue.vector(embeddingValues) } : {}),
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: current.createdAt || FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

export async function recordTaskCompleted({ schoolId, taskId, task }) {
  if (!schoolId || !taskId || task?.scope === 'personal') return;
  const patternId = taskPatternId(task);
  await Promise.all([
    adminDb.doc(`schools/${schoolId}/taskLearningEvents/completed_${taskId}`).set({
      schoolId, taskId, actorId: task.createdBy || '', eventType: 'completed', patternId,
      completedAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp(),
    }, { merge: false }),
    adminDb.doc(`schools/${schoolId}/taskPatterns/${patternId}`).set({
      successCount: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
  ]);
}
