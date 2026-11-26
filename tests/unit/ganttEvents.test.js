import assert from 'node:assert/strict';
import test from 'node:test';
import { ganttStructuredQueries, ganttWindow } from '../../worker/src/ganttEvents.js';

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
});
