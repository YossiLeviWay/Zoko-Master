// Zoki provider backed by our Worker (local school model such as DictaLM, or Claude).
// The browser sends the conversation plus vetted regulation/milestone text. The Worker adds the
// institutional knowledge the user may see and may return an action PROPOSAL, which only enters the
// existing approval flow; nothing is executed from here.
import { replyWithoutFalseSave, teachingNote } from '../../worker/src/zokiTurn.js';

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
    const { reply, proposals = [] } = await askRoleAgent({ schoolId: this.schoolId, messages, context: knowledgeContext(input), onToken: input.onToken });
    if (!reply) throw Object.assign(new Error('agent-unavailable'), { code: 'agent-unavailable' });
    // Only task creation has an approval screen today. Other proposals are shown as text and executed by nobody.
    const task = proposals.find(item => item?.tool === 'create_task' && item.input?.title);
    const others = proposals.filter(item => item !== task).map(item => `הצעה (עדיין לא ניתנת לאישור כאן): ${item.tool}`);
    const note = teachingNote(input.question);
    return {
      answer: replyWithoutFalseSave([reply, ...others].join('\n'), Boolean(note)),
      actionIntent: task ? 'create_task' : 'none',
      actionRequest: task ? [task.input.title, task.input.description].filter(Boolean).join('. ') : '',
      actionTargetType: 'none', actionTargetLabel: '', staffRoleDraft: null,
      taskDraft: task ? { title: task.input.title.slice(0, 180), dueDate: /^\d{4}-\d{2}-\d{2}$/u.test(task.input.dueDate || '') ? task.input.dueDate : '', teamName: '', memberNames: [] } : null,
      sourceIds: [],
      // "Remember that ..." is kept as this user's own memory (the existing memory layer checks it and honours the learning switch).
      memoryMutations: note ? [{ operation: 'upsert', type: 'preference', content: note, sourceIds: ['user'] }] : [],
    };
  }
}

export const isWorkerProviderEnabled = () => import.meta.env?.VITE_ZOKI_PROVIDER === 'worker' && Boolean(import.meta.env?.VITE_ZOKI_WORKER_URL);
