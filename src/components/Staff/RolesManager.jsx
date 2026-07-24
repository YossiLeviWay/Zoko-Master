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
  cloneCustomRole,
  createCustomRole,
  updateCustomRole,
} from '../../services/adminUserService';

const EMPTY_FORM = Object.freeze({
  name: '',
  description: '',
  permissions: {},
  delegatedPermissionKeys: [],
  accessScope: { type: 'school', classIds: [] },
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
  };
}

export default function RolesManager({ schoolId, onClose }) {
  const { isGlobalAdmin, isPrincipal } = useAuth();
  const { permissions } = usePermissions();
  const isAdmin = isGlobalAdmin() || isPrincipal();
  const [roles, setRoles] = useState([]);
  const [classes, setClasses] = useState([]);
  const [staff, setStaff] = useState([]);
  const [editingRole, setEditingRole] = useState(null);
  const [editForm, setEditForm] = useState(roleForm());
  const [expandedGroups, setExpandedGroups] = useState({});
  const [showForm, setShowForm] = useState(false);
  const [selectedAssignees, setSelectedAssignees] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const canView = isAdmin || permissions['roles.view'];
  const canCreate = isAdmin || permissions['roles.create'];
  const canUpdate = isAdmin || permissions['roles.update'];
  const canArchive = isAdmin || permissions['roles.archive'];
  const canAssign = isAdmin || permissions['roles.assign'];

  const loadData = useCallback(async () => {
    if (!schoolId || !canView) return;
    try {
      const [roleSnapshot, classSnapshot, staffByPrimary, staffByMembership] = await Promise.all([
        getDocs(schoolCollection(db, schoolId, 'roles')),
        getDocs(schoolCollection(db, schoolId, 'classes')),
        getDocs(query(collection(db, 'users'), where('schoolId', '==', schoolId))),
        getDocs(query(collection(db, 'users'), where('schoolIds', 'array-contains', schoolId))),
      ]);
      setRoles(roleSnapshot.docs.map(item => ({ id: item.id, ...item.data() })));
      setClasses(classSnapshot.docs.map(item => ({ id: item.id, ...item.data() })));
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
    setExpandedGroups(Object.fromEntries(PERMISSION_GROUPS.map(group => [group.id, true])));
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
    } catch {
      setError('הפעולה נדחתה. ניתן להעניק רק הרשאות שבבעלותך ושמותר לך להאציל.');
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

  if (!canView) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content roles-manager-modal" role="dialog" aria-modal="true" aria-label="תפקידים והרשאות" onClick={event => event.stopPropagation()}>
        <div className="modal-header"><h3>תפקידים והרשאות</h3><button className="modal-close" onClick={onClose} aria-label="סגירה"><X size={18} /></button></div>
        <div className="roles-manager-body">
          {error && <div className="staff-form-error" role="alert">{error}</div>}
          {message && <div className="students-feedback students-feedback--success" role="status">{message}</div>}
          {!showForm ? <>
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
            {!editingRole && <div className="role-presets"><span>התחלה מתפקיד מוצע:</span>{ROLE_PRESETS.map(preset => <button key={preset.name} className="btn btn-secondary btn-sm" onClick={() => applyPreset(preset)}>{preset.name}</button>)}</div>}
            <div className="student-form-grid"><label className="form-group">שם התפקיד<input value={editForm.name} onChange={event => setEditForm(previous => ({ ...previous, name: event.target.value }))} maxLength={120} /></label><label className="form-group">תיאור<input value={editForm.description} onChange={event => setEditForm(previous => ({ ...previous, description: event.target.value }))} maxLength={500} /></label></div>
            <fieldset className="students-choice-group"><legend>היקף ההרשאה</legend><div className="students-check-row"><label><input type="radio" checked={editForm.accessScope.type === 'school'} onChange={() => setEditForm(previous => ({ ...previous, accessScope: { type: 'school', classIds: [] } }))} /> כל המוסד</label><label><input type="radio" checked={editForm.accessScope.type === 'classes'} onChange={() => setEditForm(previous => ({ ...previous, accessScope: { type: 'classes', classIds: [] } }))} /> כיתות מסוימות</label></div>{editForm.accessScope.type === 'classes' && <div className="students-check-grid">{classes.map(item => <label key={item.id}><input type="checkbox" checked={editForm.accessScope.classIds.includes(item.id)} onChange={() => toggleScopeClass(item.id)} /> {item.name}</label>)}</div>}</fieldset>
            <div className="permissions-list">{PERMISSION_GROUPS.map(group => <section key={group.id} className="permissions-group"><button className="permissions-group-header" onClick={() => setExpandedGroups(previous => ({ ...previous, [group.id]: !previous[group.id] }))}><span className="permissions-group-title">{group.label}</span><span className="permissions-group-summary">{group.permissions.filter(([key]) => editForm.permissions[key]).length}/{group.permissions.length}</span>{expandedGroups[group.id] ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>{expandedGroups[group.id] && <div className="permissions-group-items">{group.permissions.map(([key, label]) => <div key={key} className="permission-delegation-row"><label className="permissions-item"><input type="checkbox" checked={Boolean(editForm.permissions[key])} onChange={() => togglePermission(key)} /><span>{label}</span></label><label className="permission-delegable"><input type="checkbox" disabled={!editForm.permissions[key]} checked={editForm.delegatedPermissionKeys.includes(key)} onChange={() => toggleDelegable(key)} /> ניתן להאצלה</label></div>)}</div>}</section>)}</div>
            <div className="modal-actions"><button className="btn btn-primary" disabled={saving} onClick={saveRole}><Save size={15} /> {editingRole ? 'שמירת שינויים' : 'יצירת תפקיד'}</button><button className="btn btn-secondary" onClick={() => setShowForm(false)}>ביטול</button></div>
          </div>}
        </div>
      </div>
    </div>
  );
}
