import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { parseCsv, extractPilotFile, FILE_LIMITS } from '../../scripts/codex-pilot/files.mjs';
import { expandDates, matchCandidates, prepareProposal, executeProposal, digest } from '../../scripts/codex-pilot/imports.mjs';
import { UserFirestore } from '../../scripts/codex-pilot/firestore.mjs';
import { saveProposal, loadProposal } from '../../scripts/codex-pilot/store.mjs';
import { allowedRequest, parseAnswer, createPilotHandler } from '../../scripts/codex-pilot/server.mjs';
const actor = { uid: 'manager', schoolId: 'demo_school', fullName: 'Synthetic manager' };
const action = (kind, fields, key = 'a') => ({ key, kind, fields, intent: 'create', source: 'Sheet1!A2', reason: 'Synthetic fixture' });
function memoryDb(records = []) {
  const store = new Map(records.map(r => [r.path, structuredClone(r)])); let writes = 0;
  return { store, get writes() { return writes; }, actor: async () => actor,
    get: async path => structuredClone(store.get(path) || null),
    list: async path => [...store.values()].filter(r => r.path.split('/').slice(0,-1).join('/') === path),
    commit: async changes => {
      for (const c of changes) { const old = store.get(c.path); if (c.version ? old?.version !== c.version : old) throw Object.assign(new Error(), { code: 'data-changed' }); }
      writes++; for (const c of changes) { const old = store.get(c.path); store.set(c.path, { path: c.path, id: c.path.split('/').pop(), data: { ...old?.data, ...(c.patch || c.data) }, version: `v${writes}` }); }
    },
  };
}
test('CSV retains quoted cells, newlines, source rows and rejects overflow', async () => {
  assert.deepEqual(parseCsv('name,note\r\n"A, B","first\nsecond"'), [['name','note'],['A, B','first\nsecond']]);
  assert.throws(() => parseCsv('"unclosed'), /invalid-csv/);
  assert.throws(() => parseCsv('row\n'.repeat(10001)), /too-many-rows/);
  const result = await extractPilotFile({name:'fixture.csv',base64:Buffer.from('שם,ציון\nדוגמה,90').toString('base64')});
  assert.equal(result.pages[0].rows[1].row,2); assert.equal(result.pages[0].rows[1].values[1],'90');
  await assert.rejects(extractPilotFile({ name:'fixture.csv', base64:'A'.repeat(Math.ceil(FILE_LIMITS.bytes*4/3)+8) }),/invalid-file/);
});
test('calendar expands all days including weekends; invalid dates never roll over', () => {
  assert.deepEqual(expandDates('2026-09-10','2026-09-13'),['2026-09-10','2026-09-11','2026-09-12','2026-09-13']);
  assert.deepEqual(expandDates('2026-09-10','2026-09-13',true),['2026-09-10','2026-09-13']);
  assert.throws(()=>expandDates('2026-02-30'),/invalid-date/);
});
test('class matching uses teacher, grade and year and retains ambiguity', () => {
  const records = ['one','two'].map(id => ({id,data:{name:id,gradeLevel:'י״א',teacherId:'sharon',academicYearId:'2026'}}));
  const candidates = matchCandidates({name:'יא שרון',gradeLevel:'יא',teacherName:'שרון',academicYearId:'2026'},records,[{id:'sharon',data:{fullName:'שרון לדוגמה'}}]);
  assert.equal(candidates.length,2); assert.equal(candidates[0].exact,false);
  assert.equal(matchCandidates({name:'שרון',academicYearId:'2025'},records).length,0);
});
test('untrusted model output cannot request arbitrary collections or code', () => {
  assert.throws(()=>parseAnswer('not json'),/invalid-proposal/);
  const db=memoryDb();
  return assert.rejects(prepareProposal(db,actor,{answer:'',actions:[action('users',{role:'admin'})]},{records:[]}),/invalid-action/);
});
test('preview has zero writes; explicit version approval, retry and linked events', async () => {
  const db=memoryDb();
  const p=await prepareProposal(db,actor,{answer:'Synthetic',actions:[action('event',{title:'Synthetic',date:'2026-09-10',endDate:'2026-09-12'})]},{records:[]});
  assert.deepEqual(p.items[0].errors,[]); assert.equal(db.writes,0); assert.equal(p.items[0].changes.length,3);
  assert.ok(p.items[0].changes.every(c=>c.data.importGroupId===p.id));
  await assert.rejects(executeProposal(db,actor,p,'wrong'),/approval-changed/); assert.equal(db.writes,0);
  const result=await executeProposal(db,actor,p,p.hash); assert.equal(result[0].status,'done');
  const count=db.writes; await executeProposal(db,actor,p,p.hash); assert.equal(db.writes,count);
});
test('failed and uncertain rows prevent writes; school and user cannot be switched', async () => {
  const db=memoryDb(); const p=await prepareProposal(db,actor,{answer:'',actions:[{...action('event',{title:'Synthetic',date:'2026-09-10'}),needsReview:true}]},{records:[]});
  await assert.rejects(executeProposal(db,actor,p,p.hash),/unresolved-proposal/);
  await assert.rejects(executeProposal(db,{...actor,schoolId:'other'},p,p.hash),/approval-changed/); assert.equal(db.writes,0);
});
test('updates preserve timestamps and unrelated fields with REST masks', async () => {
  let sent; const db=new UserFirestore({projectId:'demo_project',token:'test',fetchImpl:async (_url,options)=>{sent=JSON.parse(options.body);return{ok:true,status:200,json:async()=>({})};}});
  await db.commit([{path:'events_demo_school/e',version:'2026-01-01T00:00:00Z',data:{createdAt:'2020-01-01',title:'new'},patch:{title:'new'},timestamps:['updatedAt']}]);
  assert.deepEqual(sent.writes[0].updateMask.fieldPaths,['`title`']); assert.equal(sent.writes[0].update.fields.createdAt,undefined);
  assert.equal(sent.writes[0].currentDocument.updateTime,'2026-01-01T00:00:00Z');
});
test('concurrent edits stop an approved update without overwriting',async()=>{
  const row={path:'events_demo_school/e',id:'e',version:'v1',kind:'events',data:{schoolId:actor.schoolId,title:'Original',date:'2026-09-10',visibleTo:'all'}};
  const db=memoryDb([row]);const p=await prepareProposal(db,actor,{answer:'',actions:[{...action('event',{title:'Edited'}),intent:'update',id:'e'}]},{records:[row]});
  db.store.get(row.path).version='v2'; const result=await executeProposal(db,actor,p,p.hash); assert.equal(result[0].status,'failed'); assert.equal(db.store.get(row.path).data.title,'Original');
});
test('partial commits resume at stable checkpoints, not from the first row',async()=>{
  const db=memoryDb();const p=await prepareProposal(db,actor,{answer:'',actions:[action('event',{title:'Synthetic',date:'2026-09-01',endDate:'2026-09-10'})]},{records:[]});
  const commit=db.commit;let calls=0;db.commit=async c=>{if(++calls===2)throw Object.assign(new Error(),{code:'firebase-unavailable'});return commit(c);};
  let result=await executeProposal(db,actor,p,p.hash);assert.equal(result[0].committedWrites,6);assert.equal(result[0].status,'failed');
  db.commit=commit;result=await executeProposal(db,actor,p,p.hash);assert.equal(result[0].status,'done');assert.equal([...db.store.keys()].filter(key=>key.startsWith('events_')).length,10);
});
test('immutable paged proposals round trip and detect mutation',async()=>{
  const db=memoryDb();const p=await prepareProposal(db,actor,{answer:'Synthetic',actions:[action('event',{title:'Fixture',date:'2026-09-10'})]},{records:[]});
  await saveProposal(db,p);const loaded=await loadProposal(db,p.root,p.revision);assert.equal(loaded.hash,p.hash);
  db.store.get(`${p.root}/revisions/1/pages/p0`).data.items[0].label='tampered'; await assert.rejects(loadProposal(db,p.root,1),/proposal-unavailable/);
});
test('a partially saved task update resumes its own writes but rejects later changes', async () => {
  const task = { path: `schools/${actor.schoolId}/tasks/task`, id: 'task', kind: 'tasks', version: 'old', data: { schoolId: actor.schoolId, title: 'Before', assigneeIds: [], participantIds: [], assignmentVersion: 2, assignmentSources: {}, progressBy: {}, status: 'todo', localPilot: true } };
  const staff = Array.from({ length: 8 }, (_, i) => ({ path: `users/person${i}`, id: `person${i}`, kind: 'staff', version: 'staff', data: { fullName: `Fixture ${i}`, active: true } }));
  for (const concurrent of [false, true]) {
    const db = memoryDb([task, ...staff]);
    const p = await prepareProposal(db, actor, { answer: '', actions: [{ ...action('task', { title: 'After', assigneeIds: staff.map(s => s.id) }), intent: 'update', id: task.id }] }, { records: [task, ...staff] });
    assert.deepEqual(p.items[0].errors, []);
    const commit = db.commit; let calls = 0;
    db.commit = async changes => { if (++calls === 2) throw Object.assign(new Error(), { code: 'firebase-unavailable' }); return commit(changes); };
    const partial = await executeProposal(db, actor, p, p.hash);
    assert.equal(partial[0].committedWrites, 6);
    db.commit = commit;
    if (concurrent) db.store.get(task.path).data.title = 'Another user changed this';
    const resumed = await executeProposal(db, actor, p, p.hash);
    assert.equal(resumed[0].status, concurrent ? 'failed' : 'done');
    if (concurrent) assert.equal(resumed[0].code, 'data-changed');
  }
});
test('same-origin API rejects cross-site, rebound hosts and credentials in URLs',async()=>{
  const headers={host:'127.0.0.1:5189',origin:'http://127.0.0.1:5189','content-type':'application/json'};
  assert.equal(allowedRequest({headers},headers.origin),true);
  assert.equal(allowedRequest({headers:{...headers,origin:'https://attacker.invalid'}},headers.origin),false);
  assert.equal(allowedRequest({headers:{...headers,host:'attacker.invalid'}},headers.origin),false);
  const pilot=await createPilotHandler({origin:headers.origin,projectId:'demo_project',cwd:'/tmp',check:async()=>({ready:false,reason:'codex-privacy-check-failed'}),dbFactory:()=>memoryDb()});
  try {
    const req=Readable.from([Buffer.from(JSON.stringify({schoolId:actor.schoolId}))]);Object.assign(req,{headers:{...headers,authorization:'Bearer test'},method:'POST',url:'/__zoki_codex/connect'});
    let response;await pilot.handler(req,{setHeader(){},end(value){response=JSON.parse(value);}});assert.equal(response.code,'codex-privacy-check-failed');
  }finally{pilot.close();}
});
test('pilot never writes browser storage or operational payload logs',async()=>{
  for(const path of ['src/components/Zoki/ZokiCodexPanel.jsx','scripts/codex-pilot/client.mjs','scripts/codex-pilot/files.mjs','scripts/codex-pilot/imports.mjs']){
    const source=await readFile(path,'utf8');assert.doesNotMatch(source,/localStorage|sessionStorage|indexedDB|console\.(?:log|error|warn)/);
  }
  assert.equal(digest({a:1,b:2}),digest({b:2,a:1}));
});

