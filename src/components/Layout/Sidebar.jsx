import { useState, useEffect, useRef } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../firebase';
import {
  collection,
  query,
  where,
  onSnapshot,
  getDocs,
  updateDoc,
  doc,
  orderBy,
  limit as firestoreLimit
} from 'firebase/firestore';
import {
  Home,
  Calendar,
  Users,
  CheckSquare,
  FolderOpen,
  Settings,
  LogOut,
  ChevronRight,
  ChevronLeft,
  School,
  LayoutGrid,
  Menu,
  MessageCircle,
  Sun,
  Bell,
  CheckCheck,
  FileText,
  UserPlus,
  AlertCircle,
  GraduationCap,
  LifeBuoy,
  MessagesSquare,
  ShieldCheck,
  ContactRound,
  ChevronDown
} from 'lucide-react';
import UserAvatar from '../Shared/UserAvatar';
import NavPermissionsPanel, { PATH_TO_PERMISSION as PATH_TO_PERMISSION_SIDEBAR } from '../Shared/NavPermissionsPanel';
import { usePermissions } from '../../hooks/usePermissions';
import './Layout.css';

const NAV_ITEMS = [
  { path: '/tasks', icon: CheckSquare, label: 'המשימות שלי', requiresSchool: true, permission: 'tasks_view', primary: true },
  { path: '/', icon: Home, label: 'דשבורד', platformAllowed: true, primary: true },
  { path: '/calendar', icon: Calendar, label: 'לוח שנה', requiresSchool: true, permission: 'calendar_view', primary: true },
  { path: '/staff', icon: Users, label: 'סגל וקהילה', requiresSchool: true, permission: 'staff_view' },
  { path: '/teams', icon: Users, label: 'צוותים', requiresSchool: true, permission: 'teams_view' },
  { path: '/students', icon: GraduationCap, label: 'תלמידים', requiresSchool: true, permission: 'students_view' },
  { path: '/files', icon: FolderOpen, label: 'קבצים', requiresSchool: true, permission: 'files_view' },
  { path: '/contacts', icon: ContactRound, label: 'אנשי קשר', requiresSchool: true, permission: 'contacts.view' },
  { path: '/messages', icon: MessageCircle, label: 'הודעות', permission: 'messages_send' },
  { path: '/categories', icon: LayoutGrid, label: 'קטגוריות לוח שנה', requiresSchool: true, permission: 'categories_view' },
  { path: '/holidays', icon: Sun, label: 'חופשות וחגים', requiresSchool: true, permission: 'holidays_view' },
  { path: '/forum', icon: MessagesSquare, label: 'פורום בתי הספר', forumOnly: true, platformAllowed: true },
  { path: '/support', icon: LifeBuoy, label: 'תמיכה', requiresSchool: true, permission: 'support.create' },
  { path: '/platform', icon: ShieldCheck, label: 'ניהול הפלטפורמה', adminOnly: true, platformAllowed: true },
  { path: '/settings', icon: Settings, label: 'הגדרות', permission: 'settings_edit' }
];

const NOTIF_TYPE_ICONS = {
  message: MessageCircle,
  task: CheckSquare,
  calendar: Calendar,
  staff: Users,
  file: FolderOpen,
  permission: UserPlus,
  system: AlertCircle
};

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
}

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

