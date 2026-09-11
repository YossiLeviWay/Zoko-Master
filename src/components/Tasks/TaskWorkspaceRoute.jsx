import { lazy, useEffect, useState } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import TaskWorkspace from './TaskWorkspace';
const backendEnabled = import.meta.env.VITE_TASK_WORKSPACE_ENABLED === 'true';
const LegacyBoard=lazy(()=>import('./TaskBoard'));
export default function TaskWorkspaceRoute(){
  const {selectedSchool,userData}=useAuth();const schoolId=selectedSchool||userData?.schoolId;
  const [legacy,setLegacy]=useState(false);const [pagingReady,setPagingReady]=useState(false);const [params]=useSearchParams();const location=useLocation();
  useEffect(()=>{setLegacy(false);if(!schoolId||!backendEnabled)return;return onSnapshot(doc(db,'schools',schoolId,'settings','task_workspace'),snapshot=>{setLegacy(snapshot.data()?.layout==='legacy');setPagingReady(snapshot.data()?.pagingReady===true);},()=>setLegacy(false));},[schoolId]);
  if(params.get('view')==='communications')return <Navigate to={`/messages?${params}`} replace/>;
  if(params.get('view')==='invitations')return <LegacyBoard/>;
  if(params.get('initiative')||location.state?.zokiTaskWorkflow||location.state?.zokiTaskDraft)return <LegacyBoard/>;
  return !backendEnabled||legacy?<LegacyBoard/>:<TaskWorkspace pagingReady={pagingReady}/>;
}
