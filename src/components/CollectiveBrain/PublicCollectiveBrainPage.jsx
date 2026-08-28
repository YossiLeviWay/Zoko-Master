import { useCallback, useEffect, useState } from 'react';
import { Brain, Check, Lock, RefreshCw, Save } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  getPublicCollectiveBrainBoard,
  submitPublicCollectiveBrainResponse,
} from '../../services/adminUserService';
import { COLLECTIVE_BRAIN_LIMITS } from '../../utils/collectiveBrain';
import './CollectiveBrain.css';

function formatTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

export default function PublicCollectiveBrainPage() {
  const { shareId } = useParams();
  const [searchParams] = useSearchParams();
  const participantToken = searchParams.get('participant') || '';
  const [data, setData] = useState(null);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await getPublicCollectiveBrainBoard({ shareId, participantToken }));
    } catch {
      setError('הקישור אינו פעיל או שהלוח אינו פומבי עוד.');
    } finally { setLoading(false); }
  }, [participantToken, shareId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const interval = window.setInterval(() => {
      getPublicCollectiveBrainBoard({ shareId, participantToken }).then(setData).catch(() => undefined);
    }, 12000);
    return () => window.clearInterval(interval);
  }, [participantToken, shareId]);

  async function submit(event) {
    event.preventDefault();
    if (!body.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      await submitPublicCollectiveBrainResponse({ shareId, participantToken, body });
      setBody('');
      setSaved(true);
      await load();
    } catch (submitError) {
      const reason = submitError?.details?.reason || submitError?.customData?.details?.reason;
      setError(reason === 'response-limit' ? 'הגעת למכסת התגובות שהוגדרה עבורך.' : 'לא ניתן לשמור. ייתכן שהלוח ננעל או שהקישור האישי אינו תקף.');
    } finally { setSaving(false); }
  }

  if (loading) return <div className="brain-public-page" dir="rtl"><div className="brain-loading"><Brain size={42} /><p>טוען את הלוח…</p></div></div>;
  if (!data?.board) return <div className="brain-public-page" dir="rtl"><div className="brain-public-error"><Lock size={38} /><h1>הלוח אינו זמין</h1><p>{error}</p></div></div>;
  const { board, participant, responses } = data;
  const remaining = participant ? Math.max(0, board.maxResponsesPerUser - participant.responseCount) : 0;

  return <div className="brain-public-page" dir="rtl">
    <header className="brain-public-brand"><Brain size={22} /><strong>מוח משותף</strong><button onClick={load}><RefreshCw size={15} /> רענון</button></header>
    <main className="brain-public-content">
      <section className={`brain-question brain-question--${board.status}`}>
        <span className="brain-status-badge">{board.status === 'open' ? <Check size={13} /> : <Lock size={13} />}{board.status === 'open' ? 'פתוח להשתתפות' : 'קריאה בלבד'}</span>
        <h1>{board.question}</h1>{board.description && <p>{board.description}</p>}
      </section>
      {saved && <div className="brain-own-banner"><Check size={16} /> התגובה נשמרה בהצלחה.</div>}
      {error && <div className="brain-alert" role="alert">{error}</div>}
      {participant && board.status === 'open' && remaining > 0 && <form className="brain-response-composer" onSubmit={submit}>
        <label htmlFor="public-brain-response">תגובה בשם {participant.authorName}</label>
        <p className="brain-public-identity-note">השם נקבע מראש בקישור האישי ואינו ניתן לשינוי.</p>
        <textarea id="public-brain-response" value={body} onChange={event => setBody(event.target.value)} maxLength={COLLECTIVE_BRAIN_LIMITS.response} rows={4} placeholder="כתבו כאן את התגובה…" />
        <div><span>{body.length}/{COLLECTIVE_BRAIN_LIMITS.response} · נותרו {remaining} תגובות</span><button className="btn btn-primary btn-sm" disabled={saving || !body.trim()}><Save size={14} /> {saving ? 'שומר…' : 'שמירת תגובה'}</button></div>
      </form>}
      {!participant && <div className="brain-readonly-banner"><Lock size={16} /> זהו קישור צפייה. כדי להגיב יש לפתוח את הקישור האישי שנשלח אליך.</div>}
      {participant && remaining === 0 && <div className="brain-readonly-banner"><Check size={16} /> מכסת התגובות שלך נוצלה.</div>}
      <div className="brain-responses-heading"><div><h2>תשובות הצוות</h2><span>{responses.length} תשובות</span></div></div>
      <div className="brain-response-grid">{responses.map((response, index) => <article key={response.id} className="brain-response-card"><div className="brain-response-card-top"><span className="brain-response-avatar">{response.authorName?.charAt(0) || '?'}</span><div><strong>{response.authorName}</strong><small>{formatTime(response.createdAt)}</small></div><span className="brain-response-number">#{index + 1}</span></div><p>{response.body}</p></article>)}</div>
    </main>
  </div>;
}
