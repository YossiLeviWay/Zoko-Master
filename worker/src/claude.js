// Claude (Anthropic Messages API) adapter for Zoki role agents.
// Pure request builders + a thin fetch wrapper so everything is unit-testable
// without a network. The API key lives only in the Worker secret
// ANTHROPIC_API_KEY; the browser never sees it.
import { allowedTools, AGENT_TOOLS } from '../../functions/src/roleAgents.js';

export const ANTHROPIC_VERSION = '2023-06-01';
export const DEFAULT_MODEL = 'claude-sonnet-5-5';
export const LIMITS = Object.freeze({ messages: 12, messageChars: 4000, maxTokens: 1024 });

// Claude may only PROPOSE these. The browser shows the proposal and the user
// approves; execution then goes through the normal permission checks.
const TOOL_SCHEMAS = Object.freeze({
  list_my_tasks: { description: 'הצג את המשימות הפתוחות של המשתמש', properties: {} },
  create_task: { description: 'הצע יצירת משימה', properties: { title: { type: 'string' }, dueDate: { type: 'string', description: 'YYYY-MM-DD' }, description: { type: 'string' } }, required: ['title'] },
  read_calendar: { description: 'קרא אירועים מלוח השנה בטווח תאריכים', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
  create_event: { description: 'הצע יצירת אירוע בלוח השנה', properties: { title: { type: 'string' }, date: { type: 'string' }, kind: { type: 'string', enum: ['event', 'exam', 'meeting'] }, subject: { type: 'string' }, grade: { type: 'string' } }, required: ['title', 'date'] },
  read_class_grades: { description: 'קרא ציוני כיתה שהמשתמש רשאי לראות', properties: { classId: { type: 'string' } }, required: ['classId'] },
  read_students: { description: 'קרא רשימת תלמידים בכיתה שהמשתמש רשאי לראות', properties: { classId: { type: 'string' } }, required: ['classId'] },
  draft_email: { description: 'נסח טיוטת מייל (לא נשלח)', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } }, required: ['subject', 'body'] },
});

export const heldCapabilities = accessProfile => Object.entries(accessProfile?.school || {}).filter(([, enabled]) => enabled === true).map(([key]) => key);

const cleanText = (value, max) => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, '').trim().slice(0, max);

export function boundedMessages(messages = []) {
  return messages.filter(item => item && ['user', 'assistant'].includes(item.role) && cleanText(item.content, 1)).slice(-LIMITS.messages)
    .map(item => ({ role: item.role, content: cleanText(item.content, LIMITS.messageChars) }))
    // The API requires the first message to be from the user.
    .filter((item, index, list) => index > 0 || item.role === 'user' || list.some(other => other.role === 'user'))
    .reduce((out, item) => (out.length === 0 && item.role !== 'user' ? out : [...out, item]), []);
}

export function buildClaudeRequest({ profile, messages, heldKeys = [], model = DEFAULT_MODEL, context = '' }) {
  const tools = allowedTools(profile, heldKeys);
  const history = boundedMessages(messages);
  if (!history.length) throw new Error('invalid-input');
  return {
    model,
    max_tokens: LIMITS.maxTokens,
    // The role prompt is identical for every call of that role, so it is cached.
    system: [
      { type: 'text', text: profile.systemPrompt, cache_control: { type: 'ephemeral' } },
      ...(context ? [{ type: 'text', text: `הקשר מוסדי (מצומצם, ללא פרטים מזהים):\n${cleanText(context, 6000)}` }] : []),
    ],
    messages: history,
    tools: tools.map(name => ({ name, description: TOOL_SCHEMAS[name].description,
      input_schema: { type: 'object', properties: TOOL_SCHEMAS[name].properties, ...(TOOL_SCHEMAS[name].required ? { required: TOOL_SCHEMAS[name].required } : {}) } })),
  };
}

export function parseClaudeResponse(response) {
  const blocks = Array.isArray(response?.content) ? response.content : [];
  return {
    reply: blocks.filter(block => block.type === 'text').map(block => block.text).join('\n').trim(),
    // Proposals only: nothing here has been executed.
    proposals: blocks.filter(block => block.type === 'tool_use' && Object.hasOwn(AGENT_TOOLS, block.name)).map(block => ({ id: block.id, tool: block.name, input: block.input || {} })),
    stopReason: response?.stop_reason || '',
    usage: { input: response?.usage?.input_tokens || 0, output: response?.usage?.output_tokens || 0, cacheRead: response?.usage?.cache_read_input_tokens || 0 },
  };
}

export async function callClaude(env, payload, fetchImpl = fetch) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('agent-not-configured');
  const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': ANTHROPIC_VERSION },
    body: JSON.stringify(payload),
  });
  // Provider error bodies can echo prompts, so only the status is surfaced.
  if (response.status === 429) throw new Error('resource-exhausted');
  if (!response.ok) throw new Error('agent-unavailable');
  return response.json();
}
