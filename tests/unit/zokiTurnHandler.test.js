import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import worker from '../../worker/src/index.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const str = stringValue => ({ stringValue });
const map = fields => ({ mapValue: { fields } });

function environment(over = {}) {
  return { ZOKI_PROVIDER: 'local', LOCAL_MODEL_URL: 'https://model.example.com', LOCAL_MODEL_TOKEN: 'k', FIREBASE_WEB_API_KEY: 'w', FIREBASE_PROJECT_ID: 'p',
    FIREBASE_CLIENT_EMAIL: 'svc@p.iam', FIREBASE_PRIVATE_KEY: pem, ZOKI_SCHOOL_IDS: 's1', ...over };
}

// Routes every outbound call to a fake; records what the model service and the counter received.
function fakes({ count = 1, route = { tool: null }, tasksCreate = true, claude = 'ok', brain = true, personal = null, persistPersonal = false } = {}) {
  const seen = { model: [], commits: 0, claude: [], brainWrites: 0, personal, personalWrites: [] };
  // What Firestore would hold for this user. A masked update on a missing document does not create it.
  let brainDoc = personal ? { profile: str(JSON.stringify(personal)), snapshot: str(JSON.stringify({ at: new Date().toISOString(), name: 'דנה', jobTitle: 'מזכירה', openTasks: 0 })) } : null;
  const applyPersonalWrite = write => {
    const fields = write?.update?.fields;
    if (!fields) return;
    if (!write.updateMask) { brainDoc = { ...fields }; return; }
    if (!brainDoc) return;
    const next = { ...brainDoc };
    for (const path of write.updateMask.fieldPaths || []) if (fields[path]) next[path] = fields[path];
    brainDoc = next;
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    let body = {};
    try { body = init.body ? JSON.parse(init.body) : {}; } catch { /* form-encoded token request */ }
    if (url.includes('identitytoolkit')) return Response.json({ users: [{ localId: 'u1' }] });
    if (url.endsWith('/documents/users/u1')) return Response.json({ fields: { fullName: str('דנה'), schoolId: str('s1'), accountStatus: str('active'),
      accessProfilesBySchool: map({ s1: map({ presetId: str('secretary'), school: map({ 'tasks.create': { booleanValue: tasksCreate } }) }) }) } });
    if (url.includes('/documents/zokiAgents/')) return new Response('{}', { status: 404 });
    if (url.includes('oauth2.googleapis.com')) return Response.json({ access_token: 'adm' });
    if (url.includes(':commit')) {
      seen.commits += 1;
      if (String(init.body).includes('zokiPersonalBrain')) {
        seen.personalWrites.push(body.writes[0]);
        if (persistPersonal) applyPersonalWrite(body.writes[0]);
      }
      if (String(init.body).includes('schoolBrain')) seen.brainWrites += 1;
      return Response.json({ writeResults: [{ transformResults: [{ integerValue: String(count) }] }] });
    }
    if (url.endsWith('/documents/schoolBrain/s1')) return brain ? Response.json({ fields: { markdown: str('# מוח\n\n## סגל\n\nדנה\n\n## תלמידים והקשרים לימודיים\n\n| נועה לוי | ז1 |\n'), version: str('1') } }) : new Response('{}', { status: 404 });
    if (url.includes('/documents/zokiPersonalBrain/')) return brainDoc ? Response.json({ fields: brainDoc }) : new Response('{}', { status: 404 });
    if (url.endsWith('/documents/tasks_s1?pageSize=1000')) return Response.json({ documents: [{ name: 'x/tasks_s1/k1', fields: { title: str('להזמין אוטובוס לטיול'), dueDate: str('2020-01-01'), status: str('open'), assigneeIds: { arrayValue: { values: [str('u1')] } } } }] });
    if (url.includes('/documents/schoolBrain/')) return new Response('{}', { status: 404 });
    // Any other collection read (used to build a brain from school data) is simply empty.
    if (url.includes('/documents/')) return Response.json({});
    if (url.startsWith('https://model.example.com/api/chat')) {
      seen.model.push(body);
      if (body.mode === 'route') return Response.json(route);
      return Response.json({ answer: 'יש שלוש כיתות בבית הספר: ז1, ז2 וח3.', sources: [] });
    }
    if (url.startsWith('https://api.anthropic.com/')) {
      seen.claude.push(body);
      if (claude === 'down') return new Response('{}', { status: 529 });
      if (claude === 'credit') return new Response('{}', { status: 429 });
      if (JSON.stringify(body.system).includes('מנגנון הזיכרון')) {
        if (claude === 'learn' || claude === 'invert') {
          const asked = JSON.stringify(body.messages);
          const text = claude === 'invert'
            ? '{"summary":"כל בעל תפקיד מציג 2 דקות לכל היותר","preferences":["2 דקות לכל היותר"],"facts":["מציג 2 דקות לכל היותר"],"focus":["אין מבחן"],"insights":[],"mood":null}'
            : asked.includes('מבחן מחצית')
              ? '{"summary":"מעדיף קיצור ועסוק במבחן","preferences":["תשובות קצרות בנקודות"],"focus":["הכנה למבחן מחצית"],"insights":["לפתוח בנקודות"],"mood":null}'
              : '{"summary":"מעדיף תשובות קצרות","preferences":["תשובות קצרות בנקודות"],"focus":[],"mood":null}';
          return Response.json({ content: [{ type: 'text', text }] });
        }
        return Response.json({ content: [{ type: 'text', text: '{"summary":"שואלת על סדרי עדיפויות","focus":["הטיול השנתי"],"mood":null}' }] });
      }
      return Response.json({ content: [{ type: 'text', text: 'תשובת קלוד' }], stop_reason: 'end_turn', usage: {} });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  return seen;
}

const turn = (messages, env) => worker.fetch(new Request('https://w.example.com/v1/zoki/turn', { method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: JSON.stringify({ schoolId: 's1', messages }) }), env);

test('a question gets school context (without students for a user who may not see them)', async () => {
  const seen = fakes();
  const response = await turn([{ role: 'user', content: 'כמה כיתות יש?' }], environment());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).reply, 'יש שלוש כיתות בבית הספר: ז1, ז2 וח3.');
  assert.ok(seen.model[0].context.includes('דנה'));
  assert.ok(!seen.model[0].context.includes('נועה לוי'));
  assert.equal(seen.model.some(item => item.mode === 'route'), false);
});

