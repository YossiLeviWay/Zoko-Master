import { useEffect, useState } from 'react';
import { db } from '../../firebase.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { usePermissions } from '../../hooks/usePermissions.js';
import { listSchoolStaff } from '../../services/firestore/classStudentRepository.js';
import { answerReplyRequest, createReplyRequest, listenReplyRequests, replyFailureText } from '../../services/firestore/replyRequestRepository.js';
import { answeredRequestsFor, canRequestReply, choiceLabel, openRequestsFor, promptsFor, REPLY_CHOICES, snoozeReply, stackSlice } from '../../utils/replyRequests.js';
import './ReplyRequests.css';

export default function ReplyRequestPanel({ draft = null, onDraftClose = () => {}, composerOnly = false }) {
  const { currentUser, userData, selectedSchool, isPrincipal, isGlobalAdmin } = useAuth();
  const { permissions } = usePermissions();
  const schoolId = selectedSchool || userData?.schoolId;
  const uid = currentUser?.uid;
  const manager = isPrincipal() || isGlobalAdmin() || canRequestReply({ permissions });
  const [items, setItems] = useState([]);
  const [rulesNote, setRulesNote] = useState('');
  const [openMore, setOpenMore] = useState(false);
  const [answeredMore, setAnsweredMore] = useState(false);
  const [promptMore, setPromptMore] = useState(false);
  const [active, setActive] = useState(null);
  const [choice, setChoice] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [composer, setComposer] = useState(null);
  const [staff, setStaff] = useState([]);

  useEffect(() => {
    if (composerOnly || !schoolId || !uid) return undefined;
    return listenReplyRequests({
      db, schoolId, uid, canAssign: manager,
      onData: setItems,
      onError: error => setRulesNote(replyFailureText(error)),
    });
  }, [composerOnly, schoolId, uid, manager]);

  useEffect(() => { if (draft) setComposer({ ...draft, question: '', assigneeId: '', dueDate: '', reminderAt: '' }); }, [draft]);

  useEffect(() => {
    if (!composer || !schoolId || staff.length) return undefined;
    let live = true;
    listSchoolStaff(db, schoolId).then(rows => { if (live) setStaff(rows); }).catch(() => {});
    return () => { live = false; };
  }, [composer, schoolId, staff.length]);

  if (!uid || !schoolId) return null;
  const prompts = promptsFor(items, uid);
  const waiting = openRequestsFor(items, uid, { manager });
  const answered = answeredRequestsFor(items, uid, { manager }).slice(0, 8);
  const promptStack = stackSlice(prompts, promptMore);
  const waitStack = stackSlice(waiting, openMore);
  const answerStack = stackSlice(answered, answeredMore);
  const actor = { uid, fullName: userData?.fullName || '' };

  async function sendAnswer(request, choice) {
    setBusy(true);
    setRulesNote('');
    try {
      await answerReplyRequest({ db, schoolId, actor, request, choice, note, date });
      setActive(null); setNote(''); setDate('');
    } catch (error) { setRulesNote(replyFailureText(error)); }
    setBusy(false);
  }

  async function sendRequest() {
    setBusy(true);
    setRulesNote('');
    try {
      const result = await createReplyRequest({ db, schoolId, actor, input: composer });
      setComposer(null);
      onDraftClose();
      if (!result.notified) setRulesNote('הבקשה נשמרה. הפעמון יציג אותה כשההתראות זמינות.');
    } catch (error) { setRulesNote(replyFailureText(error)); }
    setBusy(false);
  }

  return (
    <div className="reply-requests">
      {rulesNote && <p className="reply-requests__note" role="status">{rulesNote}</p>}
      {!composerOnly && prompts.length > 0 && (
        <section className="reply-stack reply-stack--prompt" aria-label="בקשות שממתינות לתשובתך">
          <header><strong>מבקשים את תשובתך</strong><span>{prompts.length}</span></header>
          {promptStack.shown.map(item => (
            <article key={item.id} className="reply-card">
              <p>{item.question}</p>
              <small>{item.sourceTitle || 'בקשה עצמאית'}{item.requesterName ? ` · ${item.requesterName}` : ''}{item.dueDate ? ` · עד ${item.dueDate}` : ''}</small>
              <div className="reply-card__choices">
                {REPLY_CHOICES.map(option => <button type="button" key={option.id} disabled={busy} aria-pressed={active === item.id && choice === option.id} onClick={() => { setActive(item.id); setChoice(option.id); }}>{option.label}</button>)}
              </div>
              {active === item.id && <div className="reply-card__extra"><input aria-label="הערה" value={note} maxLength={2000} placeholder="הערה" onChange={event => setNote(event.target.value)} /><input aria-label="תאריך חדש" type="date" value={date} onChange={event => setDate(event.target.value)} /><button type="button" disabled={busy || !choice} onClick={() => sendAnswer(item, choice)}>שליחה</button></div>}
              <button type="button" className="reply-card__later" onClick={() => { snoozeReply(item.id); setItems(current => [...current]); }}>הזכר לי אחר כך</button>
            </article>
          ))}
          {promptStack.hidden > 0 && <button type="button" className="reply-stack__more" onClick={() => setPromptMore(true)}>עוד {promptStack.hidden}</button>}
        </section>
      )}
      {!composerOnly && manager && (waiting.length > 0 || answered.length > 0) && (
        <section className="reply-stack" aria-label="בקשות עדכון שפתחת">
          <header><strong>ממתינים לתשובה</strong><span>{waiting.length}</span><button type="button" onClick={() => setComposer({ sourceType: 'standalone', sourceId: '', sourceTitle: '', question: '', assigneeId: '', dueDate: '', reminderAt: '' })}>בקשה חדשה</button></header>
          {waitStack.shown.map(item => <p key={item.id} className="reply-row">{item.assigneeName || item.assigneeId} עדיין לא ענה · {item.sourceTitle || item.question}</p>)}
          {waitStack.hidden > 0 && <button type="button" className="reply-stack__more" onClick={() => setOpenMore(true)}>עוד {waitStack.hidden}</button>}
          {answered.length > 0 && <header><strong>תשובות שהתקבלו</strong></header>}
          {answerStack.shown.map(item => <p key={item.id} className="reply-row is-done">{item.sourceTitle || item.question}: {choiceLabel(item.answer?.choice)}{item.answer?.note ? ` — ${item.answer.note}` : ''}</p>)}
          {answerStack.hidden > 0 && <button type="button" className="reply-stack__more" onClick={() => setAnsweredMore(true)}>עוד {answerStack.hidden}</button>}
        </section>
      )}
      {composer && (
        <form className="reply-composer" onSubmit={event => { event.preventDefault(); sendRequest(); }}>
          <strong>{composer.sourceTitle || 'בקשת תשובה'}</strong>
          <label>למי<select value={composer.assigneeId} onChange={event => setComposer({ ...composer, assigneeId: event.target.value })} required><option value="">בחרו איש צוות</option>{staff.map(person => <option key={person.id} value={person.id}>{person.fullName || person.name || person.id}</option>)}</select></label>
          <label>השאלה<textarea required maxLength={500} value={composer.question} onChange={event => setComposer({ ...composer, question: event.target.value })} placeholder="האם תיאמת את סדנת ODT? נשלח תשלום?" /></label>
          <label>תאריך יעד<input type="date" value={composer.dueDate} onChange={event => setComposer({ ...composer, dueDate: event.target.value })} /></label>
          <footer><button type="submit" disabled={busy}>שליחת הבקשה</button><button type="button" onClick={() => { setComposer(null); onDraftClose(); }}>ביטול</button></footer>
        </form>
      )}
    </div>
  );
}
