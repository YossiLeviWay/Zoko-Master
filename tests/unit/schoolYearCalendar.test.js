import test from 'node:test';
import assert from 'node:assert/strict';
import { MILESTONES, ROUTINES, milestonesFor, routinesFor, remindersText, YEAR } from '../../functions/src/schoolYearCalendar.js';
import { SCHOOL_ROLES } from '../../functions/src/schoolRoleCatalog.js';

const roleIds = new Set([...SCHOOL_ROLES.map(role => role.id), 'teacher', 'homeroom', 'institution_manager']);

test('every milestone and routine has a source, valid dates inside the school year and real role ids', () => {
  const ids = new Set();
  for (const entry of MILESTONES) {
    assert.ok(!ids.has(entry.id), entry.id); ids.add(entry.id);
    assert.match(entry.source, /^https:\/\//);
    assert.ok(entry.from <= entry.to, entry.id);
    assert.ok(entry.from >= YEAR.start && entry.to <= YEAR.end, entry.id);
    for (const role of entry.roles) assert.ok(roleIds.has(role), `${entry.id}: unknown role ${role}`);
  }
  for (const routine of ROUTINES) for (const role of routine.roles) assert.ok(roleIds.has(role), `${routine.id}: unknown role ${role}`);
});
test('the Bagrut coordinator is reminded of the exact winter dates from the circular', () => {
  const list = milestonesFor({ today: '2026-10-25', roleId: 'bagrut_coordinator' });
  const ids = list.map(entry => entry.id);
  assert.ok(ids.includes('bagrut-winter-order'));
  assert.ok(ids.includes('bagrut-winter-exceptions'));
  const order = list.find(entry => entry.id === 'bagrut-winter-order');
  assert.equal(order.state, 'active');
  assert.equal(order.to, '2026-11-01');
  assert.equal(order.daysLeft, 7);
  assert.equal(order.mandatory, true);
});
test('past items disappear and far-future items stay out of the horizon', () => {
  const ids = milestonesFor({ today: '2027-03-10', roleId: 'bagrut_coordinator' }).map(entry => entry.id);
  assert.equal(ids.includes('bagrut-winter-order'), false);
  assert.equal(ids.includes('bagrut-overlap-requests'), false);
  assert.equal(milestonesFor({ today: '2026-09-01', roleId: 'trips_coordinator', horizonDays: 30 }).some(entry => entry.id === 'may-20-trips-plan'), false);
  assert.equal(milestonesFor({ today: '2027-04-25', roleId: 'trips_coordinator' }).find(entry => entry.id === 'may-20-trips-plan').daysLeft, 25);
});
test('role filtering, routines and the reminder text', () => {
  assert.ok(routinesFor('homeroom').some(item => item.id === 'monthly-attendance-report'));
  assert.equal(routinesFor('secretary').length, 0);
  const text = remindersText({ today: '2026-09-10', roleId: 'institution_manager' });
  assert.match(text, /אבני דרך קרובות/);
  assert.match(text, /20\.09\.2026|20\.9/);
  assert.equal(remindersText({ today: '2026-09-10', roleId: 'asa_coordinator' }), '');
});