test('separate grade cells merge without losing scores; blank cells are omitted',async()=>{
  const records=[{path:'students_demo_school/s',id:'s',kind:'students',version:'v1',data:{schoolId:actor.schoolId,fullName:'Synthetic',classId:'c'}},{path:'schools/demo_school/gradebooks/g',id:'g',kind:'gradebooks',version:'v1',data:{schoolId:actor.schoolId,classId:'c',subjects:[{id:'math',components:[{id:'a',weight:50},{id:'b',weight:50}]}]}}];
  const db=memoryDb(records);
  const p=await prepareProposal(db,actor,{answer:'',actions:[action('grade',{gradebookId:'g',studentId:'s',subjectId:'math',componentId:'a',value:80},'a'),action('grade',{gradebookId:'g',studentId:'s',subjectId:'math',componentId:'b',value:100},'b'),action('grade',{gradebookId:'g',studentId:'s',subjectId:'math',componentId:'a',value:null},'blank')]},{records});
  assert.ok(p.items.every(item=>!item.errors.length));assert.equal(p.items[2].enabled,false);
  const result=await executeProposal(db,actor,p,p.hash);assert.ok(result.every(row=>row.status==='done'));
  const saved=db.store.get('schools/demo_school/gradebooks/g/grades/s').data;assert.deepEqual(saved.scores.math,{a:80,b:100});assert.equal(saved.calculated.math,90);
});
test('shared task retains one record and personal progress, with stable notifications',async()=>{
  const records=['a','b'].map(id=>({id,path:`users/${id}`,kind:'staff',version:'v1',data:{fullName:`Synthetic ${id}`,active:true}}));
  const db=memoryDb(records);const p=await prepareProposal(db,actor,{answer:'',actions:[action('task',{title:'Synthetic task',assigneeIds:['a','b']})]},{records});
  assert.deepEqual(p.items[0].errors,[]);const task=p.items[0].changes.find(c=>c.path.includes('/tasks/')).data;
  assert.deepEqual(task.assigneeIds,['a','b']);assert.equal(task.assignmentVersion,2);assert.equal(task.progressBy.a.status,'todo');assert.equal(p.items[0].changes.filter(c=>c.path.startsWith('notifications/')).length,2);
  const result=await executeProposal(db,actor,p,p.hash);assert.equal(result[0].status,'done');
});

