import assert from 'node:assert/strict';
import test from 'node:test';
import { eventFieldSample, eventPageContinues, eventScanQuery, firestoreParent, ganttStructuredQueries, ganttWindow } from '../../worker/src/ganttEvents.js';
import { buildPersonalSnapshot } from '../../worker/src/personalBrain.js';

test('gantt queries bound the date instead of taking the oldest page', () => {
  const now = new Date('2026-11-26T08:00:00Z');
  const { today, horizon, months } = ganttWindow(now);
  assert.equal(today, '2026-11-26');
  assert.equal(horizon, '2026-12-10');
  assert.deepEqual(months, [{ year: 2026, month: 10 }, { year: 2026, month: 11 }]);
  const { queries } = ganttStructuredQueries(now);
  const date = queries.find(query => query.label === 'date:string').structuredQuery;
  const encoded = JSON.stringify(date);
  assert.match(encoded, /GREATER_THAN_OR_EQUAL/u);
  assert.match(encoded, /LESS_THAN_OR_EQUAL/u);
  assert.ok(encoded.includes('2026-11-26') && encoded.includes('2026-12-10'));
  assert.equal(date.orderBy[0].field.fieldPath, 'date');
  assert.equal(date.orderBy[0].direction, 'ASCENDING');
  const december = queries.find(query => query.label === 'year-month:2026-11').structuredQuery;
  assert.ok(JSON.stringify(december).includes('"integerValue":"2026"'));
  assert.ok(JSON.stringify(december).includes('"integerValue":"11"'));
  assert.ok(queries.some(query => query.label === 'date:timestamp'));
  assert.ok(queries.some(query => query.label === 'startDate:string'));
  assert.equal(firestoreParent('eduflow'), 'projects/eduflow/databases/(default)/documents');
  assert.equal(firestoreParent('eduflow', 'schools/s1'), 'projects/eduflow/databases/(default)/documents/schools/s1');
  assert.equal(firestoreParent('eduflow').startsWith('https://'), false);
  const first = eventScanQuery('events_0Le4ldc5W0MiFc663GwK');
  assert.deepEqual(first, {
    from: [{ collectionId: 'events_0Le4ldc5W0MiFc663GwK' }],
    orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
    limit: 300,
  });
  const second = eventScanQuery('events_0Le4ldc5W0MiFc663GwK', 'projects/p/databases/(default)/documents/events_0Le4ldc5W0MiFc663GwK/h049');
  assert.equal(second.startAt.before, false);
  assert.equal(second.startAt.values[0].referenceValue.endsWith('/h049'), true);
  assert.equal(eventPageContinues(50), true);
  assert.equal(eventPageContinues(1), false);
});

test('a document shaped like the calendar screen is kept when it overlaps 1–2 December', () => {
  const now = new Date('2026-11-26T08:00:00Z');
  // calendarDateFields writes date as YYYY-MM-DD plus year and month (month is Date.getMonth, 0-based).
  // The screen stores one document per day, so 1–2.12 is two rows. A range that starts earlier still overlaps.
  const screen = (date, month) => ({
    id: date, title: 'התנדבות בגן חינוך מיוחד', date, year: 2026, month,
    category: 'חברתי', visibleTo: 'all', createdBy: 'staff1', createdAt: '2026-11-01T00:00:00.000Z',
    audience: { kind: 'activity', grade: 'י׳', subject: '', roleIds: [] },
  });
  const events = [
    screen('2026-12-01', 11),
    screen('2026-12-02', 11),
    { id: 'span', title: 'התנדבות בגן חינוך מיוחד', date: '2026-11-20', endDate: '2026-12-02', year: 2026, month: 10, visibleTo: 'all', audience: { grade: 'י׳' } },
    { id: 'old', title: 'אירוע ישן', date: '2020-01-01', year: 2020, month: 0, visibleTo: 'all' },
  ];
  const snapshot = buildPersonalSnapshot({
    uid: 'u1', now, user: { fullName: 'דנה', role: 'teacher' }, events,
  });
  assert.deepEqual(snapshot.events.map(event => event.date), ['2026-11-20', '2026-12-01', '2026-12-02']);
  assert.ok(snapshot.events.every(event => event.title === 'התנדבות בגן חינוך מיוחד' && event.grade === 'י׳'));
  assert.equal(snapshot.events.find(event => event.date === '2026-11-20').end, '2026-12-02');
  assert.match(eventFieldSample(events[0]), /date:string year:number month:number/u);
  assert.doesNotMatch(eventFieldSample(events[0]), /התנדבות|staff1/u);
});
