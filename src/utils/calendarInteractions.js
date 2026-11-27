export function calendarDateFields(date) {
  const parsed = new Date(`${date}T12:00:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || Number.isNaN(parsed.getTime()) || parsed.getFullYear() !== Number(date.slice(0,4)) || parsed.getMonth()+1 !== Number(date.slice(5,7)) || parsed.getDate() !== Number(date.slice(8,10))) throw new Error('invalid-date');
  return { date, year: parsed.getFullYear(), month: parsed.getMonth() };
}
export function sortCalendarCategories(rows) {
  return [...rows].sort((a,b) => (a.order ?? 9999) - (b.order ?? 9999) || a.name.localeCompare(b.name, 'he'));
}

// Sunday–Thursday. The grid opens on this week; a saved preference can still replace it
// before the grid is shown.
export const SCHOOL_WEEK = Object.freeze([0, 1, 2, 3, 4]);

// Scroll offset that puts today's week flush under the sticky header, as the first row in view.
export function todayScrollTop({ scrollTop = 0, cellTop = 0, wrapTop = 0, headHeight = 0 } = {}) {
  const cellOffset = scrollTop + cellTop - wrapTop;
  return Math.max(0, cellOffset - headHeight);
}
export const DEFAULT_EVENT_TEMPLATES = [
  { id:'math', title:'מבחן במתמטיקה', description:'', color:'#fed7aa' },
  { id:'english', title:'מבחן באנגלית', description:'', color:'#bae6fd' },
  { id:'mock', title:'מתכונת', description:'', color:'#bbf7d0' },
];

// The date the calendar should stand on: the given day when its weekday is shown, otherwise the
// next shown day (Friday or Saturday in a Sunday-Thursday calendar -> the coming Sunday).
export function nextVisibleDate(date = new Date(), visibleDays = SCHOOL_WEEK) {
  const shown = Array.isArray(visibleDays) && visibleDays.length ? visibleDays : SCHOOL_WEEK;
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  for (let step = 0; step < 7 && !shown.includes(result.getDay()); step += 1) result.setDate(result.getDate() + 1);
  return result;
}
