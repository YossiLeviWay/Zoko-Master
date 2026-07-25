import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query, setDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import { Bell, Flag, Lock, MessageSquare, Paperclip, Pin, Plus, Send, Trash2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { db, isAppCheckConfigured, storage } from '../../firebase';
import {
  callableReason,
  createForumPost,
  createForumThread,
  forumContentAction,
  upsertForumFolder,
} from '../../services/adminUserService';
import Header from '../Layout/Header';
import '../Gantt/Gantt.css';
import './Forum.css';

const ROOT = 'platformForum/root';

function forumActionError(action, error) {
  const reason = callableReason(error);
  if (!isAppCheckConfigured || reason === 'app-check-failed') {
    return 'אימות App Check של האפליקציה אינו פעיל. יש לפרסם את הממשק עם מפתח App Check תקין ולרענן את הדף.';
  }
  if (reason === 'not-found') {
    return 'שירות הפורום טרם פורסם ל-Firebase. יש לפרוס את Cloud Functions לפני שניתן ליצור תוכן.';
  }
  if (reason === 'unauthenticated') return 'החיבור פג. התחברו מחדש ונסו שוב.';
  if (reason === 'permission-denied') return 'השרת לא זיהה הרשאת מנהל מוסד פעילה עבור המוסד הנבחר.';
  if (reason === 'failed-precondition') return 'הפעולה אינה זמינה במצב הנוכחי. רעננו את הדף ונסו שוב.';
  if (reason === 'unavailable' || reason === 'deadline-exceeded') return 'שירות הפורום אינו זמין כרגע. נסו שוב בעוד מספר רגעים.';
  return `לא ניתן ${action}. שירות הפורום החזיר שגיאה לא צפויה.`;
}

export default function ForumPage() {
  const { currentUser, isPrincipal, isPlatformAdmin } = useAuth();
  const [membership, setMembership] = useState(null);
  const [folders, setFolders] = useState([]);
  const [threads, setThreads] = useState([]);
  const [posts, setPosts] = useState([]);
  const [selectedFolderId, setSelectedFolderId] = useState('');
  const [selectedThread, setSelectedThread] = useState(null);
  const [folderName, setFolderName] = useState('');
  const [threadForm, setThreadForm] = useState({ title: '', body: '' });
  const [reply, setReply] = useState('');
  const [attachment, setAttachment] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [schoolFilter, setSchoolFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');

  useEffect(() => {
    if (!currentUser?.uid || isPlatformAdmin() || isPrincipal()) return undefined;
    return onSnapshot(doc(db, 'platformForumMemberships', currentUser.uid), snapshot => setMembership(snapshot.data() || null), () => setMembership(null));
  }, [currentUser?.uid, isPlatformAdmin, isPrincipal]);
  const permissions = useMemo(() => new Set(isPlatformAdmin()
    ? ['forum.access', 'forum.read', 'forum.createThread', 'forum.reply', 'forum.uploadAttachment', 'forum.createFolder', 'forum.editFolder', 'forum.pinThread', 'forum.lockThread', 'forum.moderate']
    : isPrincipal() ? [
      'forum.access', 'forum.read', 'forum.createThread', 'forum.reply',
      'forum.editOwnPost', 'forum.deleteOwnPost', 'forum.uploadAttachment',
      'forum.createFolder', 'forum.editFolder', ...(membership?.permissions || []),
    ] : (membership?.permissions || [])), [isPlatformAdmin, isPrincipal, membership]);
  const managerAccess = isPlatformAdmin() || isPrincipal();
  const active = permissions.has('forum.access') && permissions.has('forum.read')
    && (managerAccess || !membership?.expiresAt || membership.expiresAt.toMillis() > Date.now());

  useEffect(() => {
    if (!active) return undefined;
    return onSnapshot(query(collection(db, `${ROOT}/folders`), orderBy('name')), snapshot => {
      const items = snapshot.docs.map(item => ({ id: item.id, ...item.data() })).filter(item => item.status !== 'deleted');
      setFolders(items); setSelectedFolderId(previous => previous || items[0]?.id || '');
    }, () => setError('לא ניתן לטעון את תיקיות הפורום.'));
  }, [active]);
  useEffect(() => {
    if (!active) return undefined;
    return onSnapshot(query(collection(db, `${ROOT}/threads`), orderBy('createdAt', 'desc')), snapshot => setThreads(snapshot.docs.map(item => ({ id: item.id, ...item.data() })).filter(item => item.status === 'active')), () => setError('לא ניתן לטעון דיונים.'));
  }, [active]);
  useEffect(() => {
    if (!active || !selectedThread?.id) { setPosts([]); return undefined; }
    return onSnapshot(query(collection(db, `${ROOT}/threads/${selectedThread.id}/posts`), orderBy('createdAt')), snapshot => setPosts(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))), () => setPosts([]));
  }, [active, selectedThread?.id]);

  async function prepareAttachment(file) {
    if (!file || !permissions.has('forum.uploadAttachment')) return [];
    if (file.size > 10 * 1024 * 1024) throw new Error('large');
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowed.includes(file.type)) throw new Error('type');
    const attachmentId = `${currentUser.uid}_${Date.now()}`;
    const path = `platform-forum/attachments/${attachmentId}/${file.name.replace(/[^\p{L}\p{N}._-]/gu, '_')}`;
    await setDoc(doc(db, `${ROOT}/attachments`, attachmentId), { uploadedBy: currentUser.uid, status: 'pending', storagePath: path, mimeType: file.type, size: file.size, createdAt: serverTimestamp() });
    await uploadBytes(ref(storage, path), file, { contentType: file.type });
    await setDoc(doc(db, `${ROOT}/attachments`, attachmentId), { status: 'uploaded', uploadedAt: serverTimestamp() }, { merge: true });
    return [attachmentId];
  }

  async function addFolder(event) {
    event.preventDefault(); if (!folderName.trim()) return;
    setSaving(true); setError('');
    try { await upsertForumFolder({ name: folderName.trim(), description: '' }); setFolderName(''); }
    catch (actionError) { setError(forumActionError('ליצור תיקייה', actionError)); }
    finally { setSaving(false); }
  }

  async function addThread(event) {
    event.preventDefault(); setSaving(true); setError('');
    try { const attachmentIds = await prepareAttachment(attachment); await createForumThread({ folderId: selectedFolderId, title: threadForm.title.trim(), body: threadForm.body.trim(), attachmentIds }); setThreadForm({ title: '', body: '' }); setAttachment(null); }
    catch (actionError) { setError(forumActionError('לפתוח את הדיון', actionError)); }
    finally { setSaving(false); }
  }

  async function addReply(event) {
    event.preventDefault(); setSaving(true); setError('');
    try { await createForumPost({ threadId: selectedThread.id, body: reply.trim(), attachmentIds: [] }); setReply(''); }
    catch (actionError) { setError(forumActionError('לשלוח את התגובה', actionError)); }
    finally { setSaving(false); }
  }

  if (!active) return <div className="page"><Header title="פורום בתי הספר" /><div className="page-content"><div className="empty-state"><Lock size={38} /><p>אין חברות פעילה בפורום. בקשת נציג מוסד מופיעה כאן רק לאחר אישור Platform Admin.</p></div></div></div>;
  const schoolNames = [...new Set(threads.map(item => item.author?.schoolName).filter(Boolean))].sort();
  const visibleThreads = threads.filter(item => {
    if (selectedFolderId && item.folderId !== selectedFolderId) return false;
    if (schoolFilter && item.author?.schoolName !== schoolFilter) return false;
    if (dateFilter && item.createdAt?.toDate?.().toISOString().slice(0, 10) !== dateFilter) return false;
    const needle = search.trim().toLocaleLowerCase('he');
    return !needle || `${item.title || ''} ${item.body || ''} ${item.author?.fullName || ''}`.toLocaleLowerCase('he').includes(needle);
  });
  async function contentAction(payload) {
    setError('');
    try { await forumContentAction(payload); }
    catch (actionError) { setError(forumActionError('להשלים את הפעולה בדיון', actionError)); }
  }
  return <div className="page"><Header title="פורום בתי הספר" /><div className="page-content forum-page">
    {error && <div className="students-feedback students-feedback--error">{error}</div>}
    <aside className="forum-folders"><h3>תיקיות</h3>{folders.map(item => <button key={item.id} className={selectedFolderId === item.id ? 'active' : ''} onClick={() => { setSelectedFolderId(item.id); setSelectedThread(null); }}>{item.name}</button>)}{permissions.has('forum.createFolder') && <form onSubmit={addFolder}><input value={folderName} onChange={event => setFolderName(event.target.value)} placeholder="שם תיקייה" aria-label="שם תיקייה חדשה" /><button className="btn btn-primary btn-sm" disabled={saving || !folderName.trim()}><Plus size={14} /> הוספה</button></form>}</aside>
    <main className="forum-threads"><div className="forum-heading"><h3>דיונים</h3><span>{visibleThreads.length}</span></div><div className="forum-filters"><input value={search} onChange={event => setSearch(event.target.value)} placeholder="חיפוש בדיונים" /><select value={schoolFilter} onChange={event => setSchoolFilter(event.target.value)}><option value="">כל המוסדות</option>{schoolNames.map(name => <option key={name}>{name}</option>)}</select><input type="date" value={dateFilter} onChange={event => setDateFilter(event.target.value)} aria-label="סינון לפי תאריך" /></div>{permissions.has('forum.createThread') && selectedFolderId && <form className="card forum-new-thread" onSubmit={addThread}><input value={threadForm.title} onChange={event => setThreadForm(previous => ({ ...previous, title: event.target.value }))} placeholder="כותרת הדיון" required /><textarea value={threadForm.body} onChange={event => setThreadForm(previous => ({ ...previous, body: event.target.value }))} placeholder="תוכן הדיון" required />{permissions.has('forum.uploadAttachment') && <label className="btn btn-secondary btn-sm"><Paperclip size={14} /> קובץ<input hidden type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={event => setAttachment(event.target.files?.[0] || null)} /></label>}<button className="btn btn-primary btn-sm" disabled={saving}>פתיחת דיון</button></form>}{visibleThreads.map(item => <button className={`forum-thread-card ${selectedThread?.id === item.id ? 'active' : ''}`} key={item.id} onClick={() => setSelectedThread(item)}><span>{item.pinned && <Pin size={13} />}{item.locked && <Lock size={13} />}</span><strong>{item.title}</strong><small>{item.author?.fullName} · {item.author?.publicRole} · {item.author?.schoolName}</small><p>{item.body}</p></button>)}</main>
    <section className="forum-discussion">{selectedThread ? <><div className="forum-heading"><h3>{selectedThread.title}</h3><div><button className="icon-btn" title="מעקב" onClick={() => contentAction({ targetType: 'thread', threadId: selectedThread.id, action: 'follow' })}><Bell size={14} /></button><button className="icon-btn" title="דיווח" onClick={() => { const reason = window.prompt('סיבת הדיווח:'); if (reason) contentAction({ targetType: 'thread', threadId: selectedThread.id, action: 'report', reason }); }}><Flag size={14} /></button>{permissions.has('forum.pinThread') && <button className="icon-btn" onClick={() => contentAction({ targetType: 'thread', threadId: selectedThread.id, action: 'pin' })}><Pin size={14} /></button>}{permissions.has('forum.lockThread') && <button className="icon-btn" onClick={() => contentAction({ targetType: 'thread', threadId: selectedThread.id, action: 'lock' })}><Lock size={14} /></button>}{((selectedThread.authorId === currentUser.uid && permissions.has('forum.deleteOwnPost')) || permissions.has('forum.moderate')) && <button className="icon-btn" title="מחיקה" onClick={() => window.confirm('למחוק את הדיון?') && contentAction({ targetType: 'thread', threadId: selectedThread.id, action: 'delete' })}><Trash2 size={14} /></button>}</div></div><article className="forum-post"><strong>{selectedThread.author?.fullName}</strong><small>{selectedThread.author?.publicRole} · {selectedThread.author?.schoolName}</small><p>{selectedThread.body}</p></article>{posts.filter(item => item.status !== 'deleted').map(item => <article className="forum-post" key={item.id}><strong>{item.author?.fullName}</strong><small>{item.author?.publicRole} · {item.author?.schoolName}</small><p>{item.body}</p>{((item.authorId === currentUser.uid && permissions.has('forum.deleteOwnPost')) || permissions.has('forum.moderate')) && <button className="icon-btn" title="מחיקת תגובה" onClick={() => window.confirm('למחוק את התגובה?') && contentAction({ targetType: 'post', threadId: selectedThread.id, postId: item.id, action: 'delete' })}><Trash2 size={13} /></button>}</article>)}{permissions.has('forum.reply') && !selectedThread.locked && <form className="forum-reply" onSubmit={addReply}><textarea value={reply} onChange={event => setReply(event.target.value)} placeholder="כתיבת תגובה" required /><button className="btn btn-primary" disabled={saving}><Send size={14} /> שליחה</button></form>}</> : <div className="empty-state"><MessageSquare size={36} /><p>בחרו דיון להצגה.</p></div>}</section>
  </div></div>;
}
