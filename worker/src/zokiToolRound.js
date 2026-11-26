import { AGENT_TOOLS } from '../../functions/src/roleAgents.js';
import { parseClaudeResponse } from './claude.js';
import { V1_TOOLS } from './zokiActionTools.js';

// A principal's access-profile map is often empty: the role itself holds every tool key.
export function managerCapabilityKeys() {
  return [...new Set([...Object.values(AGENT_TOOLS), ...Object.values(V1_TOOLS).flatMap(spec => spec.keys)])];
}

export const PROPOSAL_LINE = 'הכנתי הצעה לאישור';

const READ_NAMES = new Set([
  'list_my_tasks', 'read_calendar', 'read_attendance', 'read_class_grades', 'read_students', 'list_unanswered_replies',
]);

export function isReadTool(name) {
  if (READ_NAMES.has(name)) return true;
  const spec = V1_TOOLS[name];
  return Boolean(spec && spec.write === false);
}

// Client permission keys may only narrow the server set. They never add a tool.
export function offeredCapabilityKeys(held = [], claimed) {
  const server = [...new Set((held || []).filter(key => typeof key === 'string' && key.length > 0 && key.length < 64))];
  if (!Array.isArray(claimed)) return server;
  const asked = new Set(claimed.filter(key => typeof key === 'string' && key.length > 0 && key.length < 64));
  return server.filter(key => asked.has(key));
}

export function readToolText(proposal, context = {}) {
  const input = proposal?.input || {};
  if (proposal?.tool === 'read_calendar') {
    const from = String(input.from || '');
    const to = String(input.to || '');
    const grade = String(input.grade || '');
    const rows = (context.events || []).filter(event => {
      const start = String(event.date || '');
      const end = String(event.end || start);
      if (from && end < from) return false;
      if (to && start > to) return false;
      if (grade && event.grade && event.grade !== grade && !String(event.grade).includes(grade)) return false;
      return true;
    });
    if (!rows.length) return 'אין אירועים בטווח בהקשר שנקרא מהיומן.';
    return rows.slice(0, 40).map(event => `${event.date} ${event.title || ''}${event.certainty === 'tentative' ? ' (לא סגור)' : ''}${event.grade ? ` (שכבה ${event.grade})` : ''}${event.category ? ` [${event.category}]` : ''}`).join('\n');
  }
  if (proposal?.tool === 'list_my_tasks') {
    const rows = context.tasks || [];
    if (!rows.length) return 'אין משימות פתוחות בהקשר.';
    return rows.slice(0, 20).map(task => `${task.title || ''}${task.due ? ` עד ${task.due}` : ''}`).join('\n');
  }
  if (proposal?.tool === 'read_attendance') return 'אין רשומות נוכחות בהקשר של התור.';
  if (proposal?.tool === 'list_unanswered_replies') return 'אין בקשות פתוחות בהקשר של התור.';
  return 'אין נתונים נוספים לכלי הזה בהקשר של התור.';
}

export function ensureReply(parsed, readText = '') {
  const reply = String(parsed?.reply || '').trim();
  if (reply) return { ...parsed, reply };
  const proposals = parsed?.proposals || [];
  const writes = proposals.some(item => !isReadTool(item.tool));
  if (readText) return { ...parsed, reply: readText };
  if (writes) return { ...parsed, reply: PROPOSAL_LINE };
  return { ...parsed, reply: 'אין לי תשובה כרגע.' };
}

// At most two Claude calls. A read tool gets one tool_result round. A write with no text becomes a proposal line.
export async function runClaudeRounds({ request, call, context = {} }) {
  let payload = request;
  let carried = '';
  for (let round = 0; round < 2; round += 1) {
    const response = await call(payload);
    const parsed = parseClaudeResponse(response);
    const reads = parsed.proposals.filter(item => isReadTool(item.tool));
    const text = reads.map(item => readToolText(item, context)).filter(Boolean).join('\n').slice(0, 2000);
    if (!reads.length || reads.some(item => !item.id) || round === 1) return ensureReply(parsed, carried || text);
    carried = text;
    payload = {
      ...payload,
      messages: [
        ...payload.messages,
        { role: 'assistant', content: Array.isArray(response?.content) ? response.content : [] },
        { role: 'user', content: reads.map(item => ({ type: 'tool_result', tool_use_id: item.id, content: readToolText(item, context).slice(0, 2000) })) },
      ],
    };
  }
  return ensureReply({ reply: carried, proposals: [] }, carried);
}
