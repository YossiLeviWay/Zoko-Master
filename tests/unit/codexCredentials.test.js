import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryCredentials } from '../../scripts/codex-pilot/credentials.mjs';
test('device refreshes credentials in memory and clears them on disconnect',async()=>{
 let now=0,calls=0;
 const credentials=memoryCredentials({token:'first',refreshToken:'refresh',apiKey:'test',now:()=>now,fetchImpl:async(_url,options)=>{calls++;assert.equal(options.body.get('refresh_token'),'refresh');return {ok:true,json:async()=>({id_token:'renewed',refresh_token:'rotated',expires_in:3600})};}});
 assert.equal(await credentials.token(),'first');assert.equal(calls,0);
 now=41*60*1000;assert.equal(await credentials.token(),'renewed');assert.equal(calls,1);
 credentials.clear();await assert.rejects(credentials.token(),/session-expired/);
});
test('revoked Firebase credentials never fall back to the stale token',async()=>{
 let now=0;const credentials=memoryCredentials({token:'first',refreshToken:'refresh',apiKey:'test',now:()=>now,fetchImpl:async()=>({ok:false})});now=41*60*1000;await assert.rejects(credentials.token(),/session-expired/);
});
