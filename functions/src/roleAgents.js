// Zoki's "school of agents": one sub-agent profile per role, derived from the
// role catalog. A profile is data (prompt + reminders + allowed tool names), so
// the manager can see and limit exactly what each sub-agent may do.
import { SCHOOL_ROLES } from './schoolRoleCatalog.js';
import { knowledgePromptFor } from './zokiKnowledge.js';

// Tools a role agent may use, mapped to the capability that must ALSO be granted
// to the human, so the agent can never exceed its user's own permissions.
export const AGENT_TOOLS = Object.freeze({
  list_my_tasks: 'tasks.viewOwn',
  create_task: 'tasks.create',
  read_calendar: 'calendar.view',
  create_event: 'calendar.create',
  read_class_grades: 'grades.view',
  read_students: 'students.view',
  draft_email: 'communications.create',
});

export function roleAgentProfile(roleId) {
  const role = SCHOOL_ROLES.find(item => item.id === roleId);
  if (!role) return null;
  const official = role.official || {};
  const facts = [official.hours && `היקף שעות: ${official.hours}`, official.compensation && `גמול: ${official.compensation}`].filter(Boolean);
  return Object.freeze({
    roleId: role.id,
    name: `זוקי · ${role.label}`,
    systemPrompt: [
      `אתה זוקי, עוזר אישי של בעל/ת תפקיד: ${role.label}.`,
      `הגדרת התפקיד: ${role.description}.`,
      facts.length ? facts.join(' · ') + ' (מקור: הנחיות מינהל הכשרה מקצועית).' : '',
      `תחומי אחריות: ${role.duties.join('; ')}.`,
      'פעל רק במסגרת ההרשאות של המשתמש. אל תמציא נתונים. הצע פעולה, וחכה לאישור לפני שינוי.',
      'אל תאמר «רשמתי», «שמרתי» או «אזכור» אלא אם המשתמש פתח ב«תזכור», «זכור», «חשוב שתדע» או «העדפות שלי». אחרת אל תטען שמשהו נשמר.',
      'אל תשלח הודעות ואל תבצע פעולה. מותר לנסח טיוטה בלבד. אם אין נתון בגאנט או בלוח, אמור שאין אירוע גלוי, ואל תמציא נוהל.',
      'כשנפתחת השיחה, הזכר משימות פתוחות, תאריכים קרובים והסדירויות החוזרות של התפקיד.',
      knowledgePromptFor(role.id),
    ].filter(Boolean).join('\n'),
    reminders: role.reminders,
    tools: Object.keys(AGENT_TOOLS),
  });
}

// Tools the agent may offer a particular person, given the capabilities they hold.
export function allowedTools(profile, held = []) {
  const have = new Set(held);
  return profile.tools.filter(tool => have.has(AGENT_TOOLS[tool]));
}

export const ROLE_AGENT_PROFILES = Object.freeze(SCHOOL_ROLES.map(role => roleAgentProfile(role.id)));
