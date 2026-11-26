// Zoki's personal brain: what Zoki knows about ONE staff member in ONE school.
// It has two halves:
//   1. a live snapshot of that person's place in the school (role, teams, classes, open tasks, the
//      days ahead), rebuilt from the school's data;
//   2. a learned profile (who they are, how they like to work, what occupies them now, how they
//      sounded lately, and what Zoki concluded about helping them), rewritten after each conversation.
// Everything here is pure (no network), so it is unit-tested. The brain belongs to its user only:
// it is never added to the school brain and never shown to a manager.
import { sanitizeInstitutionalText } from './brain.js';

export const MOODS = Object.freeze(['רגוע', 'נלהב', 'עמוס', 'לחוץ', 'מתוסכל', 'מודאג', 'עייף', 'מהוסס']);
export const PROFILE_LIMITS = Object.freeze({ summary: 500, item: 180, facts: 12, preferences: 8, focus: 6, insights: 6, moodNote: 180, moodDays: 7, focusDays: 45 });
export const SNAPSHOT_TTL_MS = 10 * 60 * 1000;

const DAY = 86400000;
const dateKey = date => date.toISOString().slice(0, 10);
const text = (value, max = PROFILE_LIMITS.item) => sanitizeInstitutionalText(typeof value === 'string' ? value : '', max).replace(/\s*\n+\s*/gu, ' ');
const isoOr = (value, fallback) => (typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : fallback);

export const emptyProfile = () => ({ summary: '', facts: [], preferences: [], focus: [], insights: [], mood: null, turns: 0, updatedAt: '' });

function list(value, limit) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).map(item => text(typeof item === 'string' ? item : item?.text)).filter(item => item.length > 2 && !seen.has(item) && seen.add(item)).slice(-limit);
}

// Whatever comes back from storage or from the model is cut down to this exact shape and size.
export function sanitizeProfile(raw, now = new Date()) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const stamp = now.toISOString();
  const seen = new Set();
  const focus = (Array.isArray(source.focus) ? source.focus : [])
    .map(item => ({ text: text(typeof item === 'string' ? item : item?.text), since: isoOr(item?.since, stamp) }))
    .filter(item => item.text.length > 2 && !seen.has(item.text) && seen.add(item.text)
      && now.getTime() - Date.parse(item.since) < PROFILE_LIMITS.focusDays * DAY)
    .slice(-PROFILE_LIMITS.focus);
  const tone = MOODS.includes(source.mood?.tone) ? source.mood.tone : '';
  const moodAt = isoOr(source.mood?.at, stamp);
  const mood = tone && now.getTime() - Date.parse(moodAt) < PROFILE_LIMITS.moodDays * DAY
    ? { tone, note: text(source.mood.note, PROFILE_LIMITS.moodNote), at: moodAt } : null;
  return {
    summary: text(source.summary, PROFILE_LIMITS.summary),
    facts: list(source.facts, PROFILE_LIMITS.facts),
    preferences: list(source.preferences, PROFILE_LIMITS.preferences),
    focus,
    insights: list(source.insights, PROFILE_LIMITS.insights),
    mood,
    turns: Number.isInteger(source.turns) && source.turns > 0 ? Math.min(source.turns, 1000000) : 0,
    updatedAt: isoOr(source.updatedAt, ''),
  };
}

export const profileIsEmpty = profile => !profile || !(profile.summary || profile.facts?.length || profile.preferences?.length || profile.focus?.length || profile.insights?.length || profile.mood);

const mine = (value, uid) => (Array.isArray(value) ? value.includes(uid) : value === uid);
const closed = status => ['done', 'completed', 'archived', 'cancelled', 'canceled'].includes(status);

