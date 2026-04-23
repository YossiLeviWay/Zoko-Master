import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../firebase';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { X, Plus, Save, Trash2, Edit3, Shield, ChevronDown, ChevronUp } from 'lucide-react';

const DEFAULT_ROLE_PERMISSIONS = {
  calendar_view: false,
  calendar_edit: false,
  categories_view: false,
  categories_edit: false,
  staff_view: false,
  staff_edit: false,
  tasks_view: false,
  tasks_edit: false,
  tasks_assign: false,
  teams_view: false,
  teams_edit: false,
  files_view: false,
  files_upload: false,
  files_delete: false,
  messages_send: false,
  messages_delete: false,
  holidays_view: false,
  holidays_edit: false,
  data_mapping_view: false,
  data_mapping_edit: false,
  schools_manage: false,
  settings_edit: false,
};

const PERMISSION_GROUPS = [
  { label: 'דשבורד', permissions: [] },
  { label: 'לוח שנה', permissions: [
    { key: 'calendar_view', label: 'צפייה בלוח שנה' },
    { key: 'calendar_edit', label: 'עריכת אירועים' },
  ]},
  { label: 'קטגוריות', permissions: [
    { key: 'categories_view', label: 'צפייה בקטגוריות' },
    { key: 'categories_edit', label: 'עריכת קטגוריות' },
  ]},
  { label: 'סגל וקהילה', permissions: [
    { key: 'staff_view', label: 'צפייה בסגל' },
    { key: 'staff_edit', label: 'עריכת סגל והרשאות' },
  ]},
  { label: 'משימות', permissions: [
    { key: 'tasks_view', label: 'צפייה במשימות' },
    { key: 'tasks_edit', label: 'יצירה ועריכת משימות' },
    { key: 'tasks_assign', label: 'הקצאת משימות לאחרים' },
  ]},
  { label: 'צוותים', permissions: [
    { key: 'teams_view', label: 'צפייה בצוותים' },
    { key: 'teams_edit', label: 'ניהול צוותים' },
  ]},
  { label: 'קבצים', permissions: [
    { key: 'files_view', label: 'צפייה בקבצים' },
    { key: 'files_upload', label: 'העלאת קבצים' },
    { key: 'files_delete', label: 'מחיקת קבצים' },
  ]},
  { label: 'הודעות', permissions: [
    { key: 'messages_send', label: 'שליחת הודעות' },
    { key: 'messages_delete', label: 'מחיקת הודעות' },
  ]},
  { label: 'חגים וחופשות', permissions: [
    { key: 'holidays_view', label: 'צפייה בחגים' },
    { key: 'holidays_edit', label: 'עריכת חגים' },
  ]},
  { label: 'מיפוי נתונים', permissions: [
    { key: 'data_mapping_view', label: 'צפייה במיפוי' },
    { key: 'data_mapping_edit', label: 'עריכת מיפוי נתונים' },
  ]},
];

