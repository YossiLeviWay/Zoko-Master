import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedZokiHistory, normalizeSemanticResult, runSemanticZokiTurn, ZOKI_CONTEXT_LIMITS } from '../../src/utils/zokiSemanticTurn.js';
import { normalizeZokiConversationState } from '../../src/utils/zokiConversation.js';
import { resolveSemanticTaskTarget } from '../../src/utils/zokiTaskWorkflow.js';

const sources = Array.from({ length: 20 }, (_, index) => ({ id: `schools/s/tasks/t${index}`, label: `רשומה ${index}`, fields: { description: 'תיאור מוסדי' } }));
const answer = (extra = {}) => ({ answer: 'אפשר להכין טיוטה', actionIntent: 'none', actionRequest: '', actionTargetType: 'none', actionTargetLabel: '', sourceIds: [], memoryMutations: [], ...extra });

test('history preserves referents and corrections beyond the old six-message window', () => {
  const messages = [{ role: 'user', text: 'הישיבה בנושא איסוף חומרים תתקיים בחמישי' },
    ...Array.from({ length: 8 }, (_, i) => ({ role: i % 2 ? 'user' : 'zoki', text: `המשך ${i}` })),
    { role: 'user', text: 'בעצם עד רביעי, בלי לשלוח הודעות' }];
  const history = boundedZokiHistory(messages);
  assert.equal(history[0].text, messages[0].text);
  assert.equal(history.at(-1).text, messages.at(-1).text);
  assert.equal(history[1].role, 'assistant');
  const large = boundedZokiHistory(Array.from({ length: 50 }, () => ({ role: 'user', text: 'א'.repeat(5000) })));
  assert.ok(large.reduce((sum, item) => sum + item.text.length, 0) <= ZOKI_CONTEXT_LIMITS.historyCharacters);
});

test('local fallback and error messages never become model conversation evidence after restore', () => {
  const restored = normalizeZokiConversationState({ messages: [
    { role: 'user', text: 'מי מטפל בזה?' },
    { role: 'zoki', text: 'תשובת גיבוי', localOnly: true },
    { role: 'zoki', text: 'תקלה', error: true },
  ] });
  assert.deepEqual(boundedZokiHistory(restored.messages), [{ role: 'user', text: 'מי מטפל בזה?' }]);
});

test('provider chooses sources by meaning and receives the same conversation in both stages', async () => {
  const history = [{ role: 'user', text: 'צריך לאסוף חומרים לקראת הישיבה' }];
  const calls = [];
  await runSemanticZokiTurn({ sources, input: { question: 'בוא נדאג שזה יקרה עד חמישי', history }, provider: {
    async selectSources(input) {
      calls.push(input);
      assert.equal(input.catalog.length, 20);
      return { sourceIds: [sources[19].id] };
    },
    async generateTurn(input) {
      calls.push(input);
      assert.deepEqual(input.authorizedSources, [sources[19]]);
      return answer();
    },
  } });
  assert.deepEqual(calls[0].history, calls[1].history);
  assert.equal(calls[1].question, 'בוא נדאג שזה יקרה עד חמישי');
});

test('empty catalog still reaches AI for general reasoning, without an unnecessary selection call', async () => {
  const result = await runSemanticZokiTurn({ sources: [], input: { question: 'איך כדאי להתכונן לישיבה?' }, provider: {
    selectSources() { assert.fail('no selection needed'); },
    async generateTurn(input) { assert.deepEqual(input.authorizedSources, []); return answer(); },
  } });
  assert.equal(result.result.actionIntent, 'none');
});

test('forged source selection fails closed before generation', async () => {
  await assert.rejects(runSemanticZokiTurn({ sources, input: { question: 'מידע' }, provider: {
    async selectSources() { return { sourceIds: ['schools/other/tasks/private'] }; },
    generateTurn() { assert.fail('must not run'); },
  } }), { code: 'invalid-ai-source' });
});

test('provider outage propagates instead of producing a keyword answer', async () => {
  await assert.rejects(runSemanticZokiTurn({ sources: [], input: { question: 'משימה' }, provider: {
    async generateTurn() { throw new Error('provider-offline'); },
  } }), /provider-offline/);
});

test('changed session stops a delayed selection before final generation', async () => {
  let current = true;
  await assert.rejects(runSemanticZokiTurn({ sources, input: { question: 'בקשה' },
    assertSession() { if (!current) throw new Error('session-changed'); },
    provider: {
      async selectSources() { current = false; return { sourceIds: [] }; },
      generateTurn() { assert.fail('must not run'); },
    },
  }), /session-changed/);
});

test('handoff preserves a resolved brief; advice discards any stray action payload', () => {
  const input = { authorizedSources: sources };
  const brief = 'לאסוף חומרים מהמחנכים עד יום חמישי לקראת הישיבה; ללא משלוח הודעות';
  assert.equal(normalizeSemanticResult(answer({ actionIntent: 'create_task', actionRequest: brief }), input).actionRequest, brief);
  const advice = normalizeSemanticResult(answer({ actionRequest: brief, actionTargetType: 'person', actionTargetLabel: 'דנה' }), input);
  assert.equal(advice.actionRequest, '');
  assert.equal(advice.actionTargetType, 'none');
  assert.throws(() => normalizeSemanticResult(answer({ actionIntent: 'create_task' }), input), { code: 'invalid-ai-response' });
  assert.throws(() => normalizeSemanticResult(answer({ sourceIds: ['forged'] }), input), { code: 'invalid-ai-source' });
});

test('semantic target binding does not infer a role when the model chose none', () => {
  assert.equal(resolveSemanticTaskTarget({ targetType: 'none', targetLabel: '', roles: [], staff: [], schoolId: 's' }).status, 'none');
  const staff = [{ id: 'one', fullName: 'דנה כהן' }];
  assert.equal(resolveSemanticTaskTarget({ targetType: 'person', targetLabel: 'דנה כהן', roles: [], staff, schoolId: 's' }).holders[0].id, 'one');
  assert.equal(resolveSemanticTaskTarget({ targetType: 'person', targetLabel: 'דנה כהן', roles: [], staff: [...staff, { id: 'two', fullName: 'דנה כהן' }], schoolId: 's' }).status, 'multiple_holders');
});
