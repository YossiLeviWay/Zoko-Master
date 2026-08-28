import { useCallback, useEffect, useState } from 'react';
import { Brain, Check, Lock, RefreshCw, Save } from 'lucide-react';
import { signInAnonymously } from 'firebase/auth';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  loadPublicCollectiveBrainBoard,
  subscribePublicCollectiveBrainBoard,
  submitPublicCollectiveBrainResponse,
} from '../../services/firestore/collectiveBrainRepository';
import { auth, db } from '../../firebase';
import { COLLECTIVE_BRAIN_LIMITS } from '../../utils/collectiveBrain';
import './CollectiveBrain.css';

function formatTime(value) {
  if (!value) return '';
  const date = value?.toDate ? value.toDate() : value?.seconds ? new Date(value.seconds * 1000) : new Date(value);
  return new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

export default function PublicCollectiveBrainPage() {
  const { shareId } = useParams();
  const [searchParams] = useSearchParams();
  const legacyParticipantId = searchParams.get('participant') || '';
  const [selectedParticipantId, setSelectedParticipantId] = useState(legacyParticipantId);
  const [data, setData] = useState(null);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [participantSearch, setParticipantSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      await (auth.currentUser ? Promise.resolve(auth.currentUser) : signInAnonymously(auth));
      setData(await loadPublicCollectiveBrainBoard({
        db, shareId,
      }));
    } catch {
      setError('הקישור אינו פעיל או שהלוח אינו פומבי עוד.');
    } finally { setLoading(false); }
  }, [shareId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!data?.board?.schoolId || !data?.board?.id) return undefined;
    return subscribePublicCollectiveBrainBoard({
      db,
      schoolId: data.board.schoolId,
      boardId: data.board.id,
      shareId,
      onBoard: board => setData(previous => previous ? { ...previous, board } : previous),
      onResponses: responses => setData(previous => previous ? { ...previous, responses } : previous),
      onError: () => {
        setData(null);
        setError('הלוח אינו פומבי עוד או שהקישור בוטל.');
      },
    });
  }, [data?.board?.id, data?.board?.schoolId, shareId]);

  async function submit(event) {
    event.preventDefault();
    if (!body.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      await (auth.currentUser ? Promise.resolve(auth.currentUser) : signInAnonymously(auth));
      await submitPublicCollectiveBrainResponse({
        db, shareId, participantId: selectedParticipantId, body,
      });
      setBody('');
      setSaved(true);
    } catch (submitError) {
      setError(submitError?.message === 'RESPONSE_LIMIT' ? 'הגעת למכסת התגובות שהוגדרה עבורך.' : 'לא ניתן לשמור. ייתכן שהלוח ננעל או שהשם שנבחר אינו זמין לתגובה.');
    } finally { setSaving(false); }
  }

  if (loading) return <div className="brain-public-page" dir="rtl"><div className="brain-loading"><Brain size={42} /><p>טוען את הלוח…</p></div></div>;
  if (!data?.board) return <div className="brain-public-page" dir="rtl"><div className="brain-public-error"><Lock size={38} /><h1>הלוח אינו זמין</h1><p>{error}</p></div></div>;
  const { board, participants = [], responses } = data;
  const participant = participants.find(item => item.id === selectedParticipantId) || null;
  const normalizedSearch = participantSearch.trim().toLocaleLowerCase('he');
  const visibleParticipants = participants.filter(person => (
    person.id === selectedParticipantId
    || !normalizedSearch
    || person.authorName.toLocaleLowerCase('he').includes(normalizedSearch)
  ));
  const participantResponses = participant ? responses.filter(response => response.authorId === participant.authorId).length : 0;
  const remaining = participant ? Math.max(0, board.maxResponsesPerUser - participantResponses) : 0;

  return <div className="brain-public-page" dir="rtl">
    <header className="brain-public-brand"><Brain size={22} /><strong>מוח משותף</strong><button onClick={load}><RefreshCw size={15} /> רענון</button></header>
    <main className="brain-public-content">
      <section className={`brain-question brain-question--${board.status}`}>
        <span className="brain-status-badge">{board.status === 'open' ? <Check size={13} /> : <Lock size={13} />}{board.status === 'open' ? 'פתוח להשתתפות' : 'קריאה בלבד'}</span>
        <h1>{board.question}</h1>{board.description && <p>{board.description}</p>}
      </section>
      {saved && <div className="brain-own-banner"><Check size={16} /> התגובה נשמרה בהצלחה.</div>}
      {error && <div className="brain-alert" role="alert">{error}</div>}
      {board.status === 'open' && participants.length > 0 && <section className="brain-response-composer brain-participant-picker">
        <label htmlFor="public-brain-participant">מי כותב את התגובה?</label>
        <p className="brain-public-identity-note">בחרו את שמכם בלבד. השם נלקח מרשימת אנשי הסגל שהוגדרה ללוח ואינו ניתן להקלדה חופשית.</p>
        <input type="search" value={participantSearch} onChange={event => setParticipantSearch(event.target.value)} placeholder="חיפוש שם ברשימה…" aria-label="חיפוש איש סגל" />
        <select id="public-brain-participant" value={selectedParticipantId} onChange={event => { setSelectedParticipantId(event.target.value); setBody(''); setSaved(false); }}>
          <option value="">בחירת השם שלי…</option>
          {visibleParticipants.map(person => <option key={person.id} value={person.id}>{person.authorName}</option>)}
        </select>
        <small>{visibleParticipants.length} מתוך {participants.length} אנשי סגל</small>
      </section>}
      {participant && board.status === 'open' && remaining > 0 && <form className="brain-response-composer" onSubmit={submit}>
        <label htmlFor="public-brain-response">תגובה בשם {participant.authorName}</label>
        <textarea id="public-brain-response" value={body} onChange={event => setBody(event.target.value)} maxLength={COLLECTIVE_BRAIN_LIMITS.response} rows={4} placeholder="כתבו כאן את התגובה…" />
        <div><span>{body.length}/{COLLECTIVE_BRAIN_LIMITS.response} · נותרו {remaining} תגובות</span><button className="btn btn-primary btn-sm" disabled={saving || !body.trim()}><Save size={14} /> {saving ? 'שומר…' : 'שמירת תגובה'}</button></div>
      </form>}
      {!participant && board.status === 'open' && <div className="brain-readonly-banner"><Lock size={16} /> יש לבחור את שמכם מהרשימה כדי להוסיף תגובה.</div>}
      {participants.length === 0 && board.status === 'open' && <div className="brain-readonly-banner"><Lock size={16} /> לא הוגדרו משתתפים ללוח הזה.</div>}
      {participant && remaining === 0 && <div className="brain-readonly-banner"><Check size={16} /> מכסת התגובות שלך נוצלה.</div>}
      <div className="brain-responses-heading"><div><h2>תשובות הצוות</h2><span>{responses.length} תשובות</span></div></div>
      <div className="brain-response-grid">{responses.map((response, index) => <article key={response.id} className="brain-response-card"><div className="brain-response-card-top"><span className="brain-response-avatar">{response.authorName?.charAt(0) || '?'}</span><div><strong>{response.authorName}</strong><small>{formatTime(response.createdAt)}</small></div><span className="brain-response-number">#{index + 1}</span></div><p>{response.body}</p></article>)}</div>
    </main>
  </div>;
}
