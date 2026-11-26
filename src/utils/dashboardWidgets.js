// Per-user dashboard layout: which widgets, how many items, and filters. Pure functions so they are easy to test.
// A widget is { type, size, config }, stored in the user's `dashboardPreferences.widgets`.

export const LIMIT_OPTIONS = Object.freeze([3, 5, 10, 20]);
export const DEFAULT_LIMIT = 5;
export const DUE_FILTERS = Object.freeze({ ALL: 'all', TODAY: 'today', OVERDUE: 'overdue', WEEK: 'week' });
// Types a person may add more than once (for example one task list per team).
export const MULTI_INSTANCE_TYPES = Object.freeze(['my_tasks', 'events', 'milestones']);
export const DASHBOARD_WIDGET_TYPES = Object.freeze(['my_tasks', 'events', 'holidays', 'announcements', 'team_activity', 'file_tracker', 'upcoming_week', 'milestones', 'staff_tasks', 'today_schedule', 'week_schedule', 'shortcut']);
export const MAX_DASHBOARD_WIDGETS = 8;

const clean = value => (typeof value === 'string' ? value.trim().slice(0, 128) : '');

export function normalizeConfig(config = {}) {
  const limit = Number(config.limit);
  return {
    title: clean(config.title).slice(0, 60),
    limit: LIMIT_OPTIONS.includes(limit) ? limit : DEFAULT_LIMIT,
    teamId: clean(config.teamId),
    staffId: clean(config.staffId),
    priority: ['high', 'medium', 'low'].includes(config.priority) ? config.priority : '',
    tag: clean(config.tag).slice(0, 60),
    due: Object.values(DUE_FILTERS).includes(config.due) ? config.due : DUE_FILTERS.ALL,
    categories: Array.isArray(config.categories) ? [...new Set(config.categories.map(clean).filter(Boolean))].slice(0, 30) : [],
    path: clean(config.path).slice(0, 80),
  };
}

export function normalizeWidget(widget) {
  if (!widget || typeof widget.type !== 'string') return null;
  return { type: widget.type, size: widget.size === 'half' ? 'half' : 'full', config: normalizeConfig(widget.config) };
}

const dueOf = task => String(task?.dueDate || task?.dueAt || '').slice(0, 10);
const teamOf = task => task?.teamId || task?.assigneeTeamId || '';
const involves = (task, staffId) => [task.assigneeIds, task.participantIds].some(list => Array.isArray(list) && list.includes(staffId))
  || task.createdById === staffId || task.createdBy === staffId || task.ownerId === staffId;

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Applies the widget's filters. `today` is a YYYY-MM-DD string.
export function filterTasks(tasks, config, today) {
  const c = normalizeConfig(config);
  const weekEnd = addDays(today, 7);
  return (Array.isArray(tasks) ? tasks : []).filter(task => {
    if (c.teamId && teamOf(task) !== c.teamId) return false;
    if (c.staffId && !involves(task, c.staffId)) return false;
    if (c.priority && (task.priority || 'medium') !== c.priority) return false;
    if (c.tag && !(Array.isArray(task.tags) && task.tags.includes(c.tag))) return false;
    const due = dueOf(task);
    if (c.due === DUE_FILTERS.TODAY && due !== today) return false;
    if (c.due === DUE_FILTERS.OVERDUE && !(due && due < today)) return false;
    if (c.due === DUE_FILTERS.WEEK && !(due && due >= today && due <= weekEnd)) return false;
    return true;
  });
}

function dateKeyFrom(value) {
  return String(value || '').slice(0, 10);
}

export function schoolWeekBounds(today) {
  const date = new Date(`${today}T12:00:00`);
  if (Number.isNaN(date.getTime())) return { from: today, to: today };
  const start = new Date(date);
  start.setDate(date.getDate() - date.getDay());
  const end = new Date(start);
  end.setDate(start.getDate() + 4);
  const key = item => `${item.getFullYear()}-${String(item.getMonth() + 1).padStart(2, '0')}-${String(item.getDate()).padStart(2, '0')}`;
  return { from: key(start), to: key(end) };
}