test('file coverage rejects omitted rows and marks uncertain cells for explicit review',async()=>{
  const { sourceManifest,validateCoverage }=await import('../../scripts/codex-pilot/coverage.mjs');
  const manifest=sourceManifest({pages:[{sheet:'Synthetic',rows:[{row:1,cells:[]},{row:2,cells:[{warning:'formula-without-cached-value'}]}]}]});
  assert.throws(()=>validateCoverage({actions:[{sources:['S1R2']}]},manifest),/incomplete-source-coverage/);
  const answer={actions:[{sources:['S1R2']}],excludedSources:[{id:'S1R1',reason:'Header'}]};
  validateCoverage(answer,manifest);assert.equal(answer.actions[0].needsReview,true);
});
test('Excel keeps sheets, merged sources, cached formulas and missing-value warnings',async()=>{
  const {createRequire}=await import('node:module');const require=createRequire(new URL('../../functions/package.json',import.meta.url));const ExcelJS=require('exceljs');
  const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('Synthetic');sheet.mergeCells('A1:B1');sheet.getCell('A1').value='Header';sheet.getCell('A2').value={formula:'1+1',result:2};sheet.getCell('B2').value={formula:'2+2'};book.addWorksheet('Second').getCell('A1').value=new Date('2026-09-10T00:00:00Z');
  const file=await extractPilotFile({name:'fixture.xlsx',base64:Buffer.from(await book.xlsx.writeBuffer()).toString('base64')});
  assert.equal(file.pages.length,2);assert.equal(file.pages[0].rows[0].cells[1].mergedFrom,'A1');assert.equal(file.pages[0].rows[1].cells[0].value,2);assert.equal(file.pages[0].rows[1].cells[1].warning,'formula-without-cached-value');assert.equal(file.pages[1].rows[0].cells[0].value,'2026-09-10');
});
test('scanned PDF and image use vision while PDF over 100 pages is rejected',async()=>{
  const {jsPDF}=await import('jspdf');const {canaryPng}=await import('../../scripts/codex-pilot/canary.mjs');const png=canaryPng('SYNTHETIC');let calls=0;
  const recognize=async()=>{calls++;return '[UNCERTAIN] Synthetic cell';};
  const file=await extractPilotFile({name:'fixture.png',base64:png.toString('base64')},recognize);assert.equal(file.pages[0].visual,true);
  const pdf=new jsPDF();pdf.addImage(new Uint8Array(png),'PNG',10,10,30,30);const extracted=await extractPilotFile({name:'fixture.pdf',base64:Buffer.from(pdf.output('arraybuffer')).toString('base64')},recognize);assert.equal(extracted.pages[0].visual,true);assert.equal(calls,2);
  for(let i=1;i<101;i++)pdf.addPage();await assert.rejects(extractPilotFile({name:'too-many.pdf',base64:Buffer.from(pdf.output('arraybuffer')).toString('base64')},recognize),/too-many-pages/);
});

