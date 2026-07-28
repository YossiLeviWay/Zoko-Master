import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInitiativeClone,
  deriveInitiativeHealth,
  findHolidayConflict,
  initiativeProgress,
  milestoneDate,
  nextAvailableSchoolDate,
  nextInitiativeMilestone,
} from '../../src/utils/initiatives.js';

test('initiative progress uses milestone weights and excludes cancelled milestones', () => {
  const result = initiativeProgress([
    { status: 'completed', weight: 3 },
    { status: 'in_progress', weight: 1 },
    { status: 'cancelled', weight: 100 },
  ]);
  assert.equal(result.percent, 75);
  assert.equal(result.completed, 1);
  assert.equal(result.total, 2);
  assert.equal(result.label, '1 מתוך 2 אבני דרך הושלמו');
});

test('initiative without milestones avoids a misleading percentage', () => {
  assert.deepEqual(initiativeProgress([]), {
    percent: null, completed: 0, total: 0, completedWeight: 0, totalWeight: 0,
    label: 'לא הוגדרו אבני דרך',
  });
});

test('open blockers and overdue confirmed milestones put an initiative at risk', () => {
  const today = new Date('2026-10-20T12:00:00.000Z');
  assert.equal(deriveInitiativeHealth({
    initiative: {}, today,
    milestones: [{ status: 'in_progress', dateType: 'exact', startDate: '2026-10-14' }],
    updates: [],
  }), 'at_risk');
  assert.equal(deriveInitiativeHealth({
    initiative: {}, today, milestones: [],
    updates: [{ type: 'blocker', blockerStatus: 'open' }],
  }), 'at_risk');
});

test('proposed dates remain distinct and the next milestone is chronological', () => {
  const items = [
    { id: 'later', status: 'not_started', dateType: 'exact', startDate: '2026-11-01' },
    { id: 'proposed', status: 'not_started', dateType: 'proposed', proposedDate: '2026-09-16' },
    { id: 'unset', status: 'not_started', dateType: 'unset' },
  ];
  assert.equal(milestoneDate(items[1]), '2026-09-16');
  assert.equal(nextInitiativeMilestone(items, new Date('2026-09-01T12:00:00.000Z')).id, 'proposed');
});

test('all milestone date modes retain their intended scheduling semantics', () => {
  assert.equal(milestoneDate({ dateType: 'exact', startDate: '2026-10-01' }), '2026-10-01');
  assert.equal(milestoneDate({ dateType: 'range', startDate: '2026-10-02', endDate: '2026-10-09' }), '2026-10-09');
  assert.equal(milestoneDate({ dateType: 'proposed', proposedDate: '2026-10-10' }), '2026-10-10');
  assert.equal(milestoneDate({ dateType: 'unset', startDate: '2026-10-11' }), '');
});

test('holiday conflicts are warned about but do not mutate the selected date', () => {
  const holidays = [{ name: 'חג', startDate: '2026-09-11', endDate: '2026-09-13', isVacation: true }];
  assert.equal(findHolidayConflict('2026-09-12', holidays)?.name, 'חג');
  assert.equal(findHolidayConflict('2026-09-14', holidays), null);
  assert.equal(nextAvailableSchoolDate('2026-09-11', holidays), '2026-09-14');
});

test('safe duplication omits updates, evidence, dates and owners by default', () => {
  const clone = buildInitiativeClone({
    title: 'מסע', academicYearId: 'old', ownerId: 'owner', memberIds: ['member'],
    fileIds: ['file'], startDate: '2026-01-01', endDate: '2026-02-01', goals: ['יעד'],
    updates: ['private'], evidenceIds: ['evidence'],
  }, { academicYearId: 'new' });
  assert.equal(clone.academicYearId, 'new');
  assert.equal(clone.ownerId, '');
  assert.deepEqual(clone.memberIds, []);
  assert.deepEqual(clone.fileIds, []);
  assert.equal(clone.startDate, '');
  assert.equal('updates' in clone, false);
  assert.equal('evidenceIds' in clone, false);
});
