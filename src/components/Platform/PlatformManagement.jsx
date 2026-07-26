import { useCallback, useEffect, useState } from 'react';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { Building2, KeyRound, RefreshCw, ShieldCheck, UserX } from 'lucide-react';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { reviewForumAccessSpark } from '../../services/firestore/forumRepository';
import {
  createSchool,
  assignInstitutionManager,
  listPlatformStaff,
  platformStaffAction,
  updateSupportTicket,
} from '../../services/adminUserService';
import Header from '../Layout/Header';
import '../Gantt/Gantt.css';
import '../Schools/Schools.css';

const TABS = [
  ['institutions', 'מוסדות'], ['managers', 'מנהלי מוסדות'], ['staff', 'אנשי צוות'], ['permissions', 'הרשאות'],
  ['forumRequests', 'בקשות גישה לפורום'], ['forum', 'ניהול הפורום'], ['support', 'תמיכת המערכת'], ['audit', 'יומן פעולות'],
];
const EMPTY_SCHOOL = { name: '', code: '', address: '', phone: '', institutionalEmail: '', activeAcademicYearId: 'year_2026_2027', managerFullName: '', managerEmail: '' };

function mfaMessage() {
  return 'הפעולה דורשת חשבון Platform Admin עם MFA והתחברות מחדש בעשר הדקות האחרונות.';
}

