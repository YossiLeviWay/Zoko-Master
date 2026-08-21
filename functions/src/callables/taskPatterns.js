import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { CALLABLE_OPTIONS } from '../config.js';
import { requireActor, requireSchoolManager } from '../services/authorization.js';
import { adminDb } from '../services/firebaseAdmin.js';
import { toPublicError } from '../services/errors.js';
import { writeAuditLog } from '../services/audit.js';

const listSchema = z.object({ schoolId: z.string().trim().min(1).max(128), limit: z.number().int().min(1).max(50).default(25) }).strict();
const reviewSchema = z.object({
  schoolId: z.string().trim().min(1).max(128),
  patternId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),
  decision: z.enum(['approve', 'reject']),
  name: z.string().trim().min(2).max(120).optional(),
}).strict();

export async function listTaskPatternCandidatesHandler(request) {
  const actor = await requireActor(request);
  const input = listSchema.parse(request.data);
  requireSchoolManager(actor, input.schoolId);
  const snapshot = await adminDb.collection(`schools/${input.schoolId}/taskPatterns`)
    .where('status', '==', 'candidate').orderBy('evidenceCount', 'desc').limit(input.limit).get();
  return { patterns: snapshot.docs.map(item => {
    const data = item.data();
    return {
      id: item.id,
      name: data.name || '',
      domain: data.domain || '',
      normalizedIntent: data.normalizedIntent || '',
      evidenceCount: data.evidenceCount || 0,
      successCount: data.successCount || 0,
      confidence: data.confidence || 0,
      teamIds: data.teamIds || [],
      collaboratorIds: data.collaboratorIds || [],
      steps: data.steps || [],
      commonDocuments: data.commonDocuments || [],
    };
  }) };
}

export async function reviewTaskPatternHandler(request) {
  const actor = await requireActor(request);
  const input = reviewSchema.parse(request.data);
  requireSchoolManager(actor, input.schoolId);
  const ref = adminDb.doc(`schools/${input.schoolId}/taskPatterns/${input.patternId}`);
  const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.data().status !== 'candidate') throw new Error('pattern-not-found');
  await ref.update({
    status: input.decision === 'approve' ? 'approved' : 'rejected',
    ...(input.name ? { name: input.name } : {}),
    reviewedBy: actor.uid,
    reviewedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await writeAuditLog({ actorUid: actor.uid, action: `task_pattern.${input.decision}`, targetUid: input.patternId, schoolId: input.schoolId });
  return { ok: true };
}

function safe(handler, label) {
  return async request => {
    try { return await handler(request); }
    catch (error) {
      logger.error(`${label} failed.`, { code: error?.code || error?.message || 'unknown' });
      throw toPublicError(error);
    }
  };
}

export const listTaskPatternCandidates = onCall(CALLABLE_OPTIONS, safe(listTaskPatternCandidatesHandler, 'List task patterns'));
export const reviewTaskPattern = onCall(CALLABLE_OPTIONS, safe(reviewTaskPatternHandler, 'Review task pattern'));
