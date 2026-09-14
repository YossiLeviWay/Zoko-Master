import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCodexRelay, bridgeAvailable } from '../../src/services/zoki/codexRelay.js';
import { createRelay, validRelayRequest, invokePilot, RELAY_CHUNK } from '../../scripts/codex-pilot/relay.mjs';
const actor = { uid: 'manager', schoolId: 'school' }, origin = 'http://127.0.0.1:5189';
const root = 'users/manager/zokiPilot/school';
function memoryDb() {
  const records = new Map(); let version = 0;
  return { records, actor: async () => actor, get: async path => structuredClone(records.get(path) || null), list: async path => [...records.values()].filter(row => row.path.split('/').slice(0, -1).join('/') === path),
    commit: async changes => { for (const c of changes) { const old = records.get(c.path); assert.equal(old?.version, c.version); records.set(c.path, { path: c.path, id: c.path.split('/').pop(), data: c.patch ? { ...old.data, ...c.patch } : c.data, version: String(++version) }); } },
    remove: async rows => { for (const row of rows) { assert.equal(records.get(row.path)?.version, row.version); records.delete(row.path); } },
  };
}
test('relay validates instance, operation, expiry, IDs and bounded Unicode chunks', () => {
  const request = { id: 'request-1', bridgeId: 'bridge', operation: 'approve', parts: 1, expiresAt: 2000 };
  assert.equal(validRelayRequest(request, 'bridge', 1000), true);
  for (const change of [{ id: '../evil' }, { bridgeId: 'other' }, { operation: 'shell' }, { parts: 161 }, { parts: -1 }, { expiresAt: 999 }, { expiresAt: 999999 }]) assert.equal(validRelayRequest({ ...request, ...change }, 'bridge', 1000), false);
  assert.ok(Buffer.byteLength('漢'.repeat(RELAY_CHUNK)) < 700000);
});
test('internal transport keeps authentication in headers, not model/body', async () => {
  const result = await invokePilot(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer synthetic-token');
    assert.equal(req.headers['x-zoki-session'], 'private-nonce');
    assert.equal(req.relayInternal, true);
    let body = ''; for await (const part of req) body += part;
    assert.equal(body.includes('synthetic-token'), false); assert.equal(JSON.parse(body).schoolId, 'school');
    res.statusCode = 200; res.end('{"connected":true}');
  }, origin, 'synthetic-token', 'private-nonce', 'status', { schoolId: 'school' });
  assert.equal(result.value.connected, true);
});
test('remote resume invokes shared handler once, hides nonce, cleans chunks and rejects stale generation', async () => {
  const db = memoryDb(); const calls = [];
  const handler = async (req, res) => { const op = req.url.split('/').pop(); calls.push(op); res.statusCode = 200; res.end(JSON.stringify(op === 'resume' ? { sessionId: 'private-nonce', history: [] } : { connected: true })); };
  const relay = createRelay({ projectId: 'demo-relay', origin, handler, dbFactory: () => db });
  try {
    await relay.session({ operation: 'connect', actor, token: 'synthetic-token', sessionId: 'private-nonce' });
    const bridge = (await db.get(`${root}/state/bridge`)).data;
    await db.commit([{ path: `${root}/transportChunks/r-in-0`, data: { text: '{}', expiresAt: Date.now() + 600000 } }, { path: `${root}/state/relayRequest`, data: { id: 'r', bridgeId: bridge.bridgeId, operation: 'connect', parts: 1, status: 'queued', expiresAt: Date.now() + 180000 } }]);
    await relay.tick();
    for (let i = 0; i < 30 && (await db.get(`${root}/state/relayRequest`)).data.status !== 'done'; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal((await db.get(`${root}/state/relayRequest`)).data.status, 'done');
    await relay.tick(); assert.equal(calls.filter(op => op === 'resume').length, 1);
    const all = JSON.stringify([...db.records.values()]);
    assert.equal(all.includes('private-nonce'), false); assert.equal(all.includes('synthetic-token'), false);
    assert.equal(await db.get(`${root}/transportChunks/r-in-0`), null);
    await relay.close(); assert.equal((await db.get(`${root}/state/bridge`)).data.online, false); assert.equal((await db.list(`${root}/transportChunks`)).length, 0);
  } finally { await relay.close(); }
});
test('public relay uses memory-only transport, transactional approval and no auto mutation fallback', async () => {
  const source = await readFile('src/services/zoki/codexRelay.js', 'utf8');
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|console\./);
  assert.doesNotMatch(source, /getIdToken|refreshToken|Authorization/);
  assert.match(source, /runTransaction/); assert.match(source, /signal\?\.aborted/);
  const panel = await readFile('src/components/Zoki/ZokiCodexPanel.jsx', 'utf8');
  assert.match(panel, /!local && !busy && !question && !file/);assert.doesNotMatch(panel,/onBack\(failure.code\)/);
  const page = await readFile('src/components/Zoki/ZokiPage.jsx', 'utf8');
  assert.match(page, /onCodex=\{manager \?/);
});

test('disabled production gate never accesses Firebase or queues sensitive input', async () => {
  const client = createCodexRelay({uid:'manager',schoolId:'a',db:null});
  assert.equal((await client.status()).connected,false);
  await assert.rejects(client.request('analyze',{question:'synthetic sensitive input'}),/codex-public-disabled/);
  await assert.rejects(client.request('approve',{hash:'synthetic'}),/codex-public-disabled/);
  assert.equal(bridgeAvailable({online:true,bridgeId:'id',expiresAt:99},100),false);
  assert.equal(bridgeAvailable({online:true,bridgeId:'id',expiresAt:101},100),true);
});

test('paired worker renews credentials without a browser heartbeat and clears them on stop',async()=>{
 const db=memoryDb();let refreshed=0,cleared=0;
 const handler=async(_req,res)=>{res.statusCode=200;res.end(JSON.stringify({connected:true}));};
 const relay=createRelay({projectId:'demo-relay',origin,handler,dbFactory:()=>db});
 await relay.session({operation:'connect',actor,token:'initial',sessionId:'private',credentials:{token:async()=>{refreshed++;return 'renewed';},clear:()=>cleared++}});
 await relay.tick();assert.ok(refreshed>=2);assert.equal(db.records.get(`${root}/state/bridge`).data.online,true);
 await relay.close();assert.equal(cleared,1);assert.equal(db.records.get(`${root}/state/bridge`).data.online,false);
});

test('worker exposes only safe progress stages, never model or file text',async()=>{
 const db=memoryDb();let phase='reading';
 const handler=async(_req,res)=>{res.statusCode=200;res.end(JSON.stringify({connected:true,phase}));};
 const relay=createRelay({projectId:'demo-relay',origin,handler,dbFactory:()=>db});
 try{
  await relay.session({operation:'connect',actor,token:'synthetic',sessionId:'private'});
  assert.equal(db.records.get(`${root}/state/bridge`).data.phase,'reading');
  // Force next idle heartbeat without exposing timestamps or inputs.
  phase='private-file-content';
  await relay.close();
  await relay.session({operation:'connect',actor,token:'synthetic',sessionId:'private'});
  assert.equal(db.records.get(`${root}/state/bridge`).data.phase,'');
  assert.doesNotMatch(JSON.stringify([...db.records.values()]),/private-file-content/);
 }finally{await relay.close();}
});

test('long analysis survives renewal and the original queue admission deadline',async t=>{
 let now=100000; t.mock.method(Date,'now',()=>now);
 const db=memoryDb();let complete,analyses=0,cancelled=0;
 const finished=new Promise(resolve=>{complete=resolve;});
 const handler=async(req,res)=>{
  const operation=req.url.split('/').pop();
  if(operation==='analyze'){analyses++;await finished;}
  if(operation==='cancel')cancelled++;
  res.statusCode=200;res.end(JSON.stringify({connected:true,phase:'preparing'}));
 };
 const relay=createRelay({projectId:'demo-relay',origin,handler,dbFactory:()=>db});
 try{
  await relay.session({operation:'connect',actor,token:'synthetic',sessionId:'private',credentials:{token:async()=> 'renewed',clear(){}}});
  const bridge=(await db.get(`${root}/state/bridge`)).data;
  await db.commit([{path:`${root}/transportChunks/long-in-0`,data:{text:'{}',expiresAt:now+600000}},{path:`${root}/state/relayRequest`,data:{id:'long',bridgeId:bridge.bridgeId,operation:'analyze',parts:1,status:'queued',expiresAt:now+180000}}]);
  await relay.tick();for(let i=0;i<10&&!analyses;i++)await new Promise(resolve=>setImmediate(resolve));
  for(let i=0;i<3;i++){now+=120000;await relay.tick();}
  assert.equal(cancelled,0);assert.equal(analyses,1);assert.equal((await db.get(`${root}/state/bridge`)).data.phase,'preparing');
  complete();for(let i=0;i<30&&(await db.get(`${root}/state/relayRequest`)).data.status!=='done';i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await db.get(`${root}/state/relayRequest`)).data.status,'done');
 }finally{complete();await relay.close();}
});

