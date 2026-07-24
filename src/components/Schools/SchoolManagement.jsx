import { useCallback, useEffect, useState } from 'react';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import {
  assignInstitutionManager,
  createSchool,
  deleteSchool,
  invitationErrorMessage,
  updateSchool,
} from '../../services/adminUserService';
import { academicYearDisplay, academicYearFromHebrewYear } from '../../utils/academicYears';
import Header from '../Layout/Header';
import { Edit3, Plus, Search, Trash2, UserCheck, X } from 'lucide-react';
import '../Gantt/Gantt.css';
import './Schools.css';

const YEARS = [5786, 5787, 5788].map((year, index) => (
  academicYearFromHebrewYear(year, index === 1 ? 'active' : index === 0 ? 'closed' : 'future')
));

const EMPTY_FORM = {
  name: '', code: '', address: '', phone: '', institutionalEmail: '',
  activeAcademicYearId: YEARS[1].id, status: 'active', managerFullName: '', managerEmail: '',
};

function timestampText(value) {
  if (!value) return '—';
  const date = value.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('he-IL');
}

export default function SchoolManagement() {
  const [schools, setSchools] = useState([]);
  const [users, setUsers] = useState([]);
  const [pendingInvitations, setPendingInvitations] = useState([]);
  const [auditEvents, setAuditEvents] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [assignModal, setAssignModal] = useState(null);
  const [managerForm, setManagerForm] = useState({ fullName: '', email: '' });
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    const [schoolsSnapshot, usersSnapshot, auditSnapshot] = await Promise.all([
      getDocs(collection(db, 'schools')),
      getDocs(collection(db, 'users')),
      getDocs(query(collection(db, 'auditLogs'), orderBy('createdAt', 'desc'), limit(30))),
    ]);
    const nextSchools = schoolsSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    setSchools(nextSchools);
    setUsers(usersSnapshot.docs.map(item => ({ id: item.id, ...item.data() })));
    setAuditEvents(auditSnapshot.docs.map(item => ({ id: item.id, ...item.data() })));
    const invitationSnapshots = await Promise.all(nextSchools.map(school => (
      getDocs(query(collection(db, `schools/${school.id}/invitations`), where('status', '==', 'pending')))
    )));
    setPendingInvitations(invitationSnapshots.flatMap((snapshot, index) => (
      snapshot.docs.map(item => ({ id: item.id, schoolName: nextSchools[index].name, ...item.data() }))
    )));
  }, []);

  useEffect(() => {
    loadData().catch(() => setError('לא ניתן לטעון כרגע את נתוני המוסדות.'));
  }, [loadData]);

  function handleChange(event) {
    setForm(previous => ({ ...previous, [event.target.name]: event.target.value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSaving(true);
    const details = {
      name: form.name.trim(), code: form.code.trim(), address: form.address.trim(), phone: form.phone.trim(),
      institutionalEmail: form.institutionalEmail.trim(), activeAcademicYearId: form.activeAcademicYearId,
      status: form.status,
    };
    try {
      if (editing) {
        await updateSchool({ schoolId: editing, ...details });
      } else {
        await createSchool({
          ...details,
          manager: { fullName: form.managerFullName.trim(), email: form.managerEmail.trim() },
        });
      }
      setForm(EMPTY_FORM);
      setShowForm(false);
      setEditing(null);
      await loadData();
    } catch (caught) {
      setError(invitationErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(schoolId) {
    if (!confirm('מחיקת מוסד אפשרית רק אם אין בו משתמשים או מידע. האם להמשיך לבדיקה?')) return;
    setError('');
    try {
      await deleteSchool({ schoolId, confirmDelete: true });
      await loadData();
    } catch {
      setError('לא ניתן למחוק מוסד שמכיל משתמשים או מידע. ניתן להשבית אותו במקום זאת.');
    }
  }

  function handleEdit(school) {
    setForm({
      ...EMPTY_FORM,
      name: school.name || '', code: school.code || school.id, address: school.address || '',
      phone: school.phone || '', institutionalEmail: school.institutionalEmail || '',
      activeAcademicYearId: school.activeAcademicYearId || YEARS[1].id, status: school.status || 'active',
    });
    setEditing(school.id);
    setShowForm(true);
  }

  async function assignManager(event) {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      await assignInstitutionManager({ schoolId: assignModal, ...managerForm });
      setAssignModal(null);
      setManagerForm({ fullName: '', email: '' });
      await loadData();
    } catch (caught) {
      setError(invitationErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  function managerName(school) {
    const manager = users.find(user => user.id === school.primaryManagerId || user.id === school.principalId);
    return manager?.fullName || (school.pendingManagerInvitationId ? 'הזמנה ממתינה' : 'לא שובץ');
  }

  const filteredSchools = schools.filter(school => {
    const text = `${school.name || ''} ${school.code || ''} ${school.address || ''} ${managerName(school)}`.toLowerCase();
    return text.includes(searchQuery.trim().toLowerCase());
  });

  return (
    <div className="page">
      <Header title="ניהול מוסדות" />
      <div className="page-content">
        <div className="page-toolbar">
          <button className="btn btn-primary" onClick={() => { setShowForm(true); setEditing(null); setForm(EMPTY_FORM); }}>
            <Plus size={16} /> מוסד חדש
          </button>
          <div className="search-bar"><Search size={14} /><input value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="חיפוש מוסד..." /></div>
        </div>
        {error && <div className="school-error" role="alert">{error}</div>}

        {showForm && (
          <div className="card form-card">
            <form onSubmit={handleSubmit} className="school-form-grid">
              <div className="form-group"><label>שם המוסד</label><input name="name" value={form.name} onChange={handleChange} required /></div>
              <div className="form-group"><label>סמל או קוד</label><input name="code" value={form.code} onChange={handleChange} pattern="[A-Za-z0-9_-]+" disabled={Boolean(editing)} required /></div>
              <div className="form-group"><label>כתובת</label><input name="address" value={form.address} onChange={handleChange} /></div>
              <div className="form-group"><label>טלפון</label><input name="phone" value={form.phone} onChange={handleChange} dir="ltr" /></div>
              <div className="form-group"><label>דוא״ל מוסדי</label><input name="institutionalEmail" type="email" value={form.institutionalEmail} onChange={handleChange} dir="ltr" /></div>
              <div className="form-group"><label>שנת לימודים פעילה</label><select name="activeAcademicYearId" value={form.activeAcademicYearId} onChange={handleChange}>{YEARS.map(year => <option key={year.id} value={year.id}>{academicYearDisplay(year)}</option>)}</select></div>
              <div className="form-group"><label>סטטוס</label><select name="status" value={form.status} onChange={handleChange}><option value="active">פעיל</option><option value="disabled">מושבת</option></select></div>
              {!editing && <><div className="form-group"><label>שם מנהל מוסד ראשון</label><input name="managerFullName" value={form.managerFullName} onChange={handleChange} required /></div><div className="form-group"><label>דוא״ל מנהל מוסד</label><input name="managerEmail" type="email" value={form.managerEmail} onChange={handleChange} dir="ltr" required /></div></>}
              <div className="form-actions school-form-actions"><button disabled={saving} type="submit" className="btn btn-primary">{saving ? 'שומר...' : editing ? 'עדכון' : 'יצירת מוסד והזמנת מנהל'}</button><button type="button" className="btn btn-secondary" onClick={() => { setShowForm(false); setEditing(null); }}>ביטול</button></div>
            </form>
          </div>
        )}

        <div className="data-table-wrap">
          <table className="data-table"><thead><tr><th>מוסד</th><th>כתובת</th><th>שנת לימודים</th><th>סטטוס</th><th>מנהל מוסד</th><th>פעולות</th></tr></thead><tbody>
            {filteredSchools.map(school => {
              const year = YEARS.find(item => item.id === school.activeAcademicYearId);
              return <tr key={school.id}><td><strong>{school.name}</strong><div className="school-code">{school.code || school.id}</div></td><td>{school.address || '—'}</td><td>{year ? academicYearDisplay(year) : school.activeAcademicYearId || '—'}</td><td><span className={`school-status school-status--${school.status || 'active'}`}>{school.status === 'disabled' ? 'מושבת' : 'פעיל'}</span></td><td>{managerName(school)}</td><td><div className="td-actions"><button className="icon-btn" title="שיבוץ או החלפת מנהל" onClick={() => { setAssignModal(school.id); setManagerForm({ fullName: '', email: '' }); }}><UserCheck size={15} /></button><button className="icon-btn" title="עריכה" onClick={() => handleEdit(school)}><Edit3 size={15} /></button><button className="icon-btn icon-btn--danger" title="מחיקה בטוחה" onClick={() => handleDelete(school.id)}><Trash2 size={15} /></button></div></td></tr>;
            })}
            {filteredSchools.length === 0 && <tr><td colSpan={6} className="td-empty">אין מוסדות להצגה</td></tr>}
          </tbody></table>
        </div>

        <div className="school-admin-panels">
          <section className="card"><h3>הזמנות ממתינות ({pendingInvitations.length})</h3>{pendingInvitations.length === 0 ? <p className="td-empty">אין הזמנות ממתינות</p> : pendingInvitations.map(item => <div className="school-admin-row" key={`${item.schoolId}-${item.id}`}><span><strong>{item.fullName}</strong> · {item.schoolName}</span><span>{item.emailDeliveryStatus === 'failed' ? 'שליחת המייל נכשלה' : 'ממתינה לקבלה'}</span></div>)}</section>
          <section className="card"><h3>יומן פעולות ניהוליות</h3>{auditEvents.length === 0 ? <p className="td-empty">אין פעולות להצגה</p> : auditEvents.slice(0, 10).map(item => <div className="school-admin-row" key={item.id}><span>{item.action}</span><time>{timestampText(item.createdAt)}</time></div>)}</section>
        </div>

        {assignModal && <div className="modal-overlay" onClick={() => setAssignModal(null)}><div className="modal-content" onClick={event => event.stopPropagation()}><div className="modal-header"><h3>שיבוץ מנהל מוסד</h3><button className="modal-close" onClick={() => setAssignModal(null)}><X size={18} /></button></div><form className="modal-form" onSubmit={assignManager}><p className="assign-subtitle">אם החשבון קיים הוא ישויך למוסד; אחרת תישלח הזמנה חד־פעמית.</p><div className="form-group"><label>שם מלא</label><input value={managerForm.fullName} onChange={event => setManagerForm(previous => ({ ...previous, fullName: event.target.value }))} required /></div><div className="form-group"><label>דוא״ל</label><input type="email" dir="ltr" value={managerForm.email} onChange={event => setManagerForm(previous => ({ ...previous, email: event.target.value }))} required /></div><div className="modal-actions"><button disabled={saving} className="btn btn-primary">{saving ? 'שולח...' : 'שיבוץ או שליחת הזמנה'}</button><button type="button" className="btn btn-secondary" onClick={() => setAssignModal(null)}>ביטול</button></div></form></div></div>}
      </div>
    </div>
  );
}
