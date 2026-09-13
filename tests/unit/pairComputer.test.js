import test from 'node:test';
import assert from 'node:assert/strict';
import { isPairMessage, LOCAL_CONNECTOR } from '../../src/services/zoki/pairComputer.js';
import { pairScript } from '../../scripts/codex-pilot/pair-page.mjs';
test('pairing accepts only the exact loopback popup and matching handshake',()=>{
 const popup={},message={source:popup,origin:LOCAL_CONNECTOR,data:{nonce:'n',type:'zoko-pair-ready'}};
 assert.equal(isPairMessage(message,popup,'n'),true);
 for(const altered of [{...message,origin:'https://attacker.invalid'},{...message,source:{}},{...message,data:{nonce:'other',type:'zoko-pair-ready'}},{...message,data:{nonce:'n',type:'approve'}}])assert.equal(isPairMessage(altered,popup,'n'),false);
 assert.match(pairScript,/event.origin!==site\|\|event.source!==window.opener/);
 assert.match(pairScript,/if\(!awaiting/);
 assert.doesNotMatch(pairScript,/localStorage|sessionStorage|indexedDB|console\./);
});

test('pair popup requires consent and trusted credentials; returns no tokens or local session',async()=>{
 const {runInNewContext}=await import('node:vm');
 const handlers={},button={},status={},sent=[],requests=[];
 const opener={postMessage:(data,origin)=>sent.push({data,origin})};
 const nonce='12345678-1234-1234-1234-123456789012';
 button.addEventListener=(_,fn)=>{handlers.click=fn;};
 runInNewContext(pairScript,{URL,location:{href:`http://127.0.0.1:5189/__zoki_pair?nonce=${nonce}`},document:{getElementById:id=>id==='pair'?button:status},window:{opener,addEventListener:(_,fn)=>{handlers.message=fn;}},fetch:async(path,options)=>{requests.push({path,options});return{ok:true,json:async()=>({connected:true,sessionId:'private-session'})};}});
 const message={origin:'https://yossileviway.github.io',source:opener,data:{type:'zoko-pair-credentials',nonce,idToken:'synthetic-id',refreshToken:'synthetic-refresh',schoolId:'synthetic-school'}};
 await handlers.message(message);assert.equal(requests.length,0);
 handlers.click();assert.equal(sent[0].data.type,'zoko-pair-ready');
 await handlers.message({...message,origin:'https://attacker.invalid'});
 await handlers.message({...message,source:{}});
 await handlers.message({...message,data:{...message.data,nonce:'wrong'}});
 assert.equal(requests.length,0);
 await handlers.message(message);await handlers.message(message);
 assert.equal(requests.length,1);assert.equal(requests[0].path,'/__zoki_codex/connect');
 assert.equal(requests[0].options.headers.Authorization,'Bearer synthetic-id');
 assert.equal(sent.at(-1).data.type,'zoko-pair-done');
 assert.doesNotMatch(JSON.stringify(sent),/synthetic-id|synthetic-refresh|private-session/);
});
