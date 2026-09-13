export function calendarDateFields(date) {
  const parsed = new Date(`${date}T12:00:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || Number.isNaN(parsed.getTime()) || parsed.getFullYear() !== Number(date.slice(0,4)) || parsed.getMonth()+1 !== Number(date.slice(5,7)) || parsed.getDate() !== Number(date.slice(8,10))) throw new Error('invalid-date');
  return { date, year: parsed.getFullYear(), month: parsed.getMonth() };
}
export function sortCalendarCategories(rows) {
  return [...rows].sort((a,b) => (a.order ?? 9999) - (b.order ?? 9999) || a.name.localeCompare(b.name, 'he'));
}
export const DEFAULT_EVENT_TEMPLATES = [
  { id:'math', title:'מבחן במתמטיקה', description:'', color:'#fed7aa' },
  { id:'english', title:'מבחן באנגלית', description:'', color:'#bae6fd' },
  { id:'mock', title:'מתכונת', description:'', color:'#bbf7d0' },
];
