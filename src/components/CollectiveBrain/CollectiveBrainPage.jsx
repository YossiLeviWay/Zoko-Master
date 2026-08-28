import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  Brain,
  Check,
  ClipboardList,
  Copy,
  Edit3,
  ExternalLink,
  Globe2,
  Lock,
  Maximize2,
  MessageSquareText,
  Minimize2,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  Share2,
  Trash2,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { db } from '../../firebase';
import {
  createCollectiveBrainBoard,
  createCollectiveBrainResponse,
  configureCollectiveBrainPublicAccess,
  deleteCollectiveBrainResponse,
  moderateCollectiveBrainResponse,
  restoreCollectiveBrainResponse,
  setCollectiveBrainBoardStatus,
  subscribeCollectiveBrainBoards,
  subscribeCollectiveBrainResponseCount,
  subscribeCollectiveBrainResponses,
  updateCollectiveBrainBoard,
  updateOwnCollectiveBrainResponse,
} from '../../services/firestore/collectiveBrainRepository';
import {
  canContributeToCollectiveBrainBoard,
  COLLECTIVE_BRAIN_LIMITS,
  findOwnCollectiveBrainResponses,
} from '../../utils/collectiveBrain';
import './CollectiveBrain.css';

const STATUS_LABELS = {
  open: 'פתוח להשתתפות',
  closed: 'סגור להשתתפות',
  archived: 'בארכיון',
  deleted: 'בסל המחזור',
};

function timestampValue(value) {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  if (value.seconds) return new Date(value.seconds * 1000);
  return new Date(value);
}

