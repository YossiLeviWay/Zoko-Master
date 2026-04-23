import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../firebase';
import { collection, getDocs, query, where, doc, updateDoc, getDoc, setDoc } from 'firebase/firestore';
import { Shield, Eye, Edit3, Users, X, ChevronDown } from 'lucide-react';

/**
 * PermissionsMenu - A shared right-click / button permissions component
 * Used to grant view/edit permissions on specific resources (files, mappings, calendar items, etc.)
 *
 * Props:
 * - resourceType: 'file' | 'mapping' | 'folder' | 'calendar' | 'task'
 * - resourceId: unique ID of the resource
 * - resourceName: display name
 * - schoolId: school context
 * - onClose: callback to close the menu
 * - position: { x, y } for absolute positioning (optional)
 * - anchorRef: ref for relative positioning (optional)
 */
export default function PermissionsMenu({ resourceType, resourceId, resourceName, schoolId, onClose, position }) {
  const { userData, isGlobalAdmin, isPrincipal } = useAuth();
  const [staff, setStaff] = useState([]);
  const [teams, setTeams] = useState([]);
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState({ viewers: [], editors: [], viewerTeams: [], editorTeams: [], public: true });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('view'); // view, edit
  const [searchQuery, setSearchQuery] = useState('');
  const menuRef = useRef(null);

  const canManage = isGlobalAdmin() || isPrincipal();
  if (!canManage) return null;

  useEffect(() => {
    loadData();
  }, [schoolId, resourceId]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  async function loadData() {
    setLoading(true);
    try {
      // Load staff
      const q1 = query(collection(db, 'users'), where('schoolIds', 'array-contains', schoolId));
      const snap1 = await getDocs(q1);
      const staffMap = new Map();
      snap1.docs.forEach(d => staffMap.set(d.id, { id: d.id, ...d.data() }));
      const q2 = query(collection(db, 'users'), where('schoolId', '==', schoolId));
      const snap2 = await getDocs(q2);
      snap2.docs.forEach(d => { if (!staffMap.has(d.id)) staffMap.set(d.id, { id: d.id, ...d.data() }); });
      setStaff(Array.from(staffMap.values()));

      // Load teams
      const teamSnap = await getDocs(collection(db, `teams_${schoolId}`));
      setTeams(teamSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      // Load custom roles
      const rolesSnap = await getDocs(collection(db, `roles_${schoolId}`));
      setRoles(rolesSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      // Load existing permissions for this resource
      const permDoc = await getDoc(doc(db, 'resource_permissions', `${resourceType}_${resourceId}`));
      if (permDoc.exists()) {
        setPermissions({ ...permissions, ...permDoc.data() });
      }
    } catch (err) {
      console.error('Error loading permissions data:', err);
    }
    setLoading(false);
  }

  async function savePermissions() {
    try {
      await setDoc(doc(db, 'resource_permissions', `${resourceType}_${resourceId}`), {
        ...permissions,
        resourceType,
        resourceId,
        resourceName,
        schoolId,
        updatedAt: new Date().toISOString(),
        updatedBy: userData?.uid || '',
      });
      onClose();
    } catch (err) {
      console.error('Error saving permissions:', err);
    }
  }

  function toggleUser(userId, type) {
    const key = type === 'view' ? 'viewers' : 'editors';
    setPermissions(prev => {
      const arr = prev[key] || [];
      return { ...prev, [key]: arr.includes(userId) ? arr.filter(id => id !== userId) : [...arr, userId] };
    });
  }

  function toggleTeam(teamId, type) {
    const key = type === 'view' ? 'viewerTeams' : 'editorTeams';
    setPermissions(prev => {
      const arr = prev[key] || [];
      return { ...prev, [key]: arr.includes(teamId) ? arr.filter(id => id !== teamId) : [...arr, teamId] };
    });
  }

  const filteredStaff = staff.filter(u => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (u.fullName || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q);
  });

  const menuStyle = position ? {
    position: 'fixed',
    top: position.y,
    left: position.x,
    zIndex: 9999,
  } : {};

  return (
    <div ref={menuRef} style={{
      ...menuStyle,
      background: '#fff',
      borderRadius: 10,
      boxShadow: '0 4px 24px rgba(0,0,0,0.15)',
      border: '1px solid #e2e8f0',
      width: 360,
      maxHeight: 500,
      overflow: 'auto',
      direction: 'rtl',
    }}>
      <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>
            <Shield size={14} style={{ display: 'inline', verticalAlign: 'middle', marginLeft: 4 }} />
            הרשאות — {resourceName}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{resourceType === 'file' ? 'קובץ' : resourceType === 'mapping' ? 'מיפוי' : resourceType === 'folder' ? 'תיקיה' : resourceType}</div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
          <X size={16} />
        </button>
      </div>

      {/* Public toggle */}
      <div style={{ padding: '0.5rem 1rem', borderBottom: '1px solid #f1f5f9' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={permissions.public}
            onChange={e => setPermissions(prev => ({ ...prev, public: e.target.checked }))}
          />
          גישה לכולם (ציבורי)
        </label>
      </div>

      {!permissions.public && (
        <>
          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid #f1f5f9' }}>
            <button
              onClick={() => setTab('view')}
              style={{
                flex: 1, padding: '0.5rem', border: 'none', cursor: 'pointer', fontSize: '0.8rem',
                background: tab === 'view' ? '#eff6ff' : '#fff', color: tab === 'view' ? '#3b82f6' : '#64748b',
                borderBottom: tab === 'view' ? '2px solid #3b82f6' : 'none',
              }}
            >
              <Eye size={13} style={{ display: 'inline', verticalAlign: 'middle', marginLeft: 4 }} />
              צפייה ({(permissions.viewers?.length || 0) + (permissions.viewerTeams?.length || 0)})
            </button>
            <button
              onClick={() => setTab('edit')}
              style={{
                flex: 1, padding: '0.5rem', border: 'none', cursor: 'pointer', fontSize: '0.8rem',
                background: tab === 'edit' ? '#eff6ff' : '#fff', color: tab === 'edit' ? '#3b82f6' : '#64748b',
                borderBottom: tab === 'edit' ? '2px solid #3b82f6' : 'none',
              }}
            >
              <Edit3 size={13} style={{ display: 'inline', verticalAlign: 'middle', marginLeft: 4 }} />
              עריכה ({(permissions.editors?.length || 0) + (permissions.editorTeams?.length || 0)})
            </button>
          </div>

          {/* Search */}
          <div style={{ padding: '0.5rem 1rem' }}>
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="חיפוש..."
              style={{ width: '100%', padding: '0.4rem 0.6rem', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: '0.8rem' }}
            />
          </div>

          {/* Teams */}
          {teams.length > 0 && (
            <div style={{ padding: '0 1rem 0.5rem' }}>
              <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginBottom: '0.3rem', fontWeight: 600 }}>צוותים</div>
              {teams.map(team => (
                <label key={team.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.2rem 0', fontSize: '0.8rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={(tab === 'view' ? permissions.viewerTeams : permissions.editorTeams)?.includes(team.id)}
                    onChange={() => toggleTeam(team.id, tab)}
                  />
                  <Users size={13} style={{ color: '#64748b' }} />
                  {team.name}
                  <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>({team.memberIds?.length || 0})</span>
                </label>
              ))}
            </div>
          )}

          {/* Users */}
          <div style={{ padding: '0 1rem 0.5rem', maxHeight: 200, overflowY: 'auto' }}>
            <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginBottom: '0.3rem', fontWeight: 600 }}>משתמשים</div>
            {loading ? (
              <div style={{ fontSize: '0.8rem', color: '#94a3b8', padding: '0.5rem 0' }}>טוען...</div>
            ) : filteredStaff.map(user => (
              <label key={user.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.2rem 0', fontSize: '0.8rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={(tab === 'view' ? permissions.viewers : permissions.editors)?.includes(user.id)}
                  onChange={() => toggleUser(user.id, tab)}
                />
                <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#e2e8f0', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', flexShrink: 0 }}>
                  {user.fullName?.charAt(0)}
                </span>
                {user.fullName}
              </label>
            ))}
          </div>
        </>
      )}

      {/* Save */}
      <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid #f1f5f9', display: 'flex', gap: '0.5rem' }}>
        <button onClick={savePermissions} style={{
          flex: 1, padding: '0.5rem', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600
        }}>
          שמירה
        </button>
        <button onClick={onClose} style={{
          padding: '0.5rem 1rem', background: '#f1f5f9', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.82rem'
        }}>
          ביטול
        </button>
      </div>
    </div>
  );
}

/**
 * Hook to check if current user has permission on a resource
 */
export function useResourcePermission(resourceType, resourceId) {
  const { userData, currentUser, isGlobalAdmin, isPrincipal } = useAuth();
  const [perm, setPerm] = useState({ canView: true, canEdit: false, loading: true });

  useEffect(() => {
    if (!currentUser || !resourceId) return;

    // Admin and principal have full access
    if (isGlobalAdmin() || isPrincipal()) {
      setPerm({ canView: true, canEdit: true, loading: false });
      return;
    }

    async function check() {
      try {
        const permDoc = await getDoc(doc(db, 'resource_permissions', `${resourceType}_${resourceId}`));
        if (!permDoc.exists() || permDoc.data().public) {
          // Public or no permissions set - use role-based defaults
          const role = userData?.role || 'viewer';
          setPerm({
            canView: true,
            canEdit: role === 'editor' || role === 'principal' || role === 'global_admin',
            loading: false
          });
          return;
        }
        const data = permDoc.data();
        const uid = currentUser.uid;
        const userTeamIds = userData?.teamIds || [];
        const inViewerTeam = (data.viewerTeams || []).some(t => userTeamIds.includes(t));
        const inEditorTeam = (data.editorTeams || []).some(t => userTeamIds.includes(t));
        const canView = data.viewers?.includes(uid) || data.editors?.includes(uid) || inViewerTeam || inEditorTeam;
        const canEdit = data.editors?.includes(uid) || inEditorTeam;
        setPerm({ canView, canEdit, loading: false });
      } catch {
        setPerm({ canView: true, canEdit: false, loading: false });
      }
    }
    check();
  }, [currentUser, resourceId, resourceType]);

  return perm;
}
