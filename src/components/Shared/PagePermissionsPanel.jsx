import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { db, isAppCheckConfigured } from '../../firebase';
import {
  collection, getDocs, query, where
} from 'firebase/firestore';
import { callableReason, updateStaffUser } from '../../services/adminUserService';
import { Shield, X, Eye, Edit3, ChevronDown, ChevronUp, Users, Check } from 'lucide-react';

const FEATURE_LABELS = {
  calendar:    { label: 'לוח שנה',       view: 'calendar_view',    edit: 'calendar_edit', viewAlias: 'calendar.view', editAlias: 'calendar.edit' },
  categories:  { label: 'קטגוריות',      view: 'categories_view',  edit: 'categories_edit' },
  staff:       { label: 'סגל וקהילה',    view: 'staff_view',       edit: 'staff_edit' },
  tasks:       { label: 'משימות',         view: 'tasks_view',       edit: 'tasks_edit' },
  files:       { label: 'קבצים',          view: 'files_view',       edit: 'files_upload' },
  teams:       { label: 'צוותים',         view: 'teams_view',       edit: 'teams_edit' },
  students:    { label: 'כיתות ותלמידים', view: 'students_view',    edit: 'students_update' },
  messages:    { label: 'הודעות',         view: null,               edit: 'messages_send' },
  holidays:    { label: 'חגים וחופשות',  view: 'holidays_view',    edit: 'holidays_edit' },
  contacts:    { label: 'אנשי קשר',       view: 'contacts.view',    edit: 'contacts.edit', editExtra: ['contacts.create', 'contacts.archive'] },
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
  const [panelError, setPanelError] = useState('');
  const [search, setSearch] = useState('');
  const panelRef = useRef(null);

  const canManage = isGlobalAdmin() || isPrincipal();
  const schoolId = selectedSchool || userData?.schoolId;
  const featureMeta = FEATURE_LABELS[feature] || {};

  useEffect(() => {
    function onOutside(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [onClose]);

  const loadStaff = useCallback(async () => {
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
      console.error('PagePermissionsPanel load error:');
    }
  }, [schoolId]);

  useEffect(() => {
    if (!schoolId) return;
    loadStaff();
  }, [schoolId, loadStaff]);

  async function setAccessLevel(user, level) {
    const viewKey = featureMeta.view;
    const editKey = featureMeta.edit;
    const operationKey = `${user.id}_${level}`;
    setSaving(operationKey);
    setPanelError('');
    if (!isAppCheckConfigured) {
      setPanelError('App Check אינו מוגדר בגרסה שפורסמה, ולכן השרת חוסם שינוי הרשאות. יש להגדיר VITE_FIREBASE_APPCHECK_SITE_KEY ולפרסם את הממשק מחדש.');
      setSaving(null);
      return;
    }
    try {
      const patch = {
        ...(viewKey ? { [viewKey]: true } : {}),
        ...(featureMeta.viewAlias ? { [featureMeta.viewAlias]: true } : {}),
        ...(editKey ? { [editKey]: level === 'edit' } : {}),
        ...(featureMeta.editAlias ? { [featureMeta.editAlias]: level === 'edit' } : {}),
        ...Object.fromEntries((featureMeta.editExtra || []).map(key => [key, level === 'edit'])),
      };
      await updateStaffUser({ userId: user.id, schoolId, permissions: patch });
      setStaff(prev => prev.map(u => u.id === user.id
        ? { ...u, permissions: { ...(u.permissions || {}), ...patch } }
        : u
      ));
      setSaved(operationKey);
      setTimeout(() => setSaved(null), 1200);
    } catch (err) {
      const reason = callableReason(err);
      setPanelError(reason === 'not-found'
        ? 'שירות שמירת ההרשאות טרם נפרס. יש לפרוס את Cloud Functions לפני שינוי הרשאות.'
        : reason === 'failed-precondition' || reason === 'app-check-failed' || reason === 'unauthenticated'
          ? 'אימות האפליקציה נכשל. יש לוודא ש-App Check מוגדר בגרסה שפורסמה.'
          : reason === 'permission-denied'
            ? 'אין הרשאה לשנות את המשתמש הזה.'
            : 'שמירת ההרשאה נכשלה. השינוי לא נשמר.');
    }
    setSaving(null);
  }

  function getEffectivePerm(user, permKey) {
    if (!permKey) return true;
    if (['principal', 'institution_manager', 'global_admin', 'platform_admin'].includes(user.role)) return true;
    const aliasKey = permKey === featureMeta.view ? featureMeta.viewAlias : featureMeta.editAlias;
    const override = user.permissions?.[aliasKey] ?? user.permissions?.[permKey];
    if (override !== undefined) return override;
    const rolePermissions = user.rolePermissionsBySchool?.[schoolId] || {};
    const roleValue = rolePermissions?.[aliasKey] ?? rolePermissions?.[permKey];
    if (roleValue !== undefined) return roleValue;
    // Student data is sensitive and therefore has no implicit viewer access.
    if (permKey === 'students_view' || permKey === 'classes_view') return false;
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
          padding: '1rem 1.25rem', borderBottom: '1px solid #f9f1ef',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Shield size={18} color="#fc5029" />
            <span style={{ fontWeight: 700, fontSize: '1rem' }}>
              הרשאות — {featureMeta.label}
            </span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 6, color: '#765968' }}>
            <X size={18} />
          </button>
        </div>

        {/* Legend */}
        <div style={{
          padding: '0.5rem 1.25rem', background: '#fbf6f5',
          borderBottom: '1px solid #f9f1ef',
          display: 'flex', gap: '1.5rem', fontSize: '0.78rem', color: '#765968',
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Eye size={13} color="#765968" /> צפייה
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Edit3 size={13} color="#765968" /> עריכה
          </span>
          <span style={{ fontSize: '0.72rem', color: '#9b8790', marginRight: 'auto' }}>
            מנהל מוסד — גישה מלאה תמיד
          </span>
        </div>

        {/* Search */}
        <div style={{ padding: '0.75rem 1.25rem', borderBottom: '1px solid #f9f1ef' }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="חיפוש לפי שם..."
            style={{
              width: '100%', padding: '0.45rem 0.75rem',
              border: '1px solid #eadfe2', borderRadius: 8,
              fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box',
            }}
          />
          {panelError && <div role="alert" style={{ marginTop: '0.55rem', color: '#b91c1c', fontSize: '0.78rem', lineHeight: 1.5 }}>{panelError}</div>}
        </div>

        {/* User list */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {filtered.length === 0 && (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#9b8790', fontSize: '0.88rem' }}>
              לא נמצאו משתמשים
            </div>
          )}
          {filtered.map(user => {
            const isPrinc = ['principal', 'institution_manager', 'global_admin', 'platform_admin'].includes(user.role);
            const viewKey = featureMeta.view;
            const editKey = featureMeta.edit;
            const canView = getEffectivePerm(user, viewKey);
            const canEdit = getEffectivePerm(user, editKey);

            return (
              <div key={user.id} style={{
                padding: '0.65rem 1.25rem',
                borderBottom: '1px solid #fbf6f5',
                display: 'flex', alignItems: 'center', gap: '0.75rem',
              }}>
                {/* Avatar */}
                <div style={{
                  width: 34, height: 34, borderRadius: '50%',
                  background: isPrinc ? '#f9dab9' : '#f9f1ef',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.85rem', fontWeight: 700, color: isPrinc ? '#870335' : '#5f3b49',
                  flexShrink: 0,
                }}>
                  {user.fullName?.charAt(0) || '?'}
                </div>

                {/* Name + role */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#1e000c', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {user.fullName}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#9b8790' }}>
                    {user.jobTitle || ROLE_LABELS[user.role] || 'צופה'}
                  </div>
                </div>

                {/* Permission toggles */}
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  {viewKey && (
                    <PermToggle
                      label="צפייה"
                      icon={<Eye size={13} />}
                      active={isPrinc || (canView && !canEdit)}
                      disabled={isPrinc}
                      loading={saving === `${user.id}_view`}
                      justSaved={saved === `${user.id}_view`}
                      onChange={() => !isPrinc && setAccessLevel(user, 'view')}
                    />
                  )}
                  {editKey && (
                    <PermToggle
                      label="עריכה"
                      icon={<Edit3 size={13} />}
                      active={isPrinc || canEdit}
                      disabled={isPrinc}
                      loading={saving === `${user.id}_edit`}
                      justSaved={saved === `${user.id}_edit`}
                      onChange={() => !isPrinc && setAccessLevel(user, 'edit')}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{
          padding: '0.75rem 1.25rem', borderTop: '1px solid #f9f1ef',
          background: '#fbf6f5', fontSize: '0.76rem', color: '#9b8790', textAlign: 'center',
        }}>
          בחירה ב״עריכה״ כוללת גם הרשאת צפייה. השינוי נשמר בשרת ומתעדכן אצל המשתמש לאחר רענון.
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
        background: active ? (justSaved ? '#dcfce7' : '#fbf6f5') : '#f9f1ef',
        color: active ? (justSaved ? '#16a34a' : '#870335') : '#9b8790',
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
