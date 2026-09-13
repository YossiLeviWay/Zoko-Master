import { useEffect, useState, useSyncExternalStore } from 'react';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { Link, useSearchParams } from 'react-router-dom';
import { db } from '../../firebase.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { privateSessionRevision, subscribePrivateSession } from '../../utils/browserPrivacy.js';

export default function ImportReport() {
  const { currentUser, userData, selectedSchool } = useAuth();
  const revision = useSyncExternalStore(subscribePrivateSession, privateSessionRevision);
  const schoolId = selectedSchool || userData?.schoolId;
  const manager = ['principal', 'institution_manager'].includes(userData?.rolesBySchool?.[schoolId] || userData?.role);
  if (!currentUser || !schoolId || !manager) return <p>הדוח זמין רק למנהל שיזם את הייבוא.</p>;
  return <ScopedImportReport key={`${currentUser.uid}:${schoolId}:${revision}`} uid={currentUser.uid} schoolId={schoolId}/>;
}
function ScopedImportReport({ uid, schoolId }) {
  const [params] = useSearchParams(); const runId = params.get('run'), revision = Number(params.get('revision'));
  const [report, setReport] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    let active = true; setReport(null); setError('');
    if (!/^[\w-]{1,128}$/.test(runId || '') || !Number.isInteger(revision) || revision < 1) { setError('קישור הדוח אינו תקין.'); return; }
    async function load() {
      const root = `users/${uid}/zokiPilot/${schoolId}/proposals/${runId}`;
      const header = await getDoc(doc(db, `${root}/revisions/${revision}`)); if (!active) return;
      if (!header.exists() || !Number.isInteger(header.data().pages) || header.data().pages > 10000) throw new Error();
      const items = [];
      for (let i = 0; i < header.data().pages; i++) {
        const page = await getDoc(doc(db, `${root}/revisions/${revision}/pages/p${i}`)); if (!active) return;
        if (!page.exists()) throw new Error(); items.push(...page.data().items);
      }
      const receipts = await getDocs(collection(db, `${root}/receipts`)); if (!active) return;
      const checkpoints = await getDocs(collection(db, `${root}/checkpoints`)); if (!active) return;
      setReport({ ...header.data(), items, done: new Set(receipts.docs.filter(d => d.data().hash === header.data().hash).map(d => d.data().itemId)), partial: checkpoints.docs.filter(d => d.data().hash === header.data().hash).map(d => d.id) });
    }
    load().catch(() => { if (active) setError('הדוח אינו זמין או שאין הרשאה לצפות בו.'); });
    return () => { active = false; };
  }, [uid, schoolId, runId, revision]);
  return <main className="page" dir="rtl"><div className="page-content"><h1>דוח ייבוא מזוקי</h1><p>הדוח פרטי למנהל שיזם את הפעולה. הסטטוס מבוסס על אישורי השמירה ב־Firebase.</p>{error && <p role="alert">{error}</p>}{report && <><p>{report.answer}</p><p>גרסה {revision} · {report.done.size} פריטים הושלמו</p><div style={{ overflowX: 'auto' }}><table className="data-table"><thead><tr><th>פריט</th><th>מקור</th><th>מצב</th><th>פתיחה</th></tr></thead><tbody>{report.items.map(item => <tr key={item.key}><td>{item.label || item.fields?.title || item.fields?.fullName || item.fields?.name || 'פריט'}</td><td>{item.source || 'בקשה בשיחה'}</td><td>{!item.enabled ? 'הושמט מהייבוא' : report.done.has(item.key) ? 'הושלם' : report.partial.some(id => id.startsWith(`${item.key}_`)) ? 'נשמר חלקית — ניתן לחדש בזוקי' : 'לא בוצע'}</td><td>{report.done.has(item.key) && typeof item.route === 'string' && /^\/(calendar|tasks|students|files|mappings)(\?|$)/.test(item.route) && <Link to={item.route}>פתיחת הרשומה</Link>}</td></tr>)}</tbody></table></div><p>לתיקון או לחידוש, פתחו את זוקי ובחרו „Codex שלי”.</p></>}</div></main>;
}
