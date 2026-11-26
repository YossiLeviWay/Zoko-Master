import { useEffect, useState } from 'react';
import { getDocs } from 'firebase/firestore';
import { PERMISSION_GROUPS } from '../../../functions/src/permissionCatalog.js';
import { db } from '../../firebase.js';
import { requestStaffPasswordReset, setUserRole, updateStaffUser } from '../../services/adminUserService.js';
import { schoolCollection } from '../../services/firestore/paths.js';
import { schoolJobTitle } from '../../utils/staffManagement.js';

const ROLE_LABELS = { principal: 'מנהל', institution_manager: 'מנהל מוסד', editor: 'עורך', viewer: 'צופה', teacher: 'מורה' };

export default function StaffManagePanel({ user, schoolId, teams = [], onClose, onSaved, onEdit, onPermissions, onPreview, onProfile }) {
  const [fullName, setFullName] = useState(user.fullName || '');
  const [phone, setPhone] = useState(user.phone || '');
  const [jobTitle, setJobTitle] = useState(schoolJobTitle(user, schoolId) || '');
  const [role, setRole] = useState(['viewer', 'editor'].includes(user.role) ? user.role : 'viewer');
  const [teamIds, setTeamIds] = useState(user.teamIds || []);
  const [permissions, setPermissions] = useState({ ...(user.permissions || {}) });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmOff, setConfirmOff] = useState(false);
  const [classes, setClasses] = useState([]);
  const lockedRole = ['principal', 'institution_manager', 'global_admin'].includes(user.role);
  const status = user.accountStatus === 'disabled' ? 'מושבת' : user.accountStatus === 'pending' ? 'ממתין' : 'פעיל';

  useEffect(() => {
    const dialog = document.getElementById('staff-manage-dialog');
    dialog?.showModal();
    let live = true;
    getDocs(schoolCollection(db, schoolId, 'classes')).then(snap => {
      if (!live) return;
      setClasses(snap.docs.map(item => ({ id: item.id, ...item.data() })).filter(item => item.teacherId === user.id || (Array.isArray(item.teacherIds) && item.teacherIds.includes(user.id))));
    }).catch(() => { if (live) setClasses([]); });
    return () => { live = false; };
  }, [schoolId, user.id]);

  function toggleTeam(id) {
    setTeamIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  }

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await updateStaffUser({ userId: user.id, schoolId, fullName: fullName.trim(), phone: phone.trim(), jobTitle: jobTitle.trim(), teamIds });
      if (!lockedRole && role !== user.role) await setUserRole({ userId: user.id, schoolId, role });
      const changed = Object.fromEntries(Object.entries(permissions).filter(([key, value]) => Boolean(user.permissions?.[key]) !== Boolean(value)));
      if (Object.keys(changed).length) await updateStaffUser({ userId: user.id, schoolId, permissions: changed });
      onSaved('הפרטים נשמרו.');
      onClose();
    } catch {
      setMessage('השמירה נדחתה. בדקו את ההרשאה ונסו שוב.');
    } finally { setBusy(false); }
  }

  async function resend() {
    setBusy(true);
    setMessage('');
    try {
      await requestStaffPasswordReset({ userId: user.id, schoolId });
      setMessage('נשלח קישור כניסה חדש.');
    } catch {
      setMessage('לא ניתן לשלוח קישור כניסה כרגע.');
    } finally { setBusy(false); }
  }

  async function deactivate() {
    setBusy(true);
    setMessage('');
    try {
      await updateStaffUser({ userId: user.id, schoolId, accountStatus: 'disabled' });
      onSaved('איש הצוות הושבת. החשבון לא נמחק.');
      onClose();
    } catch {
      setMessage('ההשבתה נדחתה. אם זה המנהל האחרון, או שהשרת עדיין לא עודכן, לא נשמר דבר.');
    } finally { setBusy(false); }
  }

  const activeCount = Object.values(permissions).filter(Boolean).length;
  return (
    <dialog id="staff-manage-dialog" className="staff-manage-dialog" aria-label={`ניהול ${user.fullName}`} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
      <header>
        <div>
          <small>{ROLE_LABELS[user.role] || 'צופה'} · {status}</small>
          <h3>{user.fullName}</h3>
        </div>
        <button type="button" aria-label="סגירה" onClick={onClose}>✕</button>
      </header>
      <form id="staff-manage-form" className="staff-manage-body" onSubmit={save}>
        {message && <p role="status">{message}</p>}
        <section className="staff-manage-section">
          <label>שם<input value={fullName} onChange={event => setFullName(event.target.value)} maxLength={120} required /></label>
          <label>טלפון<input value={phone} onChange={event => setPhone(event.target.value)} maxLength={32} dir="ltr" /></label>
          <label>תפקיד בבית הספר<input value={jobTitle} onChange={event => setJobTitle(event.target.value)} maxLength={120} /></label>
          <p dir="ltr">{user.email}</p>
        </section>
        <section className="staff-manage-section">
          <label>הרשאת מערכת
            <select value={lockedRole ? user.role : role} disabled={lockedRole} onChange={event => setRole(event.target.value)}>
              {lockedRole ? <option value={user.role}>{ROLE_LABELS[user.role]}</option> : <><option value="viewer">צופה</option><option value="editor">עורך</option></>}
            </select>
          </label>
        </section>
        <details className="staff-manage-perms">
          <summary>הרשאות ({activeCount})</summary>
          {PERMISSION_GROUPS.map(group => (
            <details key={group.id}>
              <summary>{group.label}</summary>
              {group.permissions.map(([key, label]) => (
                <label key={key} className="staff-perm"><span>{label}</span><input type="checkbox" checked={permissions[key] === true} onChange={event => setPermissions(current => ({ ...current, [key]: event.target.checked }))} /></label>
              ))}
            </details>
          ))}
        </details>
        <details>
          <summary>כיתות ({classes.length})</summary>
          <div className="staff-manage-section">
            {classes.length === 0 ? <p>אין כיתה שמשויכת לאיש הצוות הזה. שיוך מחנך נשמר בכרטיס הכיתה.</p> : classes.map(item => <p key={item.id}>{item.name || item.id}</p>)}
          </div>
        </details>
        <details>
          <summary>עוד</summary>
          <div className="staff-manage-actions">
            {onEdit && <button type="button" onClick={onEdit}>עריכת פרטים</button>}
            {onPermissions && <button type="button" onClick={onPermissions}>הרשאות מתקדמות</button>}
            {onPreview && <button type="button" onClick={onPreview}>בדיקת תצוגה</button>}
            {onProfile && <button type="button" onClick={onProfile}>כרטיס מלא</button>}
          </div>
        </details>
        <details>
          <summary>צוותים ({teamIds.length})</summary>
          <div className="staff-manage-section">
            {teams.length === 0 && <p>אין צוותים במוסד.</p>}
            {teams.map(team => <label key={team.id} className="staff-perm"><span>{team.name}</span><input type="checkbox" checked={teamIds.includes(team.id)} onChange={() => toggleTeam(team.id)} /></label>)}
          </div>
        </details>
      </form>
      <div className="staff-manage-actions">
        <button type="submit" form="staff-manage-form" disabled={busy}>שמירה</button>
        <button type="button" disabled={busy} onClick={resend}>שליחת קישור כניסה</button>
        {!confirmOff ? <button type="button" className="is-danger" disabled={busy || user.role === 'principal'} onClick={() => setConfirmOff(true)}>השבתה</button> : <button type="button" className="is-danger" disabled={busy} onClick={deactivate}>אישור השבתה</button>}
      </div>
    </dialog>
  );
}
