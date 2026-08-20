import { FIREBASE_AI_CONFIG } from '../config/firebaseAi';
import { draftTaskWithAgent as callTaskAgent } from './adminUserService';
import { getFirebaseAiRuntimeConfig } from './firebaseAiRuntimeConfig';
import { buildTaskAssistantInput, normalizeTaskAssistantProposal, resolveRelativeTaskDate } from '../utils/taskAssistant';
import { startTaskAssistantStage } from './taskAssistantPerformance';

function publicError(error) {
  const reason = error?.details?.reason || error?.customData?.details?.reason || String(error?.code || '');
  if (['too-short', 'sensitive-content'].includes(reason)) return Object.assign(new Error(reason), { code: reason });
  if (reason.includes('resource-exhausted')) return Object.assign(new Error('quota'), { code: 'resource-exhausted' });
  if (reason.includes('app-check') || reason.includes('unauthenticated')) return Object.assign(new Error('app-check'), { code: 'app-check-failed' });
  if (reason.includes('deadline')) return Object.assign(new Error('timeout'), { code: 'deadline-exceeded' });
  if (reason.includes('not-configured') || reason.includes('failed-precondition')) return Object.assign(new Error('not-configured'), { code: 'agent-not-configured' });
  return Object.assign(new Error('unavailable'), { code: 'agent-unavailable' });
}

export async function draftTaskWithFirebaseAI({ uid, schoolId, request, currentProposal, answer, organizationContext }) {
  if (!uid || !schoolId) throw Object.assign(new Error('not-configured'), { code: 'agent-not-configured' });
  const runtimeConfig = await getFirebaseAiRuntimeConfig();
  if (!runtimeConfig.taskAssistantEnabled) throw Object.assign(new Error('disabled'), { code: 'agent-disabled' });
  const finishPromptBuild = startTaskAssistantStage('promptBuild');
  try {
    buildTaskAssistantInput({ request, currentProposal, answer, organizationContext, maxLength: runtimeConfig.maxInputLength });
  } finally {
    finishPromptBuild();
  }
  const finishGemini = startTaskAssistantStage('geminiCall');
  try {
    const result = await callTaskAgent({ schoolId, request, currentProposal, answer, organizationContext });
    const proposal = normalizeTaskAssistantProposal(result.proposal);
    const deterministicDate = resolveRelativeTaskDate(request);
    return { proposal: deterministicDate ? { ...proposal, dueDate: deterministicDate } : proposal };
  } catch (error) {
    throw publicError(error);
  } finally {
    finishGemini();
  }
}

export function preloadTaskAssistantRuntime() {
  return getFirebaseAiRuntimeConfig();
}

export function taskAssistantErrorMessage(error) {
  if (error?.code === 'sensitive-content') return 'הטקסט עשוי לכלול מידע רגיש. מטעמי פרטיות אפשר להמשיך ביצירה ידנית.';
  if (error?.code === 'agent-not-configured' || error?.code === 'agent-disabled') return 'הסיוע החכם אינו פעיל כרגע. אפשר להמשיך ביצירה ידנית.';
  if (error?.code === 'resource-exhausted') return 'מכסת הסיוע החכם הסתיימה כרגע. אפשר להמשיך ביצירה ידנית.';
  if (error?.code === 'deadline-exceeded') return 'הסוכן לא השיב בזמן. אפשר לנסות שוב או להמשיך ביצירה ידנית.';
  return 'הסיוע החכם אינו זמין כרגע. אפשר להמשיך ביצירה ידנית.';
}

export { FIREBASE_AI_CONFIG };
