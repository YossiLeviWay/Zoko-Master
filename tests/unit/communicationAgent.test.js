import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSparkAgentInput,
  normalizeSparkAgentProposal,
} from '../../src/utils/communicationAgent.js';

test('Spark agent input excludes app context, contacts and existing form data', () => {
  const input = JSON.parse(buildSparkAgentInput({
    request: 'נסח מייל קצר לספק',
    operation: 'compose',
    language: 'he',
    style: 'respectful',
    currentProposal: { subject: 'לא אמור להישלח', body: 'מידע קודם' },
    schoolId: 'school-secret',
    contacts: [{ email: 'person@example.test' }],
  }));

  assert.deepEqual(input, {
    request: 'נסח מייל קצר לספק',
    operation: 'compose',
    language: 'he',
    style: 'respectful',
    currentProposal: null,
  });
  assert.equal(JSON.stringify(input).includes('school-secret'), false);
  assert.equal(JSON.stringify(input).includes('person@example.test'), false);
});

test('Spark agent refinement includes only bounded previous generated fields', () => {
  const input = JSON.parse(buildSparkAgentInput({
    request: 'קצר את הטיוטה',
    operation: 'shorten',
    language: 'he',
    style: 'direct',
    currentProposal: {
      subject: 'נושא',
      body: 'תוכן',
      summary: 'תקציר',
      followUpAt: '2026-08-10',
      completionCriteria: 'קבלת תשובה',
      recipients: ['person@example.test'],
      suggestedAssigneeId: 'private-user-id',
    },
  }));

  assert.deepEqual(input.currentProposal, {
    subject: 'נושא',
    body: 'תוכן',
    summary: 'תקציר',
    followUpAt: '2026-08-10',
    completionCriteria: 'קבלת תשובה',
  });
  assert.equal(JSON.stringify(input).includes('person@example.test'), false);
  assert.equal(JSON.stringify(input).includes('private-user-id'), false);
});

test('Spark agent proposal cannot inject recipients, assignees or linked records', () => {
  const proposal = normalizeSparkAgentProposal({
    recipients: ['invented@example.test'],
    cc: ['copy@example.test'],
    bcc: ['hidden@example.test'],
    subject: ' הצעה ',
    body: ' גוף ההודעה ',
    summary: ' מעקב ',
    priority: 'urgent',
    followUpAt: 'not-a-date',
    completionCriteria: ' התקבלה תשובה ',
    suggestedAssigneeId: 'other-user',
    linkedEntities: [{ type: 'student', id: 'student-a', label: 'פרטי' }],
    missingFields: ['נמען', '', 42],
    suggestedNextAction: ' בדיקה ידנית ',
  });

  assert.deepEqual(proposal.recipients, []);
  assert.deepEqual(proposal.cc, []);
  assert.deepEqual(proposal.bcc, []);
  assert.equal(proposal.suggestedAssigneeId, null);
  assert.deepEqual(proposal.linkedEntities, []);
  assert.equal(proposal.priority, 'normal');
  assert.equal(proposal.followUpAt, null);
  assert.deepEqual(proposal.missingFields, ['נמען']);
  assert.equal(proposal.subject, 'הצעה');
});

test('Spark agent rejects an empty request', () => {
  assert.throws(() => buildSparkAgentInput({ request: '  ', operation: 'compose' }), /agent-request-too-short/);
});
