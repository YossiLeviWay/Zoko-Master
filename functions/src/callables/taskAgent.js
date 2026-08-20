import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { CALLABLE_OPTIONS } from '../config.js';
import { requireActor } from '../services/authorization.js';
import { toPublicError, permissionDenied } from '../services/errors.js';
import { enforceRateLimit } from '../services/rateLimit.js';
import { GEMINI_API_KEY, GEMINI_TASK_MODEL, requestGeminiTaskProposal } from '../services/geminiTaskAgent.js';
import { adminDb } from '../services/firebaseAdmin.js';

const nullableText = z.string().max(2000).nullable().optional();
const inputSchema = z.object({
  schoolId: z.string().trim().min(1).max(128),
  request: z.string().trim().min(3).max(1800),
  answer: z.string().trim().max(500).default(''),
  currentProposal: z.record(z.string(), z.unknown()).nullable().default(null),
  organizationContext: z.object({
    domain: nullableText,
    grade: nullableText,
    matchingTeamLabels: z.array(z.string().max(120)).max(5).default([]),
    relevantRoleLabels: z.array(z.string().max(120)).max(5).default([]),
    classLabels: z.array(z.string().max(120)).max(8).default([]),
    blockedDates: z.array(z.object({ title: z.string().max(180), startDate: z.string().max(30), endDate: z.string().max(30) })).max(20).default([]),
    relatedInitiativeLabels: z.array(z.string().max(180)).max(5).default([]),
    approvedRules: z.array(z.string().max(300)).max(10).default([]),
  }).strict(),
}).strict();

async function requireApprovedSchoolMember(actor, schoolId) {
  if (actor.globalAdmin || actor.schoolIds.has(schoolId)) return;
  const membership = await adminDb.doc(`schools/${schoolId}/memberships/${actor.uid}`).get();
  if (!membership.exists || membership.data().status !== 'active') throw permissionDenied();
}

export async function draftTaskWithAgentHandler(request, dependencies = {}) {
  const actor = await requireActor(request);
  const input = inputSchema.parse(request.data);
  if (actor.platformAdmin) throw permissionDenied();
  await requireApprovedSchoolMember(actor, input.schoolId);
  await enforceRateLimit({ uid: actor.uid, action: 'tasks.agent', limit: 6, windowSeconds: 300 });
  const proposal = await requestGeminiTaskProposal({
    apiKey: dependencies.apiKey ?? GEMINI_API_KEY.value(),
    model: dependencies.model || GEMINI_TASK_MODEL.value(),
    fetchImpl: dependencies.fetchImpl,
    input,
  });
  return { proposal };
}

export const draftTaskWithAgent = onCall({ ...CALLABLE_OPTIONS, timeoutSeconds: 45, secrets: [GEMINI_API_KEY] }, async request => {
  try { return await draftTaskWithAgentHandler(request); }
  catch (error) {
    logger.error('Task agent operation failed.', { code: error?.code || 'unknown' });
    throw toPublicError(error);
  }
});
