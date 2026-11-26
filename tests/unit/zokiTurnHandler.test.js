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
    FIREBASE_CLIENT_EMAIL: 'svc@p.iam', FIREBASE_PRIVATE_KEY: pem, GITHUB_APP_ID: '1', GITHUB_APP_PRIVATE_KEY: pem, GITHUB_INSTALLATION_ID: '2',
    SCHOOL_REPOSITORIES: '{"s1":"o/r"}', ...over };
}

// Routes every outbound call to a fake; records what the model service and the counter received.
function fakes({ count = 1, route = { tool: null }, tasksCreate = true, claude = 'ok' } = {}) {
  const seen = { model: [], commits: 0, claude: [] };
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    let body = {};
    try { body = init.body ? JSON.parse(init.body) : {}; } catch { /* form-encoded token request */ }
    if (url.includes('identitytoolkit')) return Response.json({ users: [{ localId: 'u1' }] });
    if (url.endsWith('/documents/users/u1')) return Response.json({ fields: { fullName: str('דנה'), schoolId: str('s1'), accountStatus: str('active'),
      accessProfilesBySchool: map({ s1: map({ presetId: str('secretary'), school: map({ 'tasks.create': { booleanValue: tasksCreate } }) }) }) } });
    if (url.includes('/documents/zokiAgents/')) return new Response('{}', { status: 404 });
    if (url.includes('oauth2.googleapis.com')) return Response.json({ access_token: 'adm' });
    if (url.includes(':commit')) { seen.commits += 1; return Response.json({ writeResults: [{ transformResults: [{ integerValue: String(count) }] }] }); }
    if (url.includes('/access_tokens')) return Response.json({ token: 'gh' });
    if (url.includes('/contents/school-brain.md')) return new Response('# מוח\n\n## סגל\n\nדנה\n\n## תלמידים והקשרים לימודיים\n\n| נועה לוי | ז1 |\n', { headers: { etag: '"x"' } });
    if (url.startsWith('https://model.example.com/api/chat')) {
      seen.model.push(body);
      if (body.mode === 'route') return Response.json(route);
      return Response.json({ answer: 'יש שלוש כיתות בבית הספר: ז1, ז2 וח3.', sources: [] });
    }
    if (url.startsWith('https://api.anthropic.com/')) {
      seen.claude.push(body);
      if (claude === 'down') return new Response('{}', { status: 529 });
      if (claude === 'credit') return new Response('{}', { status: 429 });
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
