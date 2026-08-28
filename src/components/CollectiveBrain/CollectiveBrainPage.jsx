import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  Brain,
  Check,
  Edit3,
  Lock,
  MessageSquareText,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { db } from '../../firebase';
import {
  createCollectiveBrainBoard,
  createCollectiveBrainResponse,
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
  findOwnCollectiveBrainResponse,
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
  const [responseDraft, setResponseDraft] = useState('');
  const [editingOwn, setEditingOwn] = useState(false);
  const [moderatingResponse, setModeratingResponse] = useState(null);
  const [showDeletedResponses, setShowDeletedResponses] = useState(false);

  useEffect(() => {
    if (!schoolId || permissionsLoading) return undefined;
    setLoading(true);
    setError('');
    setBoards([]);
    setSelectedBoardId('');
    return subscribeCollectiveBrainBoards({
      db, schoolId, canManage,
      onData: items => { setBoards(items); setLoading(false); },
      onError: () => { setError('לא ניתן לטעון את הלוחות.'); setLoading(false); },
    });
  }, [canManage, permissionsLoading, schoolId]);

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
    setEditingOwn(false);
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
  const ownResponse = findOwnCollectiveBrainResponse(activeResponses, currentUser?.uid);
  const canContribute = canContributeToCollectiveBrainBoard(selectedBoard);

  function openNewBoard() {
    setBoardForm({ id: '', question: '', description: '' });
  }

  function openEditBoard(board) {
    setBoardForm({ id: board.id, question: board.question, description: board.description || '' });
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
      if (boardForm.id) {
        await updateCollectiveBrainBoard({ db, schoolId, boardId: boardForm.id, actor, ...boardForm });
      } else {
        const id = await createCollectiveBrainBoard({ db, schoolId, actor, ...boardForm });
        setSection('active');
        setSelectedBoardId(id);
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
      if (ownResponse) {
        await updateOwnCollectiveBrainResponse({ db, schoolId, boardId: selectedBoard.id, actor, body: responseDraft });
      } else {
        await createCollectiveBrainResponse({
          db, schoolId, boardId: selectedBoard.id, actor,
          authorName: actor.fullName, body: responseDraft,
        });
      }
      setResponseDraft('');
      setEditingOwn(false);
    } catch (saveError) {
      setError(friendlyError(saveError));
    } finally {
      setSaving(false);
    }
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
    <div className="brain-page" dir="rtl">
      <header className="brain-page-header">
        <div className="brain-title"><span className="brain-title-icon"><Brain size={26} /></span><div><h1>מוח משותף</h1><p>אוספים יחד רעיונות, ניסיון ותובנות של כל אנשי המוסד</p></div></div>
        {canManage && <button className="btn btn-primary" onClick={openNewBoard}><Plus size={16} /> לוח חדש</button>}
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
                {selectedBoard.status !== 'deleted' && <button onClick={() => openEditBoard(selectedBoard)}><Edit3 size={14} /> עריכה</button>}
                {selectedBoard.status === 'open' && <button onClick={() => changeBoardStatus('closed')}><Lock size={14} /> סגירה</button>}
                {selectedBoard.status === 'closed' && <button onClick={() => changeBoardStatus('open')}><RotateCcw size={14} /> פתיחה מחדש</button>}
                {selectedBoard.status !== 'archived' && selectedBoard.status !== 'deleted' && <button onClick={() => changeBoardStatus('archived')}><Archive size={14} /> ארכוב</button>}
                {selectedBoard.status === 'archived' && <button onClick={() => changeBoardStatus('open')}><ArchiveRestore size={14} /> שחזור ופתיחה</button>}
                {selectedBoard.status !== 'deleted' && <button className="danger" onClick={() => changeBoardStatus('deleted')}><Trash2 size={14} /> מחיקה</button>}
                {selectedBoard.status === 'deleted' && <button onClick={() => changeBoardStatus('open')}><RotateCcw size={14} /> שחזור</button>}
              </div>}</div>
              <h2>{selectedBoard.question}</h2>
              {selectedBoard.description && <p>{selectedBoard.description}</p>}
              <small>נוצר ב־{formatTime(selectedBoard.createdAt)}</small>
            </section>

            {canContribute && (!ownResponse || editingOwn) && <form className="brain-response-composer" onSubmit={saveOwnResponse}>
              <label htmlFor="brain-own-response">{ownResponse ? 'עריכת התשובה שלי' : 'מה התשובה שלך?'}</label>
              <textarea id="brain-own-response" value={responseDraft} onChange={event => setResponseDraft(event.target.value)} maxLength={COLLECTIVE_BRAIN_LIMITS.response} rows={4} placeholder="כתבו כאן את הרעיון או התובנה שלכם…" />
              <div><span>{responseDraft.length}/{COLLECTIVE_BRAIN_LIMITS.response}</span><span className="brain-composer-actions">{ownResponse && <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setEditingOwn(false); setResponseDraft(''); }}>ביטול</button>}<button className="btn btn-primary btn-sm" disabled={saving || !responseDraft.trim()}><Save size={14} /> {saving ? 'שומר…' : 'שמירת תשובה'}</button></span></div>
            </form>}

            {canContribute && ownResponse && !editingOwn && <div className="brain-own-banner"><Check size={16} /><span>התשובה שלך נמצאת בלוח.</span><button onClick={() => { setResponseDraft(ownResponse.body); setEditingOwn(true); }}><Edit3 size={14} /> עריכת התשובה שלי</button></div>}
            {!canContribute && selectedBoard.status !== 'deleted' && <div className="brain-readonly-banner"><Lock size={16} /> הלוח פתוח לקריאה בלבד ולא ניתן להוסיף או לערוך תשובות.</div>}

            <div className="brain-responses-heading"><div><h3>התשובות של הצוות</h3><span>{activeResponses.length} תשובות</span></div>{canManage && deletedResponses.length > 0 && <button className="btn btn-secondary btn-sm" onClick={() => setShowDeletedResponses(value => !value)}><Trash2 size={13} /> {showDeletedResponses ? 'הסתרת מחוקות' : `הצגת מחוקות (${deletedResponses.length})`}</button>}</div>
            {activeResponses.length === 0 ? <div className="brain-no-responses"><MessageSquareText size={36} /><p>עדיין אין תשובות בלוח הזה.</p></div> : <div className="brain-response-grid">{activeResponses.map((response, index) => <article key={response.id} className="brain-response-card">
              <div className="brain-response-card-top"><span className="brain-response-avatar">{response.authorName?.charAt(0) || '?'}</span><div><strong>{response.authorName || 'משתמש'}</strong><small>{formatTime(response.createdAt)}{response.editedAt ? ' · נערך' : ''}{response.moderatedAt ? ' על ידי מנהל' : ''}</small></div><span className="brain-response-number">#{index + 1}</span></div>
              <p>{response.body}</p>
              {canManage && <div className="brain-response-actions"><button onClick={() => setModeratingResponse({ ...response })}><Edit3 size={13} /> עריכה</button><button className="danger" onClick={() => removeResponse(response)}><Trash2 size={13} /> מחיקה</button></div>}
            </article>)}</div>}

            {canManage && showDeletedResponses && deletedResponses.length > 0 && <section className="brain-deleted-responses"><h3>תשובות שנמחקו</h3>{deletedResponses.map(response => <div key={response.id}><span><strong>{response.authorName}</strong> — {response.body}</span><button className="btn btn-secondary btn-sm" onClick={() => restoreResponse(response)}><RotateCcw size={13} /> שחזור</button></div>)}</section>}
          </>}
        </main>
      </div>

      {boardForm && <Modal title={boardForm.id ? 'עריכת לוח' : 'יצירת לוח חדש'} onClose={() => !saving && setBoardForm(null)}><form className="brain-form" onSubmit={saveBoard}>
        <label>השאלה<input value={boardForm.question} onChange={event => setBoardForm(previous => ({ ...previous, question: event.target.value }))} maxLength={COLLECTIVE_BRAIN_LIMITS.question} placeholder="מה נרצה ללמוד יחד?" required /><small>{boardForm.question.length}/{COLLECTIVE_BRAIN_LIMITS.question}</small></label>
        <label>הסבר נוסף — אופציונלי<textarea value={boardForm.description} onChange={event => setBoardForm(previous => ({ ...previous, description: event.target.value }))} maxLength={COLLECTIVE_BRAIN_LIMITS.description} rows={5} placeholder="הקשר, הנחיות או נקודות שכדאי להתייחס אליהן" /><small>{boardForm.description.length}/{COLLECTIVE_BRAIN_LIMITS.description}</small></label>
        <footer><button type="button" className="btn btn-secondary" onClick={() => setBoardForm(null)}>ביטול</button><button className="btn btn-primary" disabled={saving || !boardForm.question.trim()}><Save size={15} /> {saving ? 'שומר…' : 'שמירת הלוח'}</button></footer>
      </form></Modal>}

      {moderatingResponse && <Modal title={`עריכת התשובה של ${moderatingResponse.authorName}`} onClose={() => !saving && setModeratingResponse(null)}><form className="brain-form" onSubmit={saveModeration}><label>תוכן התשובה<textarea value={moderatingResponse.body} onChange={event => setModeratingResponse(previous => ({ ...previous, body: event.target.value }))} maxLength={COLLECTIVE_BRAIN_LIMITS.response} rows={8} required /><small>{moderatingResponse.body.length}/{COLLECTIVE_BRAIN_LIMITS.response}</small></label><p className="brain-moderation-note">הכרטיס יסומן כתשובה שנערכה על ידי מנהל.</p><footer><button type="button" className="btn btn-secondary" onClick={() => setModeratingResponse(null)}>ביטול</button><button className="btn btn-primary" disabled={saving || !moderatingResponse.body.trim()}><Save size={15} /> שמירת השינוי</button></footer></form></Modal>}
    </div>
  );
}
