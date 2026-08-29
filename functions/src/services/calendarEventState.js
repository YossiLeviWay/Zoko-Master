import { createHash } from 'node:crypto';

const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const ids = value => Array.isArray(value)
  ? [...new Set(value.map(item => text(item, 128)).filter(Boolean))].sort()
  : [];

export function normalizeCalendarEvent(data = {}, eventId = '') {
  return {
    id: text(eventId || data.id, 128),
    title: text(data.title || data.name, 160),
    description: text(data.description, 2000),
    date: text(data.date || data.startDate, 10),
    time: text(data.time, 5),
    category: text(data.category, 80) || 'כללי',
    color: text(data.color, 20) || '#bae6fd',
    visibleTo: data.visibleTo === 'all' ? 'all' : ids(data.visibleTo),
    editableBy: ids(data.editableBy),
  };
}

export function calendarEventVersion(data = {}, eventId = '') {
  const normalized = normalizeCalendarEvent(data, eventId);
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex').slice(0, 32);
}