// The user's own corner of the school. Only items that already belong to this user are kept, so the
// snapshot never widens what they may see: their teams, their classes, tasks they own or share,
// and calendar entries addressed to everyone or to one of their teams.
export function buildPersonalSnapshot({ uid, user = {}, teams = [], classes = [], tasks = [], events = [], holidays = [], now = new Date() }) {
  const today = dateKey(now);
  const horizon = dateKey(new Date(now.getTime() + 14 * DAY));
  const holidayHorizon = dateKey(new Date(now.getTime() + 30 * DAY));
  const myTeams = teams.filter(team => mine(team.memberIds, uid) || mine(team.leaderIds, uid));
  const teamIds = new Set(myTeams.map(team => team.id));
  const myTasks = tasks.filter(task => !closed(task.status) && (
    mine(task.assigneeIds, uid) || task.assigneeId === uid || mine(task.participantIds, uid) || task.ownerId === uid || task.createdBy === uid
    || (task.assigneeType === 'team' && teamIds.has(task.assigneeTeamId))
  )).map(task => ({
    title: text(task.title, 120), due: /^\d{4}-\d{2}-\d{2}/u.test(task.dueDate || '') ? task.dueDate.slice(0, 10) : '',
    priority: text(task.priority, 20), status: text(task.status, 30),
    mineToDo: mine(task.assigneeIds, uid) || task.assigneeId === uid,
  })).filter(task => task.title)
    .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  const visible = event => !event.visibleTo || event.visibleTo === 'all' || (Array.isArray(event.visibleTo) && event.visibleTo.some(id => teamIds.has(id)));
  return {
    name: text(user.fullName, 80),
    jobTitle: text(user.jobTitle || user.roleName, 80),
    role: text(user.role, 40),
    areas: (Array.isArray(user.responsibilityAreas) ? user.responsibilityAreas : []).map(item => text(item, 60)).filter(Boolean).slice(0, 6),
    subjects: (Array.isArray(user.subjects) ? user.subjects : []).map(item => text(item, 40)).filter(Boolean).slice(0, 6),
    teams: myTeams.map(team => ({ name: text(team.name, 60), lead: mine(team.leaderIds, uid) })).filter(team => team.name).slice(0, 8),
    classes: classes.filter(item => item.status !== 'archived' && (item.teacherId === uid || item.homeroomTeacherId === uid || mine(item.staffIds, uid)))
      .map(item => ({ name: text(item.name || item.title, 60), homeroom: item.teacherId === uid || item.homeroomTeacherId === uid })).filter(item => item.name).slice(0, 8),
    overdue: myTasks.filter(task => task.due && task.due < today).length,
    openTasks: myTasks.length,
    tasks: myTasks.slice(0, 10),
    events: events.filter(event => event.status !== 'archived' && typeof event.date === 'string' && event.date >= today && event.date <= horizon && visible(event))
      .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8).map(event => ({ date: event.date, title: text(event.title, 100), category: text(event.category, 40) })).filter(event => event.title),
    holidays: holidays.filter(item => typeof item.startDate === 'string' && (item.endDate || item.startDate) >= today && item.startDate <= holidayHorizon)
      .sort((a, b) => a.startDate.localeCompare(b.startDate)).slice(0, 3).map(item => ({ from: item.startDate, to: item.endDate || item.startDate, title: text(item.name || item.title, 80) })).filter(item => item.title),
    at: now.toISOString(),
  };
}

const shortDate = value => `${value.slice(8, 10)}/${value.slice(5, 7)}`;

export function snapshotText(snapshot, now = new Date()) {
  if (!snapshot) return '';
  const today = dateKey(now);
  const lines = [];
  const who = [snapshot.name, snapshot.jobTitle].filter(Boolean).join(', ');
  if (who) lines.push(`מי מולך: ${who}.`);
  if (snapshot.areas?.length) lines.push(`תחומי אחריות: ${snapshot.areas.join(', ')}.`);
  if (snapshot.subjects?.length) lines.push(`מקצועות: ${snapshot.subjects.join(', ')}.`);
  if (snapshot.teams?.length) lines.push(`צוותים: ${snapshot.teams.map(team => (team.lead ? `${team.name} (מוביל/ה)` : team.name)).join(', ')}.`);
  if (snapshot.classes?.length) lines.push(`כיתות: ${snapshot.classes.map(item => (item.homeroom ? `${item.name} (מחנך/ת)` : item.name)).join(', ')}.`);
  if (snapshot.openTasks) {
    lines.push(`משימות פתוחות: ${snapshot.openTasks}${snapshot.overdue ? `, מתוכן ${snapshot.overdue} באיחור` : ''}.`);
    for (const task of snapshot.tasks || []) {
      const due = task.due ? (task.due < today ? `באיחור מ-${shortDate(task.due)}` : task.due === today ? 'להיום' : `עד ${shortDate(task.due)}`) : 'ללא תאריך';
      lines.push(`- ${task.title} (${due}${task.mineToDo ? '' : ', שותף/ה'})`);
    }
  }
  if (snapshot.events?.length) {
    lines.push('בלוח השנה שלו/ה בשבועיים הקרובים:');
    for (const event of snapshot.events) lines.push(`- ${shortDate(event.date)} ${event.title}`);
  }
  if (snapshot.holidays?.length) lines.push(`חופשות קרובות: ${snapshot.holidays.map(item => `${item.title} (${shortDate(item.from)}${item.to !== item.from ? `–${shortDate(item.to)}` : ''})`).join(', ')}.`);
  return lines.join('\n');
}

