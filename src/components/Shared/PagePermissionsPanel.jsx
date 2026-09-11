import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../firebase';
import UserAccessDialog from '../Access/UserAccessDialog';
import '../Access/SimpleAccess.css';

const FEATURE_DOMAIN = { students: 'students', staff: 'staff', teams: 'staff', files: 'content', contacts: 'content', messages: 'content', settings: 'management' };
export default function PagePermissionsPanel({ feature, onClose, advancedContent = null }) {
  const { userData, selectedSchool, isGlobalAdmin, isPrincipal } = useAuth();
  const schoolId = selectedSchool || userData?.schoolId;
  const [staff, setStaff] = useState([]);
  const [target, setTarget] = useState(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const canManage = isGlobalAdmin() || isPrincipal();
  useEffect(() => {
    if (!schoolId || !canManage) return;
    let active = true;
    Promise.all([
      getDocs(query(collection(db, 'users'), where('schoolId', '==', schoolId))),
      getDocs(query(collection(db, 'users'), where('schoolIds', 'array-contains', schoolId))),
    ]).then(snapshots => {
      if (active) setStaff([...new Map(snapshots.flatMap(snapshot => snapshot.docs).map(doc => [doc.id, { id: doc.id, ...doc.data() }])).values()]);
    }).catch(() => { if (active) setError('לא ניתן לטעון את אנשי הצוות. נסו שוב.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [schoolId, canManage]);
  if (!canManage) return null;
  if (target) return <UserAccessDialog initiallyCustomize user={target} schoolId={schoolId} initialDomain={FEATURE_DOMAIN[feature] || 'work'} onClose={() => setTarget(null)} />;
  return <div className="modal-overlay access-overlay"><section className="simple-access-dialog" role="dialog" aria-modal="true" aria-label="ניהול גישה" dir="rtl"><header><h3>ניהול גישה</h3><button type="button" onClick={onClose} aria-label="סגירה">×</button></header><div className="access-dialog-body"><p>בחרו איש צוות כדי לראות ולהתאים את הגישה שלו.</p><input aria-label="חיפוש איש צוות" value={search} onChange={event => setSearch(event.target.value)} placeholder="חיפוש שם או אימייל…" />{loading && <p role="status">טוען…</p>}{error && <p role="alert">{error}</p>}{staff.filter(user => `${user.fullName} ${user.email}`.toLowerCase().includes(search.toLowerCase())).map(user => <button type="button" className="access-role-option" key={user.id} onClick={() => setTarget(user)}>{user.fullName || user.email}</button>)}{advancedContent}</div></section></div>;
}