test('an instruction becomes a proposal for a tool the user holds', async () => {
  fakes({ route: { tool: 'create_task', input: { title: 'להזמין אוטובוס' } } });
  const out = await (await turn([{ role: 'user', content: 'צור משימה להזמין אוטובוס' }], environment())).json();
  assert.deepEqual(out.proposals.map(item => [item.tool, item.input.title]), [['create_task', 'להזמין אוטובוס']]);
});

test('a tool the user does not hold is never proposed', async () => {
  fakes({ tasksCreate: false, route: { tool: 'create_task', input: { title: 'x' } } });
  const response = await turn([{ role: 'user', content: 'צור משימה להזמין אוטובוס' }], environment());
  assert.deepEqual((await response.json()).proposals, []);
});

test('past the daily limit the request is refused with a retry time', async () => {
  fakes({ count: 61 });
  const response = await turn([{ role: 'user', content: 'שלום' }], environment());
  assert.equal(response.status, 429);
  const out = await response.json();
  assert.equal(out.error, 'resource-exhausted');
  assert.ok(out.retryAfter >= 60);
});

const claudeEnv = over => environment({ ZOKI_PROVIDER: 'claude-first', ANTHROPIC_API_KEY: 'sk', ...over });

test('Claude answers first, with Haiku and the school context', async () => {
  const seen = fakes();
  const out = await (await turn([{ role: 'user', content: 'כמה כיתות יש?' }], claudeEnv())).json();
  assert.equal(out.reply, 'תשובת קלוד');
  assert.equal(out.provider, 'claude');
  assert.equal(seen.claude[0].model, 'claude-haiku-5-5');
  assert.ok(JSON.stringify(seen.claude[0].system).includes('דנה'));
  assert.equal(seen.model.length, 0);
});

test('when Claude is down or out of credit the school model answers', async () => {
  for (const claude of ['down', 'credit']) {
    const seen = fakes({ claude });
    const out = await (await turn([{ role: 'user', content: 'כמה כיתות יש?' }], claudeEnv())).json();
    assert.equal(out.reply, 'יש שלוש כיתות בבית הספר: ז1, ז2 וח3.');
    assert.equal(seen.model.length, 1, JSON.stringify(seen.model.map(item => [item.mode, item.model, item.stream])));
  }
});

test('past the user\'s Claude allowance the school model answers', async () => {
  const seen = fakes({ count: 12 });
  const out = await (await turn([{ role: 'user', content: 'כמה כיתות יש?' }], claudeEnv())).json();
  assert.equal(out.reply, 'יש שלוש כיתות בבית הספר: ז1, ז2 וח3.');
  assert.equal(seen.claude.length, 0);
});

