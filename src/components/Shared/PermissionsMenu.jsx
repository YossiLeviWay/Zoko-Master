import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { Ban, Edit3, Eye, MessageSquare, Settings2, Shield, Users, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../firebase';
import { usePermissions } from '../../hooks/usePermissions';
import { removeResourceAcl, upsertResourceAcl } from '../../services/adminUserService';
import './PermissionsMenu.css';

const ACCESS_TABS = Object.freeze([
  { id: 'view', label: 'צפייה', Icon: Eye }, { id: 'comment', label: 'תגובה', Icon: MessageSquare },
  { id: 'edit', label: 'עריכה', Icon: Edit3 }, { id: 'manage', label: 'ניהול ושיתוף', Icon: Settings2 },
  { id: 'deny', label: 'חסימה', Icon: Ban },
]);

function entryKey(principalType, principalId) { return `${principalType}:${principalId}`; }
function optionalSnapshot(promise) { return promise.catch(() => ({ docs: [] })); }

export default function PermissionsMenu({ resourceType, resourceId, resourceName, schoolId, onClose, position }) {
  const { isGlobalAdmin, isPrincipal } = useAuth();
  const { permissions } = usePermissions();
  const [staff, setStaff] = useState([]);
  const [teams, setTeams] = useState([]);
  const [roles, setRoles] = useState([]);
  const [classes, setClasses] = useState([]);
  const [existing, setExisting] = useState([]);
  const [entries, setEntries] = useState({});
  const [tab, setTab] = useState('view');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const menuRef = useRef(null);
  const requiredCapability = resourceType === 'task'
    ? 'tasks.managePermissions'
    : 'files.managePermissions';
  const canManage = isGlobalAdmin() || isPrincipal() || permissions[requiredCapability] === true;

  useEffect(() => {
    function outside(event) { if (menuRef.current && !menuRef.current.contains(event.target)) onClose(); }
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [onClose]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [primary, memberships, teamSnapshot, roleSnapshot, nestedRoleSnapshot, classSnapshot, nestedClassSnapshot, aclSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'users'), where('schoolId', '==', schoolId))),
        getDocs(query(collection(db, 'users'), where('schoolIds', 'array-contains', schoolId))),
        optionalSnapshot(getDocs(collection(db, `teams_${schoolId}`))),
        optionalSnapshot(getDocs(collection(db, `roles_${schoolId}`))),
        optionalSnapshot(getDocs(collection(db, 'schools', schoolId, 'roleDefinitions'))),
        optionalSnapshot(getDocs(collection(db, `classes_${schoolId}`))),
        optionalSnapshot(getDocs(collection(db, 'schools', schoolId, 'classes'))),
        getDocs(query(
          collection(db, 'schools', schoolId, 'resourceAcls'),
          where('resourceType', '==', resourceType), where('resourceId', '==', resourceId),
        )),
      ]);
      const users = new Map();
      [...primary.docs, ...memberships.docs].forEach(item => users.set(item.id, { id: item.id, ...item.data() }));
      setStaff([...users.values()].filter(user => user.accountStatus !== 'disabled'));
      setTeams(teamSnapshot.docs.map(item => ({ id: item.id, ...item.data() })));
      const roleItems = new Map();
      [...roleSnapshot.docs, ...nestedRoleSnapshot.docs].forEach(item => roleItems.set(item.id, /** @type {any} */ ({ id: item.id, ...item.data() })));
      setRoles([...roleItems.values()].filter(role => role.status !== 'archived'));
      const classItems = new Map();
      [...classSnapshot.docs, ...nestedClassSnapshot.docs].forEach(item => classItems.set(item.id, { id: item.id, ...item.data() }));
      setClasses([...classItems.values()].filter(item => item.status !== 'archived'));
      const aclItems = aclSnapshot.docs.map(item => /** @type {any} */ ({ id: item.id, ...item.data() })).filter(item => item.active !== false);
      setExisting(aclItems);
      setEntries(Object.fromEntries(aclItems.map(item => [entryKey(item.principalType, item.principalId), {
        aclId: item.id,
        principalType: item.principalType,
        principalId: item.principalId,
        accessLevel: item.accessLevel,
        explicitDeny: item.explicitDeny === true,
        inherit: item.inherit !== false,
      }])));
    } catch { setError('לא ניתן לטעון את הרשאות המשאב.'); }
    finally { setLoading(false); }
  }, [resourceId, resourceType, schoolId]);

  useEffect(() => { load(); }, [load]);

  function toggle(principalType, principalId) {
    const key = entryKey(principalType, principalId);
    setEntries(previous => {
      const current = previous[key];
      const requested = { accessLevel: tab === 'deny' ? 'view' : tab, explicitDeny: tab === 'deny' };
      if (current && current.accessLevel === requested.accessLevel && current.explicitDeny === requested.explicitDeny) {
        const next = { ...previous }; delete next[key]; return next;
      }
      return { ...previous, [key]: { ...current, principalType, principalId, ...requested, inherit: true } };
    });
  }

  function selected(principalType, principalId) {
    const current = entries[entryKey(principalType, principalId)];
    return Boolean(current && (tab === 'deny' ? current.explicitDeny : !current.explicitDeny && current.accessLevel === tab));
  }

  async function save() {
    setSaving(true); setError('');
    try {
      const nextEntries = Object.values(entries);
      const removed = existing.filter(item => !entries[entryKey(item.principalType, item.principalId)]);
      await Promise.all([
        ...removed.map(item => removeResourceAcl({ schoolId, aclId: item.id })),
        ...nextEntries.map(item => upsertResourceAcl({
          schoolId,
          aclId: item.aclId,
          resourceType,
          resourceId,
          principalType: item.principalType,
          principalId: item.principalId,
          accessLevel: item.accessLevel,
          explicitDeny: item.explicitDeny,
          inherit: item.inherit,
          expiresAt: null,
        })),
      ]);
      onClose();
    } catch { setError('שמירת ההרשאות נדחתה. ודאו שיש לכם הרשאת ניהול ושכל המשתמשים שייכים למוסד.'); }
    finally { setSaving(false); }
  }

  const people = useMemo(() => staff.filter(user => {
    const value = `${user.fullName || ''} ${user.email || ''}`.toLowerCase();
    return !search || value.includes(search.toLowerCase());
  }), [search, staff]);
  if (!canManage) return null;

  return <div ref={menuRef} className="resource-acl-menu" style={position ? { position: 'fixed', top: position.y, left: position.x } : undefined}>
    <header><div><Shield size={15} /><strong>הרשאות — {resourceName}</strong><small>{resourceType === 'file' ? 'קובץ' : resourceType === 'folder' ? 'תיקייה' : 'משאב'}</small></div><button onClick={onClose} aria-label="סגירה"><X size={16} /></button></header>
    <div className="resource-acl-warning">לאחר הוספת הרשאה ראשונה, ברירת המחדל למשאב היא חסימה. חסימה מפורשת קודמת להרשאות אחרות.</div>
    <div className="resource-acl-tabs" role="tablist">{ACCESS_TABS.map(({ id, label, Icon }) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon size={13} /> {label}</button>)}</div>
    {error && <div className="resource-acl-error" role="alert">{error}</div>}
    <input className="resource-acl-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="חיפוש איש צוות" aria-label="חיפוש איש צוות" />
    <div className="resource-acl-content">{loading ? <p>טוען…</p> : <>
      <section><h4><Users size={13} /> אנשי צוות</h4>{people.map(user => <label key={user.id}><input type="checkbox" checked={selected('user', user.id)} onChange={() => toggle('user', user.id)} /><span>{user.fullName || user.email}</span></label>)}</section>
      {teams.length > 0 && <section><h4>צוותים</h4>{teams.map(team => <label key={team.id}><input type="checkbox" checked={selected('team', team.id)} onChange={() => toggle('team', team.id)} /><span>{team.name}</span></label>)}</section>}
      {roles.length > 0 && <section><h4>תפקידים</h4>{roles.map(role => <label key={role.id}><input type="checkbox" checked={selected('role', role.id)} onChange={() => toggle('role', role.id)} /><span>{role.name}</span></label>)}</section>}
      {classes.length > 0 && <section><h4>כיתות</h4>{classes.map(item => <label key={item.id}><input type="checkbox" checked={selected('class', item.id)} onChange={() => toggle('class', item.id)} /><span>{item.name}</span></label>)}</section>}
    </>}</div>
    <footer><button className="btn btn-primary btn-sm" disabled={saving || loading} onClick={save}>{saving ? 'שומר…' : 'שמירת הרשאות'}</button><button className="btn btn-secondary btn-sm" onClick={onClose}>ביטול</button></footer>
  </div>;
}