test('brief Firebase outage preserves pairing, revalidates role, and revocation stops immediately', async () => {
  const db=memoryDb();let fail=false,revoked=false,cleared=0,checks=0;
  db.actor=async()=>{checks++;if(fail)throw Object.assign(new Error(),{code:'firebase-unavailable'});if(revoked)throw Object.assign(new Error(),{code:'permission-denied'});return actor;};
  const handler=async(_req,res)=>{res.statusCode=200;res.end('{"connected":true}');};
  const relay=createRelay({projectId:'demo-relay',origin,handler,dbFactory:()=>db});
  try {
    await relay.session({operation:'connect',actor,token:'synthetic',sessionId:'private',credentials:{token:async()=>'synthetic',clear:()=>cleared++}});
    const bridge=(await db.get(`${root}/state/bridge`)).data.bridgeId;
    fail=true;await relay.tick();assert.equal(cleared,0);
    fail=false;await relay.tick();assert.equal((await db.get(`${root}/state/bridge`)).data.bridgeId,bridge);assert.ok(checks>=3);
    revoked=true;await relay.tick();assert.equal(cleared,1);assert.equal((await db.get(`${root}/state/bridge`)).data.online,false);
  } finally { await relay.close(); }
});

test('prolonged outage clears credentials after bounded retry window', async t => {
  let now=100000; t.mock.method(Date,'now',()=>now);
  const db=memoryDb();let fail=false,cleared=0;
  db.actor=async()=>{if(fail)throw Object.assign(new Error(),{code:'firebase-unavailable'});return actor;};
  const relay=createRelay({projectId:'demo-relay',origin,dbFactory:()=>db,handler:async(_req,res)=>{res.statusCode=200;res.end('{"connected":true}');}});
  try {
    await relay.session({operation:'connect',actor,token:'synthetic',sessionId:'private',credentials:{token:async()=>'synthetic',clear:()=>cleared++}});
    fail=true;await relay.tick();now+=59000;await relay.tick();assert.equal(cleared,0);
    now+=1000;await relay.tick();assert.equal(cleared,1);
  } finally { await relay.close(); }
});
