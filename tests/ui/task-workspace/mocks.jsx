import React from 'react';
const auth={currentUser:{uid:'a'},userData:{fullName:'נועה כהן',schoolId:'demo',role:'principal',teamIds:['management']},selectedSchool:'demo'};
export const useAuth=()=>auth;
export const usePermissions=()=>({permissions:{}});
export const db={};
export default function Header(){return <div style={{height:56,background:'white',borderBottom:'1px solid #eee',display:'flex',alignItems:'center',padding:'0 28px',fontWeight:700,color:'#870335'}}>זוקו <small style={{marginInlineStart:16,color:'#888',fontWeight:400}}>סביבת בדיקה • נתונים לדוגמה</small></div>;}
const teams=[{id:'management',name:'צוות ניהול',memberIds:['a','b']}];
const staff=[{id:'a',fullName:'נועה כהן'},{id:'b',fullName:'איתי לוי'},{id:'c',fullName:'מיכל ישראלי'}];
export const collection=(_, ...path)=>path.join('/');export const where=()=>null;export const query=path=>path;
const snapshot=items=>({docs:items.map(item=>({id:item.id,data:()=>item}))});
export const onSnapshot=(path,callback)=>{queueMicrotask(()=>callback(snapshot(teams)));return()=>{};};
export const getDocs=async()=>snapshot(staff);
let personal=[{id:'p1',_source:'personal',_storageMode:'personal',scope:'personal',title:'להכין את המפגש הראשון עם המחנכים',status:'todo',createdBy:'a',ownerId:'a',dueDate:'2026-09-14',pinnedBy:['a']},{id:'p2',_source:'personal',scope:'personal',title:'לעבור על סיכום השבוע',status:'todo',createdBy:'a',ownerId:'a'}];
const shared=[{id:'s1',_source:'organization',_storageMode:'nested',scope:'team',title:'לסיים את בניית קבוצות הלימוד בשחף',description:'נרכז את הקבוצות ונבדוק שכל התלמידים שובצו.',teamId:'management',assigneeIds:['a','b'],participantIds:['a','b'],status:'in_progress',assignmentVersion:2,assignmentSources:{a:['team:management'],b:['team:management']},progressBy:{a:{status:'todo'},b:{status:'done'}},dueDate:'2026-09-15',createdBy:'a'},{id:'s2',_source:'organization',_storageMode:'nested',scope:'assigned',title:'להכין רשימה שמית למשלחת',assigneeIds:['a','c'],participantIds:['a','c'],status:'todo',createdBy:'b'}];
let emitPersonal,emitPreferences;let prefs={};
export const subscribePersonalTasks=({onData})=>{emitPersonal=onData;queueMicrotask(()=>onData(personal));return()=>{};};
export const subscribeOrganizationTasks=({onData})=>{queueMicrotask(()=>onData(shared));return()=>{};};
export const subscribeWorkspace=({onLists,onPreferences,onInvitations})=>{emitPreferences=onPreferences;queueMicrotask(()=>{onLists([{id:'l1',name:'תחילת שנת הלימודים',kind:'personal',memberIds:['a'],ownerId:'a'}]);onPreferences(prefs);onInvitations([]);});return()=>{};};
export const saveBoardPreferences=async(_,uid,schoolId,patch)=>{prefs={...prefs,...patch};emitPreferences(prefs);};
export const newRequestId=()=>crypto.randomUUID();
export const workspaceAction=async input=>{if(input.operation==='create'){const ids=(input.titles||[input.title]).map((title,i)=>{const id=`${input.requestId}-${i}`;personal=[...personal,{id,title,scope:'personal',_source:'personal',createdBy:'a',ownerId:'a',status:'todo'}];return id;});emitPersonal(personal);return{taskIds:ids};}if(input.operation==='progress'){personal=personal.map(task=>task.id===input.taskId?{...task,status:input.status}:task);emitPersonal(personal);}return{ok:true};};

export const subscribeSparkWorkspace=subscribeWorkspace;
export const sparkWorkspaceAction=({input})=>workspaceAction(input);