export function eventsInSpan(events, today, span = 'today') {
  const list = Array.isArray(events) ? events : [];
  const bounds = span === 'week' ? schoolWeekBounds(today) : { from: today, to: today };
  return list.filter(event => {
    const date = dateKeyFrom(event?.date);
    return date >= bounds.from && date <= bounds.to;
  }).sort((a, b) => dateKeyFrom(a.date).localeCompare(dateKeyFrom(b.date)) || String(a.title || '').localeCompare(String(b.title || ''), 'he')).slice(0, 8);
}

export function applyDashboardLayout(widgets, action = {}) {
  const list = (Array.isArray(widgets) ? widgets : []).map(normalizeWidget).filter(Boolean).slice(0, MAX_DASHBOARD_WIDGETS);
  if (action.op === 'replace' && Array.isArray(action.widgets)) return action.widgets.map(normalizeWidget).filter(Boolean).slice(0, MAX_DASHBOARD_WIDGETS);
  if (action.op === 'add' && DASHBOARD_WIDGET_TYPES.includes(action.type)) {
    if (list.length >= MAX_DASHBOARD_WIDGETS) return list;
    if (action.type === 'shortcut' && !clean(action.path)) return list;
    const added = normalizeWidget({ type: action.type, size: action.size === 'half' ? 'half' : 'full', config: { path: action.path, title: action.title } });
    return added ? [...list, added] : list;
  }
  const index = Number(action.index);
  if (!Number.isInteger(index) || index < 0 || index >= list.length) return list;
  if (action.op === 'remove') return list.filter((_, item) => item !== index);
  if (action.op === 'resize') {
    const next = [...list];
    next[index] = { ...next[index], size: action.size === 'half' ? 'half' : 'full' };
    return next;
  }
  if (action.op === 'move') {
    const target = index + (action.direction === 'up' ? -1 : 1);
    if (target < 0 || target >= list.length) return list;
    const next = [...list];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  }
  return list;
}

export function filterEvents(events, config) {
  const c = normalizeConfig(config);
  return (Array.isArray(events) ? events : []).filter(event => c.categories.length === 0 || c.categories.includes(event.category));
}

export function hasFilters(config) {
  const c = normalizeConfig(config);
  return Boolean(c.teamId || c.staffId || c.priority || c.tag || c.due !== DUE_FILTERS.ALL || c.categories.length);
}

