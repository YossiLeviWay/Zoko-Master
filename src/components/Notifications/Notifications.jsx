import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../firebase';
import { collection, query, where, getDocs, orderBy, updateDoc, doc, deleteDoc, onSnapshot } from 'firebase/firestore';
import Header from '../Layout/Header';
import { Bell, Check, Trash2, CheckCheck, Calendar, Users, FileText, MessageCircle, Shield, Clock } from 'lucide-react';
import './Notifications.css';

const ICON_MAP = {
  calendar: Calendar,
  staff: Users,
  file: FileText,
  message: MessageCircle,
  permission: Shield,
  system: Bell,
  task: Clock,
};

export default function Notifications() {
  const { userData, currentUser } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all, unread

  useEffect(() => {
    if (!currentUser) return;
    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', currentUser.uid),
      orderBy('createdAt', 'desc')
    );
    const unsub = onSnapshot(q, (snap) => {
      setNotifications(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [currentUser]);

  async function markAsRead(notifId) {
    await updateDoc(doc(db, 'notifications', notifId), { read: true });
  }

  async function markAllRead() {
    const unread = notifications.filter(n => !n.read);
    for (const n of unread) {
      await updateDoc(doc(db, 'notifications', n.id), { read: true });
    }
  }

  async function deleteNotification(notifId) {
    await deleteDoc(doc(db, 'notifications', notifId));
  }

  function formatTime(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (minutes < 1) return 'עכשיו';
    if (minutes < 60) return `לפני ${minutes} דקות`;
    if (hours < 24) return `לפני ${hours} שעות`;
    if (days < 7) return `לפני ${days} ימים`;
    return date.toLocaleDateString('he-IL');
  }

  const filtered = filter === 'unread' ? notifications.filter(n => !n.read) : notifications;
  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div className="page">
      <Header title="התראות" />
      <div className="page-content">
        <div className="page-toolbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div className="view-toggle">
              <button className={`toggle-btn ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
                הכל ({notifications.length})
              </button>
              <button className={`toggle-btn ${filter === 'unread' ? 'active' : ''}`} onClick={() => setFilter('unread')}>
                לא נקראו ({unreadCount})
              </button>
            </div>
          </div>
          {unreadCount > 0 && (
            <button className="btn btn-secondary btn-sm" onClick={markAllRead}>
              <CheckCheck size={14} />
              סמן הכל כנקרא
            </button>
          )}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>טוען...</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>
            <Bell size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} />
            <p>{filter === 'unread' ? 'אין התראות שלא נקראו' : 'אין התראות'}</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {filtered.map(notif => {
              const IconComp = ICON_MAP[notif.type] || Bell;
              return (
                <div
                  key={notif.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.75rem',
                    padding: '0.75rem 1rem',
                    background: notif.read ? '#fff' : '#eff6ff',
                    border: `1px solid ${notif.read ? '#e2e8f0' : '#bfdbfe'}`,
                    borderRadius: 8,
                    cursor: 'pointer',
                  }}
                  onClick={() => !notif.read && markAsRead(notif.id)}
                >
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: notif.read ? '#f1f5f9' : '#dbeafe',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <IconComp size={16} style={{ color: notif.read ? '#94a3b8' : '#3b82f6' }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: '0.88rem', fontWeight: notif.read ? 400 : 600, color: '#1e293b' }}>
                      {notif.title}
                    </p>
                    {notif.body && (
                      <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: '#64748b' }}>
                        {notif.body}
                      </p>
                    )}
                    <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{formatTime(notif.createdAt)}</span>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteNotification(notif.id); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#94a3b8' }}
                    title="מחק"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
