// Per-user dashboard layout: which widgets, how many items, and filters. Pure functions so they are easy to test.
// A widget is { type, size, config }, stored in the user's `dashboardPreferences.widgets`.

export const LIMIT_OPTIONS = Object.freeze([3, 5, 10, 20]);
export const DEFAULT_LIMIT = 5;
export const DUE_FILTERS = Object.freeze({ ALL: 'all', TODAY: 'today', OVERDUE: 'overdue', WEEK: 'week' });
// Types a person may add more than once (for example one task list per team).
export const MULTI_INSTANCE_TYPES = Object.freeze(['my_tasks', 'events', 'milestones']);

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

export function filterEvents(events, config) {
  const c = normalizeConfig(config);
  return (Array.isArray(events) ? events : []).filter(event => c.categories.length === 0 || c.categories.includes(event.category));
}

export function hasFilters(config) {
  const c = normalizeConfig(config);
  return Boolean(c.teamId || c.staffId || c.priority || c.tag || c.due !== DUE_FILTERS.ALL || c.categories.length);
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
