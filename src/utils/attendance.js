export const ATTENDANCE_TIMEZONE = 'Asia/Jerusalem';

export const DEFAULT_ATTENDANCE_LEGEND = Object.freeze([
  Object.freeze({
    id: 'present',
    label: 'נוכחות',
    shortCode: '✓',
    color: '#22c55e',
    type: 'status',
    attendanceEffect: 'present',
    order: 0,
    active: true,
  }),
  Object.freeze({
    id: 'absent',
    label: 'לא הגיע',
    shortCode: 'ל',
    color: '#ef4444',
    type: 'status',
    attendanceEffect: 'absent',
    order: 1,
    active: true,
  }),
  Object.freeze({
    id: 'excused_illness',
    label: 'מחלה מאושרת',
    shortCode: 'מ',
    color: '#eab308',
    type: 'status',
    attendanceEffect: 'excused_absence',
    order: 2,
    active: true,
  }),
  Object.freeze({
    id: 'work',
    label: 'עבודה',
    shortCode: 'ע',
    color: '#3b82f6',
    type: 'status',
    attendanceEffect: 'approved_activity',
    order: 3,
    active: true,
  }),
]);

export function parseDateKey(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey || '');
  if (!match) throw new Error('INVALID_DATE_KEY');
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
  if (Number.isNaN(date.getTime())) throw new Error('INVALID_DATE_KEY');
  return date;
}

export function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayDateKey() {
  return toDateKey(new Date());
}

export function buildScheduledDays({ startDate, endDate, studyDays = [] }) {
  const start = parseDateKey(startDate);
  const end = parseDateKey(endDate);
  if (start > end) throw new Error('INVALID_DATE_RANGE');
  const allowedDays = new Set(studyDays.map(String));
  const days = [];
  const cursor = new Date(start);
  for (let guard = 0; cursor <= end && guard < 400; guard += 1) {
    const dateKey = toDateKey(cursor);
    if (allowedDays.has(String(cursor.getDay()))) {
      days.push({
        id: dateKey,
        dateKey,
        scheduled: true,
        blocked: false,
        blockedReason: '',
        source: 'class_schedule',
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  if (cursor <= end) throw new Error('DATE_RANGE_TOO_LARGE');
  return days;
}

export function attendanceRecordId(studentId, dateKey) {
  if (!studentId || !/^[A-Za-z0-9_-]{1,128}$/.test(studentId)) throw new Error('INVALID_STUDENT_ID');
  parseDateKey(dateKey);
  return `${studentId}_${dateKey}`;
}

function memberRequiredOnDate(member, dateKey) {
  if (member.joinedAt && dateKey < member.joinedAt) return false;
  if (member.endDate && dateKey > member.endDate) return false;
  return member.included !== false;
}

export function calculateAttendanceSummary({ days, records, legend, member }) {
  const legendById = new Map(legend.map(item => [item.id, item]));
  const recordByDate = new Map(records.map(item => [item.dateKey, item]));
  const summary = {
    scheduled: 0,
    present: 0,
    absent: 0,
    excused: 0,
    work: 0,
    missing: 0,
    attendancePercent: 0,
    recognizedPercent: 0,
  };

  days.forEach(day => {
    if (!day.scheduled || day.blocked || !memberRequiredOnDate(member, day.dateKey)) return;
    summary.scheduled += 1;
    const record = recordByDate.get(day.dateKey);
    const item = record?.primaryStatusId ? legendById.get(record.primaryStatusId) : null;
    if (!item) {
      summary.missing += 1;
      return;
    }
    if (item.attendanceEffect === 'present') summary.present += 1;
    else if (item.attendanceEffect === 'absent') summary.absent += 1;
    else if (item.attendanceEffect === 'excused_absence') summary.excused += 1;
    else if (item.attendanceEffect === 'approved_activity') summary.work += 1;
  });

  if (summary.scheduled > 0) {
    summary.attendancePercent = Math.round((summary.present / summary.scheduled) * 100);
    summary.recognizedPercent = Math.round(((summary.present + summary.work) / summary.scheduled) * 100);
  }
  return summary;
}