export function profileText(profile) {
  if (profileIsEmpty(profile)) return '';
  const lines = [];
  if (profile.summary) lines.push(`מה למדת עליו/ה: ${profile.summary}`);
  if (profile.facts.length) lines.push(`עובדות שסיפר/ה על עצמו/ה:\n${profile.facts.map(item => `- ${item}`).join('\n')}`);
  if (profile.preferences.length) lines.push(`איך הוא/היא אוהב/ת לקבל תשובות:\n${profile.preferences.map(item => `- ${item}`).join('\n')}`);
  if (profile.focus.length) lines.push(`מה מעסיק אותו/ה עכשיו:\n${profile.focus.map(item => `- ${item.text}`).join('\n')}`);
  if (profile.insights.length) lines.push(`המסקנות שלך על הדרך הנכונה לעזור לו/ה:\n${profile.insights.map(item => `- ${item}`).join('\n')}`);
  if (profile.mood) lines.push(`בשיחות האחרונות נשמע/ה: ${profile.mood.tone}${profile.mood.note ? ` (${profile.mood.note})` : ''}.`);
  return lines.join('\n');
}

// How Zoki is told to use the personal brain. The emotional read shapes tone only; it is never
// announced, never treated as a diagnosis, and never repeated to anyone else.
export const PERSONAL_GUIDANCE = [
  'ההקשר האישי שלהלן שייך רק למשתמש שמולך. השתמש בו כדי לענות לאדם הזה, ולא "למורה כלשהו":',
  '- התאם את התשובה לתפקיד, לצוותים, לכיתות, למשימות וללוח השנה שלו. כשזה רלוונטי, קשר את התשובה למשימה או לתאריך ממשי שלו.',
  '- כבד את ההעדפות שלו (אורך, סגנון, מבנה) בלי שיצטרך לבקש שוב.',
  '- המשך שיחות קודמות: אם נושא שהעסיק אותו עדיין פתוח, התייחס אליו בטבעיות.',
  '- התאם את הטון למצבו: כשהוא עמוס או לחוץ, קצר, הצע צעד אחד ברור והורד עומס; כשהוא נלהב, הרחב ובנה איתו. גלה אמפתיה עניינית, בלי לנתח אותו ובלי להכריז מה הוא מרגיש.',
  '- אל תצטט את ההקשר הזה ואל תאמר "אני רואה ברשומות". אל תמציא פרטים שאינם כתובים בו. הוא חסוי: אינו משותף עם אנשי צוות אחרים או עם ההנהלה.',
].join('\n');

export function buildPersonalContext({ snapshot = null, profile = null, maxChars = 2600, now = new Date() } = {}) {
  const parts = [snapshotText(snapshot, now), profileText(profile)].filter(Boolean);
  if (!parts.length) return '';
  return `${PERSONAL_GUIDANCE}\n\n${parts.join('\n\n')}`.slice(0, maxChars);
}

// A short form for the small local model, whose context window is tight: no guidance block.
export function compactPersonalContext({ snapshot = null, profile = null, maxChars = 900, now = new Date() } = {}) {
  const lines = [];
  if (snapshot) lines.push(snapshotText({ ...snapshot, tasks: (snapshot.tasks || []).slice(0, 4), events: (snapshot.events || []).slice(0, 3), holidays: [] }, now));
  if (profile && !profileIsEmpty(profile)) {
    if (profile.preferences.length) lines.push(`העדפות: ${profile.preferences.slice(-3).join('; ')}.`);
    if (profile.focus.length) lines.push(`מעסיק אותו/ה עכשיו: ${profile.focus.slice(-2).map(item => item.text).join('; ')}.`);
    if (profile.mood) lines.push(`נשמע/ה לאחרונה ${profile.mood.tone}: התאם את הטון.`);
  }
  const body = lines.filter(Boolean).join('\n');
  return body ? `הקשר אישי של המשתמש (חסוי, לשימושך בלבד):\n${body}`.slice(0, maxChars) : '';
}