export default function RolesManager({ schoolId, onClose }) {
  const { isGlobalAdmin, isPrincipal } = useAuth();
  const [roles, setRoles] = useState([]);
  const [editingRole, setEditingRole] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', description: '', permissions: { ...DEFAULT_ROLE_PERMISSIONS } });
  const [expandedGroups, setExpandedGroups] = useState({});
  const [showForm, setShowForm] = useState(false);

  const canManage = isGlobalAdmin() || isPrincipal();

  useEffect(() => {
    loadRoles();
  }, [schoolId]);

  async function loadRoles() {
    try {
      const snap = await getDocs(collection(db, `roles_${schoolId}`));
      setRoles(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('Error loading roles:', err);
    }
  }

  async function saveRole() {
    if (!editForm.name.trim()) return;
    try {
      if (editingRole) {
        await updateDoc(doc(db, `roles_${schoolId}`, editingRole.id), {
          name: editForm.name.trim(),
          description: editForm.description.trim(),
          permissions: editForm.permissions,
          updatedAt: new Date().toISOString(),
        });
      } else {
        await addDoc(collection(db, `roles_${schoolId}`), {
          name: editForm.name.trim(),
          description: editForm.description.trim(),
          permissions: editForm.permissions,
          createdAt: new Date().toISOString(),
        });
      }
      setEditingRole(null);
      setShowForm(false);
      setEditForm({ name: '', description: '', permissions: { ...DEFAULT_ROLE_PERMISSIONS } });
      loadRoles();
    } catch (err) {
      console.error('Error saving role:', err);
    }
  }

  async function deleteRole(roleId) {
    if (!confirm('האם למחוק תפקיד זה?')) return;
    try {
      await deleteDoc(doc(db, `roles_${schoolId}`, roleId));
      loadRoles();
    } catch (err) {
      console.error('Error deleting role:', err);
    }
  }

  function openEdit(role) {
    setEditingRole(role);
    setEditForm({
      name: role.name,
      description: role.description || '',
      permissions: { ...DEFAULT_ROLE_PERMISSIONS, ...role.permissions },
    });
    setShowForm(true);
    const expanded = {};
    PERMISSION_GROUPS.forEach(g => { expanded[g.label] = true; });
    setExpandedGroups(expanded);
  }

  function openNew() {
    setEditingRole(null);
    setEditForm({ name: '', description: '', permissions: { ...DEFAULT_ROLE_PERMISSIONS } });
    setShowForm(true);
    const expanded = {};
    PERMISSION_GROUPS.forEach(g => { expanded[g.label] = true; });
    setExpandedGroups(expanded);
  }

  function togglePerm(key) {
    setEditForm(prev => ({
      ...prev,
      permissions: { ...prev.permissions, [key]: !prev.permissions[key] }
    }));
  }

  if (!canManage) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 700, maxHeight: '85vh', overflow: 'auto' }}>
        <div className="modal-header">
          <h3>ניהול תפקידים</h3>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        {!showForm ? (
          <div style={{ padding: '1rem 1.5rem' }}>
            <button className="btn btn-primary" onClick={openNew} style={{ marginBottom: '1rem' }}>
              <Plus size={16} />
              תפקיד חדש
            </button>

            {roles.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                <Shield size={36} style={{ opacity: 0.3 }} />
                <p>לא הוגדרו תפקידים מותאמים. צור תפקיד חדש כדי להתחיל.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {roles.map(role => {
                  const permCount = Object.values(role.permissions || {}).filter(Boolean).length;
                  return (
                    <div key={role.id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '0.75rem 1rem', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fafafa'
                    }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{role.name}</div>
                        {role.description && <div style={{ fontSize: '0.78rem', color: '#64748b' }}>{role.description}</div>}
                        <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.2rem' }}>
                          {permCount} הרשאות פעילות
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '0.3rem' }}>
                        <button className="icon-btn" onClick={() => openEdit(role)} title="עריכה">
                          <Edit3 size={15} />
                        </button>
                        <button className="icon-btn icon-btn--danger" onClick={() => deleteRole(role.id)} title="מחיקה">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div style={{ padding: '1rem 1.5rem' }}>
            <div className="add-staff-form">
              <div className="form-group">
                <label>שם התפקיד</label>
                <input
                  value={editForm.name}
                  onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="לדוגמה: רכז חברתי"
                  required
                />
              </div>
              <div className="form-group">
                <label>תיאור</label>
                <input
                  value={editForm.description}
                  onChange={e => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="תיאור קצר של התפקיד"
                />
              </div>

              <div style={{ marginTop: '0.5rem' }}>
                <label style={{ fontWeight: 600, fontSize: '0.88rem', marginBottom: '0.5rem', display: 'block' }}>הרשאות</label>
                <div className="permissions-list">
                  {PERMISSION_GROUPS.filter(g => g.permissions.length > 0).map(group => (
                    <div key={group.label} className="permissions-group">
                      <button
                        className="permissions-group-header"
                        onClick={() => setExpandedGroups(prev => ({ ...prev, [group.label]: !prev[group.label] }))}
                      >
                        <span className="permissions-group-title">{group.label}</span>
                        <span className="permissions-group-summary">
                          {group.permissions.filter(p => editForm.permissions[p.key]).length}/{group.permissions.length}
                        </span>
                        {expandedGroups[group.label] ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                      {expandedGroups[group.label] && (
                        <div className="permissions-group-items">
                          {group.permissions.map(perm => (
                            <label key={perm.key} className="permissions-item">
                              <input
                                type="checkbox"
                                checked={!!editForm.permissions[perm.key]}
                                onChange={() => togglePerm(perm.key)}
                              />
                              <span>{perm.label}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="modal-actions" style={{ marginTop: '1rem' }}>
                <button className="btn btn-primary" onClick={saveRole}>
                  <Save size={15} />
                  {editingRole ? 'עדכון' : 'יצירה'}
                </button>
                <button className="btn btn-secondary" onClick={() => { setShowForm(false); setEditingRole(null); }}>ביטול</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
