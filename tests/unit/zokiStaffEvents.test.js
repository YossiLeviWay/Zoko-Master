import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { prepareZokiAction } from '../../src/utils/zokiActions.js';
import { runZokiAction } from '../../src/services/zokiActionRunner.js';

const actor = { uid: 'principal1', fullName: 'יוסי' };

test('a calendar event defaults to confirmed and can be marked לא סגור', () => {
  const open = prepareZokiAction({ tool: 'create_calendar_event', input: { title: 'סדנה', date: '2026-12-01', certainty: 'tentative' } }, { manager: true });
  assert.equal(open.fields.certainty, 'tentative');
  assert.match(open.lines.join('\n'), /לא סגור/);
  const closed = prepareZokiAction({ tool: 'create_calendar_event', input: { title: 'סדנה', date: '2026-12-01' } }, { manager: true });
  assert.equal(closed.fields.certainty, 'confirmed');
});

test('only a manager can change staff, and nobody can lock themselves out or delete a user', async () => {
  const viewer = prepareZokiAction({ tool: 'add_staff', input: { fullName: 'דנה לוי', email: 'dana@school.test', role: 'editor' } }, { permissions: { staff_edit: true } });
  assert.equal(viewer.allowed, false);
  const self = prepareZokiAction({ tool: 'deactivate_staff', input: { userId: 'principal1' } }, { manager: true, actorId: 'principal1' });
  assert.match(self.reason, /לנעול את עצמך/);
  const card = prepareZokiAction({ tool: 'deactivate_staff', input: { userId: 'teacher1' } }, { manager: true, actorId: 'principal1' });
  assert.equal(card.allowed, true);
  assert.match(card.lines.join('\n'), /אין מחיקה/);
  const calls = [];
  const saved = await runZokiAction(card, { schoolId: '0Le4ldc5W0MiFc663GwK', actor, manager: true }, {
    updateStaff: async input => { calls.push(input); },
  });
  assert.equal(saved.saved, true);
  assert.equal(calls[0].accountStatus, 'disabled');
  assert.equal(calls[0].userId, 'teacher1');
  const blockedCard = prepareZokiAction({ tool: 'add_staff', input: { fullName: 'דנה לוי', email: 'dana@school.test' } }, { manager: false });
  const blocked = await runZokiAction(blockedCard, { schoolId: '0Le4ldc5W0MiFc663GwK', actor, manager: false }, {
    createStaff: async () => { throw new Error('should not run'); },
  });
  assert.equal(blocked.saved, false);
});

test('new staff profiles do not write a plaintext password field', () => {
  const source = readFileSync(new URL('../../functions/src/services/userManagement.js', import.meta.url), 'utf8');
  assert.match(source, /delete profile\[secret\]/);
  assert.doesNotMatch(source, /_authPassword\s*:/);
  const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
  assert.match(rules, /function hasNoPasswordFields/);
});
