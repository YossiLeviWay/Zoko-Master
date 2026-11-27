// Zoki provider backed by our Worker (local school model such as DictaLM, or Claude).
// The browser sends the conversation plus vetted regulation/milestone text. The Worker adds the
// institutional knowledge the user may see and may return an action PROPOSAL, which only enters the
// existing approval flow; nothing is executed from here.
import { proposalFromReply } from '../utils/zokiActions.js';
import { PROPOSAL_LINE } from '../../worker/src/zokiToolRound.js';
import { replyWithStoredMemory, teachingNote } from '../../worker/src/zokiTurn.js';

const CONTEXT_CHARS = 5500;

export function knowledgeContext(input) {
  const parts = [];
  for (const entry of input.knowledge || []) parts.push(`- ${entry.title}: ${JSON.stringify(entry).slice(0, 900)}`);
  if (input.upcomingMilestones) parts.push(typeof input.upcomingMilestones === 'string' ? input.upcomingMilestones : JSON.stringify(input.upcomingMilestones));
  return parts.join('\n').slice(0, CONTEXT_CHARS);
}

export function clientActionFromProposals(userText, proposals = [], earlierText = '') {
  const direct = proposalFromReply(userText, proposals, earlierText);
  if (direct) return direct;
  const legacy = proposals.find(item => item?.tool === 'create_task' && item.input?.title);
  if (!legacy) return null;
  return { tool: 'create_personal_task', input: { title: String(legacy.input.title), dueDate: legacy.input.dueDate || '', description: legacy.input.description || '' } };
}

export function visibleZokiAnswer(reply, hasCard) {
  if (hasCard) return 'הנה מה שיישמר.';
  const cleaned = String(reply || '')
    .replace(/הצעה \(עדיין לא ניתנת לאישור כאן\):[^\n]*/gu, '')
    .replace(/הכנתי הצעה לאישור/gu, '')
    .trim();
  return cleaned || 'הנה מה שיישמר.';
}

export function settleWorkerTurn({ reply, proposals = [] } = {}) {
  if (!String(reply || '').trim() && !proposals.length) throw Object.assign(new Error('agent-unavailable'), { code: 'agent-unavailable' });
  return { reply: String(reply || '').trim() || PROPOSAL_LINE, proposals };
}

export class WorkerZokiProvider {
  constructor(schoolId) { this.schoolId = schoolId; }

  // No school records are shared with the Worker model, so there is nothing to select.
  async selectSources() { return { sourceIds: [] }; }

  async generateTurn(input) {
    const messages = [...(input.history || []).map(item => ({ role: item.role, content: item.text })), { role: 'user', content: input.question }];
    // Loaded on demand so importing this module never initialises Firebase.
    const { askRoleAgent } = await import('./zokiClaudeService.js');
    const { reply, proposals = [] } = await askRoleAgent({ schoolId: this.schoolId, messages, context: knowledgeContext(input), permissionKeys: input.permissionKeys, onToken: input.onToken });
    const settled = settleWorkerTurn({ reply, proposals });
    const earlier = [...(input.history || [])].reverse().find(item => item.role === 'user')?.text || '';
    const clientAction = clientActionFromProposals(input.question, settled.proposals, earlier);
    const task = clientAction ? null : settled.proposals.find(item => item?.tool === 'create_task' && item.input?.title);
    const note = teachingNote(input.question);
    return {
      answer: replyWithStoredMemory(visibleZokiAnswer(settled.reply, Boolean(clientAction)), note),
      actionIntent: task ? 'create_task' : 'none',
      actionRequest: task ? [task.input.title, task.input.description].filter(Boolean).join('. ') : '',
      actionTargetType: 'none', actionTargetLabel: '', staffRoleDraft: null,
      taskDraft: task ? { title: task.input.title.slice(0, 180), dueDate: /^\d{4}-\d{2}-\d{2}$/u.test(task.input.dueDate || '') ? task.input.dueDate : '', teamName: '', memberNames: [] } : null,
      clientAction,
      sourceIds: [],
      // "Remember that ..." is kept as this user's own memory (the existing memory layer checks it and honours the learning switch).
      memoryMutations: note ? [{ operation: 'upsert', type: 'preference', content: note, sourceIds: ['user'] }] : [],
    };
  }
}

export const isWorkerProviderEnabled = () => import.meta.env?.VITE_ZOKI_PROVIDER === 'worker' && Boolean(import.meta.env?.VITE_ZOKI_WORKER_URL);
