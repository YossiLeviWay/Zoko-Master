import { useState, useEffect, useRef } from 'react';
import { db } from '../../firebase';
import {
  collection, query, where, getDocs, doc, updateDoc, getDoc
} from 'firebase/firestore';
import { Shield, X, Check, Users, Save } from 'lucide-react';

// Maps nav path → Firestore permission key
export const PATH_TO_PERMISSION = {
  '/calendar':    'calendar_view',
  '/categories':  'categories_view',
  '/staff':       'staff_view',
  '/tasks':       'tasks_view',
  '/files':       'files_view',
  '/teams':       'teams_view',
  '/students':    'students_view',
  '/holidays':    'holidays_view',
  '/messages':    'messages_send',
  '/settings':    'settings_edit',
};

// Default view permission for each key (viewer defaults = all view = true)
const DEFAULT_ALLOWED = true;

export default function NavPermissionsPanel({ item, anchor, schoolId, onClose }) {
  const panelRef = useRef(null);
  const [staff, setStaff] = useState([]);
  const [permissions, setPermissions] = useState({}); // uid → bool
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const permKey = PATH_TO_PERMISSION[item.path];

  // Position panel near right-click anchor, keeping it in viewport
  const [pos, setPos] = useState({ top: anchor.y, right: window.innerWidth - anchor.x });
  useEffect(() => {
    if (!panelRef.current) return;
    const { height, width } = panelRef.current.getBoundingClientRect();
    let top = anchor.y;
    let left = anchor.x;
    if (top + height > window.innerHeight - 12) top = window.innerHeight - height - 12;
    if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12;
    if (top < 8) top = 8;
    if (left < 8) left = 8;
    setPos({ top, left });
  }, [anchor, loading]);

  // Load staff and their current permissions
  useEffect(() => {
    if (!schoolId || !permKey) { setLoading(false); return; }
    async function load() {
      setLoading(true);
      try {
        const results = [];
        const seen = new Set();
        const q1 = query(collection(db, 'users'), where('schoolIds', 'array-contains', schoolId));
        const snap1 = await getDocs(q1);
        snap1.docs.forEach(d => {
          if (!seen.has(d.id)) { seen.add(d.id); results.push({ id: d.id, ...d.data() }); }
        });
        const q2 = query(collection(db, 'users'), where('schoolId', '==', schoolId));
        const snap2 = await getDocs(q2);
        snap2.docs.forEach(d => {
          if (!seen.has(d.id)) { seen.add(d.id); results.push({ id: d.id, ...d.data() }); }
        });

        // Filter out global admins (they always have access)
        const filteredStaff = results.filter(u => u.role !== 'global_admin');
        setStaff(filteredStaff);

        // Build initial permission map
        const pmap = {};
        filteredStaff.forEach(u => {
          const perms = u.permissions || {};
          // principal/editor always allowed; for viewer check explicit perm or default
          if (u.role === 'principal' || u.role === 'editor') {
            pmap[u.id] = true;
          } else {
            pmap[u.id] = permKey in perms ? !!perms[permKey] : DEFAULT_ALLOWED;
          }
        });
        setPermissions(pmap);
      } catch (err) {
        console.error('Error loading staff for nav permissions:', err);
      }
      setLoading(false);
    }
    load();
  }, [schoolId, permKey]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose();
    }
    function handleKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  function toggle(uid) {
    const user = staff.find(u => u.id === uid);
    if (!user) return;
    // Principals and editors always have access — don't allow toggling for now
    if (user.role === 'principal') return;
    setPermissions(prev => ({ ...prev, [uid]: !prev[uid] }));
    setSaved(false);
  }

  async function save() {
    if (!permKey) return;
    setSaving(true);
    try {
      const updates = staff
        .filter(u => u.role !== 'principal')
        .map(u => {
          const currentPerms = u.permissions || {};
          return updateDoc(doc(db, 'users', u.id), {
            permissions: { ...currentPerms, [permKey]: !!permissions[u.id] }
          });
        });
      await Promise.all(updates);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      alert('שגיאה בשמירה: ' + err.message);
    }
    setSaving(false);
  }

  if (!permKey) return null;

  const allowedCount = Object.values(permissions).filter(Boolean).length;

  return (
    <div
      ref={panelRef}
      className="nav-perm-panel"
      style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}
      onClick={e => e.stopPropagation()}
    >
      <div className="nav-perm-header">
        <Shield size={14} />
        <span>הרשאות גישה — {item.label}</span>
        <button className="nav-perm-close" onClick={onClose}><X size={14} /></button>
      </div>

      <div className="nav-perm-summary">
        <Users size={12} />
        <span>{allowedCount} מתוך {staff.length} בעלי גישה</span>
      </div>

      {loading ? (
        <div className="nav-perm-loading">טוען...</div>
      ) : (
        <div className="nav-perm-list">
          {staff.length === 0 && (
            <div className="nav-perm-empty">אין משתמשים בבית ספר זה</div>
          )}
          {staff.map(user => {
            const allowed = !!permissions[user.id];
            const isPrincipal = user.role === 'principal';
            return (
              <div
                key={user.id}
                className={`nav-perm-item ${allowed ? 'nav-perm-item--allowed' : 'nav-perm-item--blocked'} ${isPrincipal ? 'nav-perm-item--fixed' : ''}`}
                onClick={() => !isPrincipal && toggle(user.id)}
                title={isPrincipal ? 'מנהל מוסד — תמיד בעל גישה' : (allowed ? 'לחץ לחסימה' : 'לחץ לאישור גישה')}
              >
                <div className={`nav-perm-check ${allowed ? 'nav-perm-check--on' : ''}`}>
                  {allowed && <Check size={10} />}
                </div>
                <div className="nav-perm-user-info">
                  <span className="nav-perm-avatar">{user.fullName?.charAt(0) || '?'}</span>
                  <div>
                    <span className="nav-perm-name">{user.fullName || user.email}</span>
                    <span className="nav-perm-role">{user.jobTitle || user.role}</span>
                  </div>
                </div>
                {isPrincipal && <span className="nav-perm-locked">קבוע</span>}
              </div>
            );
          })}
        </div>
      )}

      <div className="nav-perm-footer">
        <button
          className="btn btn-primary btn-sm"
          onClick={save}
          disabled={saving}
          style={{ width: '100%', justifyContent: 'center' }}
        >
          <Save size={13} />
          {saving ? 'שומר...' : saved ? '✓ נשמר' : 'שמירת הרשאות'}
        </button>
        <p className="nav-perm-hint">השינויים יכנסו לתוקף בכניסה הבאה של המשתמש</p>
      </div>
    </div>
  );
}
