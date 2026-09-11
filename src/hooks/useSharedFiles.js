import { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
export function useSharedFiles(schoolId) {
  const { userData } = useAuth();
  const [files, setFiles] = useState([]);
  useEffect(() => {
    let active = true;
    setFiles([]);
    if (!schoolId || !userData?.uid) return;
    const refresh = () => httpsCallable(functions, 'listSharedFiles')({ schoolId }).then(({ data }) => { if (active) setFiles(data.files); }).catch(() => { if (active) setFiles([]); });
    refresh();
    window.addEventListener('access-sharing-changed', refresh);
    return () => { active = false; window.removeEventListener('access-sharing-changed', refresh); };
  }, [schoolId, userData?.uid, userData?.customRoleAssignments, userData?.teamIdsBySchool]);
  return files;
}
