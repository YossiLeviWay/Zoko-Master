import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { Link, useSearchParams } from 'react-router-dom';
import { db } from '../../firebase.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { privateSessionGuard } from '../../utils/browserPrivacy.js';

export function ClassPedagogicalMappings({ schoolId, classId }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    setItems([]);
    return onSnapshot(query(collection(db, 'schools', schoolId, 'pedagogicalMappings'), where('classId', '==', classId)), snap => setItems(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(item => item.status !== 'archived')), () => setItems([]));
  }, [schoolId, classId]);
  return items.length ? <details><summary>מיפויים נוספים ({items.length})</summary>{items.map(item => <p key={item.id}><Link to={`/mappings?mapping=${item.id}`}>{item.name}</Link></p>)}</details> : null;
}
export default function PedagogicalMapping() {
  const { currentUser, selectedSchool, userData } = useAuth();
  const [params] = useSearchParams();
  const schoolId = selectedSchool || userData?.schoolId;
  const id = params.get('mapping');
  const [mapping, setMapping] = useState(null), [rows, setRows] = useState([]), [error, setError] = useState('');
  useEffect(() => {
    setMapping(null); setRows([]); setError('');
    if (!schoolId || !id || !currentUser) return;
    const valid = privateSessionGuard();
    const fail = () => { setMapping(null); setRows([]); setError('המיפוי אינו זמין או שאין הרשאה לצפות בו.'); };
    const close = onSnapshot(doc(db, 'schools', schoolId, 'pedagogicalMappings', id), snap => {
      try { valid(); } catch { return; }
      if (!snap.exists()) { fail(); return; } setMapping(snap.data());
    }, fail);
    const closeRows = onSnapshot(collection(db, 'schools', schoolId, 'pedagogicalMappings', id, 'rows'), snap => {
      try { valid(); } catch { return; } setRows(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(row => row.status !== 'archived'));
    }, fail);
    return () => { close(); closeRows(); };
  }, [schoolId, id, currentUser]);
  return <main className="page" dir="rtl"><div className="page-content"><Link to="/students">חזרה לכיתות ולתלמידים</Link>{error && <p role="alert">{error}</p>}{mapping && <><h1>{mapping.name}</h1><p>{mapping.className} · {mapping.academicYearId}</p><p>לעדכון הנתונים, בקשו מזוקי להכין הצעת שינוי למיפוי הזה.</p><div style={{ overflowX: 'auto' }}><table className="data-table"><thead><tr><th>תלמיד/ה</th>{mapping.columns.map(col => <th key={col.id}>{col.name || col.label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id}><th>{row.displayName}</th>{mapping.columns.map(col => <td key={col.id}>{row.values?.[col.id] == null ? '—' : String(row.values[col.id])}</td>)}</tr>)}</tbody></table></div></>}</div></main>;
}
