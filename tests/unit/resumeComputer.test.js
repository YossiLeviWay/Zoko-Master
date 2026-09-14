import test from 'node:test';
import assert from 'node:assert/strict';
import { resumeComputer } from '../../src/services/zoki/resumeComputer.js';
test('online pairing resumes conversation without requesting credentials or new consent', async () => {
  const signal = new AbortController().signal;
  const result = {sessionId:'synthetic',history:[{text:'Synthetic history'}]};
  assert.equal(await resumeComputer({status:async()=>({connected:true}),request:async(op,body,passed)=>{assert.equal(op,'connect');assert.deepEqual(body,{});assert.equal(passed,signal);return result;}},signal),result);
});
test('offline computer does not dispatch, and an account change aborts a pending probe', async () => {
  const controller = new AbortController(); let calls=0;
  const relay={status:async()=>({connected:false}),request:async()=>{calls++;}};
  assert.equal(await resumeComputer(relay,controller.signal),null);
  relay.status=async()=>{controller.abort();return {connected:true};};
  await assert.rejects(resumeComputer(relay,controller.signal),{name:'AbortError'});
  assert.equal(calls,0);
});