export default function Sidebar() {
  const isMobile = useIsMobile();
  const { permissions } = usePermissions();
  const [collapsed, setCollapsed] = useState(isMobile);
  const [showMore, setShowMore] = useState(() => NAV_ITEMS.some(item => !item.primary && item.path === window.location.hash.slice(1)));
  const { logout, userData, currentUser, selectedSchool, isPending, isPrincipal, isGlobalAdmin, isPlatformAdmin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Notification state
  const [unreadCount, setUnreadCount] = useState(0);
  const [latestNotifs, setLatestNotifs] = useState([]);
  const [showNotifPopup, setShowNotifPopup] = useState(false);
  const [forumMembershipActive, setForumMembershipActive] = useState(false);
  const notifPopupRef = useRef(null);
  const notifBellRef = useRef(null);

  // Nav right-click permissions panel
  const [navPermPanel, setNavPermPanel] = useState(null); // { item, x, y }
  const canManagePermissions = isPrincipal() || isGlobalAdmin();
  const schoolId = selectedSchool || userData?.schoolId;

  useEffect(() => {
    if (!currentUser?.uid || isPlatformAdmin() || isPrincipal()) {
      setForumMembershipActive(Boolean(currentUser?.uid && (isPlatformAdmin() || isPrincipal())));
      return undefined;
    }
    return onSnapshot(doc(db, 'platformForumMemberships', currentUser.uid), snapshot => {
      const membership = snapshot.data();
      const expiresAt = membership?.expiresAt?.toMillis?.() || Number.POSITIVE_INFINITY;
      setForumMembershipActive(membership?.status === 'active' && expiresAt > Date.now());
    }, () => setForumMembershipActive(false));
  }, [currentUser?.uid, isPlatformAdmin, isPrincipal]);

  function handleNavContextMenu(e, item) {
    if (!canManagePermissions) return;
    if (item.adminOnly || item.path === '/' || !PATH_TO_PERMISSION_SIDEBAR[item.path]) return;
    e.preventDefault();
    e.stopPropagation();
    setNavPermPanel({ item, x: e.clientX, y: e.clientY });
  }

  // Auto-collapse on route change for mobile
  useEffect(() => {
    if (isMobile) setCollapsed(true);
  }, [location.pathname, isMobile]);

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
    }, (err) => {
      console.warn('Error listening to notifications count:');
    });
    return unsub;
  }, [currentUser?.uid]);

  // Listen for latest 5 notifications (for the popup)
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
    }, (err) => {
      console.warn('Error listening to latest notifications:');
    });
    return unsub;
  }, [currentUser?.uid]);

  // Close popup when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (
        showNotifPopup &&
        notifPopupRef.current &&
        !notifPopupRef.current.contains(e.target) &&
        notifBellRef.current &&
        !notifBellRef.current.contains(e.target)
      ) {
        setShowNotifPopup(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showNotifPopup]);

  async function markAllRead() {
    if (!currentUser?.uid) return;
    try {
      const q = query(
        collection(db, 'notifications'),
        where('userId', '==', currentUser.uid),
        where('read', '==', false)
      );
      const snap = await getDocs(q);
      const updates = snap.docs.map(d => updateDoc(doc(db, 'notifications', d.id), { read: true }));
      await Promise.all(updates);
    } catch (err) {
      console.warn('Error marking all notifications as read:');
    }
  }

  function handleNotifClick(notif) {
    setShowNotifPopup(false);
    if (notif.link) {
      navigate(notif.link);
    } else {
      navigate('/notifications');
    }
  }

  const userIsPending = isPending();

  function canSeeItem(item) {
    if (userIsPending) return item.path === '/';
    if (isPlatformAdmin()) return item.platformAllowed === true;
    if (item.adminOnly) return isPlatformAdmin();
    if (item.forumOnly && !forumMembershipActive && !isPrincipal()) return false;
    if (item.requiresSchool && !schoolId) return false;
    if (item.permission && !permissions[item.permission]) return false;
    return true;
  }

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <>
      {/* Mobile overlay */}
      {isMobile && !collapsed && (
        <div className="sidebar-overlay" onClick={() => setCollapsed(true)} />
      )}

      {/* Mobile hamburger button */}
      {isMobile && collapsed && (
        <button
          className="sidebar-mobile-toggle"
          onClick={() => setCollapsed(false)}
          style={{
            position: 'fixed',
            top: '0.6rem',
            right: '0.6rem',
            zIndex: 101,
            background: '#fff',
            border: '1px solid #eadfe2',
            borderRadius: 8,
            width: 36,
            height: 36,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
          }}
        >
          <Menu size={20} />
        </button>
      )}

      <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
      <div className="sidebar-header">
        {!collapsed && <span className="sidebar-logo">Zoko-Master</span>}
        <button
          className="sidebar-toggle"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? 'הרחב תפריט' : 'כווץ תפריט'}
        >
          {collapsed ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
        </button>
      </div>

      <nav className="sidebar-nav" aria-label="ניווט ראשי">
        {!collapsed && <span className="sidebar-section-label">עבודה שוטפת</span>}
        {NAV_ITEMS.filter(item => item.primary).filter(canSeeItem).map(item => {
          const isNotifications = item.path === '/notifications';

          return (
            <div
              key={item.path}
              className="sidebar-link-wrapper"
              onContextMenu={e => handleNavContextMenu(e, item)}
            >
              <NavLink
                to={item.path}
                end={item.path === '/'}
                className={({ isActive }) =>
                  `sidebar-link ${isActive ? 'sidebar-link--active' : ''}`
                }
                title={collapsed ? item.label : undefined}
                {...(isNotifications ? {
                  ref: notifBellRef,
                  onMouseEnter: () => {
                    if (!collapsed) setShowNotifPopup(true);
                  }
                } : {})}
              >
                <span className="sidebar-icon-wrap">
                  <item.icon size={20} />
                  {isNotifications && unreadCount > 0 && (
                    <span className="notif-badge">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </span>
                {!collapsed && <span>{item.label}</span>}
              </NavLink>

              {/* Notification popup dropdown */}
              {isNotifications && showNotifPopup && !collapsed && (
                <div
                  className="notif-popup"
                  ref={notifPopupRef}
                  onMouseLeave={() => setShowNotifPopup(false)}
                >
                  <div className="notif-popup-header">
                    <span className="notif-popup-title">התראות</span>
                    {unreadCount > 0 && (
                      <button
                        className="notif-mark-all-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          markAllRead();
                        }}
                      >
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
                            <div className="notif-popup-item-icon">
                              <TypeIcon size={14} />
                            </div>
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
                    <button
                      className="notif-popup-view-all"
                      onClick={() => {
                        setShowNotifPopup(false);
                        navigate('/notifications');
                      }}
                    >
                      צפייה בכל ההתראות
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {NAV_ITEMS.filter(item => !item.primary).filter(canSeeItem).length > 0 && <>
          <button
            type="button"
            className={`sidebar-more-toggle ${showMore ? 'is-open' : ''}`}
            onClick={() => setShowMore(value => !value)}
            aria-expanded={showMore}
            title={collapsed ? 'כלים נוספים' : undefined}
          >
            <LayoutGrid size={19} />
            {!collapsed && <><span>כלים נוספים</span><ChevronDown size={16} /></>}
          </button>
          {showMore && <div className="sidebar-secondary" aria-label="כלים נוספים">
            {!collapsed && <span className="sidebar-section-label">ניהול וכלים</span>}
            {NAV_ITEMS.filter(item => !item.primary).filter(canSeeItem).map(item => (
              <div key={item.path} className="sidebar-link-wrapper" onContextMenu={event => handleNavContextMenu(event, item)}>
                <NavLink to={item.path} className={({ isActive }) => `sidebar-link ${isActive ? 'sidebar-link--active' : ''}`} title={collapsed ? item.label : undefined}>
                  <item.icon size={20} />
                  {!collapsed && <span>{item.label}</span>}
                </NavLink>
              </div>
            ))}
          </div>}
        </>}
      </nav>

      <div className="sidebar-footer">
        {!collapsed && userData && (
          <div className="sidebar-user">
            <UserAvatar user={userData} className="sidebar-avatar" />
            <div className="sidebar-user-info">
              <span className="sidebar-user-name">{userData.fullName}</span>
              <span className="sidebar-user-role">{userData.jobTitle || userData.role}</span>
            </div>
          </div>
        )}
        <button className="sidebar-link sidebar-logout" onClick={handleLogout} title="יציאה">
          <LogOut size={20} />
          {!collapsed && <span>יציאה</span>}
        </button>
      </div>
    </aside>

    {/* Nav right-click permissions panel */}
    {navPermPanel && (
      <NavPermissionsPanel
        item={navPermPanel.item}
        anchor={{ x: navPermPanel.x, y: navPermPanel.y }}
        schoolId={schoolId}
        onClose={() => setNavPermPanel(null)}
      />
    )}
    </>
  );
}
