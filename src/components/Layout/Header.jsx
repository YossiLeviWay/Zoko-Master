import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { db } from '../../firebase';
import { collection, getDocs, query, where, onSnapshot, updateDoc, doc, orderBy, limit as firestoreLimit } from 'firebase/firestore';
import { Building2, ChevronDown, Check, Bell, CheckCheck, MessageCircle, CheckSquare, Calendar, Users, FolderOpen, UserPlus, AlertCircle, Shield } from 'lucide-react';
import './Layout.css';

const NOTIF_TYPE_ICONS = {
  message: MessageCircle,
  task: CheckSquare,
  calendar: Calendar,
  staff: Users,
  file: FolderOpen,
  permission: UserPlus,
  system: AlertCircle
};

function formatNotifTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'עכשיו';
  if (diffMin < 60) return `לפני ${diffMin} דק׳`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `לפני ${diffHours} שע׳`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `לפני ${diffDays} ימים`;
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
}

export default function Header({ title, onPermissions }) {
  const { userData, currentUser, selectedSchool, switchSchool, isGlobalAdmin, isPrincipal } = useAuth();
  const canManagePermissions = isGlobalAdmin() || isPrincipal();
  const navigate = useNavigate();
  const [schools, setSchools] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef(null);

  // Notification state
  const [unreadCount, setUnreadCount] = useState(0);
  const [latestNotifs, setLatestNotifs] = useState([]);
  const [showNotifPopup, setShowNotifPopup] = useState(false);
  const notifPopupRef = useRef(null);
  const notifBellRef = useRef(null);

  useEffect(() => {
    if (!isGlobalAdmin()) return;
    async function fetchSchools() {
      try {
        const snap = await getDocs(collection(db, 'schools'));
        setSchools(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch {
        setSchools([]);
      }
    }
    fetchSchools();
  }, [userData]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
      if (showNotifPopup && notifPopupRef.current && !notifPopupRef.current.contains(e.target) && notifBellRef.current && !notifBellRef.current.contains(e.target)) {
        setShowNotifPopup(false);
      }
    }
    if (showDropdown || showNotifPopup) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showDropdown, showNotifPopup]);

  // Listen for unread notification count
  useEffect(() => {
    if (!currentUser?.uid) return;
    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', currentUser.uid),
      where('read', '==', false)
    );
    const unsub = onSnapshot(q, (snap) => {
      setUnreadCount(snap.size);
    }, () => {});
    return unsub;
  }, [currentUser?.uid]);

  // Listen for latest 5 notifications
  useEffect(() => {
    if (!currentUser?.uid) return;
    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', currentUser.uid),
      orderBy('createdAt', 'desc'),
      firestoreLimit(5)
    );
    const unsub = onSnapshot(q, (snap) => {
      setLatestNotifs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => {});
    return unsub;
  }, [currentUser?.uid]);

  async function markAllRead() {
    if (!currentUser?.uid) return;
    try {
      const q = query(
        collection(db, 'notifications'),
        where('userId', '==', currentUser.uid),
        where('read', '==', false)
      );
      const snap = await getDocs(q);
      await Promise.all(snap.docs.map(d => updateDoc(doc(db, 'notifications', d.id), { read: true })));
    } catch {}
  }

  function handleNotifClick(notif) {
    setShowNotifPopup(false);
    navigate(notif.link || '/notifications');
  }

  const currentSchool = schools.find(s => s.id === selectedSchool);
  const filtered = schools.filter(s =>
    s.name.includes(search) || (s.address || '').includes(search)
  );

  const avatarStyle = userData?.avatarStyle || 'default';
  const initial = userData?.fullName?.charAt(0) || '?';

  const ROLE_LABELS_HEADER = {
    global_admin: 'מנהל על',
    principal: 'מנהל מוסד',
    editor: 'עורך',
    viewer: 'צופה'
  };

  return (
    <header className="app-header">
      <div className="header-right">
        <h2 className="header-title">{title}</h2>
      </div>

      <div className="header-left">
        {/* Permissions button — visible to principal/admin only */}
        {onPermissions && canManagePermissions && (
          <button
            onClick={onPermissions}
            title="ניהול הרשאות"
            style={{
              display: 'flex', alignItems: 'center', gap: '0.35rem',
              padding: '0.4rem 0.75rem', borderRadius: 8,
              border: '1px solid #e2e8f0', background: '#f8fafc',
              cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
              color: '#475569', transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#eff6ff'; e.currentTarget.style.color = '#2563eb'; e.currentTarget.style.borderColor = '#bfdbfe'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.color = '#475569'; e.currentTarget.style.borderColor = '#e2e8f0'; }}
          >
            <Shield size={15} />
            הרשאות
          </button>
        )}
        {/* Notification bell */}
        <div className="header-notif-wrap" ref={notifBellRef}>
          <button
            className="header-notif-btn"
            onClick={() => setShowNotifPopup(!showNotifPopup)}
            title="התראות"
          >
            <Bell size={18} />
            {unreadCount > 0 && (
              <span className="header-notif-badge">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>
          {showNotifPopup && (
            <div className="header-notif-popup" ref={notifPopupRef}>
              <div className="notif-popup-header">
                <span className="notif-popup-title">התראות</span>
                {unreadCount > 0 && (
                  <button className="notif-mark-all-btn" onClick={(e) => { e.stopPropagation(); markAllRead(); }}>
                    <CheckCheck size={12} />
                    סמן הכל כנקרא
                  </button>
                )}
              </div>
              <div className="notif-popup-list">
                {latestNotifs.length === 0 ? (
                  <div className="notif-popup-empty">אין התראות</div>
                ) : (
                  latestNotifs.map(notif => {
                    const TypeIcon = NOTIF_TYPE_ICONS[notif.type] || NOTIF_TYPE_ICONS.system;
                    return (
                      <div
                        key={notif.id}
                        className={`notif-popup-item ${!notif.read ? 'notif-popup-item--unread' : ''}`}
                        onClick={() => handleNotifClick(notif)}
                      >
                        <div className="notif-popup-item-icon"><TypeIcon size={14} /></div>
                        <div className="notif-popup-item-content">
                          <span className="notif-popup-item-title">{notif.title}</span>
                          <span className="notif-popup-item-time">{formatNotifTime(notif.createdAt)}</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              <div className="notif-popup-footer">
                <button className="notif-popup-view-all" onClick={() => { setShowNotifPopup(false); navigate('/notifications'); }}>
                  צפייה בכל ההתראות
                </button>
              </div>
            </div>
          )}
        </div>

        {/* User info */}
        <div className="header-user">
          <div className={`header-avatar avatar-style--${avatarStyle}`}>
            {initial}
          </div>
          <div className="header-user-info">
            <span className="header-user-name">{userData?.fullName || ''}</span>
            <span className="header-user-role">{ROLE_LABELS_HEADER[userData?.role] || ''}</span>
          </div>
        </div>

      {isGlobalAdmin() && schools.length > 0 && (
        <div className="context-switcher" ref={dropdownRef}>
          <button
            className="context-switcher-btn"
            onClick={() => setShowDropdown(!showDropdown)}
          >
            <Building2 size={16} />
            <span>{currentSchool?.name || 'בחרו מוסד'}</span>
            <ChevronDown size={14} className={showDropdown ? 'rotate-180' : ''} />
          </button>
          {showDropdown && (
            <div className="context-dropdown">
              {schools.length > 3 && (
                <div className="context-search">
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="חיפוש מוסד..."
                    autoFocus
                  />
                </div>
              )}
              <div className="context-options-list">
                {filtered.map(s => (
                  <button
                    key={s.id}
                    className={`context-option ${s.id === selectedSchool ? 'active' : ''}`}
                    onClick={() => { switchSchool(s.id); setShowDropdown(false); setSearch(''); }}
                  >
                    <div className="context-option-info">
                      <span className="context-option-name">{s.name}</span>
                      {s.address && <span className="context-option-addr">{s.address}</span>}
                    </div>
                    {s.id === selectedSchool && <Check size={14} className="context-check" />}
                  </button>
                ))}
                {filtered.length === 0 && (
                  <div className="context-empty">לא נמצאו מוסדות</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      </div>
    </header>
  );
}
