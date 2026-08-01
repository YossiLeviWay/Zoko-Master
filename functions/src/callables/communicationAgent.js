import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { CALLABLE_OPTIONS } from '../config.js';
import { requireActor } from '../services/authorization.js';
import { writeAuditLog } from '../services/audit.js';
import { adminDb } from '../services/firebaseAdmin.js';
import { permissionDenied, toPublicError } from '../services/errors.js';
import {
  OPENAI_API_KEY,
  OPENAI_COMMUNICATION_MODEL,
  requestCommunicationProposal,
} from '../services/openaiCommunicationAgent.js';
import { enforceRateLimit } from '../services/rateLimit.js';
import { requireRoleAction, resolveActorRoleAuthority } from '../services/roleAuthorization.js';
import {
  communicationAgentRequestSchema,
  communicationAgentResultSchema,
} from '../validation/schemas.js';

function belongsToSchool(data, schoolId) {
  return data?.schoolId === schoolId || (Array.isArray(data?.schoolIds) && data.schoolIds.includes(schoolId));
}

async function allowedContacts(actor, authority, input) {
  if (input.contactRefs.length === 0) return [];
  const mayViewInstitutional = authority.unrestricted || authority.permissions.has('contacts.view');
  const refs = input.contactRefs.map(item => item.scope === 'private'
    ? adminDb.doc(`users/${actor.uid}/contactDirectory/private/items/${item.id}`)
    : adminDb.doc(`schools/${input.schoolId}/contactDirectory/institutional/items/${item.id}`));
  const snapshots = await adminDb.getAll(...refs);
  return snapshots.flatMap((snapshot, index) => {
    if (!snapshot.exists || snapshot.data().archived === true) return [];
    const requested = input.contactRefs[index];
    const data = snapshot.data();
    if (requested.scope === 'private' && (data.ownerId !== actor.uid || data.schoolId !== input.schoolId)) return [];
    if (requested.scope === 'institutional') {
      const visible = mayViewInstitutional && data.schoolId === input.schoolId && (
        data.visibility === 'institution'
        || data.createdBy === actor.uid
        || (data.ownerStaffIds || []).includes(actor.uid)
        || authority.unrestricted
      );
      if (!visible) return [];
    }
    return [{
      id: snapshot.id,
      scope: requested.scope,
      name: String(data.fullName || '').slice(0, 160),
      organization: String(data.organization || '').slice(0, 160),
      email: String(data.primaryEmail || '').slice(0, 320),
      category: String(data.category || '').slice(0, 80),
    }];
  });
}

async function allowedAssignees(input) {
  if (input.assigneeIds.length === 0) return [];
  const snapshots = await adminDb.getAll(...input.assigneeIds.map(uid => adminDb.doc(`users/${uid}`)));
  return snapshots.flatMap(snapshot => {
    const data = snapshot.data();
    if (!snapshot.exists || data.accountStatus === 'disabled' || !belongsToSchool(data, input.schoolId)) return [];
    return [{
      id: snapshot.id,
      name: String(data.fullName || '').slice(0, 160),
      role: String(data.role || '').slice(0, 80),
    }];
  });
}

export async function draftCommunicationWithAgentHandler(request, dependencies = {}) {
  const actor = await requireActor(request);
  const input = communicationAgentRequestSchema.parse(request.data);
  if (actor.platformAdmin || actor.globalAdmin) throw permissionDenied();
  const authority = await resolveActorRoleAuthority(actor, input.schoolId);
  requireRoleAction(authority, 'communications.useAgent');
  await enforceRateLimit({ uid: actor.uid, action: 'communications.agent', limit: 8, windowSeconds: 300 });
  const [contacts, assignees] = await Promise.all([
    allowedContacts(actor, authority, input),
    allowedAssignees(input),
  ]);
  const result = await requestCommunicationProposal({
    apiKey: dependencies.apiKey ?? OPENAI_API_KEY.value(),
    model: dependencies.model || OPENAI_COMMUNICATION_MODEL.value(),
    fetchImpl: dependencies.fetchImpl,
    input,
    contacts,
    assignees,
    actorUid: actor.uid,
  });
  const proposal = communicationAgentResultSchema.parse(result.proposal);
  await writeAuditLog({
    actorUid: actor.uid,
    actorRole: actor.data.role || '',
    action: 'communication.agent.propose',
    targetType: 'communicationDraftProposal',
    targetId: result.responseId,
    schoolId: input.schoolId,
    metadata: {
      operation: input.operation,
      contextType: input.context.type,
      missingFieldCount: proposal.missingFields.length,
      model: dependencies.model || OPENAI_COMMUNICATION_MODEL.value(),
    },
  });
  return { proposal };
}

const AGENT_OPTIONS = { ...CALLABLE_OPTIONS, timeoutSeconds: 60, secrets: [OPENAI_API_KEY] };

export const draftCommunicationWithAgent = onCall(AGENT_OPTIONS, async request => {
  try {
    return await draftCommunicationWithAgentHandler(request);
  } catch (error) {
    logger.error('Communication agent operation failed.', { code: error?.code || 'unknown' });
    throw toPublicError(error);
  }
});