test('without a Claude key, or when forced local, Claude is never called', async () => {
  let seen = fakes();
  await turn([{ role: 'user', content: 'שלום' }], environment({ ZOKI_PROVIDER: 'claude-first' }));
  assert.equal(seen.claude.length, 0);
  seen = fakes();
  await turn([{ role: 'user', content: 'שלום' }], claudeEnv({ ZOKI_PROVIDER: 'local' }));
  assert.equal(seen.claude.length, 0);
});

test('a school with no brain yet gets one built and saved the first time it is needed', async () => {
  const seen = fakes({ brain: false });
  const response = await turn([{ role: 'user', content: 'כמה כיתות יש?' }], environment());
  assert.equal(response.status, 200);
  assert.equal(seen.brainWrites, 1);
});

test('the answer is personal: the user\'s own tasks and what Zoki learned reach the model, and Zoki learns from the turn', async () => {
  const seen = fakes();
  await turn([{ role: 'user', content: 'מה הכי דחוף לי השבוע?' }], claudeEnv());
  const system = JSON.stringify(seen.claude[0].system);
  assert.ok(system.includes('להזמין אוטובוס לטיול') && system.includes('באיחור'));
  // The second Claude call is the reflection; its result is stored as this user's profile only.
  assert.equal(seen.claude.length, 2);
  const stored = seen.personalWrites.find(write => write.update.fields.profile);
  assert.ok(stored.update.name.endsWith('/zokiPersonalBrain/u1__s1'));
  const learned = JSON.parse(stored.update.fields.profile.stringValue);
  assert.equal(learned.turns, 1);
  assert.deepEqual(learned.focus, []);

  const known = fakes({ personal: { preferences: ['תשובות קצרות בנקודות'], mood: { tone: 'עמוס', note: 'שבוע מבחנים', at: new Date().toISOString() } } });
  await turn([{ role: 'user', content: 'מה הכי דחוף לי השבוע?' }], claudeEnv());
  assert.ok(JSON.stringify(known.claude[0].system).includes('תשובות קצרות בנקודות'));
  const local = fakes({ personal: { preferences: ['תשובות קצרות בנקודות'] } });
  await turn([{ role: 'user', content: 'מה הכי דחוף לי השבוע?' }], environment());
  assert.ok(local.model[0].context.includes('תשובות קצרות בנקודות'));
  assert.equal(local.claude.length, 0);
});

test('the first turn waits for a missing snapshot, then the reflection still runs after the answer', async () => {
  const seen = fakes();
  const pending = [];
  const ctx = { waitUntil(promise) { pending.push(promise); } };
  const response = await worker.fetch(new Request('https://w.example.com/v1/zoki/turn', {
    method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: JSON.stringify({ schoolId: 's1', messages: [{ role: 'user', content: 'מה הכי דחוף לי השבוע?' }] }),
  }), claudeEnv(), ctx);
  assert.equal(response.status, 200);
  const answer = seen.claude.find(call => !JSON.stringify(call.system).includes('מנגנון הזיכרון'));
  assert.ok(JSON.stringify(answer.system).includes('להזמין אוטובוס לטיול'), 'the answer is sent with the live snapshot');
  await Promise.all(pending);
  assert.ok(seen.claude.some(call => JSON.stringify(call.system).includes('מנגנון הזיכרון')), 'reflection runs after the answer');
  const created = seen.personalWrites.find(write => write.update.fields.snapshot && !write.updateMask);
  assert.ok(created, 'the first snapshot must create the document; a masked update fails when it is missing');
  assert.ok(seen.personalWrites.some(write => write.update.fields.profile));
});

