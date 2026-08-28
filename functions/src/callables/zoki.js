import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { CALLABLE_OPTIONS } from '../config.js';
import { isPrincipalFor, requireActor } from '../services/authorization.js';
import { writeAuditLog } from '../services/audit.js';
import { adminDb } from '../services/firebaseAdmin.js';
import { permissionDenied, toPublicError } from '../services/errors.js';
import { enforceRateLimit } from '../services/rateLimit.js';
import { loadZokiContext, loadZokiTaskGuidance } from '../services/zokiContext.js';
import { GEMINI_API_KEY, GEMINI_ZOKI_MODEL, requestGeminiZokiAnswer, requestGeminiZokiFileText } from '../services/geminiZoki.js';

const historyItemSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().trim().min(1).max(5000),
}).strict();
const inputSchema = z.object({
  schoolId: z.string().trim().min(1).max(128),
  question: z.string().trim().min(2).max(2000),
  history: z.array(historyItemSchema).max(8).optional().default([]),
}).strict();
const schoolInputSchema = z.object({ schoolId: z.string().trim().min(1).max(128) }).strict();
const brainAudienceSchema = z.object({
  type: z.enum(['school', 'roles', 'users']),
  roleIds: z.array(z.string().trim().min(1).max(128)).max(50).default([]),
  userIds: z.array(z.string().trim().min(1).max(128)).max(50).default([]),
}).strict();
const brainEntrySchema = z.object({
  id: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(6000),
  category: z.string().trim().max(80).default(''),
  validUntil: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/u)]).default(''),
  status: z.enum(['draft', 'published']),
  audience: brainAudienceSchema,
}).strict();
const saveBrainSchema = z.object({
  schoolId: z.string().trim().min(1).max(128),
  instructions: z.string().trim().max(8000).default(''),
  entries: z.array(brainEntrySchema).max(100),
}).strict();

function authorizeSchool(actor, schoolId) {
  if (actor.platformAdmin || (!actor.globalAdmin && !actor.schoolIds.has(schoolId))) throw permissionDenied();
}

function safeGradeAction({ generated, context, question, sourceIds }) {
  const action = generated?.actionProposal;
  if (!action || action.type !== 'grade_update' || !context.capabilities?.canEditGrades) return null;
  if (!/(?:הזן|הכנס|עדכן|שנה|קבע|תן|רשום|להזין|להכניס|לעדכן|לשנות|לקבוע|לרשום)/u.test(question)) return null;
  if (!sourceIds.includes(action.sourceId)) return null;
  const source = context.sources.find(item => item.id === action.sourceId && item.type === 'grade');
  if (!source) return null;
  const subject = (Array.isArray(source.fields?.subjects) ? source.fields.subjects : []).find(item => item?.id === action.subjectId);
  const component = (Array.isArray(subject?.components) ? subject.components : []).find(item => item?.id === action.componentId);
  const score = Number(action.score);
  if (!subject || !component || !Number.isFinite(score) || score < 0 || score > 100) return null;
  const previousValue = source.fields?.scores?.[subject.id]?.[component.id];
  const previousScore = previousValue === '' || previousValue === null || previousValue === undefined ? null : Number(previousValue);
  if (previousScore !== null && !Number.isFinite(previousScore)) return null;
  return {
    type: 'grade_update',
    gradebookId: source.fields.gradebookId,
    studentId: source.fields.studentId,
    studentName: source.fields.studentName,
    className: source.fields.className,
    subjectId: subject.id,
    subjectName: subject.name || '',
    componentId: component.id,
    componentName: component.name || '',
    previousScore,
    score,
  };
}

