// Zoki provider backed by our Worker (local school model such as DictaLM, or Claude).
// Deliberately conservative: no school records leave the browser, the model only gets the
// conversation plus vetted regulation/milestone text, and it can never propose an action.
const CONTEXT_CHARS = 5500;

export function knowledgeContext(input) {
  const parts = [];
  for (const entry of input.knowledge || []) parts.push(`- ${entry.title}: ${JSON.stringify(entry).slice(0, 900)}`);
  if (input.upcomingMilestones) parts.push(`תאריכים קרובים:\n${typeof input.upcomingMilestones === 'string' ? input.upcomingMilestones : JSON.stringify(input.upcomingMilestones)}`);
  return parts.join('\n').slice(0, CONTEXT_CHARS);
}

export class WorkerZokiProvider {
  constructor(schoolId) { this.schoolId = schoolId; }

  // No school records are shared with the Worker model, so there is nothing to select.
  async selectSources() { return { sourceIds: [] }; }

  async generateTurn(input) {
    const messages = [...(input.history || []).map(item => ({ role: item.role, content: item.text })), { role: 'user', content: input.question }];
    // Loaded on demand so importing this module never initialises Firebase.
    const { askRoleAgent } = await import('./zokiClaudeService.js');
    const { reply } = await askRoleAgent({ schoolId: this.schoolId, messages, context: knowledgeContext(input) });
    if (!reply) throw Object.assign(new Error('agent-unavailable'), { code: 'agent-unavailable' });
    return { answer: reply, actionIntent: 'none', actionRequest: '', actionTargetType: 'none', actionTargetLabel: '', staffRoleDraft: null, taskDraft: null, sourceIds: [], memoryMutations: [] };
  }
}

export const isWorkerProviderEnabled = () => import.meta.env?.VITE_ZOKI_PROVIDER === 'worker' && Boolean(import.meta.env?.VITE_ZOKI_WORKER_URL);