const REFLECTION_SYSTEM = [
  'אתה מנגנון הזיכרון האישי של זוקי, עוזר לאנשי צוות בבית ספר. אינך עונה למשתמש.',
  'תקבל את הפרופיל הקיים של איש צוות אחד ואת קטע השיחה האחרון שלו עם זוקי. החזר את הפרופיל המעודכן כ-JSON בלבד, בלי טקסט נוסף, במבנה:',
  '{"summary": string, "facts": string[], "preferences": string[], "focus": string[], "insights": string[], "mood": {"tone": string, "note": string} | null}',
  'משמעות השדות:',
  '- summary: עד 3 משפטים על האדם בעבודה ועל אופן העבודה איתו.',
  '- facts: עובדות יציבות שהוא עצמו אמר על עצמו (רקע, ותק, מקצועות, תחומי עניין מקצועיים).',
  '- preferences: איך הוא אוהב לקבל עזרה (אורך, סגנון, פורמט, שפה).',
  '- focus: מה מעסיק אותו כעת בעבודה: מטרות, דאגות ונושאים פתוחים שכדאי לחזור אליהם.',
  '- insights: מסקנות שלך על הדרך היעילה לעזור לאדם הזה, מנוסחות כהנחיה מעשית לזוקי.',
  `- mood: איך הוא נשמע בשיחה הזו. tone אחד מתוך: ${MOODS.join(', ')}. note: הסבר קצר שנשען על מה שנאמר. אם אין סימן ברור, null.`,
  'כללים מחייבים:',
  '- הסתמך רק על מה שהמשתמש עצמו כתב או שנובע ממנו בבירור. אל תנחש ואל תמציא.',
  '- שמור מה שעדיין נכון מהפרופיל הקיים, עדכן מה שהשתנה, ומחק מה שהמשתמש סתר או ביקש לשכוח.',
  '- אל תכלול שמות או פרטים של תלמידים, הורים או אנשי צוות אחרים. אל תכלול מידע רפואי, משפחתי, כלכלי, דתי או פוליטי, מספרי זהות, טלפונים או סיסמאות.',
  '- המצב הרגשי הוא תיאור זהיר של טון השיחה ולא אבחון. אל תשתמש במונחים קליניים.',
  '- כל פריט הוא משפט קצר אחד בעברית. אם אין חדש, החזר את הפרופיל הקיים כפי שהוא.',
].join('\n');

const REFLECTION_MESSAGES = 6;

export function buildReflectionRequest({ profile, messages = [], reply = '', role = '', model }) {
  const current = sanitizeProfile(profile);
  const turns = [...messages.filter(item => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string'), ...(reply ? [{ role: 'assistant', content: reply }] : [])]
    .slice(-REFLECTION_MESSAGES).map(item => `${item.role === 'user' ? 'המשתמש' : 'זוקי'}: ${sanitizeInstitutionalText(item.content, 1200)}`);
  if (!turns.some(line => line.startsWith('המשתמש'))) return null;
  const known = { summary: current.summary, facts: current.facts, preferences: current.preferences, focus: current.focus.map(item => item.text), insights: current.insights, mood: current.mood ? { tone: current.mood.tone, note: current.mood.note } : null };
  return {
    model,
    max_tokens: 900,
    system: [{ type: 'text', text: REFLECTION_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: `תפקיד המשתמש: ${text(role, 60) || 'איש צוות'}\n\nהפרופיל הקיים:\n${JSON.stringify(known)}\n\nקטע השיחה האחרון:\n${turns.join('\n')}\n\nהחזר JSON בלבד.` }],
  };
}

// Reads the model's answer into a profile. Anything that is not a usable JSON object leaves the
// previous profile untouched, so a bad answer can never erase what was learned.
export function parseReflection(response, previous, now = new Date()) {
  const before = sanitizeProfile(previous, now);
  const raw = (Array.isArray(response?.content) ? response.content : []).filter(block => block.type === 'text').map(block => block.text).join('\n');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return before;
  let parsed;
  try { parsed = JSON.parse(raw.slice(start, end + 1)); } catch { return before; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return before;
  const stamp = now.toISOString();
  const since = new Map(before.focus.map(item => [item.text, item.since]));
  const next = sanitizeProfile({
    summary: parsed.summary,
    facts: parsed.facts,
    preferences: parsed.preferences,
    // A topic that was already open keeps the date it first came up, so it can age out.
    focus: (Array.isArray(parsed.focus) ? parsed.focus : []).map(item => { const value = text(typeof item === 'string' ? item : item?.text); return { text: value, since: since.get(value) || stamp }; }),
    insights: parsed.insights,
    mood: parsed.mood && typeof parsed.mood === 'object' ? { tone: parsed.mood.tone, note: parsed.mood.note, at: stamp } : before.mood,
    turns: before.turns + 1,
    updatedAt: stamp,
  }, now);
  return next;
}
