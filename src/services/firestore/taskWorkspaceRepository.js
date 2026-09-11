import { collection, doc, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
const call = httpsCallable(functions, 'taskWorkspace');
export const workspaceAction = async input => {
  if (import.meta.env.VITE_TASK_WORKSPACE_ENABLED !== 'true') throw new Error('shared-action-paused');
  return (await call(input)).data;
};
export const newRequestId = () => crypto.randomUUID();
export function subscribeWorkspace({db, schoolId, uid, onLists, onPreferences, onInvitations, onError}) {
  return [
    onSnapshot(query(collection(db, 'schools',schoolId,'taskLists'),where('memberIds','array-contains',uid)),snap => onLists(snap.docs.map(item=>({id:item.id,...item.data()}))),onError),
    onSnapshot(doc(db,'users',uid,'taskBoardPreferences',schoolId),snap=>onPreferences(snap.data()||{}),onError),
    onSnapshot(query(collection(db,'schools',schoolId,'taskListInvitations'),where('recipientId','==',uid)),snap=>onInvitations(snap.docs.map(item=>({id:item.id,...item.data()})).filter(item=>item.status==='pending')),onError),
  ].reduce((close,unsubscribe)=>()=>{close();unsubscribe();},()=>{});
}
export const saveBoardPreferences = (db,uid,schoolId,patch) => setDoc(doc(db,'users',uid,'taskBoardPreferences',schoolId),patch,{merge:true});
