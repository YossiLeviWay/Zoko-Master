import { aclActions } from '../../../functions/src/resourceActions.js';
import '../Access/SimpleAccess.css';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  const [candidate, setCandidate] = useState('');
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
    function outside(event) { if (!saving && menuRef.current && !menuRef.current.contains(event.target)) onClose(); }
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [onClose, saving]);

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
        ...(item.actions ? { actions: item.actions } : {}),
        expiresAt: item.expiresAt?.toDate?.().toISOString() || item.expiresAt || null,
        explicitDeny: item.explicitDeny === true,
        inherit: item.inherit !== false,
      }])));
    } catch { setError('לא ניתן לטעון את הרשאות המשאב.'); }
    finally { setLoading(false); }
  }, [resourceId, resourceType, schoolId]);

  useEffect(() => { load(); }, [load]);

  function addRecipient() {
    if (!candidate) return;
    const [principalType, ...parts] = candidate.split(':');
    const principalId = parts.join(':');
    setEntries(previous => ({ ...previous, [candidate]: previous[candidate] || { principalType, principalId, accessLevel: 'view', actions: ['view'], explicitDeny: false, inherit: true, expiresAt: null } }));
    setCandidate('');
  }
  function changeEntry(key, patch) { setEntries(previous => ({ ...previous, [key]: { ...previous[key], ...patch } })); }
  function toggleAction(key, action) {
    const actions = aclActions(entries[key]);
    changeEntry(key, { actions: actions.includes(action) ? actions.filter(item => item !== action) : [...actions, action] });
  }
  async function save() {
    setSaving(true); setError('');
    try {
      const nextEntries = Object.values(entries);
      const removed = existing.filter(item => !entries[entryKey(item.principalType, item.principalId)]);
      for (const item of nextEntries.filter(item => { const old = existing.find(acl => acl.id === item.aclId); return !old || JSON.stringify(aclActions(old)) !== JSON.stringify(aclActions(item)) || (old.explicitDeny === true) !== item.explicitDeny || (old.inherit !== false) !== item.inherit; })) await upsertResourceAcl({
          schoolId,
          aclId: item.aclId,
          resourceType,
          resourceId,
          principalType: item.principalType,
          principalId: item.principalId,
          accessLevel: item.accessLevel,
          ...(item.actions ? { actions: item.actions } : {}),
          explicitDeny: item.explicitDeny,
          inherit: item.inherit,
          expiresAt: item.expiresAt,
        });
      for (const item of removed) await removeResourceAcl({ schoolId, aclId: item.id });
      window.dispatchEvent(new Event('access-sharing-changed'));
      onClose();
    } catch { await load(); setError('חלק מהשינויים עשויים להישמר. הגישה נטענה מחדש; בדקו אותה לפני ניסיון נוסף.'); }
    finally { setSaving(false); }
  }

  const recipients = [
    ...staff.map(item => ({ type: 'user', id: item.id, name: item.fullName || item.email })),
    ...teams.map(item => ({ type: 'team', id: item.id, name: `צוות: ${item.name}` })),
    ...roles.map(item => ({ type: 'role', id: item.id, name: `תפקיד: ${item.name}` })),
    ...classes.map(item => ({ type: 'class', id: item.id, name: `כיתה: ${item.name}` })),
  ];
  if (!canManage) return null;
  return <div className="modal-overlay access-overlay"><section ref={menuRef} className="simple-access-dialog" role="dialog" aria-modal="true" aria-label={`שיתוף — ${resourceName}`} dir="rtl">
    <header><h3>שיתוף — {resourceName}</h3><button type="button" onClick={onClose} disabled={saving} aria-label="סגירה">×</button></header>
    <div className="access-dialog-body">
      {error && <p className="access-error" role="alert">{error}</p>}
      <p>מי מקבל גישה לתוכן הזה?</p>
      <input aria-label="חיפוש משתתף" placeholder="חיפוש אדם, צוות או תפקיד…" value={search} onChange={event => setSearch(event.target.value)} />
      <select aria-label="משתתף חדש" value={candidate} disabled={loading || saving} onChange={event => setCandidate(event.target.value)}><option value="">בחירת משתתף…</option>{recipients.filter(item => item.name?.includes(search) && !entries[entryKey(item.type, item.id)]).map(item => <option key={entryKey(item.type, item.id)} value={entryKey(item.type, item.id)}>{item.name}</option>)}</select>
      <button type="button" className="btn btn-secondary" disabled={!candidate || saving} onClick={addRecipient}>הוספה לשיתוף</button>
      {loading ? <p role="status">טוען…</p> : Object.entries(entries).map(([key, entry]) => <fieldset key={key} style={{ marginTop: 16, border: '1px solid #e4e8ec', borderRadius: 12, padding: 14 }}><legend>{recipients.find(item => entryKey(item.type, item.id) === key)?.name || 'משתתף קיים'}</legend><div className="access-action-row"><span>{entry.explicitDeny ? 'חסום' : 'צפייה'}</span>{((resourceType === 'folder' || resourceId.startsWith('gradebook_')) ? [['create', 'הוספה'], ['edit', 'עריכה']] : [['edit', 'עריכה']]).map(([action, label]) => <label key={action}><input type="checkbox" disabled={saving || entry.explicitDeny} checked={aclActions(entry).includes(action)} onChange={() => toggleAction(key, action)} />{label}</label>)}</div><details><summary>אפשרויות מתקדמות</summary>{[['comment', 'תגובות'], ['delete', 'מחיקה'], ['manage', 'ניהול שיתוף']].map(([action, label]) => <label className="access-check" key={action}><input type="checkbox" disabled={saving || entry.explicitDeny} checked={aclActions(entry).includes(action)} onChange={() => toggleAction(key, action)} />{label}</label>)}<label className="access-check"><input type="checkbox" disabled={saving} checked={entry.explicitDeny} onChange={event => changeEntry(key, { explicitDeny: event.target.checked })} />חסימה מפורשת</label><label className="access-check"><input type="checkbox" disabled={saving} checked={entry.inherit} onChange={event => changeEntry(key, { inherit: event.target.checked })} />העברת הגישה לתוכן בתוך התיקייה</label><button type="button" className="btn btn-secondary" disabled={saving} onClick={() => setEntries(previous => { const next = { ...previous }; delete next[key]; return next; })}>הסרה מהשיתוף</button></details></fieldset>)}
      <p className="access-hint">כאשר מוגדר שיתוף מוגבל, הגישה היא למשתתפים המורשים. מנהל המוסד שומר על גישה מלאה. הסרה מהשיתוף אינה מבטלת גישה מקבוצה אחרת.</p>
    </div><footer><button type="button" className="btn btn-primary" disabled={saving || loading} onClick={save}>{saving ? 'שומר…' : 'שמירת שיתוף'}</button><button type="button" className="btn btn-secondary" disabled={saving} onClick={onClose}>ביטול</button></footer>
  </section></div>;
}
