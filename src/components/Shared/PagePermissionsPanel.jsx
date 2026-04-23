import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../firebase';
import {
  collection, getDocs, query, where, doc, updateDoc, getDoc
} from 'firebase/firestore';
import { Shield, X, Eye, Edit3, ChevronDown, ChevronUp, Users, Check } from 'lucide-react';

const FEATURE_LABELS = {
  calendar:    { label: 'לוח שנה',       view: 'calendar_view',    edit: 'calendar_edit' },
  categories:  { label: 'קטגוריות',      view: 'categories_view',  edit: 'categories_edit' },
  staff:       { label: 'סגל וקהילה',    view: 'staff_view',       edit: 'staff_edit' },
  tasks:       { label: 'משימות',         view: 'tasks_view',       edit: 'tasks_edit' },
  files:       { label: 'קבצים',          view: 'files_view',       edit: 'files_upload' },
  teams:       { label: 'צוותים',         view: 'teams_view',       edit: 'teams_edit' },
  messages:    { label: 'הודעות',         view: null,               edit: 'messages_send' },
  holidays:    { label: 'חגים וחופשות',  view: 'holidays_view',    edit: 'holidays_edit' },
};

const ROLE_LABELS = {
  global_admin: 'מנהל על',
  principal: 'מנהל מוסד',
  editor: 'עורך',
  viewer: 'צופה',
};

