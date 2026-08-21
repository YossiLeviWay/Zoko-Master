import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { CALLABLE_OPTIONS } from '../config.js';
import { requireActor } from '../services/authorization.js';
import { toPublicError, permissionDenied } from '../services/errors.js';
import { enforceRateLimit } from '../services/rateLimit.js';
import { GEMINI_API_KEY, GEMINI_EMBEDDING_MODEL, GEMINI_TASK_MODEL, requestGeminiEmbedding, requestGeminiTaskProposal } from '../services/geminiTaskAgent.js';
import { adminDb } from '../services/firebaseAdmin.js';
import {
  loadTaskAgentContext,
  localTaskAgentProposal,
  saveTaskAgentSession,
  validateTaskAgentProposal,
} from '../services/taskAgentContext.js';

const inputSchema = z.object({
  schoolId: z.string().trim().min(1).max(128),
  request: z.string().trim().min(3).max(1800),
  answer: z.string().trim().max(500).default(''),
  currentProposal: z.record(z.string(), z.unknown()).nullable().default(null),
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
  const apiKey = dependencies.apiKey ?? GEMINI_API_KEY.value();
  const queryVector = await requestGeminiEmbedding({
    apiKey,
    model: dependencies.embeddingModel || GEMINI_EMBEDDING_MODEL.value(),
    text: input.request,
    fetchImpl: dependencies.fetchImpl,
  }).catch(() => null);
  const context = await loadTaskAgentContext({ actor, schoolId: input.schoolId, request: input.request, queryVector });
  const localProposal = localTaskAgentProposal(input.request, context);
  let generated = null;
  try {
    generated = await requestGeminiTaskProposal({
      apiKey,
      model: dependencies.model || GEMINI_TASK_MODEL.value(),
      fetchImpl: dependencies.fetchImpl,
      input: {
        ...input,
        organizationContext: {
          grade: context.grade,
          staff: context.staff,
          teams: context.teams,
          roles: context.roles,
          classes: context.classes,
          calendar: context.calendar,
          approvedPatterns: context.patterns,
          personalPreferences: context.personalProfile,
        },
      },
    });
  } catch (error) {
    if (dependencies.failOnProviderError) throw error;
    logger.warn('Gemini task proposal unavailable; using institutional fallback.', { code: error?.code || 'unknown' });
  }
  const localPartyCount = Object.values(localProposal.assignmentPlan || {}).flat().length;
  const merged = generated ? {
    ...localProposal,
    ...generated,
    assignmentPlan: localPartyCount ? localProposal.assignmentPlan : generated.assignmentPlan,
    workPlanSteps: localProposal.workPlanSteps.length ? localProposal.workPlanSteps : generated.workPlanSteps,
    commonDocuments: localProposal.commonDocuments.length ? localProposal.commonDocuments : generated.commonDocuments,
    domain: localProposal.domain || generated.domain,
    playbookId: localProposal.playbookId,
    confidence: localProposal.confidence,
  } : localProposal;
  const proposal = validateTaskAgentProposal(merged, context);
  const sessionId = await saveTaskAgentSession({ actor, schoolId: input.schoolId, request: input.request, proposal, capabilities: context.capabilities });
  return { sessionId, proposal, capabilities: context.capabilities };
}

export const draftTaskWithAgent = onCall({ ...CALLABLE_OPTIONS, timeoutSeconds: 45, secrets: [GEMINI_API_KEY] }, async request => {
  try { return await draftTaskWithAgentHandler(request); }
  catch (error) {
    logger.error('Task agent operation failed.', { code: error?.code || 'unknown' });
    throw toPublicError(error);
  }
});
