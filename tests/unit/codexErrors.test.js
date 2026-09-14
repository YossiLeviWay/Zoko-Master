import test from 'node:test';
import assert from 'node:assert/strict';
import {messageFor} from '../../src/services/zoki/codexErrors.js';
import {codexFailureCode} from '../../scripts/codex-pilot/client.mjs';
import {extractPilotFile} from '../../scripts/codex-pilot/files.mjs';
test('model failure categories retain cause without provider or document text',()=>{
 for(const [info,expected] of [['UsageLimitExceeded','codex-usage-limit'],['contextWindowExceeded','codex-context-limit'],[{httpConnectionFailed:{httpStatusCode:503}},'codex-connection-failed'],['Unauthorized','codex-login-required']]){
  const code=codexFailureCode({codexErrorInfo:info,message:'PRIVATE STUDENT',additionalDetails:'PRIVATE FILE'});
  assert.equal(code,expected);assert.doesNotMatch(messageFor({code}),/PRIVATE/);
 }
 assert.equal(codexFailureCode({message:'PRIVATE'}),'codex-turn-failed');
 assert.doesNotMatch(messageFor({code:'private-student',message:'PRIVATE'}),/private-student|PRIVATE/);
 assert.match(messageFor({code:'codex-timeout'}),/codex-timeout/);
});
test('unreadable XLSX returns a safe file-specific failure',async()=>{
 await assert.rejects(extractPilotFile({name:'private-name.xlsx',base64:Buffer.from('private invalid content').toString('base64')}),error=>error.code==='file-read-failed'&&!error.message.includes('private'));
});

test('analysis timeout reports timeout instead of falsely reporting user cancellation',async()=>{
 const {EventEmitter}=await import('node:events');const {PassThrough}=await import('node:stream');
 const {CodexPilotClient}=await import('../../scripts/codex-pilot/client.mjs');
 const child=new EventEmitter();child.stdout=new PassThrough();child.stdin=new PassThrough();let killed=false;child.kill=()=>{killed=true;};
 const client=new CodexPilotClient({cwd:'/tmp',spawnProcess:()=>child,timeoutMs:10});client.authenticated=true;
 client.call=async method=>method==='config/read'?{config:{}}:method==='thread/start'?{thread:{id:'synthetic',ephemeral:true}}:{};
 try{await assert.rejects(client.generate({text:'synthetic'}),error=>error.code==='codex-timeout');assert.equal(killed,true);}finally{client.close();}
});