function safeStudentTransferAction({ generated, context, question, sourceIds }) {
  const action = generated?.actionProposal;
  if (!action || action.type !== 'student_transfer' || !context.capabilities?.canTransferStudents) return null;
  if (!/(?:העבר|העביר|שבץ|שבצי|שינוי שיבוץ|מעבר|העברה)/u.test(question)) return null;
  if (!sourceIds.includes(action.studentSourceId) || !sourceIds.includes(action.targetClassSourceId)) return null;
  const studentSource = context.sources.find(item => item.id === action.studentSourceId && item.type === 'student');
  const classSource = context.sources.find(item => item.id === action.targetClassSourceId && item.type === 'class');
  const effectiveDate = String(action.effectiveDate || '').trim();
  if (!studentSource || !classSource || !/^\d{4}-\d{2}-\d{2}$/u.test(effectiveDate)) return null;
  if (!studentSource.fields?.id || !classSource.fields?.id || studentSource.fields.classId === classSource.fields.id) return null;
  return {
    type: 'student_transfer',
    studentId: studentSource.fields.id,
    studentName: studentSource.fields.fullName,
    expectedCurrentClassId: studentSource.fields.classId || '',
    currentClassName: studentSource.fields.className || '',
    targetClassId: classSource.fields.id,
    targetClassName: classSource.fields.name || '',
    targetGradeLevel: classSource.fields.gradeLevel || '',
    effectiveDate,
    reason: String(action.reason || '').trim().slice(0, 500),
  };
}

function safeActionProposal(args) {
  return safeGradeAction(args) || safeStudentTransferAction(args);
}

export async function askZokiHandler(request, dependencies = {}) {
  const actor = await requireActor(request);
  const input = inputSchema.parse(request.data);
  authorizeSchool(actor, input.schoolId);
  await enforceRateLimit({ uid: actor.uid, action: 'zoki.ask', limit: 20, windowSeconds: 300 });
  const apiKey = dependencies.apiKey ?? GEMINI_API_KEY.value();
  const model = dependencies.model || GEMINI_ZOKI_MODEL.value();
  const recentUserQuestions = input.history.filter(item => item.role === 'user').slice(-3).map(item => item.text);
  const retrievalQuestion = [...recentUserQuestions, input.question].join('\n');
  const context = await loadZokiContext({
    actor, schoolId: input.schoolId, question: retrievalQuestion,
    imageTextExtractor: args => requestGeminiZokiFileText({
      ...args, apiKey, model, fetchImpl: dependencies.fileFetchImpl || dependencies.fetchImpl,
    }),
  });
  const generated = await requestGeminiZokiAnswer({
    apiKey, model,
    fetchImpl: dependencies.fetchImpl, question: input.question, history: input.history, context,
  });
  const allowedIds = new Set(context.sources.map(item => item.id));
  const sourceIds = [...new Set((generated.sourceIds || []).filter(id => allowedIds.has(id)))].slice(0, 8);
  const actionProposal = safeActionProposal({ generated, context, question: input.question, sourceIds });
  await writeAuditLog({
    actorUid: actor.uid,
    actorRole: actor.data.rolesBySchool?.[input.schoolId] || actor.data.role || '',
    action: 'zoki.ask',
    targetType: 'zoki',
    schoolId: input.schoolId,
    metadata: {
      questionLength: input.question.length,
      historyItemCount: input.history.length,
      authorizedSourceCount: context.sources.length,
      citedSourceCount: sourceIds.length,
      deniedAreaCount: context.denied.length,
      sourceTypes: [...new Set(context.sources.map(item => item.type))].slice(0, 20).join(','),
      proposedAction: actionProposal?.type || '',
    },
  });
  return {
    answer: String(generated.answer || '').slice(0, 5000), followUpQuestion: generated.followUpQuestion || null,
    sources: context.sources.filter(item => sourceIds.includes(item.id)).map(item => ({ id: item.id, type: item.type, label: item.label, route: item.route })),
    capabilities: context.capabilities,
    actionProposal,
  };
}

export async function getZokiTaskGuidanceHandler(request) {
  const actor = await requireActor(request);
  const input = schoolInputSchema.parse(request.data);
  authorizeSchool(actor, input.schoolId);
  return loadZokiTaskGuidance({ actor, schoolId: input.schoolId });
}

