import { eventsInSpan, schoolWeekBounds } from './dashboardWidgets.js';

// Firebase Hosting on the Spark plan rewrites only to static files. Proxying
// /api/zoki to the Worker needs Cloud Functions or Cloud Run, which are not
// on this plan and are not deployed. A redirect would still send the browser
// to workers.dev, which is what the blocked network refuses.
export const HOSTING_PROXY = Object.freeze({
  available: false,
  reason: 'אין נתיב באותו אתר אל השרת. אירוח Firebase בתוכנית החינמית לא יכול לתווך בקשות אל ה-Worker בלי Cloud Functions או Cloud Run, ואלה לא בשימוש.',
});

export const LOCAL_MODEL_NOTE = 'מצב לא מקוון – תשובה ממודל מקומי, בלי ביצוע פעולות';
export const LOCAL_DATA_NOTE = 'מצב לא מקוון – תשובה מהנתונים שכבר במכשיר, בלי ביצוע פעולות';

export const LOCAL_MODEL_ID = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';
// Quantized weights published by MLC for this model id. The runtime is loaded separately, only on fallback.
export const LOCAL_MODEL_WEIGHT_BYTES = 352 * 1024 * 1024;

const clip = (value, max) => String(value || '').replace(/\s+/gu, ' ').trim().slice(0, max);

export function isWorkerNetworkError(error) {
  return error?.code === 'worker-unreachable';
}

export function schoolGrounding(sources = {}, today = '') {
  const events = (Array.isArray(sources.events) ? sources.events : []).map(event => ({
    title: clip(event?.title, 80),
    date: clip(event?.date, 10),
    tentative: event?.certainty === 'tentative',
  })).filter(event => event.title && /^\d{4}-\d{2}-\d{2}$/u.test(event.date));
  const tasks = (Array.isArray(sources.tasks) ? sources.tasks : [])
    .filter(task => !['done', 'completed'].includes(task?.status))
    .map(task => ({ title: clip(task?.title, 80), due: clip(task?.dueDate || task?.dueAt, 10) }))
    .filter(task => task.title)
    .slice(0, 8);
  const classes = (Array.isArray(sources.classes) ? sources.classes : [])
    .filter(item => item?.status !== 'archived')
    .map(item => ({ name: clip(item?.name, 40), grade: clip(item?.gradeLevel, 12) }))
    .filter(item => item.name)
    .slice(0, 12);
  return { today, events, tasks, classes };
}

function eventLine(event) {
  return `${event.date.slice(8, 10)}/${event.date.slice(5, 7)} ${event.title}${event.tentative ? ' · לא סגור' : ''}`;
}

export function answerFromSchoolData(question, grounding) {
  const text = String(question || '');
  const today = grounding.today || '';
  const week = schoolWeekBounds(today);
  const todayEvents = eventsInSpan(grounding.events, today, 'today');
  const weekEvents = (grounding.events || []).filter(event => event.date >= week.from && event.date <= week.to);
  const wantsWeek = /שבוע/u.test(text);
  const wantsTasks = /משימ/u.test(text);
  const wantsClass = /כית/u.test(text);
  const wantsToday = /היום|לו״ז|לו"ז|לוז/u.test(text) && !wantsWeek;
  const parts = [];
  if (wantsToday || (!wantsWeek && !wantsTasks && !wantsClass)) {
    parts.push(todayEvents.length ? `היום:\n${todayEvents.map(eventLine).join('\n')}` : 'אין אירועים להיום בנתונים שכבר נטענו.');
  }
  if (wantsWeek) parts.push(weekEvents.length ? `השבוע:\n${weekEvents.map(eventLine).join('\n')}` : 'אין אירועים לשבוע הזה בנתונים שכבר נטענו.');
  if (wantsTasks) parts.push(grounding.tasks.length ? `משימות פתוחות:\n${grounding.tasks.map(task => task.due ? `${task.title} · ${task.due}` : task.title).join('\n')}` : 'אין משימות פתוחות בנתונים שכבר נטענו.');
  if (wantsClass) parts.push(grounding.classes.length ? `כיתות:\n${grounding.classes.map(item => item.grade ? `${item.name} (${item.grade})` : item.name).join('\n')}` : 'אין כיתות בנתונים שכבר נטענו.');
  return parts.join('\n\n');
}

export function groundingText(grounding) {
  return [
    `היום ${grounding.today}`,
    grounding.events.slice(0, 12).map(event => `אירוע ${event.date} ${event.title}${event.tentative ? ' לא סגור' : ''}`).join('\n'),
    grounding.tasks.map(task => `משימה ${task.title}${task.due ? ` עד ${task.due}` : ''}`).join('\n'),
    grounding.classes.map(item => `כיתה ${item.name}${item.grade ? ` ${item.grade}` : ''}`).join('\n'),
  ].filter(Boolean).join('\n');
}
