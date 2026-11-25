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
function fakes({ count = 1, route = { tool: null }, tasksCreate = true } = {}) {
  const seen = { model: [], commits: 0 };
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
      return Response.json({ answer: 'יש שלוש כיתות.', sources: [] });
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
  assert.equal((await response.json()).reply, 'יש שלוש כיתות.');
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
