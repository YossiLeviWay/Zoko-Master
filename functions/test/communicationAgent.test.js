import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMUNICATION_AGENT_JSON_SCHEMA,
  requestCommunicationProposal,
} from '../src/services/openaiCommunicationAgent.js';

const proposal = {
  recipients: ['recipient@example.test'],
  cc: [],
  bcc: [],
  subject: 'בקשת עדכון',
  body: 'שלום, נשמח לקבל עדכון.',
  summary: 'מעקב אחר פנייה',
  priority: 'normal',
  followUpAt: '2026-08-04',
  completionCriteria: 'התקבלה תשובה',
  suggestedAssigneeId: null,
  linkedEntities: [{ type: 'task', id: 'task_a', label: 'משימה א' }],
  missingFields: [],
  suggestedNextAction: 'בדיקת הטיוטה לפני פתיחת תוכנת המייל',
};

test('communication agent requests strict, non-persistent structured output', async () => {
  let requestBody;
  const result = await requestCommunicationProposal({
    apiKey: 'test-key-not-a-secret',
    model: 'test-model',
    actorUid: 'actor_a',
    input: {
      request: 'נסח מייל קצר',
      operation: 'compose',
      language: 'he',
      style: 'respectful',
      context: { type: 'task', id: 'task_a', label: 'משימה א' },
      currentDraft: {},
    },
    contacts: [],
    assignees: [],
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({ id: 'response_a', output_text: JSON.stringify(proposal) }),
      };
    },
  });
  assert.deepEqual(result.proposal, proposal);
  assert.equal(requestBody.store, false);
  assert.equal(requestBody.text.format.strict, true);
  assert.deepEqual(requestBody.text.format.schema, COMMUNICATION_AGENT_JSON_SCHEMA);
  assert.equal(requestBody.tools, undefined);
  assert.equal(JSON.stringify(requestBody).includes('test-key-not-a-secret'), false);
});

test('communication agent fails closed when no server secret is configured', async () => {
  await assert.rejects(requestCommunicationProposal({
    apiKey: '',
    model: 'test-model',
    actorUid: 'actor_a',
    input: {},
    contacts: [],
    assignees: [],
  }), error => error.code === 'failed-precondition' && error.details.reason === 'agent-not-configured');
});
