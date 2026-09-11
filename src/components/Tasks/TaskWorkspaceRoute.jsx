import { lazy, useEffect, useState } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { doc, getDocFromServer, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import TaskWorkspace from './TaskWorkspace';

const backendEnabled = import.meta.env.VITE_TASK_WORKSPACE_ENABLED === 'true';
const LegacyBoard = lazy(() => import('./TaskBoard'));

export default function TaskWorkspaceRoute() {
  const { selectedSchool, userData, currentUser } = useAuth();
  const schoolId = selectedSchool || userData?.schoolId;
  const uid = currentUser?.uid;
  const scope = `${uid}:${schoolId}`;
  const [legacy, setLegacy] = useState(false);
  const [pagingReady, setPagingReady] = useState(false);
  const [sparkAccess, setSparkAccess] = useState(null);
  const [params] = useSearchParams();
  const location = useLocation();

  useEffect(() => {
    setLegacy(false);
    setPagingReady(false);
    if (!schoolId || !backendEnabled) return;
    return onSnapshot(doc(db, 'schools', schoolId, 'settings', 'task_workspace'), snapshot => {
      setLegacy(snapshot.data()?.layout === 'legacy');
      setPagingReady(snapshot.data()?.pagingReady === true);
    }, () => setLegacy(false));
  }, [schoolId]);

  useEffect(() => {
    if (backendEnabled || !uid || !schoolId) return;
    let active = true;
    // Older production rules may not include the owner-only preferences path.
    // Keep the existing board usable until those rules have been approved.
    getDocFromServer(doc(db, 'users', uid, 'taskBoardPreferences', schoolId))
      .then(() => { if (active) setSparkAccess({ scope, allowed: true }); })
      .catch(() => { if (active) setSparkAccess({ scope, allowed: false }); });
    return () => { active = false; };
  }, [uid, schoolId, scope]);

  if (params.get('view') === 'communications') return <Navigate to={`/messages?${params}`} replace />;
  if (params.get('view') === 'invitations' || params.get('initiative') || location.state?.zokiDraftId) return <LegacyBoard />;
  if (!uid || !schoolId) return null;
  if (!backendEnabled && sparkAccess?.scope !== scope) return <p role="status" dir="rtl">טוען את המשימות…</p>;
  if (legacy || (!backendEnabled && !sparkAccess.allowed)) return <LegacyBoard />;
  return <TaskWorkspace key={scope} freeMode={!backendEnabled} pagingReady={pagingReady} />;
}