test('persisted proposals cannot be forged by changing their content and recomputing a public hash',async()=>{
  const {proposalSeal,verifyProposalSeal}=await import('../../scripts/codex-pilot/integrity.mjs');
  const key=Buffer.alloc(32,5);const p=await prepareProposal(memoryDb(),actor,{answer:'Synthetic',actions:[action('event',{title:'Fixture',date:'2026-09-10'})]},{records:[]});p.seal=proposalSeal(key,p);assert.doesNotThrow(()=>verifyProposalSeal(key,p));
  p.items[0].changes[0].path='users/manager';p.hash=digest(Object.fromEntries(Object.entries(p).filter(([field])=>!['root','hash','seal'].includes(field))));assert.throws(()=>verifyProposalSeal(key,p),/proposal-unverified/);
});
test('HTTP analysis can save a private draft but only UI approval can write events',async()=>{
  const db=memoryDb();const headers={host:'127.0.0.1:5189',origin:'http://127.0.0.1:5189','content-type':'application/json',authorization:'Bearer synthetic'};
  const pilot=await createPilotHandler({origin:headers.origin,projectId:'demo_project',cwd:'/tmp',check:async()=>({ready:true}),dbFactory:()=>db,clientFactory:()=>({initialize:async()=>({authenticated:true}),close(){},generate:async()=>JSON.stringify({answer:'Synthetic',actions:[action('event',{title:'Fixture',date:'2026-09-10'})]})})});
  const call=async(operation,body={},sessionId)=>{const req=Readable.from([Buffer.from(JSON.stringify({schoolId:actor.schoolId,...body}))]);Object.assign(req,{headers:{...headers,...(sessionId?{'x-zoki-session':sessionId}:{})},method:'POST',url:`/__zoki_codex/${operation}`});let result;await pilot.handler(req,{setHeader(){},end(value){result=JSON.parse(value);}});return result;};
  try{
    const connection=await call('connect');assert.ok(connection.sessionId);const {proposal}=await call('analyze',{question:'Synthetic event'},connection.sessionId);assert.ok(proposal?.seal);assert.equal([...db.store.keys()].filter(p=>p.startsWith('events_')).length,0);
    assert.equal((await call('approve',{hash:'bad'},connection.sessionId)).code,'approval-changed');
    const run=await call('approve',{hash:proposal.hash},connection.sessionId);assert.equal(run.results[0].status,'done');
    await call('disconnect',{},connection.sessionId);assert.equal((await call('approve',{hash:proposal.hash},connection.sessionId)).code,'session-expired');
  }finally{pilot.close();}
});