async function validateBrainAudience(schoolId, entries) {
  const roleIds = [...new Set(entries.flatMap(entry => entry.audience.type === 'roles' ? entry.audience.roleIds : []))];
  const userIds = [...new Set(entries.flatMap(entry => entry.audience.type === 'users' ? entry.audience.userIds : []))];
  if (entries.some(entry => (entry.audience.type === 'roles' && entry.audience.roleIds.length === 0)
    || (entry.audience.type === 'users' && entry.audience.userIds.length === 0))) throw permissionDenied();
  if (roleIds.length) {
    const [nested, legacy] = await Promise.all([
      adminDb.getAll(...roleIds.map(id => adminDb.doc(`schools/${schoolId}/roleDefinitions/${id}`))),
      adminDb.getAll(...roleIds.map(id => adminDb.doc(`roles_${schoolId}/${id}`))),
    ]);
    if (roleIds.some((id, index) => !(nested[index].exists || (legacy[index].exists && (!legacy[index].data().schoolId || legacy[index].data().schoolId === schoolId))))) throw permissionDenied();
  }
  if (userIds.length) {
    const users = await adminDb.getAll(...userIds.map(id => adminDb.doc(`users/${id}`)));
    if (users.some(snapshot => {
      if (!snapshot.exists) return true;
      const data = snapshot.data();
      return data.schoolId !== schoolId && !(Array.isArray(data.schoolIds) && data.schoolIds.includes(schoolId));
    })) throw permissionDenied();
  }
}

export async function saveZokiBrainHandler(request) {
  const actor = await requireActor(request);
  const input = saveBrainSchema.parse(request.data);
  if (actor.platformAdmin || (!actor.globalAdmin && !isPrincipalFor(actor, input.schoolId))) throw permissionDenied();
  if (new Set(input.entries.map(entry => entry.id)).size !== input.entries.length) throw permissionDenied();
  await validateBrainAudience(input.schoolId, input.entries);
  const ref = adminDb.doc(`schools/${input.schoolId}/settings/zoki_brain`);
  const previous = await ref.get();
  const publishedCount = input.entries.filter(entry => entry.status === 'published').length;
  await ref.set({
    schoolId: input.schoolId,
    instructions: input.instructions,
    entries: input.entries,
    updatedBy: actor.uid,
    updatedAt: FieldValue.serverTimestamp(),
    revision: FieldValue.increment(1),
  }, { merge: true });
  await writeAuditLog({
    actorUid: actor.uid,
    actorRole: actor.data.rolesBySchool?.[input.schoolId] || actor.data.role || '',
    action: 'zoki.brain.update',
    targetType: 'zokiBrain',
    targetId: 'zoki_brain',
    schoolId: input.schoolId,
    before: { entryCount: Array.isArray(previous.data()?.entries) ? previous.data().entries.length : 0 },
    after: { entryCount: input.entries.length, publishedCount },
    metadata: { instructionsChanged: previous.data()?.instructions !== input.instructions },
  });
  return { entries: input.entries, entryCount: input.entries.length, publishedCount };
}

export const askZoki = onCall({ ...CALLABLE_OPTIONS, timeoutSeconds: 60, secrets: [GEMINI_API_KEY] }, async request => {
  try { return await askZokiHandler(request); }
  catch (error) { logger.error('Zoki request failed.', { code: error?.code || 'unknown' }); throw toPublicError(error); }
});

export const getZokiTaskGuidance = onCall(CALLABLE_OPTIONS, async request => {
  try { return await getZokiTaskGuidanceHandler(request); }
  catch (error) { logger.error('Zoki task guidance request failed.', { code: error?.code || 'unknown' }); throw toPublicError(error); }
});

export const saveZokiBrain = onCall(CALLABLE_OPTIONS, async request => {
  try { return await saveZokiBrainHandler(request); }
  catch (error) { logger.error('Zoki brain update failed.', { code: error?.code || 'unknown' }); throw toPublicError(error); }
});