export default function PlatformManagement() {
  const { currentUser } = useAuth();
  const [tab, setTab] = useState('institutions');
  const [institutions, setInstitutions] = useState([]);
  const [staff, setStaff] = useState([]);
  const [requests, setRequests] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [audit, setAudit] = useState([]);
  const [schoolForm, setSchoolForm] = useState(EMPTY_SCHOOL);
  const [showSchoolForm, setShowSchoolForm] = useState(false);
  const [selectedSchoolId, setSelectedSchoolId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [institutionSnapshot, staffResult, requestSnapshot, ticketSnapshot, auditSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'schools'), limit(200))),
        listPlatformStaff({ ...(selectedSchoolId ? { schoolId: selectedSchoolId } : {}), limit: 200 }).catch(() => ({ staff: [] })),
        getDocs(query(collection(db, 'platformForumAccessRequests'), orderBy('createdAt', 'desc'), limit(100))),
        getDocs(query(collection(db, 'supportTickets'), orderBy('createdAt', 'desc'), limit(100))),
        getDocs(query(collection(db, 'platformAuditLogs'), orderBy('createdAt', 'desc'), limit(100))),
      ]);
      setInstitutions(institutionSnapshot.docs.map(item => ({ id: item.id, ...item.data() }))); setStaff(staffResult.staff || []);
      setRequests(requestSnapshot.docs.map(item => ({ id: item.id, ...item.data() })));
      setTickets(ticketSnapshot.docs.map(item => ({ id: item.id, ...item.data() })));
      setAudit(auditSnapshot.docs.map(item => ({ id: item.id, ...item.data() })));
    } catch { setError('לא ניתן לטעון את נתוני ניהול הפלטפורמה. הממשק אינו מנסה לפתוח מידע פנימי של מוסדות.'); }
    finally { setLoading(false); }
  }, [selectedSchoolId]);
  useEffect(() => { load(); }, [load]);

  async function createInstitution(event) {
    event.preventDefault(); setError('');
    try {
      await createSchool({ name: schoolForm.name, code: schoolForm.code, address: schoolForm.address, phone: schoolForm.phone, institutionalEmail: schoolForm.institutionalEmail, activeAcademicYearId: schoolForm.activeAcademicYearId, status: 'active', manager: { fullName: schoolForm.managerFullName, email: schoolForm.managerEmail } });
      setSchoolForm(EMPTY_SCHOOL); setShowSchoolForm(false); setMessage('המוסד נוצר ומנהל המוסד הוזמן בתהליך המאובטח.'); await load();
    } catch { setError('יצירת המוסד נכשלה.'); }
  }

  async function staffAction(item, action) {
    const reason = window.prompt('יש להזין סיבה לפעולה הרגישה:');
    if (!reason || reason.trim().length < 5) return;
    if (!window.confirm(`לבצע את הפעולה עבור ${item.fullName} במוסד שנבחר?`)) return;
    setError('');
    try { await platformStaffAction({ schoolId: selectedSchoolId || item.schoolIds[0], userId: item.userId, action, reason: reason.trim(), revokeSessions: action === 'send_password_reset' && window.confirm('לבטל גם sessions קיימים?') }); setMessage('הפעולה בוצעה ונרשמה ביומן.'); await load(); }
    catch { setError(mfaMessage()); }
  }

  async function reviewAccess(item, approve) {
    const reason = window.prompt(approve ? 'סיבת האישור:' : 'סיבת הדחייה:');
    if (!reason || reason.trim().length < 3) return;
    try { await reviewForumAccessSpark({ db, currentUser, accessRequest: item, approve, reason }); setMessage('בקשת הפורום טופלה בהצלחה.'); await load(); }
    catch { setError('לא ניתן לטפל בבקשת הפורום. ודאו שהחשבון הוא Platform Admin ושהבקשה עדיין ממתינה.'); }
  }

  async function updateTicket(item, status) {
    const response = window.prompt('תגובה למוסד (ללא נתונים פנימיים):') || '';
    const reason = window.prompt('סיבת עדכון הסטטוס:');
    if (!reason) return;
    try { await updateSupportTicket({ ticketId: item.id, status, response, reason }); setMessage('פניית התמיכה עודכנה.'); await load(); }
    catch { setError('עדכון פניית התמיכה נכשל.'); }
  }

  async function assignManager() {
    const schoolId = window.prompt('מזהה המוסד:');
    const school = institutions.find(item => item.id === schoolId);
    if (!school) return setError('מזהה המוסד לא נמצא ברשימה.');
    const fullName = window.prompt('שם המנהל החדש:');
    const email = window.prompt('דוא״ל המנהל החדש:');
    const reason = window.prompt('סיבה למינוי או להחלפה:');
    if (!fullName || !email || !reason || reason.trim().length < 5) return;
    const replaceExisting = Boolean(school.primaryManagerId) && window.confirm('להחליף את המנהל הראשי הקיים? הוא יישאר חבר במוסד בתפקיד צופה.');
    try {
      await assignInstitutionManager({ schoolId, fullName, email, reason: reason.trim(), replaceExisting });
      setMessage('המינוי נשמר או נשלחה הזמנה מאובטחת. הפעולה נרשמה ביומן.'); await load();
    } catch { setError(mfaMessage()); }
  }

  const managers = staff.filter(item => ['principal', 'institution_manager'].includes(item.role) || Object.values(item.rolesBySchool || {}).some(role => ['principal', 'institution_manager'].includes(role)));
  return <div className="page"><Header title="ניהול הפלטפורמה" /><div className="page-content"><div className="students-feedback students-feedback--warning"><ShieldCheck size={16} /> ממשק תמיכה מוגבל: אין כאן גישה לתלמידים, ציונים, נוכחות, קבצים, משימות, לוח שנה או שיחות פנימיות. פעולות רגישות דורשות MFA והתחברות מחדש.</div><div className="segmented-control" role="tablist">{TABS.map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</div>{error && <div className="students-feedback students-feedback--error">{error}</div>}{message && <div className="students-feedback students-feedback--success">{message}</div>}{loading ? <p>טוען…</p> : <>
    {tab === 'institutions' && <section><div className="page-toolbar"><button className="btn btn-primary" onClick={() => setShowSchoolForm(value => !value)}><Building2 size={15} /> יצירת מוסד</button></div>{showSchoolForm && <form className="card school-form-grid" onSubmit={createInstitution}>{Object.entries({ name: 'שם מוסד', code: 'קוד', address: 'כתובת', phone: 'טלפון', institutionalEmail: 'דוא״ל מוסדי', managerFullName: 'שם מנהל ראשון', managerEmail: 'דוא״ל מנהל ראשון' }).map(([key, label]) => <label className="form-group" key={key}>{label}<input type={key.toLowerCase().includes('email') ? 'email' : 'text'} value={schoolForm[key]} onChange={event => setSchoolForm(previous => ({ ...previous, [key]: event.target.value }))} required={['name', 'code', 'managerFullName', 'managerEmail'].includes(key)} /></label>)}<button className="btn btn-primary">יצירת מוסד</button></form>}<div className="data-table-wrap"><table className="data-table"><thead><tr><th>מוסד</th><th>קוד</th><th>סטטוס</th><th>מנהל</th></tr></thead><tbody>{institutions.map(item => <tr key={item.id}><td>{item.name}</td><td>{item.code}</td><td>{item.status}</td><td>{item.primaryManagerId ? 'משויך' : 'לא משויך'}</td></tr>)}</tbody></table></div></section>}
    {tab === 'managers' && <section><div className="page-toolbar"><button className="btn btn-primary" onClick={assignManager}>מינוי או החלפת מנהל מוסד</button></div><DirectoryTable items={managers} /></section>}
    {tab === 'staff' && <section><label className="form-group">סינון לפי מוסד<select value={selectedSchoolId} onChange={event => setSelectedSchoolId(event.target.value)}><option value="">כל המוסדות</option>{institutions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="data-table-wrap"><table className="data-table"><thead><tr><th>שם</th><th>דוא״ל</th><th>תפקיד</th><th>סטטוס</th><th>פעולות תמיכה</th></tr></thead><tbody>{staff.map(item => <tr key={item.userId}><td>{item.fullName}</td><td dir="ltr">{item.email}</td><td>{item.jobTitle || item.role}</td><td>{item.accountStatus}</td><td><button className="icon-btn" title="שליחת קישור איפוס" onClick={() => staffAction(item, 'send_password_reset')}><KeyRound size={14} /></button><button className="icon-btn" title="ביטול sessions" onClick={() => staffAction(item, 'revoke_sessions')}><RefreshCw size={14} /></button><button className="icon-btn" title={item.accountStatus === 'disabled' ? 'הפעלת חשבון' : 'השבתת חשבון'} onClick={() => staffAction(item, item.accountStatus === 'disabled' ? 'enable_account' : 'disable_account')}><UserX size={14} /></button></td></tr>)}</tbody></table></div></section>}
    {tab === 'permissions' && <DirectoryTable items={staff} showPermissions />}
    {tab === 'forumRequests' && <div className="data-table-wrap"><table className="data-table"><thead><tr><th>מוסד</th><th>מבקש</th><th>הרשאות</th><th>סטטוס</th><th>פעולות</th></tr></thead><tbody>{requests.map(item => <tr key={item.id}><td>{item.schoolId}</td><td>{item.userId}</td><td>{(item.requestedPermissions || []).join(', ')}</td><td>{item.status}</td><td>{item.status === 'pending_admin_approval' && <><button className="btn btn-primary btn-sm" onClick={() => reviewAccess(item, true)}>אישור</button><button className="btn btn-secondary btn-sm" onClick={() => reviewAccess(item, false)}>דחייה</button></>}</td></tr>)}</tbody></table></div>}
    {tab === 'forum' && <div className="empty-state"><p>ניהול תוכן הפורום מתבצע בתוך המרחב המשותף, ללא פתיחת מידע מוסדי.</p><Link className="btn btn-primary" to="/forum">מעבר לפורום</Link></div>}
    {tab === 'support' && <div className="data-table-wrap"><table className="data-table"><thead><tr><th>מוסד</th><th>כותרת</th><th>סוג</th><th>דחיפות</th><th>סטטוס</th><th>טיפול</th></tr></thead><tbody>{tickets.map(item => <tr key={item.id}><td>{item.schoolId}</td><td>{item.title}</td><td>{item.issueType}</td><td>{item.urgency}</td><td>{item.status}</td><td><button className="btn btn-secondary btn-sm" onClick={() => updateTicket(item, 'in_progress')}>בטיפול</button><button className="btn btn-primary btn-sm" onClick={() => updateTicket(item, 'resolved')}>נפתר</button></td></tr>)}</tbody></table></div>}
    {tab === 'audit' && <div className="data-table-wrap"><table className="data-table"><thead><tr><th>פעולה</th><th>סוג יעד</th><th>מוסד</th><th>סיבה</th></tr></thead><tbody>{audit.map(item => <tr key={item.id}><td>{item.action}</td><td>{item.targetType || '—'}</td><td>{item.institutionId || '—'}</td><td>{item.reason || '—'}</td></tr>)}</tbody></table></div>}
  </>}</div></div>;
}

function DirectoryTable({ items, showPermissions = false }) {
  return <div className="data-table-wrap"><table className="data-table"><thead><tr><th>שם</th><th>דוא״ל</th><th>תפקיד</th><th>{showPermissions ? 'הרשאות' : 'מוסדות'}</th><th>סטטוס</th></tr></thead><tbody>{items.map(item => <tr key={item.userId}><td>{item.fullName}</td><td dir="ltr">{item.email}</td><td>{item.jobTitle || item.role}</td><td>{showPermissions ? Object.entries(item.permissions || {}).filter(([, enabled]) => enabled === true).map(([key]) => key).join(', ') || 'לפי תפקיד' : (item.schoolIds || []).join(', ')}</td><td>{item.accountStatus}</td></tr>)}</tbody></table></div>;
}
