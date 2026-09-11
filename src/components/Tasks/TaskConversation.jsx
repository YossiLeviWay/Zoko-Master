import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../firebase';
import ChatPanel from './ChatPanel';
import Header from '../Layout/Header';
import './TaskWorkspace.css';
export default function TaskConversation() {
  const {currentUser,userData,selectedSchool}=useAuth();const [params]=useSearchParams();const navigate=useNavigate();const [task,setTask]=useState(null),[error,setError]=useState('');
  const schoolId=selectedSchool||userData?.schoolId,id=params.get('task'),storage=params.get('storage')==='legacy'?'legacy':'nested';
  useEffect(()=>{if(!schoolId||!id||!/^[\w-]+$/.test(id))return;setTask(null);return onSnapshot(doc(db,storage==='legacy'?`tasks_${schoolId}/${id}`:`schools/${schoolId}/tasks/${id}`),snap=>{if(snap.exists)setTask({...snap.data(),id:snap.id,_storageMode:storage});else setError('המשימה אינה זמינה.');},()=>setError('אין גישה לשיחה זו.'));},[schoolId,id,storage]);
  return <div className="tw-page tw-conversation"><Header title="שיחת משימה"/><main className="tw-main"><button onClick={()=>navigate(`/tasks?task=${id}&storage=${storage}`)}>חזרה למשימה</button>{error&&<p role="alert">{error}</p>}{task&&<ChatPanel task={task} schoolId={schoolId} currentUser={{...userData,uid:currentUser.uid}} onClose={()=>navigate('/messages')}/>}</main></div>;
}