export const DASHBOARD_CATALOG = Object.freeze([
  { group: 'היום', type: 'today_schedule', label: 'לו״ז היום', description: 'האירועים שלך להיום, כולל מה שעוד לא סגור' },
  { group: 'היום', type: 'week_schedule', label: 'לו״ז השבוע', description: 'אירועי השבוע הנוכחי שרלוונטיים אליך' },
  { group: 'היום', type: 'my_tasks', label: 'המשימות שלי', description: 'משימות פתוחות שמשויכות אליך' },
  { group: 'היום', type: 'milestones', label: 'מועדים חשובים', description: 'אבני דרך של התפקיד שלך' },
  { group: 'לוח ותוכן', type: 'events', label: 'אירועים קרובים', description: 'אירועי היומן שמותר לך לראות' },
  { group: 'לוח ותוכן', type: 'upcoming_week', label: 'השבוע הקרוב', description: 'משימות ואירועים לשבעת הימים הקרובים' },
  { group: 'לוח ותוכן', type: 'holidays', label: 'חגים וחופשות', description: 'חגים וחופשות קרובים' },
  { group: 'לוח ותוכן', type: 'announcements', label: 'הודעות אחרונות', description: 'ההודעות האחרונות במוסד' },
  { group: 'עבודה', type: 'team_activity', label: 'פעילות צוות', description: 'מה קרה לאחרונה בצוותים שלך' },
  { group: 'עבודה', type: 'staff_tasks', label: 'משימות מאנשי צוות', description: 'משימות שאנשי צוות הוסיפו' },
  { group: 'עבודה', type: 'file_tracker', label: 'מעקב קבצים', description: 'קבצים שסומנו למעקב' },
  { group: 'קיצורי דרך', type: 'shortcut', path: '/tasks', label: 'המשימות שלי', description: 'פתיחת רשימת המשימות' },
  { group: 'קיצורי דרך', type: 'shortcut', path: '/tasks/advanced', label: 'לוח המשימות', description: 'פתיחת לוח המשימות המלא' },
  { group: 'קיצורי דרך', type: 'shortcut', path: '/calendar', label: 'לוח שנה', description: 'פתיחת היומן השבועי' },
  { group: 'קיצורי דרך', type: 'shortcut', path: '/students', label: 'תלמידים', description: 'פתיחת רשימת התלמידים' },
  { group: 'קיצורי דרך', type: 'shortcut', path: '/files', label: 'קבצים', description: 'פתיחת הקבצים' },
  { group: 'קיצורי דרך', type: 'shortcut', path: '/staff', label: 'אנשי צוות', description: 'פתיחת ניהול הסגל' },
  { group: 'קיצורי דרך', type: 'shortcut', path: '/teams', label: 'צוותים', description: 'פתיחת הצוותים' },
  { group: 'קיצורי דרך', type: 'shortcut', path: '/contacts', label: 'אנשי קשר', description: 'פתיחת אנשי הקשר' },
  { group: 'קיצורי דרך', type: 'shortcut', path: '/messages', label: 'הודעות', description: 'פתיחת ההודעות' },
  { group: 'קיצורי דרך', type: 'shortcut', path: '/collective-brain', label: 'מוח משותף', description: 'פתיחת המוח המשותף' },
  { group: 'קיצורי דרך', type: 'shortcut', path: '/holidays', label: 'חופשות וחגים', description: 'פתיחת החגים והחופשות' },
  { group: 'קיצורי דרך', type: 'shortcut', path: '/notifications', label: 'התראות', description: 'פתיחת ההתראות' },
  { group: 'קיצורי דרך', type: 'shortcut', path: '/mappings', label: 'מיפוי פדגוגי', description: 'פתיחת המיפוי הפדגוגי' },
  { group: 'קיצורי דרך', type: 'shortcut', path: '/imports', label: 'ייבוא', description: 'פתיחת דוח הייבוא' },
  { group: 'קיצורי דרך', type: 'shortcut', path: '/forum', label: 'פורום בתי הספר', description: 'פתיחת הפורום' },
  { group: 'קיצורי דרך', type: 'shortcut', path: '/support', label: 'עזרה ודיווח', description: 'פתיחת העזרה' },
  { group: 'קיצורי דרך', type: 'shortcut', path: '/settings', label: 'הגדרות', description: 'פתיחת ההגדרות' },
]);

export function teacherDashboardWidgets() {
  return [
    { type: 'today_schedule', size: 'full', config: { title: 'היום שלי' } },
    { type: 'my_tasks', size: 'full', config: { title: 'דחוף', due: 'today' } },
    { type: 'week_schedule', size: 'full', config: { title: 'השבוע' } },
  ];
}

export function classForLesson(event, classes = [], uid = '') {
  const list = classes.filter(item => item && item.status !== 'archived');
  if (event?.classId) return list.find(item => item.id === event.classId) || null;
  const mine = list.filter(item => item.teacherId === uid);
  const grade = event?.audience?.grade || event?.grade || '';
  if (grade) return mine.find(item => item.gradeLevel === grade) || null;
  return mine.length === 1 ? mine[0] : null;
}

export function searchDashboardCatalog(query = '') {
  const needle = String(query || '').trim();
  return DASHBOARD_CATALOG.filter(item => !needle || `${item.label} ${item.description} ${item.group}`.includes(needle));
}

export function widgetTitle(widget, defaultLabel) {
  return normalizeConfig(widget?.config).title || defaultLabel;
}

// Ready-made task views offered in the "add view" menu; the person then refines them in the settings window.
export const TASK_VIEW_PRESETS = Object.freeze([
  { id: 'by-priority', label: 'משימות לפי רמת חשיבות', config: { title: 'משימות דחופות', priority: 'high' } },
  { id: 'by-staff', label: 'משימות לפי איש צוות', config: { title: 'משימות של איש צוות' } },
  { id: 'by-tag', label: 'משימות לפי תיוג', config: { title: 'משימות לפי תיוג' } },
]);

// Every tag used by the given tasks, most used first.
export function tagsInTasks(tasks) {
  const counts = new Map();
  for (const task of Array.isArray(tasks) ? tasks : []) for (const tag of Array.isArray(task.tags) ? task.tags : []) counts.set(String(tag), (counts.get(String(tag)) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'he')).map(([tag]) => tag);
}