export default function PagePermissionsPanel({ feature, onClose }) {
  const { userData, selectedSchool, isGlobalAdmin, isPrincipal } = useAuth();
  const [staff, setStaff] = useState([]);
  const [saving, setSaving] = useState(null);
  const [saved, setSaved] = useState(null);
  const [search, setSearch] = useState('');
  const panelRef = useRef(null);

  const canManage = isGlobalAdmin() || isPrincipal();
  const schoolId = selectedSchool || userData?.schoolId;
  const featureMeta = FEATURE_LABELS[feature] || {};

  useEffect(() => {
    if (!schoolId) return;
    loadStaff();
  }, [schoolId]);

  useEffect(() => {
    function onOutside(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [onClose]);

  async function loadStaff() {
    try {
      const q1 = query(collection(db, 'users'), where('schoolIds', 'array-contains', schoolId));
      const q2 = query(collection(db, 'users'), where('schoolId', '==', schoolId));
      const [s1, s2] = await Promise.all([getDocs(q1), getDocs(q2)]);
      const map = new Map();
      s1.docs.forEach(d => map.set(d.id, { id: d.id, ...d.data() }));
      s2.docs.forEach(d => { if (!map.has(d.id)) map.set(d.id, { id: d.id, ...d.data() }); });
      const all = Array.from(map.values()).filter(u =>
        u.role !== 'global_admin' && !u.pendingSchools?.includes(schoolId)
      );
      setStaff(all);
    } catch (err) {
      console.error('PagePermissionsPanel load error:', err);
    }
  }

  async function togglePerm(user, permKey, currentVal) {
    setSaving(`${user.id}_${permKey}`);
    try {
      const userRef = doc(db, 'users', user.id);
      const snap = await getDoc(userRef);
      const existing = snap.data()?.permissions || {};
      await updateDoc(userRef, {
        permissions: { ...existing, [permKey]: !currentVal }
      });
      setStaff(prev => prev.map(u => u.id === user.id
        ? { ...u, permissions: { ...(u.permissions || {}), [permKey]: !currentVal } }
        : u
      ));
      setSaved(`${user.id}_${permKey}`);
      setTimeout(() => setSaved(null), 1200);
    } catch (err) {
      console.error('Error toggling permission:', err);
    }
    setSaving(null);
  }

  function getEffectivePerm(user, permKey) {
    if (!permKey) return true;
    if (user.role === 'principal') return true;
    const override = user.permissions?.[permKey];
    if (override !== undefined) return override;
    // viewer default: _view = true, _edit = false
    return permKey.endsWith('_view') || permKey === 'messages_send';
  }

  const filtered = staff.filter(u => {
    if (!search) return true;
    return (u.fullName || '').toLowerCase().includes(search.toLowerCase()) ||
           (u.email || '').toLowerCase().includes(search.toLowerCase());
  });

  if (!canManage) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9998,
      background: 'rgba(0,0,0,0.25)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div ref={panelRef} style={{
        background: '#fff', borderRadius: 14,
        boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
        width: 560, maxHeight: '80vh',
        display: 'flex', flexDirection: 'column',
        direction: 'rtl', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '1rem 1.25rem', borderBottom: '1px solid #f1f5f9',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Shield size={18} color="#3b82f6" />
            <span style={{ fontWeight: 700, fontSize: '1rem' }}>
              הרשאות — {featureMeta.label}
            </span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 6, color: '#64748b' }}>
            <X size={18} />
          </button>
        </div>

        {/* Legend */}
        <div style={{
          padding: '0.5rem 1.25rem', background: '#f8fafc',
          borderBottom: '1px solid #f1f5f9',
          display: 'flex', gap: '1.5rem', fontSize: '0.78rem', color: '#64748b',
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Eye size={13} color="#64748b" /> צפייה
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Edit3 size={13} color="#64748b" /> עריכה
          </span>
          <span style={{ fontSize: '0.72rem', color: '#94a3b8', marginRight: 'auto' }}>
            מנהל מוסד — גישה מלאה תמיד
          </span>
        </div>

        {/* Search */}
        <div style={{ padding: '0.75rem 1.25rem', borderBottom: '1px solid #f1f5f9' }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="חיפוש לפי שם..."
            style={{
              width: '100%', padding: '0.45rem 0.75rem',
              border: '1px solid #e2e8f0', borderRadius: 8,
              fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>

        {/* User list */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {filtered.length === 0 && (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.88rem' }}>
              לא נמצאו משתמשים
            </div>
          )}
          {filtered.map(user => {
            const isPrinc = user.role === 'principal';
            const viewKey = featureMeta.view;
            const editKey = featureMeta.edit;
            const canView = getEffectivePerm(user, viewKey);
            const canEdit = getEffectivePerm(user, editKey);

            return (
              <div key={user.id} style={{
                padding: '0.65rem 1.25rem',
                borderBottom: '1px solid #f8fafc',
                display: 'flex', alignItems: 'center', gap: '0.75rem',
              }}>
                {/* Avatar */}
                <div style={{
                  width: 34, height: 34, borderRadius: '50%',
                  background: isPrinc ? '#dbeafe' : '#f1f5f9',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.85rem', fontWeight: 700, color: isPrinc ? '#2563eb' : '#475569',
                  flexShrink: 0,
                }}>
                  {user.fullName?.charAt(0) || '?'}
                </div>

                {/* Name + role */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {user.fullName}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                    {user.jobTitle || ROLE_LABELS[user.role] || 'צופה'}
                  </div>
                </div>

                {/* Permission toggles */}
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  {viewKey && (
                    <PermToggle
                      label="צפייה"
                      icon={<Eye size={13} />}
                      active={isPrinc || canView}
                      disabled={isPrinc}
                      loading={saving === `${user.id}_${viewKey}`}
                      justSaved={saved === `${user.id}_${viewKey}`}
                      onChange={() => !isPrinc && togglePerm(user, viewKey, canView)}
                    />
                  )}
                  {editKey && (
                    <PermToggle
                      label="עריכה"
                      icon={<Edit3 size={13} />}
                      active={isPrinc || canEdit}
                      disabled={isPrinc}
                      loading={saving === `${user.id}_${editKey}`}
                      justSaved={saved === `${user.id}_${editKey}`}
                      onChange={() => !isPrinc && togglePerm(user, editKey, canEdit)}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{
          padding: '0.75rem 1.25rem', borderTop: '1px solid #f1f5f9',
          background: '#f8fafc', fontSize: '0.76rem', color: '#94a3b8', textAlign: 'center',
        }}>
          שינויים נשמרים מיידית וייכנסו לתוקף בכניסה הבאה של המשתמש
        </div>
      </div>
    </div>
  );
}

function PermToggle({ label, icon, active, disabled, loading, justSaved, onChange }) {
  return (
    <button
      onClick={onChange}
      disabled={disabled || loading}
      title={label}
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '0.3rem 0.6rem', borderRadius: 6, border: 'none',
        cursor: disabled ? 'default' : 'pointer',
        fontSize: '0.75rem', fontWeight: 600,
        background: active ? (justSaved ? '#dcfce7' : '#eff6ff') : '#f1f5f9',
        color: active ? (justSaved ? '#16a34a' : '#2563eb') : '#94a3b8',
        transition: 'all 0.15s',
        opacity: loading ? 0.6 : 1,
        minWidth: 60,
      }}
    >
      {justSaved ? <Check size={13} /> : icon}
      {label}
    </button>
  );
}
