// Pure helpers for a Zoki turn on the local model: quota, school context, action routing, learning log.
// Nothing here touches the network, so it is all unit-tested.
import { relevantBrainContext, sanitizeInstitutionalText } from './brain.js';

// Requests per UTC day. A role not listed gets `default`. Overridable with the ZOKI_DAILY_LIMITS var (JSON).
export const DAILY_LIMITS = Object.freeze({ principal: 300, institution_manager: 300, default: 60, viewer: 20 });

export function dailyLimitFor(role, env = {}) {
  let table = DAILY_LIMITS;
  try { table = { ...DAILY_LIMITS, ...JSON.parse(env.ZOKI_DAILY_LIMITS || '{}') }; } catch { /* bad override: keep defaults */ }
  const value = Number(table[role] ?? table.default);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DAILY_LIMITS.default;
}

export const dayKey = (now = new Date()) => now.toISOString().slice(0, 10);
export const secondsToMidnight = (now = new Date()) => Math.max(60, Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime()) / 1000));

// Only an instruction is worth the extra routing call; questions stream straight away.
const ACTION_START = /^\s*(?:(?:בבקשה|תוכל|תוכלי|אפשר|נא)\s+)?(?:צור|צרי|פתח|פתחי|הוסף|הוסיפי|קבע|קבעי|תקבע|תקבעי|עדכן|עדכני|שנה|שני|נסח|נסחי|תנסח|תנסחי|תפתח|תפתחי|תוסיף|תוסיפי|תיצור|תיצרי|הצע|הכן|הכיני|תכין|תכיני|ייצר|שלח|תשלח)(?:\s|$)/u;
export const looksLikeAction = text => ACTION_START.test(String(text || ''));

// "Remember that ..." becomes a personal memory of this user only; it never becomes school knowledge by itself.
const TEACH = /^\s*(?:זכור|תזכור|זכרי|תזכרי|תדע|דע|לידיעתך)\s*(?:ש|כי|:)?\s*(.{6,400})$/su;
export function teachingNote(text) {
  const match = TEACH.exec(String(text || ''));
  return match ? sanitizeInstitutionalText(match[1], 400) : '';
}

export function stripStudentSection(markdown) {
  return String(markdown || '').replace(/## תלמידים והקשרים לימודיים[\s\S]*?(?=\n## |$)/u, '## תלמידים והקשרים לימודיים\n\n_מוסתר: אין למשתמש הרשאה לצפות בנתוני תלמידים._\n');
}

export function buildSchoolContext({ markdown = '', query = '', canSeeStudents = false, memories = [], maxChars = 3300 } = {}) {
  const brain = relevantBrainContext(canSeeStudents ? markdown : stripStudentSection(markdown), query, maxChars - 600);
  const personal = memories.slice(0, 8).map(item => `- ${sanitizeInstitutionalText(item?.content || '', 200)}`).filter(line => line.length > 2);
  return [brain, personal.length ? `מה שהמשתמש ביקש שנזכור עליו:\n${personal.join('\n')}` : ''].filter(Boolean).join('\n\n').slice(0, maxChars);
}

// Tools the model may be offered: the user's own capabilities, with the schemas the Worker already defines.
export function toolSpecs(allowedNames, schemas) {
  return allowedNames.filter(name => schemas[name]).map(name => ({ name, description: schemas[name].description, properties: Object.fromEntries(Object.keys(schemas[name].properties || {}).map(key => [key, {}])), required: schemas[name].required || [] }));
}

// The model fills a form; this decides whether the form is usable. Never trust its tool name or fields.
export function validatedProposal(routed, allowedNames, schemas) {
  if (!routed?.tool || !allowedNames.includes(routed.tool) || !schemas[routed.tool]) return null;
  const schema = schemas[routed.tool];
  const input = {};
  for (const key of Object.keys(schema.properties || {})) {
    const value = routed.input?.[key];
    if (typeof value === 'string' && value.trim()) input[key] = sanitizeInstitutionalText(value, 400);
  }
  if ((schema.required || []).some(key => !input[key])) return { tool: routed.tool, input, missing: (schema.required || []).filter(key => !input[key]) };
  return { tool: routed.tool, input, missing: [] };
}

// One line of LEARNING_LOG.md: when, what kind, who, what. No personal data: sanitized text only.
export function learningLogLine({ at = new Date(), kind, actor = '', summary = '' }) {
  const stamp = at.toISOString().slice(0, 16).replace('T', ' ');
  return `- ${stamp} · ${sanitizeInstitutionalText(kind, 40)} · ${sanitizeInstitutionalText(actor, 80) || 'מערכת'} · ${sanitizeInstitutionalText(summary, 300).replace(/\n+/gu, ' ')}`;
}

export function appendLearningLog(existing, line, maxChars = 120000) {
  const header = '# יומן למידה של זוקי\n\nמה נלמד, מה עודכן ומי אישר. שורה לכל אירוע, מהישן לחדש.\n\n';
  const body = String(existing || '').startsWith('# יומן למידה') ? String(existing).slice(header.length > existing.length ? 0 : header.length) : '';
  const joined = `${body.trimEnd()}\n${line}\n`.trimStart();
  const kept = joined.length > maxChars ? joined.slice(joined.length - maxChars).replace(/^[^\n]*\n/u, '') : joined;
  return `${header}${kept}`;
}