function formatTime(value) {
  const date = timestampValue(value);
  if (!date || Number.isNaN(date.getTime())) return 'עכשיו';
  return new Intl.DateTimeFormat('he-IL', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function friendlyError(error) {
  if (error?.message === 'QUESTION_REQUIRED') return 'יש להזין שאלה.';
  if (error?.message === 'RESPONSE_REQUIRED') return 'יש להזין תשובה.';
  if (error?.message === 'AUDIENCE_REQUIRED') return 'יש לבחור לפחות איש צוות אחד שייחשף ללוח.';
  if (error?.code === 'permission-denied') return 'הפעולה נדחתה. ייתכן שהלוח נסגר או שההרשאה השתנתה.';
  return 'לא ניתן להשלים את הפעולה כרגע. נסו שוב.';
}

function Modal({ title, children, onClose }) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    dialogRef.current?.querySelector('input, textarea, button')?.focus();
    const onKey = event => { if (event.key === 'Escape') onCloseRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="brain-modal-overlay" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className="brain-modal" role="dialog" aria-modal="true" aria-label={title}>
        <header><h2>{title}</h2><button className="brain-icon-button" onClick={onClose} aria-label="סגירה"><X size={18} /></button></header>
        {children}
      </section>
    </div>
  );
}

export default function CollectiveBrainPage() {
  const pageRef = useRef(null);
  const migratedBoardsRef = useRef(new Set());
  const { currentUser, userData, selectedSchool, isGlobalAdmin, isPrincipal } = useAuth();
  const { permissions, loading: permissionsLoading } = usePermissions();
  const schoolId = selectedSchool || userData?.schoolId;
  const canManage = isGlobalAdmin() || isPrincipal() || permissions['collectiveBrain.manage'] === true;
  const actor = { uid: currentUser?.uid, fullName: userData?.fullName || currentUser?.displayName || 'משתמש' };

  const [boards, setBoards] = useState([]);
  const [responses, setResponses] = useState([]);
  const [responseCounts, setResponseCounts] = useState({});
  const [selectedBoardId, setSelectedBoardId] = useState('');
  const [section, setSection] = useState('active');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [boardForm, setBoardForm] = useState(null);
  const [staff, setStaff] = useState([]);
  const [teams, setTeams] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [shareInfo, setShareInfo] = useState(null);
  const [immersive, setImmersive] = useState(false);
  const [responseDraft, setResponseDraft] = useState('');
  const [editingOwn, setEditingOwn] = useState(null);
  const [moderatingResponse, setModeratingResponse] = useState(null);
  const [showDeletedResponses, setShowDeletedResponses] = useState(false);

  useEffect(() => {
    if (!schoolId || permissionsLoading) return undefined;
    setLoading(true);
    setError('');
    setBoards([]);
    setSelectedBoardId('');
    return subscribeCollectiveBrainBoards({
      db, schoolId, uid: currentUser?.uid, canManage,
      onData: items => {
        setBoards(items); setLoading(false);
        if (canManage) items.filter(item => item.schemaVersion !== 2 && !migratedBoardsRef.current.has(item.id)).forEach(item => {
          migratedBoardsRef.current.add(item.id);
          updateCollectiveBrainBoard({
            db, schoolId, boardId: item.id,
            actor: { uid: currentUser?.uid }, question: item.question, description: item.description,
            audienceMode: 'school', audienceUserIds: [], audienceTeamIds: [], visibility: 'private',
            publicShareId: '', maxResponsesPerUser: 1, linkedTaskIds: [],
          }).catch(() => migratedBoardsRef.current.delete(item.id));
        });
      },
      onError: () => { setError('לא ניתן לטעון את הלוחות.'); setLoading(false); },
    });
  }, [canManage, currentUser?.uid, permissionsLoading, schoolId]);

  useEffect(() => {
    if (!schoolId || !canManage) return undefined;
    let cancelled = false;
    async function loadManagementOptions() {
      const results = [];
      const seen = new Set();
      const [modernUsers, legacyUsers, nestedTeams, legacyTeams, nestedTasks, legacyTasks] = await Promise.allSettled([
        getDocs(query(collection(db, 'users'), where('schoolIds', 'array-contains', schoolId))),
        getDocs(query(collection(db, 'users'), where('schoolId', '==', schoolId))),
        getDocs(collection(db, `schools/${schoolId}/teams`)),
        getDocs(collection(db, `teams_${schoolId}`)),
        getDocs(collection(db, `schools/${schoolId}/tasks`)),
        getDocs(collection(db, `tasks_${schoolId}`)),
      ]);
      [modernUsers, legacyUsers].forEach(result => result.status === 'fulfilled' && result.value.docs.forEach(item => {
        if (!seen.has(item.id) && item.data().accountStatus !== 'disabled') {
          seen.add(item.id); results.push({ id: item.id, ...item.data() });
        }
      }));
      const mergeDocs = entries => {
        const map = new Map();
        entries.forEach(result => result.status === 'fulfilled' && result.value.docs.forEach(item => map.set(item.id, { id: item.id, ...item.data() })));
        return [...map.values()];
      };
      if (!cancelled) {
        setStaff(results.sort((a, b) => (a.fullName || '').localeCompare(b.fullName || '', 'he')));
        setTeams(mergeDocs([nestedTeams, legacyTeams]).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'he')));
        setTasks(mergeDocs([nestedTasks, legacyTasks]).filter(item => item.status !== 'deleted'));
      }
    }
    loadManagementOptions().catch(() => setError('חלק מאפשרויות הקהל והמשימות לא נטענו.'));
    return () => { cancelled = true; };
  }, [canManage, schoolId]);

  useEffect(() => {
    const onFullscreen = () => setImmersive(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => document.removeEventListener('fullscreenchange', onFullscreen);
  }, []);

  useEffect(() => {
    if (!schoolId) return undefined;
    const visibleBoards = boards.filter(board => board.status !== 'deleted');
    const unsubscribers = visibleBoards.map(board => subscribeCollectiveBrainResponseCount({
      db, schoolId, boardId: board.id,
      onData: count => setResponseCounts(previous => ({ ...previous, [board.id]: count })),
      onError: () => undefined,
    }));
    return () => unsubscribers.forEach(unsubscribe => unsubscribe());
  }, [boards, schoolId]);

  const filteredBoards = useMemo(() => boards.filter(board => (
    section === 'active' ? ['open', 'closed'].includes(board.status) : board.status === section
  )), [boards, section]);

  useEffect(() => {
    if (!filteredBoards.some(board => board.id === selectedBoardId)) {
      setSelectedBoardId(filteredBoards[0]?.id || '');
    }
  }, [filteredBoards, selectedBoardId]);

  const selectedBoard = boards.find(board => board.id === selectedBoardId) || null;

  useEffect(() => {
    setResponses([]);
    setResponseDraft('');
    setEditingOwn(null);
    setShowDeletedResponses(false);
    if (!schoolId || !selectedBoardId) return undefined;
    return subscribeCollectiveBrainResponses({
      db, schoolId, boardId: selectedBoardId, canManage,
      onData: setResponses,
      onError: () => setError('לא ניתן לטעון את התשובות ללוח.'),
    });
  }, [canManage, schoolId, selectedBoardId]);

  const activeResponses = responses.filter(item => item.status === 'active');
  const deletedResponses = responses.filter(item => item.status === 'deleted');
  const ownResponses = findOwnCollectiveBrainResponses(activeResponses, currentUser?.uid);
  const canContribute = canContributeToCollectiveBrainBoard(selectedBoard, ownResponses.length);

  function publicParticipantsFor(boardLike) {
    const allowed = boardLike?.audienceMode === 'restricted'
      ? new Set(boardLike.audienceUserIds || [])
      : null;
    return staff
      .filter(person => !allowed || allowed.has(person.id))
      .map(person => ({ ...person, fullName: person.fullName || person.email || 'איש צוות' }));
  }

  function openNewBoard() {
    setBoardForm({ id: '', question: '', description: '', audienceMode: 'school', audienceUserIds: [], audienceTeamIds: [], visibility: 'private', publicShareId: '', maxResponsesPerUser: 1, linkedTaskIds: [] });
  }

  function openEditBoard(board) {
    setBoardForm({ id: board.id, question: board.question, description: board.description || '', audienceMode: board.audienceMode || 'school', audienceUserIds: board.audienceUserIds || [], audienceTeamIds: board.audienceTeamIds || [], visibility: board.visibility || 'private', publicShareId: board.publicShareId || '', maxResponsesPerUser: board.maxResponsesPerUser || 1, linkedTaskIds: board.linkedTaskIds || [] });
  }

  async function saveBoard(event) {
    event.preventDefault();
    if (saving) return;
    const questionChanged = boardForm.id && boards.find(item => item.id === boardForm.id)?.question !== boardForm.question.trim();
    if (questionChanged && (responseCounts[boardForm.id] || 0) > 0
      && !window.confirm('כבר התקבלו תשובות. שינוי השאלה עלול לשנות את ההקשר שלהן. להמשיך?')) return;
    setSaving(true);
    setError('');
    try {
      if (boardForm.audienceMode === 'restricted' && boardForm.audienceUserIds.length === 0) {
        throw new Error('AUDIENCE_REQUIRED');
      }
      const existingBoard = boardForm.id ? boards.find(item => item.id === boardForm.id) : null;
      const desiredPublic = boardForm.visibility === 'public';
      const safeForm = {
        ...boardForm,
        visibility: existingBoard?.visibility === 'public' ? 'public' : 'private',
        publicShareId: existingBoard?.publicShareId || '',
      };
      let boardId = boardForm.id;
      if (boardForm.id) {
        await updateCollectiveBrainBoard({ db, schoolId, boardId: boardForm.id, actor, ...safeForm });
      } else {
        const id = await createCollectiveBrainBoard({ db, schoolId, actor, ...safeForm });
        boardId = id;
        setSection('active');
        setSelectedBoardId(id);
      }
      if (desiredPublic || existingBoard?.visibility === 'public') {
        const publicResult = await configureCollectiveBrainPublicAccess({
          db, schoolId, boardId, actor, enabled: desiredPublic,
          participants: publicParticipantsFor(boardForm),
        });
        if (desiredPublic) setShareInfo(publicResult);
      }
      setBoardForm(null);
    } catch (saveError) {
      setError(friendlyError(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function changeBoardStatus(status) {
    if (!selectedBoard || saving) return;
    const messages = {
      closed: 'לסגור את הלוח להשתתפות?',
      archived: 'להעביר את הלוח לארכיון?',
      deleted: 'להעביר את הלוח לסל המחזור?',
    };
    if (messages[status] && !window.confirm(messages[status])) return;
    setSaving(true);
    setError('');
    try {
      await setCollectiveBrainBoardStatus({ db, schoolId, boardId: selectedBoard.id, actor, status });
      if (status === 'archived') setSection('archived');
      if (status === 'deleted') setSection('deleted');
      if (status === 'open') setSection('active');
    } catch (saveError) {
      setError(friendlyError(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function saveOwnResponse(event) {
    event.preventDefault();
    if (saving || !responseDraft.trim()) return;
    setSaving(true);
    setError('');
    try {
      if (editingOwn) {
        await updateOwnCollectiveBrainResponse({ db, schoolId, boardId: selectedBoard.id, responseId: editingOwn.id, actor, body: responseDraft });
      } else {
        const used = new Set(ownResponses.map(item => Number.parseInt(item.responseSlot, 10) || 1));
        const responseIndex = Array.from({ length: selectedBoard.maxResponsesPerUser || 1 }, (_, index) => index + 1).find(index => !used.has(index));
        await createCollectiveBrainResponse({
          db, schoolId, boardId: selectedBoard.id, actor,
          authorName: actor.fullName, body: responseDraft, responseIndex,
        });
      }
      setResponseDraft('');
      setEditingOwn(null);
    } catch (saveError) {
      setError(friendlyError(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function toggleFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen?.();
      setImmersive(false);
      return;
    }
    setImmersive(true);
    await pageRef.current?.requestFullscreen?.().catch(() => undefined);
  }

  async function openShareLinks() {
    if (!selectedBoard || saving) return;
    setSaving(true);
    setError('');
    try {
      const result = await configureCollectiveBrainPublicAccess({
        db, schoolId, boardId: selectedBoard.id, actor, enabled: true,
        participants: publicParticipantsFor(selectedBoard),
      });
      setShareInfo(result);
    } catch (shareError) { setError(friendlyError(shareError)); }
    finally { setSaving(false); }
  }

  function publicUrl(token = '') {
    const root = `${window.location.origin}${window.location.pathname}#/brain/shared/${shareInfo?.shareId || selectedBoard?.publicShareId}`;
    return token ? `${root}?participant=${encodeURIComponent(token)}` : root;
  }

  async function copyText(value) {
    await navigator.clipboard.writeText(value);
  }

  function toggleAudienceUser(userId) {
    setBoardForm(previous => ({
      ...previous,
      audienceUserIds: previous.audienceUserIds.includes(userId)
        ? previous.audienceUserIds.filter(id => id !== userId)
        : [...previous.audienceUserIds, userId],
    }));
  }

  function toggleAudienceTeam(team) {
    const selected = boardForm.audienceTeamIds.includes(team.id);
    const teamMembers = Array.isArray(team.memberIds) ? team.memberIds : [];
    setBoardForm(previous => ({
      ...previous,
      audienceMode: 'restricted',
      audienceTeamIds: selected ? previous.audienceTeamIds.filter(id => id !== team.id) : [...previous.audienceTeamIds, team.id],
      audienceUserIds: selected
        ? previous.audienceUserIds.filter(id => !teamMembers.includes(id))
        : [...new Set([...previous.audienceUserIds, ...teamMembers])],
    }));
  }

  async function saveModeration(event) {
    event.preventDefault();
    if (!moderatingResponse?.body.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      await moderateCollectiveBrainResponse({
        db, schoolId, boardId: selectedBoard.id, responseId: moderatingResponse.id,
        actor, body: moderatingResponse.body,
      });
      setModeratingResponse(null);
    } catch (saveError) {
      setError(friendlyError(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function removeResponse(response) {
    if (!window.confirm(`למחוק את התשובה של ${response.authorName}?`)) return;
    setSaving(true);
    try {
      await deleteCollectiveBrainResponse({ db, schoolId, boardId: selectedBoard.id, responseId: response.id, actor });
    } catch (saveError) { setError(friendlyError(saveError)); }
    finally { setSaving(false); }
  }

  async function restoreResponse(response) {
    setSaving(true);
    try {
      await restoreCollectiveBrainResponse({ db, schoolId, boardId: selectedBoard.id, responseId: response.id, actor });
    } catch (saveError) { setError(friendlyError(saveError)); }
    finally { setSaving(false); }
  }

  if (permissionsLoading || loading) {
    return <div className="brain-page"><div className="brain-loading"><Brain size={36} /><p>טוען את המוח המשותף…</p></div></div>;
  }

  return (
    <div ref={pageRef} className={`brain-page ${immersive ? 'brain-page--immersive' : ''}`} dir="rtl">
      <header className="brain-page-header">
        <div className="brain-title"><span className="brain-title-icon"><Brain size={26} /></span><div><h1>מוח משותף</h1><p>אוספים יחד רעיונות, ניסיון ותובנות של כל אנשי המוסד</p></div></div>
        <div className="brain-header-actions">{selectedBoard && <button className="btn btn-secondary" onClick={toggleFullscreen}>{immersive ? <Minimize2 size={16} /> : <Maximize2 size={16} />} {immersive ? 'יציאה ממסך מלא' : 'מסך מלא'}</button>}{canManage && <button className="btn btn-primary" onClick={openNewBoard}><Plus size={16} /> לוח חדש</button>}</div>
      </header>

      {error && <div className="brain-alert" role="alert">{error}<button onClick={() => setError('')} aria-label="סגירה"><X size={15} /></button></div>}

      <div className="brain-tabs" role="tablist" aria-label="סינון לוחות">
        <button role="tab" aria-selected={section === 'active'} className={section === 'active' ? 'active' : ''} onClick={() => setSection('active')}>לוחות פעילים</button>
        <button role="tab" aria-selected={section === 'archived'} className={section === 'archived' ? 'active' : ''} onClick={() => setSection('archived')}><Archive size={14} /> ארכיון</button>
        {canManage && <button role="tab" aria-selected={section === 'deleted'} className={section === 'deleted' ? 'active' : ''} onClick={() => setSection('deleted')}><Trash2 size={14} /> סל מחזור</button>}
      </div>

      <div className="brain-workspace">
        <aside className="brain-board-list" aria-label="רשימת לוחות">
          {filteredBoards.map(board => (
            <button key={board.id} className={`brain-board-list-item ${board.id === selectedBoardId ? 'selected' : ''}`} onClick={() => setSelectedBoardId(board.id)}>
              <span className={`brain-status-dot brain-status-dot--${board.status}`} />
              <span className="brain-board-list-copy"><strong>{board.question}</strong><small>{STATUS_LABELS[board.status]} · {responseCounts[board.id] || 0} תשובות</small></span>
            </button>
          ))}
          {filteredBoards.length === 0 && <div className="brain-list-empty"><MessageSquareText size={28} /><p>{section === 'active' ? 'עדיין אין לוחות פעילים' : section === 'archived' ? 'הארכיון עדיין ריק' : 'סל המחזור ריק'}</p>{canManage && section === 'active' && <button className="btn btn-secondary btn-sm" onClick={openNewBoard}><Plus size={14} /> יצירת לוח ראשון</button>}</div>}
        </aside>

        <main className="brain-board-area">
          {!selectedBoard ? <div className="brain-empty-board"><Brain size={48} /><h2>בחרו לוח כדי להתחיל</h2><p>השאלות והתשובות של המוסד יוצגו כאן.</p></div> : <>
            <section className={`brain-question brain-question--${selectedBoard.status}`}>
              <div className="brain-question-topline"><span className="brain-status-badge">{selectedBoard.status === 'open' ? <Check size={13} /> : <Lock size={13} />}{STATUS_LABELS[selectedBoard.status]}</span>{canManage && <div className="brain-question-actions">
                <button onClick={toggleFullscreen}>{immersive ? <Minimize2 size={14} /> : <Maximize2 size={14} />} {immersive ? 'יציאה' : 'מסך מלא'}</button>
                {selectedBoard.status !== 'deleted' && <button onClick={() => openEditBoard(selectedBoard)}><Settings2 size={14} /> הגדרות</button>}
                {selectedBoard.visibility === 'public' && <button onClick={openShareLinks}><Share2 size={14} /> שיתוף</button>}
                {selectedBoard.status === 'open' && <button onClick={() => changeBoardStatus('closed')}><Lock size={14} /> סגירה</button>}
                {selectedBoard.status === 'closed' && <button onClick={() => changeBoardStatus('open')}><RotateCcw size={14} /> פתיחה מחדש</button>}
                {selectedBoard.status !== 'archived' && selectedBoard.status !== 'deleted' && <button onClick={() => changeBoardStatus('archived')}><Archive size={14} /> ארכוב</button>}
                {selectedBoard.status === 'archived' && <button onClick={() => changeBoardStatus('open')}><ArchiveRestore size={14} /> שחזור ופתיחה</button>}
                {selectedBoard.status !== 'deleted' && <button className="danger" onClick={() => changeBoardStatus('deleted')}><Trash2 size={14} /> מחיקה</button>}
                {selectedBoard.status === 'deleted' && <button onClick={() => changeBoardStatus('open')}><RotateCcw size={14} /> שחזור</button>}
              </div>}</div>
              <h2>{selectedBoard.question}</h2>
              {selectedBoard.description && <p>{selectedBoard.description}</p>}
              <div className="brain-board-meta"><span>{selectedBoard.visibility === 'public' ? <><Globe2 size={12} /> פומבי</> : <><Lock size={12} /> פרטי</>}</span><span>{selectedBoard.audienceMode === 'school' ? <><Users size={12} /> כל הצוות</> : <><UserRound size={12} /> {selectedBoard.audienceUserIds.length} משתתפים</>}</span><span><MessageSquareText size={12} /> עד {selectedBoard.maxResponsesPerUser || 1} תגובות לאדם</span>{selectedBoard.linkedTaskIds?.length > 0 && <span><ClipboardList size={12} /> {selectedBoard.linkedTaskIds.length} משימות מקושרות</span>}</div>
              {selectedBoard.linkedTaskIds?.length > 0 && <div className="brain-linked-tasks">{selectedBoard.linkedTaskIds.map(taskId => { const task = tasks.find(item => item.id === taskId); return <a key={taskId} href={`#/tasks?task=${encodeURIComponent(taskId)}`}><ClipboardList size={12} /> {task?.title || 'פתיחת המשימה'} <ExternalLink size={11} /></a>; })}</div>}
              <small>נוצר ב־{formatTime(selectedBoard.createdAt)}</small>
            </section>

            {(canContribute || editingOwn) && <form className="brain-response-composer" onSubmit={saveOwnResponse}>
              <label htmlFor="brain-own-response">{editingOwn ? 'עריכת התגובה שלי' : 'מה התגובה שלך?'}</label>
              <textarea id="brain-own-response" value={responseDraft} onChange={event => setResponseDraft(event.target.value)} maxLength={COLLECTIVE_BRAIN_LIMITS.response} rows={4} placeholder="כתבו כאן את הרעיון או התובנה שלכם…" />
              <div><span>{responseDraft.length}/{COLLECTIVE_BRAIN_LIMITS.response}{!editingOwn && ` · תגובה ${ownResponses.length + 1} מתוך ${selectedBoard.maxResponsesPerUser || 1}`}</span><span className="brain-composer-actions">{editingOwn && <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setEditingOwn(null); setResponseDraft(''); }}>ביטול</button>}<button className="btn btn-primary btn-sm" disabled={saving || !responseDraft.trim()}><Save size={14} /> {saving ? 'שומר…' : 'שמירת תגובה'}</button></span></div>
            </form>}

            {ownResponses.length > 0 && !editingOwn && <div className="brain-own-banner"><Check size={16} /><span>פרסמת {ownResponses.length} מתוך {selectedBoard.maxResponsesPerUser || 1} תגובות אפשריות.</span></div>}
            {!canContribute && !editingOwn && selectedBoard.status !== 'deleted' && <div className="brain-readonly-banner"><Lock size={16} /> {selectedBoard.status !== 'open' ? 'הלוח פתוח לקריאה בלבד.' : 'הגעת למכסת התגובות שהוגדרה עבורך.'}</div>}

            <div className="brain-responses-heading"><div><h3>התשובות של הצוות</h3><span>{activeResponses.length} תשובות</span></div>{canManage && deletedResponses.length > 0 && <button className="btn btn-secondary btn-sm" onClick={() => setShowDeletedResponses(value => !value)}><Trash2 size={13} /> {showDeletedResponses ? 'הסתרת מחוקות' : `הצגת מחוקות (${deletedResponses.length})`}</button>}</div>
            {activeResponses.length === 0 ? <div className="brain-no-responses"><MessageSquareText size={36} /><p>עדיין אין תשובות בלוח הזה.</p></div> : <div className="brain-response-grid">{activeResponses.map((response, index) => <article key={response.id} className="brain-response-card">
              <div className="brain-response-card-top"><span className="brain-response-avatar">{response.authorName?.charAt(0) || '?'}</span><div><strong>{response.authorName || 'משתמש'}</strong><small>{formatTime(response.createdAt)}{response.editedAt ? ' · נערך' : ''}{response.moderatedAt ? ' על ידי מנהל' : ''}</small></div><span className="brain-response-number">#{index + 1}</span></div>
              <p>{response.body}</p>
              {(canManage || (response.authorId === currentUser?.uid && selectedBoard.status === 'open')) && <div className="brain-response-actions">{response.authorId === currentUser?.uid && selectedBoard.status === 'open' && <button onClick={() => { setEditingOwn(response); setResponseDraft(response.body); }}><Edit3 size={13} /> עריכת התגובה שלי</button>}{canManage && <><button onClick={() => setModeratingResponse({ ...response })}><Edit3 size={13} /> עריכת מנהל</button><button className="danger" onClick={() => removeResponse(response)}><Trash2 size={13} /> מחיקה</button></>}</div>}
            </article>)}</div>}

            {canManage && showDeletedResponses && deletedResponses.length > 0 && <section className="brain-deleted-responses"><h3>תשובות שנמחקו</h3>{deletedResponses.map(response => <div key={response.id}><span><strong>{response.authorName}</strong> — {response.body}</span><button className="btn btn-secondary btn-sm" onClick={() => restoreResponse(response)}><RotateCcw size={13} /> שחזור</button></div>)}</section>}
          </>}
        </main>
      </div>

      {boardForm && <Modal title={boardForm.id ? 'עריכת לוח' : 'יצירת לוח חדש'} onClose={() => !saving && setBoardForm(null)}><form className="brain-form" onSubmit={saveBoard}>
        <label>השאלה<input value={boardForm.question} onChange={event => setBoardForm(previous => ({ ...previous, question: event.target.value }))} maxLength={COLLECTIVE_BRAIN_LIMITS.question} placeholder="מה נרצה ללמוד יחד?" required /><small>{boardForm.question.length}/{COLLECTIVE_BRAIN_LIMITS.question}</small></label>
        <label>הסבר נוסף — אופציונלי<textarea value={boardForm.description} onChange={event => setBoardForm(previous => ({ ...previous, description: event.target.value }))} maxLength={COLLECTIVE_BRAIN_LIMITS.description} rows={5} placeholder="הקשר, הנחיות או נקודות שכדאי להתייחס אליהן" /><small>{boardForm.description.length}/{COLLECTIVE_BRAIN_LIMITS.description}</small></label>
        <fieldset className="brain-settings-group"><legend>מי יכול לראות את הלוח?</legend><label className="brain-choice"><input type="radio" name="audience" checked={boardForm.audienceMode === 'school'} onChange={() => setBoardForm(previous => ({ ...previous, audienceMode: 'school', audienceUserIds: [], audienceTeamIds: [] }))} /><span><strong>כל אנשי הצוות</strong><small>הלוח יוצג לכל משתמש פעיל במוסד</small></span></label><label className="brain-choice"><input type="radio" name="audience" checked={boardForm.audienceMode === 'restricted'} onChange={() => setBoardForm(previous => ({ ...previous, audienceMode: 'restricted' }))} /><span><strong>אנשים וצוותים מסוימים</strong><small>רק מי שמסומן יוכל לראות ולהגיב</small></span></label>
        {boardForm.audienceMode === 'restricted' && <div className="brain-audience-picker">{teams.length > 0 && <div><h4>הוספה לפי צוות</h4><div className="brain-chip-list">{teams.map(team => <button key={team.id} type="button" className={boardForm.audienceTeamIds.includes(team.id) ? 'selected' : ''} onClick={() => toggleAudienceTeam(team)}><Users size={13} /> {team.name || 'צוות'} ({team.memberIds?.length || 0})</button>)}</div></div>}<div><div className="brain-picker-title"><h4>האנשים החשופים ללוח ({boardForm.audienceUserIds.length})</h4><span><button type="button" onClick={() => setBoardForm(previous => ({ ...previous, audienceUserIds: staff.map(person => person.id) }))}>בחירת כולם</button><button type="button" onClick={() => setBoardForm(previous => ({ ...previous, audienceUserIds: [], audienceTeamIds: [] }))}>ניקוי</button></span></div><div className="brain-person-list">{staff.map(person => <label key={person.id}><input type="checkbox" checked={boardForm.audienceUserIds.includes(person.id)} onChange={() => toggleAudienceUser(person.id)} /><span>{person.fullName || person.email || 'איש צוות'}</span></label>)}</div></div></div>}</fieldset>
        <div className="brain-form-row"><label>מכסת תגובות לכל אדם<input type="number" min="1" max="20" value={boardForm.maxResponsesPerUser} onChange={event => setBoardForm(previous => ({ ...previous, maxResponsesPerUser: Number(event.target.value) }))} /></label><label>מצב שיתוף<select value={boardForm.visibility} onChange={event => setBoardForm(previous => ({ ...previous, visibility: event.target.value }))}><option value="private">פרטי — בתוך האפליקציה</option><option value="public">פומבי — קישור חיצוני</option></select></label></div>
        {boardForm.visibility === 'public' && <p className="brain-public-note"><Globe2 size={15} /> ייווצר קישור צפייה כללי וקישור אישי לכל משתתף מורשה. השם בקישור האישי נקבע מראש ואינו ניתן לשינוי.</p>}
        <fieldset className="brain-settings-group"><legend>חיבור למשימות</legend><p className="brain-field-help">אפשר לבחור משימות קיימות שהוקצו לאדם או לצוות המתאימים.</p><div className="brain-task-picker">{tasks.length === 0 ? <span>אין משימות זמינות לחיבור.</span> : tasks.slice(0, 100).map(task => <label key={task.id}><input type="checkbox" checked={boardForm.linkedTaskIds.includes(task.id)} onChange={() => setBoardForm(previous => ({ ...previous, linkedTaskIds: previous.linkedTaskIds.includes(task.id) ? previous.linkedTaskIds.filter(id => id !== task.id) : [...previous.linkedTaskIds, task.id] }))} /><span>{task.title || 'משימה ללא כותרת'}</span></label>)}</div></fieldset>
        <footer><button type="button" className="btn btn-secondary" onClick={() => setBoardForm(null)}>ביטול</button><button className="btn btn-primary" disabled={saving || !boardForm.question.trim()}><Save size={15} /> {saving ? 'שומר…' : 'שמירת הלוח'}</button></footer>
      </form></Modal>}

      {shareInfo && <Modal title="שיתוף הלוח" onClose={() => setShareInfo(null)}><div className="brain-share-panel"><p>קישור צפייה כללי — מי שמחזיק בו יכול לראות את הלוח, אך אינו יכול להגיב בשם אדם אחר.</p><div className="brain-share-row" dir="ltr"><input readOnly value={publicUrl()} /><button className="btn btn-secondary btn-sm" onClick={() => copyText(publicUrl())}><Copy size={14} /> העתקה</button><a className="btn btn-secondary btn-sm" href={publicUrl()} target="_blank" rel="noreferrer"><ExternalLink size={14} /></a></div><h3>קישורים אישיים לתגובה</h3><p>שלחו לכל איש צוות רק את הקישור שלו. הקישור קובע את שם הכותב ומאפשר תגובה ללא התחברות.</p><div className="brain-share-people">{shareInfo.participants?.map(person => <div key={person.userId}><span>{person.authorName}</span><button className="btn btn-secondary btn-sm" onClick={() => copyText(publicUrl(person.token))}><Copy size={13} /> העתקת קישור אישי</button></div>)}</div></div></Modal>}

      {moderatingResponse && <Modal title={`עריכת התשובה של ${moderatingResponse.authorName}`} onClose={() => !saving && setModeratingResponse(null)}><form className="brain-form" onSubmit={saveModeration}><label>תוכן התשובה<textarea value={moderatingResponse.body} onChange={event => setModeratingResponse(previous => ({ ...previous, body: event.target.value }))} maxLength={COLLECTIVE_BRAIN_LIMITS.response} rows={8} required /><small>{moderatingResponse.body.length}/{COLLECTIVE_BRAIN_LIMITS.response}</small></label><p className="brain-moderation-note">הכרטיס יסומן כתשובה שנערכה על ידי מנהל.</p><footer><button type="button" className="btn btn-secondary" onClick={() => setModeratingResponse(null)}>ביטול</button><button className="btn btn-primary" disabled={saving || !moderatingResponse.body.trim()}><Save size={15} /> שמירת השינוי</button></footer></form></Modal>}
    </div>
  );
}
