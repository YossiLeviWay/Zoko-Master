import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { Archive, ChevronDown, ChevronUp, Copy, Edit3, Plus, Save, Shield, UserPlus, X } from 'lucide-react';
import { PERMISSION_GROUPS } from '../../../functions/src/permissionCatalog.js';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { db } from '../../firebase';
import { schoolCollection } from '../../services/firestore/paths';
import {
  archiveCustomRole,
  assignCustomRole,
  callableReason,
  cloneCustomRole,
  createCustomRole,
  setPermissionDelegation,
  updateCustomRole,
} from '../../services/adminUserService';

const EMPTY_FORM = Object.freeze({
  name: '',
  description: '',
  permissions: {},
  delegatedPermissionKeys: [],
  accessScope: { type: 'school', classIds: [] },
  icon: 'shield',
  color: '#870335',
  delegable: true,
  assignableBy: [],
  defaultForInvites: false,
  responsibilityAreas: [],
  relatedTeamIds: [],
  relatedGrades: [],
  commonTaskTypes: [],
});

const ROLE_PRESETS = Object.freeze([
  { name: 'רכז פדגוגי', keys: ['academicYears.view', 'classes.view', 'classes.update', 'students.view', 'students.update', 'students.promote'] },
  { name: 'מחנך', keys: ['classes.view', 'students.view', 'students.update', 'students.addNotes', 'personalFile.view', 'cv.view'] },
  { name: 'רכז תעסוקה', keys: ['students.view', 'personalFile.view', 'personalFile.manage', 'cv.view', 'cv.create', 'cv.edit', 'cv.manageExperience', 'cv.manageRecommendations'] },
  { name: 'רכז מגמה', keys: ['classes.view', 'students.view', 'students.managePrograms', 'personalFile.view', 'cv.manageSkills'] },
  { name: 'צופה', keys: ['academicYears.view', 'classes.view', 'students.view', 'personalFile.view', 'cv.view'] },
]);

function roleForm(role = EMPTY_FORM) {
  return {
    name: role.name || '',
    description: role.description || '',
    permissions: { ...(role.permissions || {}) },
    delegatedPermissionKeys: [...(role.delegatedPermissionKeys || [])],
    accessScope: role.accessScope?.type === 'classes'
      ? { type: 'classes', classIds: [...(role.accessScope.classIds || [])] }
      : { type: 'school', classIds: [] },
    icon: role.icon || 'shield',
    color: role.color || '#870335',
    delegable: role.delegable !== false,
    assignableBy: [...(role.assignableBy || [])],
    defaultForInvites: role.defaultForInvites === true,
    responsibilityAreas: [...(role.responsibilityAreas || [])],
    relatedTeamIds: [...(role.relatedTeamIds || [])],
    relatedGrades: [...(role.relatedGrades || [])],
    commonTaskTypes: [...(role.commonTaskTypes || [])],
  };
}

function roleOperationErrorMessage(error) {
  const reason = callableReason(error);
  const messages = {
    unauthenticated: 'החיבור פג. התחברו מחדש ונסו שוב.',
    'permission-denied': 'השרת לא זיהה הרשאת ניהול תפקידים במוסד הנבחר. ודאו שנבחר המוסד הנכון ורעננו את הדף.',
    'invalid-argument': 'אחד מפרטי התפקיד אינו תקין. בדקו את השם, ההיקף וההרשאות שנבחרו.',
    'failed-precondition': 'לא ניתן להשלים את הפעולה משום שאחד מהפריטים המשויכים אינו קיים במוסד.',
    'not-found': 'שירות ניהול התפקידים עדיין אינו זמין בשרת.',
    unavailable: 'שירות ניהול התפקידים אינו זמין כרגע. נסו שוב בעוד רגע.',
    internal: 'שירות ניהול התפקידים החזיר שגיאה. לא נשמרו שינויים.',
  };
  return messages[reason] || 'לא ניתן לשמור את התפקיד כרגע. לא נשמרו שינויים.';
}

