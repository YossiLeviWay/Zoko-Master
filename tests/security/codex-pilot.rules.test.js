import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { UserFirestore } from '../../scripts/codex-pilot/firestore.mjs';
import { prepareProposal, executeProposal } from '../../scripts/codex-pilot/imports.mjs';
import { saveProposal, loadProposal } from '../../scripts/codex-pilot/store.mjs';
let env;
const projectId='demo-zoko-security';
const actor={uid:'manager',schoolId:'a',fullName:'Synthetic manager'};
const token=uid=>`${Buffer.from(JSON.stringify({alg:'none',typ:'JWT'})).toString('base64url')}.${Buffer.from(JSON.stringify({sub:uid,user_id:uid,iss:`https://securetoken.google.com/${projectId}`,aud:projectId,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,firebase:{sign_in_provider:'custom'}})).toString('base64url')}.`;
const rest=uid=>new UserFirestore({projectId,token:token(uid)});
const database=(uid='manager')=>env.authenticatedContext(uid).firestore();
before(async()=>{
  env=await initializeTestEnvironment({projectId,firestore:{rules:await readFile('firestore.rules','utf8')}});await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx=>{
    const db=ctx.firestore();
    for(const [uid,role,schoolId] of [['manager','principal','a'],['second','principal','a'],['teacher','viewer','a'],['other','principal','b']]) await setDoc(doc(db,'users',uid),{fullName:`Synthetic ${uid}`,role,schoolId,schoolIds:[schoolId],accountStatus:'active',permissions:{tasks_assign:true}});
    await setDoc(doc(db,'schools/a'),{name:'Synthetic'});await setDoc(doc(db,'schools/b'),{name:'Synthetic other'});
    await setDoc(doc(db,'classes_a/c'),{schoolId:'a',name:'Synthetic class',teacherId:'teacher',academicYear:'2026',academicYearId:'2026',status:'active'});
    await setDoc(doc(db,'students_a/s'),{schoolId:'a',fullName:'Synthetic student',classId:'c',status:'active'});
  });
});
after(async()=>env?.cleanup());
test('private proposals are inaccessible to colleagues, other principals and other schools',async()=>{
  const ref=doc(database(),'users/manager/zokiPilot/a/state/conversation');await assertSucceeds(setDoc(ref,{history:[]}));
  for(const uid of ['teacher','second','other']) await assertFails(getDoc(doc(database(uid),ref.path)));
  await assertFails(setDoc(doc(database(),'users/manager/zokiPilot/b/state/conversation'),{history:[]}));
});
test('Firebase REST authenticates actor and immutable proposals round trip under real rules',async()=>{
  const db=rest('manager');assert.equal((await db.actor('a')).uid,'manager');await assert.rejects(db.actor('b'),/permission-denied/);
  const p=await prepareProposal(db,actor,{answer:'Synthetic',actions:[{kind:'event',intent:'create',key:'event',fields:{title:'Synthetic event',date:'2026-09-10'}}]},{records:[]});
  await saveProposal(db,p);assert.equal((await loadProposal(db,p.root,1)).hash,p.hash);
  assert.equal((await executeProposal(db,actor,p,p.hash))[0].status,'done');
});
test('one shared task, notifications and personal completion use Spark rules without admin keys',async()=>{
  const db=rest('manager');const records=await Promise.all(['teacher','second'].map(async id=>({...await db.get(`users/${id}`),kind:'staff'})));
  const p=await prepareProposal(db,actor,{answer:'Synthetic',actions:[{kind:'task',intent:'create',key:'task',fields:{title:'Synthetic task',assigneeIds:['teacher','second']}}]},{records});
  assert.deepEqual(p.items[0].errors,[]);const result=await executeProposal(db,actor,p,p.hash);assert.equal(result[0].status,'done',JSON.stringify(result));
  const id=p.items[0].id;const path=`schools/a/tasks/${id}`;const task=(await getDoc(doc(database('teacher'),path))).data();
  await assertSucceeds(updateDoc(doc(database('teacher'),path),{progressBy:{...task.progressBy,teacher:{status:'done',inherited:false}},completionCount:1,startedCount:1,status:'in_progress',updatedAt:serverTimestamp(),completedAt:null}));
  await assertFails(updateDoc(doc(database('teacher'),path),{progressBy:{teacher:{status:'done'},second:{status:'done'}},completionCount:2,startedCount:2,status:'done',updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(doc(database(),path),{progressBy:{teacher:{status:'done'},second:{status:'done'}},completionCount:2,startedCount:2,status:'done',updatedBy:'manager',updatedAt:serverTimestamp()}));
  await assertFails(getDoc(doc(database('other'),path)));
  const notifications=p.items[0].changes.filter(c=>c.path.startsWith('notifications/'));
  for(const notice of notifications)await assertSucceeds(getDoc(doc(database(notice.data.userId),notice.path)));
});
test('pedagogical rows cannot point at another class or institution',async()=>{
  const parent=doc(database(),'schools/a/pedagogicalMappings/m');
  await assertSucceeds(setDoc(parent,{schoolId:'a',classId:'c',academicYearId:'2026',name:'Synthetic mapping',columns:[{id:'score',name:'Score',type:'number'}],createdBy:'manager',updatedBy:'manager'}));
  const row={schoolId:'a',classId:'c',studentId:'s',values:{score:8},updatedBy:'manager'};
  await assertSucceeds(setDoc(doc(database(),'schools/a/pedagogicalMappings/m/rows/s'),row));
  await assertFails(setDoc(doc(database(),'schools/a/pedagogicalMappings/m/rows/s'),{...row,classId:'other'}));
  await assertFails(setDoc(doc(database(),'schools/a/pedagogicalMappings/m/rows/missing'),{...row,studentId:'missing'}));
  await assertFails(getDoc(doc(database('other'),'schools/a/pedagogicalMappings/m/rows/s')));
});

test('approved student, gradebook and grade creation uses existing class data contracts',async()=>{
  const db=rest('manager'); const cls={...await db.get('classes_a/c'),kind:'classes'};
  const input={answer:'Synthetic',actions:[
    {key:'student',kind:'student',intent:'create',fields:{fullName:'Synthetic new pupil',classId:'c'}},
    {key:'book',kind:'gradebook',intent:'create',fields:{classId:'c',subjects:[{id:'math',name:'Synthetic math',components:[{id:'exam',name:'Exam',weight:100}]}]}},
    {key:'grade',kind:'grade',intent:'create',fields:{gradebookId:'$book',studentId:'$student',subjectId:'math',componentId:'exam',value:90}},
  ]};
  const p=await prepareProposal(db,actor,input,{records:[cls]});assert.ok(p.items.every(item=>!item.errors.length),JSON.stringify(p.items.map(item=>item.errors)));
  const result=await executeProposal(db,actor,p,p.hash);
  assert.ok(result.every(item=>item.status==='done'),JSON.stringify(result));
  assert.equal(result.length,3);
});
test('missing attendance sheet initializes in resumable phases before importing a cell',async()=>{
  const db=rest('manager');const records=[{...await db.get('classes_a/c'),kind:'classes'},{...await db.get('students_a/s'),kind:'students'},{...await db.get('schools/a/folders/class_c'),kind:'folders'}];
  const p=await prepareProposal(db,actor,{answer:'Synthetic',actions:[{key:'sheet',kind:'attendanceSheet',intent:'create',fields:{name:'Synthetic attendance',classId:'c',startDate:'2026-09-10',endDate:'2026-09-12'}},{key:'cell',kind:'attendance',intent:'create',fields:{fileId:'$sheet',studentId:'s',dateKey:'2026-09-10',primaryStatusId:'present'}}]},{records});
  assert.ok(p.items.every(item=>!item.errors.length),JSON.stringify(p.items.map(item=>item.errors)));
  const result=await executeProposal(db,actor,p,p.hash);assert.ok(result.every(item=>item.status==='done'),JSON.stringify(result));assert.equal(result.length,2);
});
