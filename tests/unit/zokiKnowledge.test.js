import test from 'node:test';
import assert from 'node:assert/strict';
import { KNOWLEDGE, searchKnowledge, answerPolicy, knowledgePromptFor } from '../../functions/src/zokiKnowledge.js';
import { roleAgentProfile } from '../../functions/src/roleAgents.js';

test('every entry has a source; verified entries carry a retrieval date and content', () => {
  const ids = new Set();
  for (const entry of KNOWLEDGE) {
    assert.ok(!ids.has(entry.id)); ids.add(entry.id);
    assert.match(entry.source.url, /^https:\/\//);
    if (entry.source.status === 'verified') { assert.match(entry.source.retrieved, /^\d{4}-\d{2}-\d{2}$/); assert.ok(entry.summary && entry.points.length); }
    else { assert.equal(entry.summary, ''); assert.equal(entry.points.length, 0); assert.ok(entry.checklist.length); }
  }
});
test('unverified circulars never produce rule text, only a check list and a deferral', () => {
  const [trip] = searchKnowledge('מתי אפשר לצאת לטיול עם הכיתה?');
  assert.equal(trip.id, 'circular-trips');
  const policy = answerPolicy(trip);
  assert.equal(policy.mode, 'defer');
  assert.match(policy.text, /לא בדקתי/);
  assert.ok(policy.checklist.length > 0);
});
test('verified entries are cited with their source', () => {
  const [entry] = searchKnowledge('כמה נקודות זכות מקבל רכז שכבה?', { roleId: 'grade_coordinator' });
  assert.equal(entry.id, 'credits-and-ranks');
  const policy = answerPolicy(entry);
  assert.equal(policy.mode, 'cite');
  assert.match(policy.text, /1\.67%/);
  assert.match(policy.source.url, /pedagogiamh/);
});
test('role agent prompt carries the no-invention rule and open topics', () => {
  const prompt = roleAgentProfile('trips_coordinator').systemPrompt;
  assert.match(prompt, /אל תמציא חוזר מנכ״ל/);
  assert.match(prompt, /טיולים/);
  assert.match(knowledgePromptFor('pedagogical_coordinator'), /ידע מאומת/);
});
test('unrelated questions return nothing', () => assert.deepEqual(searchKnowledge('מה מזג האוויר'), []));
