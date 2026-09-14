import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthLoadingGate} from '../../src/utils/authLoadingGate.js';
import {pairComputer,LOCAL_CONNECTOR} from '../../src/services/zoki/pairComputer.js';

test('initial auth, account switch and signout block routes; same-account token renewal preserves them',()=>{
 const blocks=createAuthLoadingGate();
 assert.equal(blocks(null),true);assert.equal(blocks({uid:'one'}),true);
 assert.equal(blocks({uid:'one',accessToken:'refreshed'}),false);
 assert.equal(blocks({uid:'two'}),true);assert.equal(blocks(null),true);
});

test('forced token refresh during pairing does not unmount the panel or abort the handshake',async t=>{
 const blocks=createAuthLoadingGate();blocks({uid:'synthetic'});
 const abort=new AbortController();let listener,nonce,closed=false,credentialsSent=false;
 const popup={closed:false,close(){closed=true;},postMessage(data,origin){
  assert.equal(origin,LOCAL_CONNECTOR);credentialsSent=true;
  queueMicrotask(()=>listener({source:popup,origin:LOCAL_CONNECTOR,data:{nonce,type:'zoko-pair-done'}}));
 }};
 t.mock.method(globalThis,'setInterval',()=>0);
 t.after(()=>{delete globalThis.window;});
 Object.defineProperty(globalThis,'window',{configurable:true,value:{open(url){nonce=new URL(url).searchParams.get('nonce');return popup;},addEventListener(_,fn){listener=fn;},removeEventListener(){}}});
 const pending=pairComputer({uid:'synthetic',refreshToken:'synthetic-refresh',async getIdToken(force){
  assert.equal(force,true);
  // ProtectedRoute unmounts the pairing panel whenever auth sets loading=true.
  if(blocks({uid:'synthetic'}))abort.abort();
  return 'synthetic-id';
 }},'synthetic-school',abort.signal);
 await listener({source:popup,origin:LOCAL_CONNECTOR,data:{nonce,type:'zoko-pair-ready'}});
 await pending;assert.equal(credentialsSent,true);assert.equal(abort.signal.aborted,false);assert.equal(closed,true);
});