export default function RolesManager({ schoolId, onClose }) {
  const { isGlobalAdmin, isPrincipal } = useAuth();
  const { permissions } = usePermissions();
  const isAdmin = isGlobalAdmin() || isPrincipal();
  const [roles, setRoles] = useState([]);
  const [classes, setClasses] = useState([]);
  const [staff, setStaff] = useState([]);
  const [teams, setTeams] = useState([]);
  const [editingRole, setEditingRole] = useState(null);
  const [editForm, setEditForm] = useState(roleForm());
  const [expandedGroups, setExpandedGroups] = useState({});
  const [showForm, setShowForm] = useState(false);
  const [selectedAssignees, setSelectedAssignees] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [activePanel, setActivePanel] = useState('roles');
  const [delegationForm, setDelegationForm] = useState({ delegateUserId: '', assignableRoleIds: [], expiresAt: '' });

  const canView = isAdmin || permissions['roles.view'];
  const canCreate = isAdmin || permissions['roles.create'];
  const canUpdate = isAdmin || permissions['roles.update'];
  const canArchive = isAdmin || permissions['roles.archive'];
  const canAssign = isAdmin || permissions['roles.assign'];

  const loadData = useCallback(async () => {
    if (!schoolId || !canView) return;
    try {
      const [roleSnapshot, classSnapshot, teamSnapshot, staffByPrimary, staffByMembership] = await Promise.all([
        getDocs(schoolCollection(db, schoolId, 'roleDefinitions')),
        getDocs(schoolCollection(db, schoolId, 'classes')),
        getDocs(schoolCollection(db, schoolId, 'teams')),
        getDocs(query(collection(db, 'users'), where('schoolId', '==', schoolId))),
        getDocs(query(collection(db, 'users'), where('schoolIds', 'array-contains', schoolId))),
      ]);
      setRoles(roleSnapshot.docs.map(item => ({ id: item.id, ...item.data() })));
      setClasses(classSnapshot.docs.map(item => ({ id: item.id, ...item.data() })));
      setTeams(teamSnapshot.docs.map(item => ({ id: item.id, ...item.data() })));
      const users = new Map();
      [...staffByPrimary.docs, ...staffByMembership.docs].forEach(item => users.set(item.id, { id: item.id, ...item.data() }));
      setStaff([...users.values()].filter(user => user.accountStatus !== 'disabled'));
    } catch {
      setError('לא ניתן לטעון את התפקידים והמשתמשים.');
    }
  }, [canView, schoolId]);

  useEffect(() => { loadData(); }, [loadData]);

  const holdersByRole = useMemo(() => {
    const result = new Map();
    roles.forEach(role => result.set(role.id, staff.filter(user => (
      user.customRoleAssignments?.[schoolId]?.includes(role.id)
      || user.customRoleIds?.includes(role.id)
    ))));
    return result;
  }, [roles, schoolId, staff]);

  function openForm(role = null) {
    setEditingRole(role);
    setEditForm(roleForm(role || EMPTY_FORM));
    setExpandedGroups(PERMISSION_GROUPS[0] ? { [PERMISSION_GROUPS[0].id]: true } : {});
    setError('');
    setShowForm(true);
  }

  function applyPreset(preset) {
    setEditForm(previous => ({
      ...previous,
      name: preset.name,
      permissions: Object.fromEntries(preset.keys.map(key => [key, true])),
      delegatedPermissionKeys: [],
    }));
  }

  function togglePermission(key) {
    setEditForm(previous => {
      const enabled = !previous.permissions[key];
      return {
        ...previous,
        permissions: { ...previous.permissions, [key]: enabled },
        delegatedPermissionKeys: enabled
          ? previous.delegatedPermissionKeys
          : previous.delegatedPermissionKeys.filter(item => item !== key),
      };
    });
  }

  function toggleDelegable(key) {
    setEditForm(previous => ({
      ...previous,
      delegatedPermissionKeys: previous.delegatedPermissionKeys.includes(key)
        ? previous.delegatedPermissionKeys.filter(item => item !== key)
        : [...previous.delegatedPermissionKeys, key],
    }));
  }

  function setGroupPermissions(group, enabled) {
    const keys = group.permissions.map(([key]) => key);
    setEditForm(previous => ({
      ...previous,
      permissions: {
        ...previous.permissions,
        ...Object.fromEntries(keys.map(key => [key, enabled])),
      },
      delegatedPermissionKeys: enabled
        ? previous.delegatedPermissionKeys
        : previous.delegatedPermissionKeys.filter(key => !keys.includes(key)),
    }));
  }

  function toggleScopeClass(classId) {
    setEditForm(previous => ({
      ...previous,
      accessScope: {
        type: 'classes',
        classIds: previous.accessScope.classIds.includes(classId)
          ? previous.accessScope.classIds.filter(item => item !== classId)
          : [...previous.accessScope.classIds, classId],
      },
    }));
  }

  async function saveRole() {
    if (!editForm.name.trim()) return setError('יש להזין שם לתפקיד.');
    if (editForm.accessScope.type === 'classes' && editForm.accessScope.classIds.length === 0) {
      return setError('בתפקיד מוגבל יש לבחור לפחות כיתה אחת.');
    }
    setSaving(true); setError('');
    try {
      const payload = { schoolId, ...editForm, name: editForm.name.trim(), description: editForm.description.trim() };
      if (editingRole) await updateCustomRole({ ...payload, roleId: editingRole.id });
      else await createCustomRole(payload);
      setMessage(editingRole ? 'התפקיד עודכן וההרשאות חושבו מחדש.' : 'התפקיד נוצר בהצלחה.');
      setShowForm(false); setEditingRole(null); await loadData();
    } catch (saveError) {
      setError(roleOperationErrorMessage(saveError));
    } finally { setSaving(false); }
  }

  async function archiveRole(role) {
    if (!window.confirm(`להעביר את התפקיד "${role.name}" לארכיון? ההרשאות יוסרו מכל המחזיקים.`)) return;
    setSaving(true); setError('');
    try {
      await archiveCustomRole({ schoolId, roleId: role.id });
      setMessage('התפקיד הועבר לארכיון וההרשאות חושבו מחדש.');
      await loadData();
    } catch { setError('לא ניתן לארכב את התפקיד.'); }
    finally { setSaving(false); }
  }

  async function cloneRole(role) {
    const name = window.prompt('שם התפקיד המועתק:', `${role.name} — עותק`)?.trim();
    if (!name) return;
    setSaving(true); setError('');
    try {
      await cloneCustomRole({ schoolId, roleId: role.id, name });
      setMessage('נוצר עותק עצמאי של התפקיד.'); await loadData();
    } catch { setError('לא ניתן להעתיק את התפקיד.'); }
    finally { setSaving(false); }
  }

  async function changeAssignment(role, action) {
    const userId = selectedAssignees[role.id];
    if (!userId) return;
    if (!window.confirm(action === 'assign' ? 'לאשר הענקת תפקיד והרשאות למשתמש?' : 'לאשר הסרת התפקיד מהמשתמש?')) return;
    setSaving(true); setError('');
    try {
      await assignCustomRole({ schoolId, roleId: role.id, userId, action, confirmSensitiveChange: true });
      setMessage(action === 'assign' ? 'התפקיד שויך ונרשם ביומן הפעילות.' : 'התפקיד הוסר ונרשם ביומן הפעילות.');
      await loadData();
    } catch { setError('השיוך נדחה: אין הרשאה, המשתמש אינו במוסד, או שקיימת סכנת הסלמת הרשאות.'); }
    finally { setSaving(false); }
  }

  async function saveDelegation() {
    if (!delegationForm.delegateUserId || delegationForm.assignableRoleIds.length === 0) {
      setError('יש לבחור מנהל הרשאות ולפחות תפקיד אחד שניתן להקצות.'); return;
    }
    const maximumPermissions = [...new Set(roles
      .filter(role => delegationForm.assignableRoleIds.includes(role.id))
      .flatMap(role => Object.entries(role.permissions || {}).filter(([, value]) => value === true).map(([key]) => key)))];
    setSaving(true); setError('');
    try {
      await setPermissionDelegation({
        schoolId,
        delegateUserId: delegationForm.delegateUserId,
        assignableRoleIds: delegationForm.assignableRoleIds,
        maximumPermissions,
        expiresAt: delegationForm.expiresAt ? new Date(`${delegationForm.expiresAt}T23:59:59`).toISOString() : null,
        active: true,
      });
      setMessage('סמכות ההקצאה נשמרה ונרשמה ביומן הביקורת.');
      setDelegationForm({ delegateUserId: '', assignableRoleIds: [], expiresAt: '' });
    } catch { setError('ההאצלה נדחתה: לא ניתן להעניק סמכות גבוהה מזו של המפעיל.'); }
    finally { setSaving(false); }
  }

  if (!canView) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content roles-manager-modal" role="dialog" aria-modal="true" aria-label="תפקידים והרשאות" onClick={event => event.stopPropagation()}>
        <div className="modal-header"><h3>תפקידים והרשאות</h3><button className="modal-close" onClick={onClose} aria-label="סגירה"><X size={18} /></button></div>
        <div className="roles-manager-body">
          {error && <div className="staff-form-error" role="alert">{error}</div>}
          {message && <div className="students-feedback students-feedback--success" role="status">{message}</div>}
          {!showForm && <div className="roles-manager-tabs" role="tablist" aria-label="ניהול תפקידים והרשאות">{[
            ['roles', 'תפקידים והרשאות'], ['delegations', 'מנהלי הרשאות'], ['audit', 'יומן שינויים'],
          ].map(([id, label]) => <button key={id} role="tab" aria-selected={activePanel === id} className={activePanel === id ? 'active' : ''} onClick={() => setActivePanel(id)}>{label}</button>)}</div>}
          {!showForm && activePanel !== 'roles' ? <section className="roles-manager-panel">
            {activePanel === 'delegations' && <div className="permission-delegation-form"><div className="roles-info-state"><UserPlus size={34} /><h4>מנהלי הקצאת הרשאות</h4><p>בחרו אילו תפקידים אדם רשאי להקצות. תקרת ההרשאות נגזרת מהתפקידים והשרת מונע הסלמה או שינוי מנהל מוסד מוגן.</p></div><label className="form-group">איש צוות<select value={delegationForm.delegateUserId} onChange={event => setDelegationForm(previous => ({ ...previous, delegateUserId: event.target.value }))}><option value="">בחירה</option>{staff.filter(user => !['principal', 'institution_manager', 'global_admin', 'platform_admin'].includes(user.role)).map(user => <option key={user.id} value={user.id}>{user.fullName || user.email}</option>)}</select></label><fieldset className="students-choice-group"><legend>תפקידים שניתן להקצות</legend><div className="students-check-grid">{roles.filter(role => role.status !== 'archived' && role.delegable !== false).map(role => <label key={role.id}><input type="checkbox" checked={delegationForm.assignableRoleIds.includes(role.id)} onChange={event => setDelegationForm(previous => ({ ...previous, assignableRoleIds: event.target.checked ? [...previous.assignableRoleIds, role.id] : previous.assignableRoleIds.filter(id => id !== role.id) }))} /> {role.name}</label>)}</div></fieldset><label className="form-group">תאריך תפוגה (אופציונלי)<input type="date" value={delegationForm.expiresAt} onChange={event => setDelegationForm(previous => ({ ...previous, expiresAt: event.target.value }))} /></label><button className="btn btn-primary" disabled={saving} onClick={saveDelegation}>שמירת סמכות הקצאה</button></div>}
            {activePanel === 'audit' && <div className="roles-info-state"><Archive size={34} /><h4>יומן שינויים</h4><p>יצירה, שינוי, הקצאה, הסרה, האצלה ותצוגה מקדימה נכתבים ליומן הביקורת בצד השרת. תוכן רגיש אינו נשמר במטא־נתונים.</p></div>}
          </section> : !showForm ? <>
            {canCreate && <button className="btn btn-primary" onClick={() => openForm()}><Plus size={16} /> תפקיד חדש</button>}
            <div className="roles-manager-list">
              {roles.filter(role => role.status !== 'archived').map(role => {
                const holders = holdersByRole.get(role.id) || [];
                const selectedUser = staff.find(user => user.id === selectedAssignees[role.id]);
                const selectedHasRole = selectedUser && holders.some(holder => holder.id === selectedUser.id);
                return <article key={role.id} className="role-manager-card">
                  <div className="role-manager-heading"><Shield size={18} /><div><strong>{role.name}</strong><p>{role.description || 'ללא תיאור'}</p></div><span>{Object.values(role.permissions || {}).filter(Boolean).length} הרשאות</span></div>
                  <div className="role-manager-meta"><span>{role.accessScope?.type === 'classes' ? `${role.accessScope.classIds?.length || 0} כיתות` : 'כל המוסד'}</span><span>{holders.length} מחזיקים</span><span>{role.delegatedPermissionKeys?.length || 0} ניתנות להאצלה</span></div>
                  {holders.length > 0 && <p className="role-holder-names">{holders.map(holder => holder.fullName || holder.email).join(', ')}</p>}
                  {canAssign && <div className="role-assignment"><select value={selectedAssignees[role.id] || ''} onChange={event => setSelectedAssignees(previous => ({ ...previous, [role.id]: event.target.value }))}><option value="">בחירת איש צוות</option>{staff.filter(user => user.role !== 'global_admin').map(user => <option key={user.id} value={user.id}>{user.fullName || user.email}</option>)}</select><button className="btn btn-secondary btn-sm" disabled={!selectedUser || saving} onClick={() => changeAssignment(role, selectedHasRole ? 'remove' : 'assign')}><UserPlus size={14} /> {selectedHasRole ? 'הסרת תפקיד' : 'שיוך תפקיד'}</button></div>}
                  <div className="role-manager-actions">{canUpdate && <button className="icon-btn" onClick={() => openForm(role)} aria-label={`עריכת ${role.name}`}><Edit3 size={15} /></button>}{canUpdate && <button className="icon-btn" onClick={() => cloneRole(role)} aria-label={`העתקת ${role.name}`}><Copy size={15} /></button>}{canArchive && <button className="icon-btn icon-btn--danger" onClick={() => archiveRole(role)} aria-label={`ארכוב ${role.name}`}><Archive size={15} /></button>}</div>
                </article>;
              })}
              {roles.filter(role => role.status !== 'archived').length === 0 && <div className="empty-state"><Shield size={36} /><p>עדיין לא נוצרו תפקידים מותאמים.</p></div>}
            </div>
          </> : <div className="role-form">
            <div className="role-form-intro">
              <div>
                <span className="role-form-eyebrow">{editingRole ? 'עריכת תפקיד קיים' : 'תפקיד חדש'}</span>
                <h4>{editingRole ? editingRole.name : 'הגדרת תפקיד והרשאות'}</h4>
                <p>מנהל המוסד רשאי לנהל תפקידים והרשאות בתוך המוסד הנבחר בלבד.</p>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowForm(false)}>חזרה לרשימה</button>
            </div>

            {!editingRole && <section className="role-form-section role-presets-section">
              <div className="role-section-heading"><strong>התחלה מהירה</strong><span>אפשר לבחור תבנית ולשנות אותה</span></div>
              <div className="role-presets">{ROLE_PRESETS.map(preset => <button key={preset.name} type="button" className="role-preset-button" onClick={() => applyPreset(preset)}>{preset.name}</button>)}</div>
            </section>}

            <section className="role-form-section">
              <div className="role-section-heading"><strong>פרטי התפקיד</strong><span>שם ברור יעזור לצוות להבין את תחום האחריות</span></div>
              <div className="role-form-grid">
                <label className="form-group">שם התפקיד<input value={editForm.name} onChange={event => setEditForm(previous => ({ ...previous, name: event.target.value }))} maxLength={120} /></label>
                <label className="form-group role-description-field">תיאור<input value={editForm.description} onChange={event => setEditForm(previous => ({ ...previous, description: event.target.value }))} maxLength={500} /></label>
                <label className="form-group">אייקון מערכת<select value={editForm.icon} onChange={event => setEditForm(previous => ({ ...previous, icon: event.target.value }))}><option value="shield">מגן</option><option value="user">אדם</option><option value="book">ספר</option><option value="briefcase">תיק</option></select></label>
                <label className="form-group role-color-field">צבע תפקיד<span className="role-color-control"><input type="color" value={editForm.color} onChange={event => setEditForm(previous => ({ ...previous, color: event.target.value }))} /><span>{editForm.color.toUpperCase()}</span></span></label>
                <label className="form-group role-description-field">תחומי אחריות<input value={editForm.responsibilityAreas.join(', ')} onChange={event => setEditForm(previous => ({ ...previous, responsibilityAreas: event.target.value.split(',').map(item => item.trim()).filter(Boolean).slice(0, 20) }))} placeholder="ייעוץ, ליווי רגשי, טיולים" /></label>
                <label className="form-group role-description-field">סוגי משימות שכיחים<input value={editForm.commonTaskTypes.join(', ')} onChange={event => setEditForm(previous => ({ ...previous, commonTaskTypes: event.target.value.split(',').map(item => item.trim()).filter(Boolean).slice(0, 20) }))} placeholder="אישורי פעילות, תיאום הורים" /></label>
              </div>
            </section>

            <fieldset className="role-form-section role-scope-section">
              <legend>הקשר ארגוני לסוכן המשימות</legend>
              <p>המידע מסייע להציע את התפקיד רק במשימות שבהן הוא באמת רלוונטי.</p>
              <div className="role-class-grid">{teams.map(team => <label key={team.id}><input type="checkbox" checked={editForm.relatedTeamIds.includes(team.id)} onChange={event => setEditForm(previous => ({ ...previous, relatedTeamIds: event.target.checked ? [...new Set([...previous.relatedTeamIds, team.id])] : previous.relatedTeamIds.filter(id => id !== team.id) }))} /> {team.name}</label>)}</div>
              <label className="form-group">שכבות קשורות<input value={editForm.relatedGrades.join(', ')} onChange={event => setEditForm(previous => ({ ...previous, relatedGrades: event.target.value.split(',').map(item => item.trim()).filter(Boolean).slice(0, 20) }))} placeholder="י, יא, יב" /></label>
            </fieldset>

            <fieldset className="role-form-section role-scope-section">
              <legend>היקף ההרשאה</legend>
              <p>בחרו אם התפקיד תקף לכל המוסד או רק לכיתות מסוימות.</p>
              <div className="role-scope-options">
                <label className={editForm.accessScope.type === 'school' ? 'selected' : ''}><input type="radio" checked={editForm.accessScope.type === 'school'} onChange={() => setEditForm(previous => ({ ...previous, accessScope: { type: 'school', classIds: [] } }))} /><span><strong>כל המוסד</strong><small>גישה לפי ההרשאות שייבחרו בכל המוסד</small></span></label>
                <label className={editForm.accessScope.type === 'classes' ? 'selected' : ''}><input type="radio" checked={editForm.accessScope.type === 'classes'} onChange={() => setEditForm(previous => ({ ...previous, accessScope: { type: 'classes', classIds: [] } }))} /><span><strong>כיתות מסוימות</strong><small>הגבלת ההרשאות לכיתות שנבחרו</small></span></label>
              </div>
              {editForm.accessScope.type === 'classes' && <div className="role-class-grid">{classes.map(item => <label key={item.id}><input type="checkbox" checked={editForm.accessScope.classIds.includes(item.id)} onChange={() => toggleScopeClass(item.id)} /> {item.name}</label>)}</div>}
            </fieldset>

            <section className="role-form-section role-permissions-section">
              <div className="role-section-heading"><strong>הרשאות לפי קטגוריות</strong><span>{Object.values(editForm.permissions).filter(Boolean).length} הרשאות נבחרו</span></div>
              <div className="permissions-list">{PERMISSION_GROUPS.map(group => {
                const enabledCount = group.permissions.filter(([key]) => editForm.permissions[key]).length;
                return <section key={group.id} className={`permissions-group${expandedGroups[group.id] ? ' expanded' : ''}`}>
                  <div className="permissions-group-header">
                    <button type="button" className="permissions-group-toggle" onClick={() => setExpandedGroups(previous => ({ ...previous, [group.id]: !previous[group.id] }))}><span className="permissions-group-title">{group.label}</span><span className="permissions-group-summary">{enabledCount}/{group.permissions.length}</span>{expandedGroups[group.id] ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
                    <div className="permissions-group-bulk"><button type="button" className="btn btn-secondary btn-sm" onClick={() => setGroupPermissions(group, true)}>בחירת הכול</button><button type="button" className="btn btn-secondary btn-sm" disabled={enabledCount === 0} onClick={() => setGroupPermissions(group, false)}>ניקוי</button></div>
                  </div>
                  {expandedGroups[group.id] && <div className="permissions-group-items">{group.permissions.map(([key, label]) => <div key={key} className="permission-delegation-row"><label className="permissions-item"><input type="checkbox" checked={Boolean(editForm.permissions[key])} onChange={() => togglePermission(key)} /><span>{label}</span></label><label className="permission-delegable"><input type="checkbox" disabled={!editForm.permissions[key]} checked={editForm.delegatedPermissionKeys.includes(key)} onChange={() => toggleDelegable(key)} /> ניתן להאצלה</label></div>)}</div>}
                </section>;
              })}</div>
            </section>

            <details className="role-advanced-settings">
              <summary>הגדרות הקצאה מתקדמות</summary>
              <div className="role-advanced-content">
                <label><input type="checkbox" checked={editForm.delegable} onChange={event => setEditForm(previous => ({ ...previous, delegable: event.target.checked, assignableBy: event.target.checked ? previous.assignableBy : [] }))} /> ניתן להקצאה על ידי מנהלי הרשאות מורשים</label>
                <label><input type="checkbox" checked={editForm.defaultForInvites} onChange={event => setEditForm(previous => ({ ...previous, defaultForInvites: event.target.checked }))} /> תפקיד ברירת מחדל למוזמנים</label>
                {editForm.delegable && <div className="role-assignee-grid"><label><input type="checkbox" checked={editForm.assignableBy.length === 0} onChange={() => setEditForm(previous => ({ ...previous, assignableBy: [] }))} /> כל מנהל הרשאות מורשה</label>{staff.filter(user => !['principal', 'institution_manager', 'global_admin', 'platform_admin'].includes(user.role)).map(user => <label key={user.id}><input type="checkbox" checked={editForm.assignableBy.includes(user.id)} onChange={event => setEditForm(previous => ({ ...previous, assignableBy: event.target.checked ? [...new Set([...previous.assignableBy, user.id])] : previous.assignableBy.filter(id => id !== user.id) }))} /> {user.fullName || user.email}</label>)}</div>}
              </div>
            </details>

            <div className="modal-actions role-form-actions"><button className="btn btn-primary" disabled={saving} onClick={saveRole}><Save size={15} /> {saving ? 'שומר…' : editingRole ? 'שמירת שינויים' : 'יצירת תפקיד'}</button><button className="btn btn-secondary" onClick={() => setShowForm(false)}>ביטול</button></div>
          </div>}
        </div>
      </div>
    </div>
  );
}
