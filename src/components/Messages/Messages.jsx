import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { db, storage } from '../../firebase';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDocs,
  arrayUnion,
  arrayRemove,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import Header from '../Layout/Header';
import { createNotification, createNotifications } from '../../utils/notifications';
import { Send, Search, Mail, Circle, Trash2, X, Shield, Megaphone, Users, MessageCircle, ImagePlus, Pin } from 'lucide-react';
import './Messages.css';

const ROLE_LABELS_MSG = {
  global_admin: 'מנהל על',
  principal: 'מנהל מוסד',
  editor: 'עורך',
  viewer: 'צופה'
};

export default function Messages() {
  const { userData, currentUser, selectedSchool, isGlobalAdmin } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [activeConv, setActiveConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMsg, setNewMsg] = useState('');
  const [users, setUsers] = useState([]);
  const [showNewConv, setShowNewConv] = useState(false);
  const [searchUsers, setSearchUsers] = useState('');
  const [searchConv, setSearchConv] = useState('');
  const [hoveredMsg, setHoveredMsg] = useState(null);
  const [confirmDeleteMsg, setConfirmDeleteMsg] = useState(null);
  const [confirmDeleteConv, setConfirmDeleteConv] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const messagesEndRef = useRef(null);
  const imageInputRef = useRef(null);
  const uid = currentUser?.uid;
  const schoolId = selectedSchool || userData?.schoolId;

  // Tab state: 'chats' or 'announcements'
  const [activeTab, setActiveTab] = useState('chats');

  // Announcements state
  const [announcements, setAnnouncements] = useState([]);
  const [showNewAnnouncement, setShowNewAnnouncement] = useState(false);
  const [announcementText, setAnnouncementText] = useState('');
  const [announcementTarget, setAnnouncementTarget] = useState('all');
  const [teams, setTeams] = useState([]);

  // Admin users for "Contact Admin" feature
  const [adminUsers, setAdminUsers] = useState([]);

  // Load users from the same school only (admin sees all)
  useEffect(() => {
    if (!uid) return;
    async function loadUsers() {
      let allUsers;
      if (isGlobalAdmin()) {
        // Admin can message anyone
        const snap = await getDocs(collection(db, 'users'));
        allUsers = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(u => u.id !== uid);
      } else if (schoolId) {
        // Regular user: only load users from the same school
        const q1 = query(collection(db, 'users'), where('schoolIds', 'array-contains', schoolId));
        const snap1 = await getDocs(q1);
        const userMap = new Map();
        snap1.docs.forEach(d => {
          if (d.id !== uid) userMap.set(d.id, { id: d.id, ...d.data() });
        });
        // Fallback: old schoolId field
        const q2 = query(collection(db, 'users'), where('schoolId', '==', schoolId));
        const snap2 = await getDocs(q2);
        snap2.docs.forEach(d => {
          if (d.id !== uid && !userMap.has(d.id)) {
            userMap.set(d.id, { id: d.id, ...d.data() });
          }
        });
        allUsers = Array.from(userMap.values());
      } else {
        allUsers = [];
      }

      // Always load global_admin users and include them in contacts
      const adminQuery = query(collection(db, 'users'), where('role', '==', 'global_admin'));
      const adminSnap = await getDocs(adminQuery);
      const admins = adminSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(u => u.id !== uid);
      setAdminUsers(admins);

      // Merge admin users into the allUsers list (avoid duplicates)
      const userIds = new Set(allUsers.map(u => u.id));
      for (const admin of admins) {
        if (!userIds.has(admin.id)) {
          allUsers.push(admin);
        }
      }

      setUsers(allUsers);
    }
    loadUsers();
  }, [uid, schoolId]);

  // Load teams for announcement targeting
  useEffect(() => {
    if (!schoolId) return;
    async function loadTeams() {
      try {
        const snap = await getDocs(collection(db, `teams_${schoolId}`));
        setTeams(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error('Error loading teams:', err);
        setTeams([]);
      }
    }
    loadTeams();
  }, [schoolId]);

  // Listen to announcements
  useEffect(() => {
    if (!uid) return;
    const q = query(
      collection(db, 'announcements'),
      orderBy('createdAt', 'desc')
    );
    const unsub = onSnapshot(q, (snap) => {
      let anns = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Filter: show announcements for target='all' or matching schoolId
      if (!isGlobalAdmin() && schoolId) {
        anns = anns.filter(a => a.target === 'all' || a.schoolId === schoolId);
      }
      setAnnouncements(anns);
    }, (err) => {
      console.error('Error loading announcements:', err);
    });
    return unsub;
  }, [uid, schoolId]);

  // Listen to conversations (scoped by school for non-admin)
  useEffect(() => {
    if (!uid) return;
    const q = query(
      collection(db, 'conversations'),
      where('participants', 'array-contains', uid)
    );
    const unsub = onSnapshot(q, (snap) => {
      let convs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Non-admin: filter to only conversations from the current school
      if (!isGlobalAdmin() && schoolId) {
        convs = convs.filter(c => !c.schoolId || c.schoolId === schoolId);
      }
      convs.sort((a, b) => (b.lastMessageAt || '').localeCompare(a.lastMessageAt || ''));

      // Merge duplicate conversations for the same participant pair
      const merged = [];
      const pairMap = new Map();
      for (const conv of convs) {
        const pairKey = [...conv.participants].sort().join('|');
        if (pairMap.has(pairKey)) {
          // Keep the one with the latest message, mark the other for merging
          const existing = pairMap.get(pairKey);
          existing._mergedIds = existing._mergedIds || [];
          existing._mergedIds.push(conv.id);
        } else {
          pairMap.set(pairKey, conv);
          merged.push(conv);
        }
      }
      setConversations(merged);
    }, (err) => {
      console.error('Error loading conversations:', err);
    });
    return unsub;
  }, [uid]);

  // Listen to messages in active conversation (including merged conversations)
  useEffect(() => {
    if (!activeConv) { setMessages([]); return; }

    const convIds = [activeConv.id, ...(activeConv._mergedIds || [])];
    const unsubs = [];
    const allMessages = {};

    for (const convId of convIds) {
      const q = query(
        collection(db, 'conversations', convId, 'messages'),
        orderBy('createdAt', 'asc')
      );
      const unsub = onSnapshot(q, (snap) => {
        allMessages[convId] = snap.docs.map(d => ({ id: d.id, ...d.data(), _convId: convId }));
        // Combine and sort all messages
        const combined = Object.values(allMessages).flat();
        combined.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
        setMessages(combined);
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
      }, (err) => {
        console.error('Error loading messages:', err);
      });
      unsubs.push(unsub);
    }

    // Mark as read
    if (activeConv.unreadBy?.includes(uid)) {
      const newUnread = (activeConv.unreadBy || []).filter(id => id !== uid);
      updateDoc(doc(db, 'conversations', activeConv.id), { unreadBy: newUnread });
    }
    return () => unsubs.forEach(u => u());
  }, [activeConv?.id, uid]);

  async function startConversation(otherUser) {
    // Check if conversation already exists (using merged list)
    const existing = conversations.find(c =>
      c.participants.includes(otherUser.id) && c.participants.length === 2
    );
    if (existing) {
      setActiveConv(existing);
      setShowNewConv(false);
      setActiveTab('chats');
      return;
    }
    const convData = {
      participants: [uid, otherUser.id],
      participantNames: { [uid]: userData?.fullName || '', [otherUser.id]: otherUser.fullName || '' },
      lastMessage: '',
      lastMessageAt: new Date().toISOString(),
      unreadBy: [],
      schoolId: schoolId || ''
    };
    const convDoc = await addDoc(collection(db, 'conversations'), convData);
    const newConv = { id: convDoc.id, ...convData };
    setActiveConv(newConv);
    setShowNewConv(false);
    setActiveTab('chats');
  }

  async function contactAdmin() {
    if (adminUsers.length === 0) return;
    // Start conversation with the first admin found
    await startConversation(adminUsers[0]);
  }

  async function sendMessage(e) {
    e.preventDefault();
    if (!newMsg.trim() || !activeConv) return;
    const text = newMsg.trim();
    setNewMsg('');
    const otherIds = activeConv.participants.filter(id => id !== uid);
    await addDoc(collection(db, 'conversations', activeConv.id, 'messages'), {
      text,
      senderId: uid,
      senderName: userData?.fullName || '',
      senderRole: userData?.role || '',
      createdAt: new Date().toISOString()
    });
    await updateDoc(doc(db, 'conversations', activeConv.id), {
      lastMessage: text,
      lastMessageAt: new Date().toISOString(),
      unreadBy: otherIds
    });

    // Notify recipients about the new message
    for (const recipientId of otherIds) {
      createNotification(recipientId, {
        title: `הודעה חדשה מ${userData?.fullName || 'משתמש'}`,
        body: text.length > 80 ? text.slice(0, 80) + '...' : text,
        type: 'message',
        link: '/messages'
      });
    }
  }

  async function sendAnnouncement(e) {
    e.preventDefault();
    if (!announcementText.trim()) return;
    const text = announcementText.trim();
    setAnnouncementText('');

    let targetName = 'כולם';
    if (announcementTarget !== 'all') {
      const team = teams.find(t => t.id === announcementTarget);
      targetName = team?.name || announcementTarget;
    }

    await addDoc(collection(db, 'announcements'), {
      text,
      senderId: uid,
      senderName: userData?.fullName || '',
      senderRole: userData?.role || '',
      createdAt: new Date().toISOString(),
      target: announcementTarget,
      targetName,
      schoolId: schoolId || ''
    });

    setShowNewAnnouncement(false);
    setAnnouncementTarget('all');
  }

  async function deleteMessage(msg) {
    if (!msg || !activeConv) return;
    const convId = msg._convId || activeConv.id;
    try {
      await deleteDoc(doc(db, 'conversations', convId, 'messages', msg.id));
      // If this was the last message, update conversation lastMessage
      const remaining = messages.filter(m => m.id !== msg.id);
      if (remaining.length > 0) {
        const last = remaining[remaining.length - 1];
        await updateDoc(doc(db, 'conversations', activeConv.id), {
          lastMessage: last.text,
          lastMessageAt: last.createdAt
        });
      } else {
        await updateDoc(doc(db, 'conversations', activeConv.id), {
          lastMessage: '',
          lastMessageAt: new Date().toISOString()
        });
      }
    } catch (err) {
      console.error('Error deleting message:', err);
    }
    setConfirmDeleteMsg(null);
  }

  async function togglePinConv(convId, isPinned) {
    if (!uid) return;
    await updateDoc(doc(db, 'conversations', convId), {
      pinnedBy: isPinned ? arrayRemove(uid) : arrayUnion(uid)
    });
  }

  async function deleteConversation(conv) {
    if (!conv) return;
    try {
      // Delete all messages in the subcollection
      const msgsSnap = await getDocs(collection(db, 'conversations', conv.id, 'messages'));
      const deletePromises = msgsSnap.docs.map(d => deleteDoc(doc(db, 'conversations', conv.id, 'messages', d.id)));
      await Promise.all(deletePromises);
      // Also delete messages from merged conversations
      if (conv._mergedIds) {
        for (const mergedId of conv._mergedIds) {
          const mergedMsgsSnap = await getDocs(collection(db, 'conversations', mergedId, 'messages'));
          const mergedDeletes = mergedMsgsSnap.docs.map(d => deleteDoc(doc(db, 'conversations', mergedId, 'messages', d.id)));
          await Promise.all(mergedDeletes);
          await deleteDoc(doc(db, 'conversations', mergedId));
        }
      }
      // Delete the conversation document
      await deleteDoc(doc(db, 'conversations', conv.id));
      if (activeConv?.id === conv.id) {
        setActiveConv(null);
        setMessages([]);
      }
    } catch (err) {
      console.error('Error deleting conversation:', err);
    }
    setConfirmDeleteConv(null);
  }

  async function handleImageUpload(e) {
    const file = e.target.files?.[0];
    if (!file || !activeConv) return;
    if (!file.type.startsWith('image/')) return;
    setUploadingImage(true);
    try {
      const filename = `${Date.now()}_${file.name}`;
      const storageRef = ref(storage, `chat_images/${activeConv.id}/${filename}`);
      await uploadBytes(storageRef, file);
      const imageUrl = await getDownloadURL(storageRef);
      const otherIds = activeConv.participants.filter(id => id !== uid);
      await addDoc(collection(db, 'conversations', activeConv.id, 'messages'), {
        text: '',
        imageUrl,
        senderId: uid,
        senderName: userData?.fullName || '',
        senderRole: userData?.role || '',
        createdAt: new Date().toISOString()
      });
      await updateDoc(doc(db, 'conversations', activeConv.id), {
        lastMessage: '📷 תמונה',
        lastMessageAt: new Date().toISOString(),
        unreadBy: otherIds
      });
    } catch (err) {
      console.error('Error uploading image:', err);
    }
    setUploadingImage(false);
    if (imageInputRef.current) imageInputRef.current.value = '';
  }

  function getOtherName(conv) {
    if (!conv.participantNames) return 'משתמש';
    const otherId = conv.participants.find(id => id !== uid);
    return conv.participantNames[otherId] || 'משתמש';
  }

  function getOtherUser(conv) {
    const otherId = conv.participants.find(id => id !== uid);
    return users.find(u => u.id === otherId);
  }

  function getInitial(conv) {
    const name = getOtherName(conv);
    return name.charAt(0) || '?';
  }

  const filteredConversations = conversations.filter(c => {
    if (!searchConv.trim()) return true;
    const name = getOtherName(c).toLowerCase();
    return name.includes(searchConv.toLowerCase());
  }).sort((a, b) => {
    const aPin = a.pinnedBy?.includes(uid) ? 0 : 1;
    const bPin = b.pinnedBy?.includes(uid) ? 0 : 1;
    return aPin - bPin;
  });

  // Sort users: admins first, then alphabetical
  const sortedFilteredUsers = users
    .filter(u => {
      if (!searchUsers.trim()) return true;
      return (u.fullName || '').toLowerCase().includes(searchUsers.toLowerCase()) ||
             (u.email || '').toLowerCase().includes(searchUsers.toLowerCase());
    })
    .sort((a, b) => {
      const aIsAdmin = a.role === 'global_admin' ? 0 : 1;
      const bIsAdmin = b.role === 'global_admin' ? 0 : 1;
      if (aIsAdmin !== bIsAdmin) return aIsAdmin - bIsAdmin;
      return (a.fullName || '').localeCompare(b.fullName || '', 'he');
    });

  function formatMsgDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const today = new Date();
    const isToday = d.toDateString() === today.toDateString();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();
    if (isToday) return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    if (isYesterday) return 'אתמול ' + d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  }

  return (
    <div className="page">
      <Header title="הודעות" />
      <div className="page-content">
        <div className="messages-layout">
          {/* Conversations sidebar */}
          <div className="conv-panel">
            {/* Tabs: Chats / Announcements */}
            <div className="msg-tabs">
              <button
                className={`msg-tab ${activeTab === 'chats' ? 'msg-tab--active' : ''}`}
                onClick={() => setActiveTab('chats')}
              >
                <MessageCircle size={14} />
                שיחות
              </button>
              <button
                className={`msg-tab ${activeTab === 'announcements' ? 'msg-tab--active' : ''}`}
                onClick={() => setActiveTab('announcements')}
              >
                <Megaphone size={14} />
                הודעות כלליות
              </button>
            </div>

            {activeTab === 'chats' && (
              <>
                <div className="conv-header">
                  <h3>שיחות</h3>
                  <div style={{ display: 'flex', gap: '0.35rem' }}>
                    {adminUsers.length > 0 && (
                      <button
                        className="btn btn-secondary btn-sm contact-admin-btn"
                        onClick={contactAdmin}
                        title="פנה לאדמין"
                      >
                        <Shield size={12} />
                        פנה לאדמין
                      </button>
                    )}
                    <button className="btn btn-primary btn-sm" onClick={() => setShowNewConv(!showNewConv)}>
                      הודעה חדשה
                    </button>
                  </div>
                </div>

                {showNewConv && (
                  <div className="new-conv-panel">
                    <div className="search-bar" style={{ margin: '0.5rem', minWidth: 'auto' }}>
                      <Search size={12} />
                      <input
                        value={searchUsers}
                        onChange={e => setSearchUsers(e.target.value)}
                        placeholder="חיפוש משתמש..."
                        autoFocus
                      />
                    </div>
                    <div className="user-list">
                      {sortedFilteredUsers.slice(0, 20).map(u => (
                        <div key={u.id} className="user-item" onClick={() => startConversation(u)}>
                          <div className={`user-avatar ${u.role === 'global_admin' ? 'user-avatar--admin' : ''}`}>
                            {u.fullName?.charAt(0) || '?'}
                          </div>
                          <div className="user-info">
                            <div className="user-name-row">
                              <span className="user-name">{u.fullName}</span>
                              {u.role === 'global_admin' && (
                                <span className="admin-badge">
                                  <Shield size={10} />
                                  מנהל על
                                </span>
                              )}
                            </div>
                            <span className="user-email">{u.email}</span>
                          </div>
                        </div>
                      ))}
                      {sortedFilteredUsers.length === 0 && <p className="conv-empty">לא נמצאו משתמשים</p>}
                    </div>
                  </div>
                )}

                <div className="search-bar" style={{ margin: '0.5rem', minWidth: 'auto' }}>
                  <Search size={12} />
                  <input
                    value={searchConv}
                    onChange={e => setSearchConv(e.target.value)}
                    placeholder="חיפוש שיחות..."
                  />
                </div>

                <div className="conv-list">
                  {filteredConversations.map(conv => {
                    const isUnread = conv.unreadBy?.includes(uid);
                    const isPinned = conv.pinnedBy?.includes(uid);
                    return (
                      <div
                        key={conv.id}
                        className={`conv-item ${activeConv?.id === conv.id ? 'conv-item--active' : ''} ${isUnread ? 'conv-item--unread' : ''} ${isPinned ? 'conv-item--pinned' : ''}`}
                        onClick={() => setActiveConv(conv)}
                      >
                        <div className="conv-avatar">{getInitial(conv)}</div>
                        <div className="conv-info">
                          <div className="conv-name-row">
                            <span className="conv-name">{getOtherName(conv)}</span>
                            {(() => { const other = getOtherUser(conv); return other?.role ? (
                              <span className={`conv-role-tag conv-role--${other.role}`}>{ROLE_LABELS_MSG[other.role]}</span>
                            ) : null; })()}
                          </div>
                          <span className="conv-last-msg">{conv.lastMessage || 'שיחה חדשה'}</span>
                        </div>
                        <div className="conv-item-actions">
                          <button
                            className={`icon-btn ${isPinned ? 'icon-btn--pinned' : ''}`}
                            title={isPinned ? 'הסר נעיצה' : 'נעץ'}
                            onClick={e => { e.stopPropagation(); togglePinConv(conv.id, isPinned); }}
                          >
                            <Pin size={13} style={isPinned ? { color: '#2563eb' } : undefined} />
                          </button>
                          {isUnread && <Circle size={8} fill="#2563eb" className="conv-unread-dot" />}
                          {confirmDeleteConv === conv.id ? (
                            <div className="conv-delete-confirm" onClick={e => e.stopPropagation()}>
                              <button className="msg-delete-yes" onClick={() => deleteConversation(conv)}>מחק</button>
                              <button className="msg-delete-no" onClick={() => setConfirmDeleteConv(null)}>לא</button>
                            </div>
                          ) : (
                            <button
                              className="conv-delete-btn"
                              onClick={e => { e.stopPropagation(); setConfirmDeleteConv(conv.id); }}
                              title="מחיקת שיחה"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {filteredConversations.length === 0 && !showNewConv && (
                    <p className="conv-empty">אין שיחות עדיין</p>
                  )}
                </div>
              </>
            )}

            {activeTab === 'announcements' && (
              <>
                <div className="conv-header">
                  <h3>הודעות כלליות</h3>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => setShowNewAnnouncement(!showNewAnnouncement)}
                  >
                    הודעה כללית
                  </button>
                </div>

                {showNewAnnouncement && (
                  <div className="new-announcement-panel">
                    <form onSubmit={sendAnnouncement}>
                      <div className="announcement-target">
                        <label>יעד:</label>
                        <select
                          value={announcementTarget}
                          onChange={e => setAnnouncementTarget(e.target.value)}
                        >
                          <option value="all">כולם</option>
                          {teams.map(t => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                      </div>
                      <textarea
                        value={announcementText}
                        onChange={e => setAnnouncementText(e.target.value)}
                        placeholder="כתבו הודעה כללית..."
                        rows={3}
                        autoFocus
                      />
                      <div className="announcement-actions">
                        <button
                          type="submit"
                          className="btn btn-primary btn-sm"
                          disabled={!announcementText.trim()}
                        >
                          <Megaphone size={12} />
                          שלח הודעה
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => { setShowNewAnnouncement(false); setAnnouncementText(''); setAnnouncementTarget('all'); }}
                        >
                          ביטול
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                <div className="conv-list">
                  {announcements.length === 0 ? (
                    <p className="conv-empty">אין הודעות כלליות עדיין</p>
                  ) : (
                    announcements.map(ann => (
                      <div key={ann.id} className="announcement-item">
                        <div className="announcement-header">
                          <div className="announcement-sender">
                            <Megaphone size={12} />
                            <span className="announcement-sender-name">{ann.senderName}</span>
                            {ann.senderRole && (
                              <span className={`msg-role-badge msg-role--${ann.senderRole}`}>
                                {ROLE_LABELS_MSG[ann.senderRole] || ''}
                              </span>
                            )}
                          </div>
                          <span className="announcement-target-badge">
                            <Users size={10} />
                            {ann.targetName}
                          </span>
                        </div>
                        <div className="announcement-text">{ann.text}</div>
                        <div className="announcement-time">{formatMsgDate(ann.createdAt)}</div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>

          {/* Chat area */}
          <div className="msg-area">
            {activeTab === 'chats' && activeConv ? (
              <>
                <div className="msg-header">
                  <div className="msg-header-avatar">{getInitial(activeConv)}</div>
                  <div className="msg-header-info">
                    <span className="msg-header-name">{getOtherName(activeConv)}</span>
                    {(() => { const other = getOtherUser(activeConv); return other?.role ? (
                      <span className={`msg-header-role msg-role--${other.role}`}>{ROLE_LABELS_MSG[other.role]}</span>
                    ) : null; })()}
                  </div>
                </div>
                <div className="msg-list">
                  {messages.length === 0 && <p className="msg-empty">אין הודעות עדיין. שלחו את ההודעה הראשונה!</p>}
                  {messages.map(msg => {
                    const isMe = msg.senderId === uid;
                    return (
                      <div
                        key={msg.id}
                        className={`msg-bubble ${isMe ? 'msg-bubble--me' : ''}`}
                        onMouseEnter={() => setHoveredMsg(msg.id)}
                        onMouseLeave={() => { setHoveredMsg(null); if (confirmDeleteMsg === msg.id) setConfirmDeleteMsg(null); }}
                      >
                        <div className="msg-bubble-header">
                          <span className="msg-sender">{isMe ? 'אני' : msg.senderName}</span>
                          {msg.senderRole && (
                            <span className={`msg-role-badge msg-role--${msg.senderRole}`}>
                              {ROLE_LABELS_MSG[msg.senderRole] || ''}
                            </span>
                          )}
                          <span className="msg-time">
                            {formatMsgDate(msg.createdAt)}
                          </span>
                          {isMe && hoveredMsg === msg.id && (
                            <button
                              className="msg-delete-btn"
                              onClick={(e) => { e.stopPropagation(); setConfirmDeleteMsg(msg.id); }}
                              title="מחיקת הודעה"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                        {msg.imageUrl && (
                          <div className="msg-image-wrapper">
                            <img
                              src={msg.imageUrl}
                              alt="תמונה"
                              className="msg-image"
                              onClick={() => setImagePreview(msg.imageUrl)}
                            />
                          </div>
                        )}
                        {msg.text && <div className="msg-text">{msg.text}</div>}
                        {confirmDeleteMsg === msg.id && (
                          <div className="msg-delete-confirm">
                            <span>למחוק הודעה זו?</span>
                            <button className="msg-delete-yes" onClick={() => deleteMessage(msg)}>מחק</button>
                            <button className="msg-delete-no" onClick={() => setConfirmDeleteMsg(null)}>ביטול</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
                <form className="msg-input" onSubmit={sendMessage}>
                  <input
                    value={newMsg}
                    onChange={e => setNewMsg(e.target.value)}
                    placeholder="כתבו הודעה..."
                    autoFocus
                  />
                  <input
                    type="file"
                    accept="image/*"
                    ref={imageInputRef}
                    style={{ display: 'none' }}
                    onChange={handleImageUpload}
                  />
                  <button
                    type="button"
                    className="msg-image-btn"
                    onClick={() => imageInputRef.current?.click()}
                    disabled={uploadingImage}
                    title="שליחת תמונה"
                  >
                    <ImagePlus size={16} />
                  </button>
                  <button type="submit" className="msg-send" disabled={!newMsg.trim()}>
                    <Send size={16} />
                  </button>
                </form>
              </>
            ) : activeTab === 'announcements' ? (
              <div className="msg-empty-state">
                <Megaphone size={40} />
                <p>הודעות כלליות מוצגות בצד</p>
              </div>
            ) : (
              <div className="msg-empty-state">
                <Mail size={40} />
                <p>בחרו שיחה או התחילו שיחה חדשה</p>
              </div>
            )}
          </div>
        </div>

        {/* Image preview modal */}
        {imagePreview && (
          <div className="image-preview-overlay" onClick={() => setImagePreview(null)}>
            <div className="image-preview-modal" onClick={e => e.stopPropagation()}>
              <button className="image-preview-close" onClick={() => setImagePreview(null)}>
                <X size={20} />
              </button>
              <img src={imagePreview} alt="תמונה מוגדלת" className="image-preview-img" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