test('three turns: the first already sees tasks, and each answer is learned and used on the next turn', async () => {
  const seen = fakes({ persistPersonal: true, claude: 'learn' });
  const env = claudeEnv();
  const history = [];
  const ask = async text => {
    const pending = [];
    history.push({ role: 'user', content: text });
    const response = await worker.fetch(new Request('https://w.example.com/v1/zoki/turn', {
      method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify({ schoolId: 's1', messages: history }),
    }), env, { waitUntil(promise) { pending.push(promise); } });
    assert.equal(response.status, 200);
    const body = await response.json();
    await Promise.all(pending);
    history.push({ role: 'assistant', content: body.reply });
  };
  const answers = () => seen.claude.filter(call => !JSON.stringify(call.system).includes('מנגנון הזיכרון'));
  await ask('אני מעדיף תשובות קצרות בנקודות תמיד');
  const first = JSON.stringify(answers()[0].system);
  assert.ok(first.includes('להזמין אוטובוס לטיול'), 'the first turn already has the live task snapshot');
  assert.ok(!first.includes('תשובות קצרות בנקודות'), 'nothing has been learned before the first reflection');
  await ask('השבוע אני עסוק בהכנה למבחן מחצית');
  const second = JSON.stringify(answers()[1].system);
  assert.ok(second.includes('תשובות קצרות בנקודות'), 'turn 2 uses what turn 1 taught');
  assert.ok(second.includes('להזמין אוטובוס לטיול'));
  await ask('מה כדאי לי לעשות קודם השבוע?');
  const third = JSON.stringify(answers()[2].system);
  assert.ok(third.includes('תשובות קצרות בנקודות') && third.includes('הכנה למבחן מחצית'));
  const stored = JSON.parse(seen.personalWrites.at(-1).update.fields.profile.stringValue);
  assert.equal(stored.turns, 3);
  assert.ok(stored.preferences.some(item => item.includes('תשובות קצרות בנקודות')));
  assert.ok(stored.focus.some(item => item.text.includes('הכנה למבחן מחצית')));
  assert.ok(seen.personalWrites.at(-1).update.name.endsWith('/zokiPersonalBrain/u1__s1'));
});

const BULLETS = 'אני מעדיף תשובות קצרות בנקודות. השבוע אני עסוק בהכנה למבחן מחצית.';
const MEETING = 'חשוב שתדע: אצלי ישיבות הנהלה בנויות כך שכל בעל תפקיד מציג 2 דקות ומעלה רעיון אחד לשיפור, ולא עדכונים.';
const MEETING_VERBATIM = 'אצלי ישיבות הנהלה בנויות כך שכל בעל תפקיד מציג 2 דקות ומעלה רעיון אחד לשיפור, ולא עדכונים.';

test('three live turns keep the user\'s own words, and the next turn is prompted with them', async () => {
  const seen = fakes({ persistPersonal: true, claude: 'invert' });
  const env = claudeEnv();
  const history = [];
  const ask = async text => {
    const pending = [];
    history.push({ role: 'user', content: text });
    const response = await worker.fetch(new Request('https://w.example.com/v1/zoki/turn', {
      method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify({ schoolId: 's1', messages: history }),
    }), env, { waitUntil(promise) { pending.push(promise); } });
    assert.equal(response.status, 200);
    const body = await response.json();
    await Promise.all(pending);
    history.push({ role: 'assistant', content: body.reply });
    return body;
  };
  await ask(BULLETS);
  await ask(MEETING);
  await ask('מה יש בגאנט השבוע לשכבת י׳?');
  const stored = JSON.parse(seen.personalWrites.at(-1).update.fields.profile.stringValue);
  assert.equal(stored.turns, 3);
  assert.ok(stored.preferences.some(item => item.includes('תשובות קצרות בנקודות')));
  assert.ok(stored.focus.some(item => item.text.includes('הכנה למבחן מחצית')));
  assert.ok(stored.facts.includes(MEETING_VERBATIM));
  const inverted = JSON.stringify(stored);
  assert.ok(!inverted.includes('לכל היותר'));
  await ask('מה כדאי לי לעשות קודם השבוע?');
  const answers = seen.claude.filter(call => !JSON.stringify(call.system).includes('מנגנון הזיכרון'));
  const next = JSON.stringify(answers.at(-1).system);
  assert.ok(next.includes('תשובות קצרות בנקודות'));
  assert.ok(next.includes('הכנה למבחן מחצית'));
  assert.ok(next.includes(MEETING_VERBATIM));
});

test('a user reads and clears only their own personal brain', async () => {
  const seen = fakes({ personal: { summary: 'מזכירה ותיקה' } });
  const call = (path, method) => worker.fetch(new Request(`https://w.example.com${path}${method === 'GET' ? '?schoolId=s1' : ''}`, { method, headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify({ schoolId: 's1', uid: 'someone-else' }) } : {}) }), environment());
  const read = await (await call('/v1/zoki/personal-brain', 'GET')).json();
  assert.equal(read.profile.summary, 'מזכירה ותיקה');
  assert.equal(read.empty, false);
  assert.equal((await call('/v1/zoki/personal-brain/clear', 'POST')).status, 200);
  const cleared = seen.personalWrites.at(-1);
  assert.ok(cleared.update.name.endsWith('/zokiPersonalBrain/u1__s1'));
  assert.equal(JSON.parse(cleared.update.fields.profile.stringValue).summary, '');
});
