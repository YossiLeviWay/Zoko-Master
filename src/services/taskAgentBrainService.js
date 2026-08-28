import { getToken as getAppCheckToken } from 'firebase/app-check';
import { appCheck, auth } from '../firebase';
import { draftTaskWithFirebaseAI } from './firebaseAiTaskService';

const baseUrl = String(import.meta.env.VITE_TASK_AGENT_WORKER_URL || '').replace(/\/$/u, '');
export const isInstitutionalBrainConfigured = Boolean(baseUrl);

async function credentials() {
  const user = auth.currentUser;
  if (!user) throw Object.assign(new Error('unauthenticated'), { code: 'unauthenticated' });
  const [idToken, appCheckResult] = await Promise.all([
    user.getIdToken(),
    appCheck ? getAppCheckToken(appCheck, false).catch(() => null) : Promise.resolve(null),
  ]);
  return { idToken, appCheckToken: appCheckResult?.token || '' };
}

async function workerRequest(path, { method = 'POST', schoolId, body, timeoutMs = 12000 } = {}) {
  if (!baseUrl) throw Object.assign(new Error('brain-not-configured'), { code: 'brain-not-configured' });
  const { idToken, appCheckToken } = await credentials();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const query = method === 'GET' && schoolId ? `?schoolId=${encodeURIComponent(schoolId)}` : '';
    const response = await fetch(`${baseUrl}${path}${query}`, {
      method,
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${idToken}`,
        ...(appCheckToken ? { 'x-firebase-appcheck': appCheckToken } : {}),
        ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
      },
      ...(method === 'POST' ? { body: JSON.stringify({ schoolId, ...(body || {}) }) } : {}),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(result.error || 'brain-unavailable'), { code: result.error || 'brain-unavailable' });
    return result;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function draftTaskWithInstitutionalBrain(input) {
  if (isInstitutionalBrainConfigured) {
    try {
      return await workerRequest('/v1/task-agent/draft', {
        schoolId: input.schoolId,
        body: { request: input.request, answer: input.answer, currentProposal: input.currentProposal },
      });
    } catch (error) {
      if (['too-short', 'sensitive-content'].includes(error?.code)) throw error;
    }
  }
  return draftTaskWithFirebaseAI(input);
}

export async function captureTaskAgentLearning({ schoolId, request, proposal, savedTask }) {
  if (!isInstitutionalBrainConfigured || !schoolId || !savedTask?.id) return { skipped: true };
  return workerRequest('/v1/task-agent/learning/capture', { schoolId, body: { request, proposal, savedTask }, timeoutMs: 15000 });
}

export const listBrainCandidates = schoolId => workerRequest('/v1/task-agent/candidates', { method: 'GET', schoolId });
export const getInstitutionalBrain = schoolId => workerRequest('/v1/task-agent/brain', { method: 'GET', schoolId });
export const previewBrainPattern = (schoolId, pattern) => workerRequest('/v1/task-agent/brain/preview', { schoolId, body: { pattern } });
export const publishBrainPattern = (schoolId, pattern, sourceIds) => workerRequest('/v1/task-agent/brain/publish', { schoolId, body: { pattern, sourceIds }, timeoutMs: 20000 });
export const rejectBrainPattern = (schoolId, sourceIds) => workerRequest('/v1/task-agent/candidates/reject', { schoolId, body: { sourceIds } });
export const syncInstitutionalBrain = (schoolId, snapshot) => workerRequest('/v1/task-agent/brain/sync', { schoolId, body: { snapshot }, timeoutMs: 25000 });
export const listBrainHistory = schoolId => workerRequest('/v1/task-agent/brain/history', { method: 'GET', schoolId });
export const restoreBrainVersion = (schoolId, sha) => workerRequest('/v1/task-agent/brain/restore', { schoolId, body: { sha }, timeoutMs: 20000 });
