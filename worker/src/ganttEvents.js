// The school Gantt reads events_${schoolId} with where('year') + where('month') (month is 0-based).
// A list of the whole collection returns the oldest documents first, so a short page never
// reaches an event two weeks ahead. These queries ask for the window itself.
const DAY = 86400000;

export function ganttWindow(now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const horizon = new Date(now.getTime() + 14 * DAY).toISOString().slice(0, 10);
  const months = [];
  for (let time = Date.parse(`${today}T00:00:00Z`); time <= Date.parse(`${horizon}T00:00:00Z`); time += DAY) {
    const date = new Date(time);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    if (!months.some(item => item.year === year && item.month === month)) months.push({ year, month });
  }
  return { today, horizon, months };
}

const compare = (fieldPath, op, value) => ({ fieldFilter: { field: { fieldPath }, op, value } });

// REST runQuery bodies. `from` is added by the caller (root collection or schools/{id}/events).
export function ganttStructuredQueries(now = new Date()) {
  const window = ganttWindow(now);
  const range = (field, kind) => ({
    label: `${field}:${kind}`,
    structuredQuery: {
      where: { compositeFilter: { op: 'AND', filters: [
        compare(field, 'GREATER_THAN_OR_EQUAL', kind === 'timestamp' ? { timestampValue: `${window.today}T00:00:00Z` } : { stringValue: window.today }),
        compare(field, 'LESS_THAN_OR_EQUAL', kind === 'timestamp' ? { timestampValue: `${window.horizon}T23:59:59Z` } : { stringValue: window.horizon }),
      ] } },
      orderBy: [{ field: { fieldPath: field }, direction: 'ASCENDING' }],
      limit: 100,
    },
  });
  const byMonth = window.months.map(({ year, month }) => ({
    label: `year-month:${year}-${month}`,
    structuredQuery: {
      where: { compositeFilter: { op: 'AND', filters: [
        compare('year', 'EQUAL', { integerValue: String(year) }),
        compare('month', 'EQUAL', { integerValue: String(month) }),
      ] } },
      limit: 200,
    },
  }));
  return {
    window,
    queries: [...byMonth, range('date', 'string'), range('startDate', 'string'), range('date', 'timestamp')],
  };
}

const dayText = value => {
  if (typeof value === 'string') return value.match(/\d{4}-\d{2}-\d{2}/u)?.[0] || '';
  if (value && typeof value === 'object') return dayText(value.timestampValue || value.stringValue || '');
  return '';
};

// calendarDateFields stores month 0-based (Date.getMonth) plus a date string.
// A document that only has year/month/day still gets a day. Month 12 is 1-based December.
function dayFromParts(event) {
  const year = Number(event?.year);
  const month = Number(event?.month);
  const day = Number(event?.day);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return '';
  const humanMonth = month >= 0 && month <= 11 ? month + 1 : month;
  if (humanMonth < 1 || humanMonth > 12 || day < 1 || day > 31) return '';
  return `${year}-${String(humanMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function eventSpan(event = {}) {
  const start = dayText(event.date) || dayText(event.startDate) || dayFromParts(event);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(start)) return null;
  const end = dayText(event.endDate) || start;
  return { start, end: /^\d{4}-\d{2}-\d{2}$/u.test(end) ? end : start };
}
