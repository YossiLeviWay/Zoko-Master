import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  AlertCircle,
  Bell,
  Building2,
  Clock3,
  Filter,
  Flag,
  FolderOpen,
  Lock,
  MessageCircle,
  MessageSquare,
  MessagesSquare,
  Pin,
  Plus,
  Search,
  Send,
  Sparkles,
  Trash2,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../firebase';
import {
  createForumFolderSpark,
  createForumPostSpark,
  createForumThreadSpark,
  FORUM_LIMITS,
  forumContentActionSpark,
  subscribeForumFolders,
  subscribeForumPosts,
  subscribeForumThreads,
} from '../../services/firestore/forumRepository';
import Header from '../Layout/Header';
import './Forum.css';

function forumActionError(action, error) {
  const reason = String(error?.code || '').replace(/^firestore\//, '');
  if (reason === 'unauthenticated') return 'החיבור פג. התחברו מחדש ונסו שוב.';
  if (reason === 'permission-denied') return 'אין הרשאה לפעולה, הגעתם למגבלת ההדגמה או שניסיתם לפרסם מהר מדי. המתינו מספר שניות ונסו שוב.';
  if (reason === 'invalid-argument') return 'אחד מפרטי הפעולה אינו תקין. בדקו את התוכן ונסו שוב.';
  if (reason === 'failed-precondition') return 'הפעולה אינה זמינה במצב הנוכחי. רעננו את הדף ונסו שוב.';
  if (reason === 'unavailable' || reason === 'deadline-exceeded') return 'שירות הפורום אינו זמין כרגע. נסו שוב בעוד מספר רגעים.';
  return `לא ניתן ${action} כרגע. רעננו את הדף ונסו שוב.`;
}

function forumDate(value) {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  if (!date || Number.isNaN(date.getTime())) return 'עכשיו';
  return new Intl.DateTimeFormat('he-IL', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function initials(name = '') {
  const letters = name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('');
  return letters || 'א';
}

function authorLine(author = {}) {
  return [author.publicRole, author.schoolName].filter(Boolean).join(' · ') || 'חבר/ת קהילה';
}

export default function ForumPage() {
  const { currentUser, userData, selectedSchool, isPrincipal, isPlatformAdmin } = useAuth();
  const [membership, setMembership] = useState(null);
  const [folders, setFolders] = useState([]);
  const [threads, setThreads] = useState([]);
  const [posts, setPosts] = useState([]);
  const [selectedFolderId, setSelectedFolderId] = useState('');
  const [selectedThread, setSelectedThread] = useState(null);
  const [folderName, setFolderName] = useState('');
  const [threadForm, setThreadForm] = useState({ title: '', body: '' });
  const [reply, setReply] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [schoolFilter, setSchoolFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [viewFilter, setViewFilter] = useState('all');
  const [showComposer, setShowComposer] = useState(false);
  const [showFolderForm, setShowFolderForm] = useState(false);
  const [pendingThreadId, setPendingThreadId] = useState('');

  useEffect(() => {
    if (!currentUser?.uid || isPlatformAdmin() || isPrincipal()) return undefined;
    return onSnapshot(
      doc(db, 'platformForumMemberships', currentUser.uid),
      snapshot => setMembership(snapshot.data() || null),
      () => setMembership(null),
    );
  }, [currentUser?.uid, isPlatformAdmin, isPrincipal]);

  const permissions = useMemo(() => new Set(isPlatformAdmin()
    ? ['forum.access', 'forum.read', 'forum.createThread', 'forum.reply', 'forum.uploadAttachment', 'forum.createFolder', 'forum.editFolder', 'forum.pinThread', 'forum.lockThread', 'forum.moderate']
    : isPrincipal() ? [
      'forum.access', 'forum.read', 'forum.createThread', 'forum.reply',
      'forum.editOwnPost', 'forum.deleteOwnPost', 'forum.uploadAttachment',
      'forum.createFolder', 'forum.editFolder', ...(membership?.permissions || []),
    ] : (membership?.permissions || [])), [isPlatformAdmin, isPrincipal, membership]);

  const managerAccess = isPlatformAdmin() || isPrincipal();
  const expiresAt = membership?.expiresAt?.toMillis?.() || Number.POSITIVE_INFINITY;
  const active = permissions.has('forum.access') && permissions.has('forum.read')
    && (managerAccess || expiresAt > Date.now());

  useEffect(() => {
    if (!active) return undefined;
    return subscribeForumFolders({
      db,
      onData: setFolders,
      onError: () => setError('לא ניתן לטעון את קהילות הפורום.'),
    });
  }, [active]);

  useEffect(() => {
    if (!active) return undefined;
    return subscribeForumThreads({
      db,
      onData: setThreads,
      onError: () => setError('לא ניתן לטעון את הדיונים.'),
    });
  }, [active]);

  useEffect(() => {
    const targetId = pendingThreadId || selectedThread?.id;
    if (!targetId) return;
    const freshThread = threads.find(item => item.id === targetId);
    if (freshThread) {
      setSelectedThread(freshThread);
      setPendingThreadId('');
    } else if (!pendingThreadId) {
      setSelectedThread(null);
    }
  }, [pendingThreadId, selectedThread?.id, threads]);

  useEffect(() => {
    if (!active || !selectedThread?.id) {
      setPosts([]);
      return undefined;
    }
    return subscribeForumPosts({
      db,
      threadId: selectedThread.id,
      onData: setPosts,
      onError: () => setError('לא ניתן לטעון את התגובות לדיון.'),
    });
  }, [active, selectedThread?.id]);

  async function addFolder(event) {
    event.preventDefault();
    if (!folderName.trim()) return;
    setSaving(true);
    setError('');
    try {
      const result = await createForumFolderSpark({ db, currentUser, name: folderName });
      setFolderName('');
      setSelectedFolderId(result.folderId);
      setShowFolderForm(false);
    } catch (actionError) {
      setError(forumActionError('ליצור את הקהילה', actionError));
    } finally {
      setSaving(false);
    }
  }

  function openComposer() {
    if (!selectedFolderId && folders[0]?.id) setSelectedFolderId(folders[0].id);
    setShowComposer(true);
    setSelectedThread(null);
  }

  async function addThread(event) {
    event.preventDefault();
    if (!selectedFolderId) {
      setError('בחרו קהילה לפני פתיחת דיון חדש.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const result = await createForumThreadSpark({
        db,
        currentUser,
        userData,
        selectedSchool,
        principal: isPrincipal(),
        platformAdmin: isPlatformAdmin(),
        folderId: selectedFolderId,
        title: threadForm.title,
        body: threadForm.body,
      });
      setThreadForm({ title: '', body: '' });
      setShowComposer(false);
      setPendingThreadId(result.threadId);
    } catch (actionError) {
      setError(forumActionError('לפתוח את הדיון', actionError));
    } finally {
      setSaving(false);
    }
  }

  async function addReply(event) {
    event.preventDefault();
    if (!reply.trim()) return;
    setSaving(true);
    setError('');
    try {
      await createForumPostSpark({
        db,
        currentUser,
        userData,
        selectedSchool,
        principal: isPrincipal(),
        platformAdmin: isPlatformAdmin(),
        threadId: selectedThread.id,
        body: reply,
      });
      setReply('');
    } catch (actionError) {
      setError(forumActionError('לשלוח את התגובה', actionError));
    } finally {
      setSaving(false);
    }
  }

  async function contentAction(payload) {
    setError('');
    try {
      await forumContentActionSpark({ db, currentUser, payload });
    } catch (actionError) {
      setError(forumActionError('להשלים את הפעולה בדיון', actionError));
    }
  }

  if (!active) {
    return <div className="page">
      <Header title="פורום בתי הספר" />
      <div className="page-content forum-access-state">
        <div className="forum-access-card">
          <Lock size={42} />
          <h2>הפורום ממתין לאישור גישה</h2>
          <p>נציגי מוסדות מצטרפים לפורום לאחר אישור מנהל המערכת. מנהל מוסד פעיל מקבל גישה אוטומטית.</p>
        </div>
      </div>
    </div>;
  }

  const schoolNames = [...new Set(threads.map(item => item.author?.schoolName).filter(Boolean))].sort();
  const activePosts = posts.filter(item => item.status !== 'deleted');
  const folderCounts = threads.reduce((counts, item) => ({
    ...counts, [item.folderId]: (counts[item.folderId] || 0) + 1,
  }), {});
  const needle = search.trim().toLocaleLowerCase('he');
  const visibleThreads = threads
    .filter(item => {
      if (selectedFolderId && item.folderId !== selectedFolderId) return false;
      if (schoolFilter && item.author?.schoolName !== schoolFilter) return false;
      if (dateFilter && item.createdAt?.toDate?.().toISOString().slice(0, 10) !== dateFilter) return false;
      if (viewFilter === 'mine' && item.authorId !== currentUser.uid) return false;
      if (viewFilter === 'followed' && !(item.followers || []).includes(currentUser.uid)) return false;
      return !needle || `${item.title || ''} ${item.body || ''} ${item.author?.fullName || ''}`.toLocaleLowerCase('he').includes(needle);
    })
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));

  return <div className="page forum-page-shell">
    <Header title="פורום בתי הספר" />
    <div className="page-content forum-community">
      <section className="forum-hero">
        <div className="forum-hero-copy">
          <span className="forum-eyebrow"><Sparkles size={15} /> קהילת החינוך של Zoko-Master</span>
          <h1>משתפים ידע, מתייעצים ומתקדמים יחד</h1>
          <p>מרחב מקצועי למנהלים ולצוותי חינוך מכל המוסדות—לשאלות, רעיונות, חיבורים ושיתופי פעולה.</p>
          {permissions.has('forum.createThread') && <button className="btn btn-primary forum-hero-action" onClick={openComposer} disabled={!folders.length}>
            <Plus size={18} /> פתיחת דיון חדש
          </button>}
        </div>
        <div className="forum-stats" aria-label="נתוני פעילות בפורום">
          <div><MessagesSquare size={20} /><strong>{threads.length}</strong><span>דיונים</span></div>
          <div><MessageCircle size={20} /><strong>{folders.length}</strong><span>קהילות</span></div>
          <div><Building2 size={20} /><strong>{schoolNames.length}</strong><span>מוסדות משתפים</span></div>
        </div>
      </section>

      {error && <div className="forum-alert" role="alert">
        <AlertCircle size={20} />
        <div><strong>לא הצלחנו להשלים את הפעולה</strong><p>{error}</p></div>
        <button className="icon-btn" onClick={() => setError('')} aria-label="סגירת הודעת השגיאה"><X size={16} /></button>
      </div>}

      <div className={`forum-workspace ${selectedThread ? 'forum-workspace--discussion-open' : ''}`}>
        <aside className="forum-sidebar">
          <div className="forum-panel-heading">
            <div><span>קהילות</span><small>לפי נושא ותחום עניין</small></div>
            {permissions.has('forum.createFolder') && <button className="icon-btn" onClick={() => setShowFolderForm(value => !value)} title="יצירת קהילה"><Plus size={17} /></button>}
          </div>

          {showFolderForm && <form className="forum-folder-form" onSubmit={addFolder}>
            <input value={folderName} onChange={event => setFolderName(event.target.value)} placeholder="שם הקהילה" aria-label="שם קהילה חדשה" maxLength={FORUM_LIMITS.folderName} autoFocus />
            <div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowFolderForm(false)}>ביטול</button>
              <button className="btn btn-primary btn-sm" disabled={saving || !folderName.trim()}>יצירה</button>
            </div>
          </form>}

          <nav className="forum-folder-list" aria-label="קהילות הפורום">
            <button className={!selectedFolderId ? 'active' : ''} onClick={() => { setSelectedFolderId(''); setSelectedThread(null); }}>
              <span className="forum-folder-icon"><MessagesSquare size={17} /></span>
              <span><strong>כל הדיונים</strong><small>מכל הקהילות</small></span>
              <b>{threads.length}</b>
            </button>
            {folders.map(item => <button key={item.id} className={selectedFolderId === item.id ? 'active' : ''} onClick={() => { setSelectedFolderId(item.id); setSelectedThread(null); }}>
              <span className="forum-folder-icon"><FolderOpen size={17} /></span>
              <span><strong>{item.name}</strong><small>{item.description || 'קהילה מקצועית'}</small></span>
              <b>{folderCounts[item.id] || 0}</b>
            </button>)}
          </nav>

          <div className="forum-guidelines">
            <Users size={20} />
            <div><strong>קהילה מכבדת ומקצועית</strong><p>שומרים על פרטיות התלמידים, משתפים ידע ומגיבים בכבוד.</p></div>
          </div>
        </aside>

        <main className="forum-feed">
          <div className="forum-feed-toolbar">
            <div className="forum-search">
              <Search size={18} />
              <input value={search} onChange={event => setSearch(event.target.value)} placeholder="חיפוש נושא, שאלה או חבר קהילה..." />
            </div>
            {permissions.has('forum.createThread') && <button className="btn btn-primary" onClick={openComposer} disabled={!folders.length}><Plus size={17} /> דיון חדש</button>}
          </div>

          <div className="forum-filter-row">
            <div className="forum-filter-tabs" aria-label="סינון דיונים">
              <button className={viewFilter === 'all' ? 'active' : ''} onClick={() => setViewFilter('all')}>הכול</button>
              <button className={viewFilter === 'followed' ? 'active' : ''} onClick={() => setViewFilter('followed')}><Bell size={14} /> במעקב</button>
              <button className={viewFilter === 'mine' ? 'active' : ''} onClick={() => setViewFilter('mine')}><UserRound size={14} /> שלי</button>
            </div>
            <div className="forum-advanced-filters">
              <Filter size={15} />
              <select value={schoolFilter} onChange={event => setSchoolFilter(event.target.value)} aria-label="סינון לפי מוסד">
                <option value="">כל המוסדות</option>
                {schoolNames.map(name => <option key={name}>{name}</option>)}
              </select>
              <input type="date" value={dateFilter} onChange={event => setDateFilter(event.target.value)} aria-label="סינון לפי תאריך" />
            </div>
          </div>

          {showComposer && <form className="forum-composer" onSubmit={addThread}>
            <div className="forum-composer-heading">
              <div className="forum-avatar">{initials(currentUser.displayName || currentUser.email)}</div>
              <div><strong>פתיחת דיון חדש</strong><small>נסחו כותרת ברורה כדי שחברי הקהילה יוכלו לעזור במהירות</small></div>
              <button type="button" className="icon-btn" onClick={() => setShowComposer(false)} aria-label="סגירת טופס הדיון"><X size={17} /></button>
            </div>
            <select value={selectedFolderId} onChange={event => setSelectedFolderId(event.target.value)} required>
              <option value="">בחירת קהילה</option>
              {folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
            </select>
            <input value={threadForm.title} onChange={event => setThreadForm(previous => ({ ...previous, title: event.target.value }))} placeholder="מה נושא הדיון?" maxLength={FORUM_LIMITS.title} required />
            <textarea value={threadForm.body} onChange={event => setThreadForm(previous => ({ ...previous, body: event.target.value }))} placeholder="שתפו שאלה, ניסיון או רעיון קצר..." rows={4} maxLength={FORUM_LIMITS.threadBody} required />
            <div className="forum-compose-note">
              <span>מצב הדגמה: הודעות קצרות ללא קבצים מצורפים</span>
              <b>{threadForm.body.length}/{FORUM_LIMITS.threadBody}</b>
            </div>
            <div className="forum-composer-actions">
              <button className="btn btn-primary" disabled={saving || !threadForm.title.trim() || !threadForm.body.trim()}><Send size={16} /> פרסום בקהילה</button>
            </div>
          </form>}

          <div className="forum-feed-summary"><strong>{visibleThreads.length} דיונים</strong><span>הדיונים המוצמדים מופיעים ראשונים</span></div>
          <div className="forum-thread-list">
            {visibleThreads.map(item => <button className={`forum-thread-card ${selectedThread?.id === item.id ? 'active' : ''}`} key={item.id} onClick={() => setSelectedThread(item)}>
              <div className="forum-avatar forum-avatar--small">{initials(item.author?.fullName)}</div>
              <div className="forum-thread-content">
                <div className="forum-thread-topline">
                  <span><strong>{item.author?.fullName || 'חבר/ת קהילה'}</strong><small>{authorLine(item.author)}</small></span>
                  <time><Clock3 size={13} /> {forumDate(item.createdAt)}</time>
                </div>
                <div className="forum-thread-title">
                  {item.pinned && <span className="forum-status-tag"><Pin size={12} /> מוצמד</span>}
                  {item.locked && <span className="forum-status-tag forum-status-tag--muted"><Lock size={12} /> נעול</span>}
                  <h3>{item.title}</h3>
                </div>
                <p>{item.body}</p>
                <div className="forum-thread-meta">
                  <span><MessageCircle size={15} /> {Number(item.replyCount || 0)} תגובות</span>
                  <span><Bell size={15} /> {(item.followers || []).length} במעקב</span>
                </div>
              </div>
            </button>)}
            {!visibleThreads.length && <div className="forum-empty-feed">
              <MessageSquare size={40} />
              <h3>עדיין אין דיונים שמתאימים לסינון</h3>
              <p>אפשר לשנות את הסינון או לפתוח דיון חדש ולהתחיל שיחה בקהילה.</p>
              {permissions.has('forum.createThread') && <button className="btn btn-primary" onClick={openComposer} disabled={!folders.length}><Plus size={16} /> פתיחת דיון</button>}
            </div>}
          </div>
        </main>

        <section className="forum-discussion">
          {selectedThread ? <>
            <div className="forum-discussion-header">
              <button className="forum-mobile-close icon-btn" onClick={() => setSelectedThread(null)} aria-label="חזרה לרשימת הדיונים"><X size={17} /></button>
              <div className="forum-avatar">{initials(selectedThread.author?.fullName)}</div>
              <div><strong>{selectedThread.author?.fullName || 'חבר/ת קהילה'}</strong><small>{authorLine(selectedThread.author)}</small></div>
              <div className="forum-discussion-tools">
                <button className={`icon-btn ${(selectedThread.followers || []).includes(currentUser.uid) ? 'active' : ''}`} title="מעקב אחר הדיון" onClick={() => contentAction({ targetType: 'thread', threadId: selectedThread.id, action: 'follow' })}><Bell size={16} /></button>
                <button className="icon-btn" title="דיווח על הדיון" onClick={() => { const reason = window.prompt('סיבת הדיווח:'); if (reason) contentAction({ targetType: 'thread', threadId: selectedThread.id, action: 'report', reason }); }}><Flag size={16} /></button>
                {permissions.has('forum.pinThread') && <button className={`icon-btn ${selectedThread.pinned ? 'active' : ''}`} title="הצמדת הדיון" onClick={() => contentAction({ targetType: 'thread', threadId: selectedThread.id, action: 'pin' })}><Pin size={16} /></button>}
                {permissions.has('forum.lockThread') && <button className={`icon-btn ${selectedThread.locked ? 'active' : ''}`} title="נעילת הדיון" onClick={() => contentAction({ targetType: 'thread', threadId: selectedThread.id, action: 'lock' })}><Lock size={16} /></button>}
                {((selectedThread.authorId === currentUser.uid && permissions.has('forum.deleteOwnPost')) || permissions.has('forum.moderate')) && <button className="icon-btn forum-danger-button" title="מחיקת הדיון" onClick={() => window.confirm('למחוק את הדיון?') && contentAction({ targetType: 'thread', threadId: selectedThread.id, action: 'delete' })}><Trash2 size={16} /></button>}
              </div>
            </div>

            <article className="forum-topic">
              <div className="forum-topic-meta"><time>{forumDate(selectedThread.createdAt)}</time><span>{Number(selectedThread.replyCount || 0)} תגובות</span></div>
              <h2>{selectedThread.title}</h2>
              <p>{selectedThread.body}</p>
            </article>

            <div className="forum-replies-heading"><strong>תגובות הקהילה</strong><span>{activePosts.length}</span></div>
            <div className="forum-replies">
              {activePosts.map(item => <article className="forum-post" key={item.id}>
                <div className="forum-avatar forum-avatar--small">{initials(item.author?.fullName)}</div>
                <div className="forum-post-body">
                  <div><span><strong>{item.author?.fullName || 'חבר/ת קהילה'}</strong><small>{authorLine(item.author)}</small></span><time>{forumDate(item.createdAt)}</time></div>
                  <p>{item.body}</p>
                </div>
                {((item.authorId === currentUser.uid && permissions.has('forum.deleteOwnPost')) || permissions.has('forum.moderate')) && <button className="icon-btn forum-danger-button" title="מחיקת תגובה" onClick={() => window.confirm('למחוק את התגובה?') && contentAction({ targetType: 'post', threadId: selectedThread.id, postId: item.id, action: 'delete' })}><Trash2 size={14} /></button>}
              </article>)}
              {!activePosts.length && <div className="forum-no-replies"><MessageCircle size={28} /><span>היו הראשונים להגיב ולפתוח את השיחה.</span></div>}
            </div>

            {permissions.has('forum.reply') && !selectedThread.locked
              ? <form className="forum-reply" onSubmit={addReply}>
                <div className="forum-avatar forum-avatar--small">{initials(currentUser.displayName || currentUser.email)}</div>
                <div className="forum-reply-input">
                  <textarea value={reply} onChange={event => setReply(event.target.value)} placeholder="כתיבת תגובה קצרה ומכבדת..." rows={2} maxLength={FORUM_LIMITS.replyBody} required />
                  <small>{reply.length}/{FORUM_LIMITS.replyBody}</small>
                </div>
                <button className="btn btn-primary" disabled={saving || !reply.trim()}><Send size={16} /> שליחה</button>
              </form>
              : selectedThread.locked && <div className="forum-locked-note"><Lock size={16} /> הדיון נעול לתגובות חדשות.</div>}
          </> : <div className="forum-discussion-empty">
            <div><MessagesSquare size={42} /></div>
            <h3>בחרו דיון והצטרפו לשיחה</h3>
            <p>כאן תוכלו לקרוא את כל התגובות, לעקוב אחרי הדיון ולשתף מהניסיון שלכם.</p>
          </div>}
        </section>
      </div>
    </div>
  </div>;
}
