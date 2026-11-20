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
  const [suspension] = searchKnowledge('איך משעים תלמיד?');
  assert.equal(suspension.id, 'circular-suspension');
  const policy = answerPolicy(suspension);
  assert.equal(policy.mode, 'defer');
  assert.match(policy.text, /לא בדקתי/);
  assert.ok(policy.checklist.length > 0);
  assert.ok(policy.leads.length > 0 && policy.leads.every(lead => /לא נקרא|לא נבדק/.test(lead)));
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
  const prompt = roleAgentProfile('discipline_climate_coordinator').systemPrompt;
  assert.match(prompt, /אל תמציא חוזר מנכ״ל/);
  assert.match(prompt, /השעיית תלמידים/);
  assert.match(knowledgePromptFor('pedagogical_coordinator'), /ידע מאומת/);
});
test('unrelated questions return nothing', () => assert.deepEqual(searchKnowledge('מה מזג האוויר'), []));

test('official role definitions: every definition maps to a real role and carries its source', async () => {
  const { ROLE_DEFINITIONS, roleBrief } = await import('../../functions/src/roleDefinitions.js');
  const { SCHOOL_ROLES } = await import('../../functions/src/schoolRoleCatalog.js');
  const known = new Set([...SCHOOL_ROLES.map(role => role.id), 'homeroom']);
  const ids = Object.keys(ROLE_DEFINITIONS);
  assert.ok(ids.length >= 16);
  for (const id of ids) {
    assert.ok(known.has(id), `unknown role ${id}`);
    assert.ok(ROLE_DEFINITIONS[id].summary.length > 40);
    assert.ok(roleBrief(id).length <= 1800);
  }
  assert.ok(ids.filter(id => ROLE_DEFINITIONS[id].complete).length >= 11);
  assert.ok(KNOWLEDGE.filter(entry => entry.topic === 'role-definition').every(entry => entry.source.status === 'verified'));
});
test('a question about a role reaches its official definition, not a topic stub', () => {
  assert.equal(searchKnowledge('מה התפקיד של רכז טיולים?')[0].id, 'role-def-trips_coordinator');
  assert.equal(searchKnowledge('מה אחראי יועץ חינוכי')[0].id, 'role-def-counselor');
});
test('role agents receive their official brief', async () => {
  const { roleAgentProfile } = await import('../../functions/src/roleAgents.js');
  assert.match(roleAgentProfile('counselor').systemPrompt, /הגדרת התפקיד הרשמית/);
});

test('trips and bagrut circulars are verified, dated and cite their official PDF', () => {
  const [trips] = searchKnowledge('מה צריך לאשר לפני טיול של הכיתה?', { roleId: 'trips_coordinator' });
  assert.equal(trips.id, 'circular-trips');
  const policy = answerPolicy(trips);
  assert.equal(policy.mode, 'cite');
  assert.match(policy.text, /מהדורת 2016/);
  assert.match(policy.source.url, /teyulim2016\.pdf$/);
  const [bagrut] = searchKnowledge('מתי מועד חורף של הבגרויות ומה המועד האחרון להזמנת שאלונים?');
  assert.equal(bagrut.id, 'circular-bagrut');
  assert.match(answerPolicy(bagrut).text, /28\.12\.2026/);
  assert.match(answerPolicy(bagrut).source.url, /HozerYearTashpaz2027\.pdf$/);
});
