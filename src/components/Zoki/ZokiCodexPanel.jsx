import { useCallback, useEffect, useRef, useState } from 'react';
import { Paperclip, Send, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { subscribePrivateSession } from '../../utils/browserPrivacy.js';
import './ZokiCodex.css';

const phaseNames = { reading: 'קורא קובץ', matching: 'מתאים לכיתות ולנתונים', preparing: 'מכין הצעה', executing: 'מבצע' };
const errors = {
  'codex-login-required': 'יש להתחבר לחשבון האישי באפליקציית Codex במחשב ולנסות שוב.',
  'codex-not-installed': 'Codex לא נמצא. יש להתקין אותו במחשב ולהגדיר את נתיב ההפעלה לפי הוראות הפיילוט.',
  'permission-denied': 'הפעולה נחסמה בהרשאות Firebase. לא נרחיב הרשאות באופן אוטומטי.',
  'session-expired': 'החיבור הסתיים. התחברו מחדש כדי לטעון רק את השיחה המורשית מ־Firebase.',
  'file-too-large': 'אפשר לצרף קובץ אחד עד 20MB.',
  'too-many-rows': 'הקובץ חורג מ־10,000 שורות. יש לפצל אותו לפני הייבוא.',
  'too-many-pages': 'הקובץ חורג מ־100 עמודי PDF.',
  'incomplete-source-coverage': 'לא התקבל פירוט מלא לכל שורות הקובץ. לא יובא דבר; אפשר לבקש ניסיון נוסף או לפצל את הקובץ.',
  'context-too-large': 'המידע גדול מדי לבקשה אחת. צמצמו את הקובץ או את תחום הבקשה; לא יובא חלק ממנו.',
  'data-changed': 'הנתונים השתנו מאז הכנת ההצעה. בקשו הצעה מעודכנת לפני ניסיון נוסף.',
  'unresolved-proposal': 'יש להשלים את הבירורים או להסיר את השורות שלא אושרו.',
  'approval-changed': 'ההצעה השתנתה. יש לבדוק ולאשר את הגרסה העדכנית.',
  'codex-privacy-check-failed': 'בדיקת הפרטיות לא עברה. לא יועברו נתוני מוסד ל־Codex.',
  'legacy-task-server-required': 'זו משימה ישנה עם מנגנון התקדמות שמנוהל בשרת. נדרש להתאים את מסלול העדכון לפני שניתן לערוך אותה בפיילוט.',
  'codex-busy': 'כבר מתבצעת פעולה. המתינו לסיומה או בטלו אותה.',
};
const kindNames = { event: 'אירוע', class: 'כיתה', student: 'תלמיד', gradebook: 'מיפוי ציונים', grade: 'ציון', attendance: 'נוכחות', attendanceSheet: 'גיליון נוכחות חדש', mapping: 'מיפוי פדגוגי', mappingRow: 'שורת מיפוי', task: 'משימה' };
const fieldNames = { title: 'כותרת', name: 'שם', fullName: 'שם מלא', firstName: 'שם פרטי', lastName: 'שם משפחה', description: 'תיאור', date: 'תאריך', endDate: 'עד תאריך', dateKey: 'תאריך', dueDate: 'מועד יעד', value: 'ערך', clear: 'מחיקת הציון הקיים', note: 'הערה', category: 'קטגוריה', gradeLevel: 'שכבה', academicYear: 'שנת לימודים', priority: 'עדיפות', skipWeekends: 'לדלג על שישי ושבת' };
const messageFor = error => errors[error?.code] || 'הפעולה לא הושלמה. הטיוטה נשמרה במסך ואפשר לנסות שוב.';
const describe = value => value == null ? '—' : typeof value === 'object' ? Object.entries(value).map(([key, entry]) => `${fieldNames[key] || key}: ${describe(entry)}`).join(' · ') : String(value);

export default function ZokiCodexPanel({ onBack, onMinimize }) {
  const { currentUser, userData, selectedSchool } = useAuth();
  const schoolId = selectedSchool || userData?.schoolId;
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [question, setQuestion] = useState('');
  const [file, setFile] = useState(null);
  const [history, setHistory] = useState([]);
  const [proposal, setProposal] = useState(null);
  const [draft, setDraft] = useState([]);
  const [edited, setEdited] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState([]);
  const [reportRoute, setReportRoute] = useState('');
  const [page, setPage] = useState(0);
  const session = useRef(null), controller = useRef(null), alive = useRef(true), fileInput = useRef(null);
  const request = useCallback(async (operation, body = {}, signal) => {
    const sessionId = session.current;
    const token = await currentUser.getIdToken();
    if (!alive.current && operation !== 'disconnect') throw Object.assign(new Error(), { code: 'session-expired' });
    const response = await fetch(`/__zoki_codex/${operation}`, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(sessionId ? { 'X-Zoki-Session': sessionId } : {}) }, body: JSON.stringify({ ...body, schoolId }), signal });
    const result = await response.json(); if (!response.ok) throw Object.assign(new Error(), { code: result.code });
    return result;
  }, [currentUser, schoolId]);
  useEffect(() => {
    alive.current = true;
    const clear = () => {
      controller.current?.abort();
      // Best effort server disposal; a short server TTL also clears RAM after
      // a closed tab/network failure. No token is stored outside memory.
      if (session.current) request('disconnect').catch(() => {});
      session.current = null; setConnected(false); setFile(null); setHistory([]); setProposal(null); setDraft([]); setQuestion(''); setResults([]);
    };
    const unsubscribe = subscribePrivateSession(clear);
    return () => { clear(); alive.current = false; unsubscribe(); };
  }, [request]); // The parent is keyed by UID, school and private-session revision.
  const acceptProposal = next => { setProposal(next); setDraft(next?.items || []); setEdited(false); setPage(0); setResults([]); };
  async function perform(operation, body = {}) {
    if (busy) return;
    setBusy(true); setError(''); setPhase(operation === 'connect' ? 'בודק התחברות ופרטיות עם נתונים סינתטיים' : operation === 'approve' ? 'מבצע' : 'מכין הצעה');
    controller.current = new AbortController();
    let poll;
    if (connected) poll = setInterval(() => { request('status').then(state => { if (alive.current) setPhase(phaseNames[state.phase] || 'מכין הצעה'); }).catch(() => {}); }, 3000);
    try {
      const result = await request(operation, body, controller.current.signal);
      if (!alive.current) return;
      if (operation === 'connect') { session.current = result.sessionId; setConnected(true); setHistory(result.history || []); acceptProposal(result.proposal || null); }
      if (result.proposal) acceptProposal(result.proposal);
      if (result.history) setHistory(result.history);
      if (operation === 'analyze') { setQuestion(''); setFile(null); if (fileInput.current) fileInput.current.value = ''; }
      if (result.results) setResults(result.results);
      if (result.reportRoute) setReportRoute(result.reportRoute);
    } catch (failure) { if (alive.current && failure.name !== 'AbortError') setError(messageFor(failure)); }
    finally { clearInterval(poll); if (alive.current) { setBusy(false); setPhase(''); } }
  }
  async function send(event) {
    event.preventDefault(); if (!question.trim() && !file) return;
    let attachment;
    if (file) {
      if (file.size > 20 * 1024 * 1024) { setError(errors['file-too-large']); return; }
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = ''; for (let start = 0; start < bytes.length; start += 16384) binary += String.fromCharCode(...bytes.subarray(start, start + 16384));
      attachment = { name: file.name, base64: btoa(binary) };
    }
    await perform('analyze', { question, ...(attachment ? { file: attachment } : {}) });
  }
  const patch = (key, change) => { setDraft(rows => rows.map(row => row.key === key ? { ...row, ...change } : row)); setEdited(true); setResults([]); };
  const active = draft.filter(item => item.enabled);
  const unresolved = active.filter(item => item.needsReview || item.errors?.length);
  const completed = results.filter(item => item.status === 'done').length;
  return <section className="zoki-codex" dir="rtl" aria-label="זוקי עם Codex">
    <header><div><strong>Codex שלי</strong><small>{connected ? 'חיבור מקומי · לפי ההרשאות שלך' : 'פיילוט מקומי בחשבון הקיים שלך'}</small></div><nav><button type="button" onClick={onBack}>זוקי רגיל</button>{onMinimize && <button type="button" onClick={onMinimize}>מזעור</button>}</nav></header>
    {!connected ? <div className="zoki-codex-welcome"><h2>מה תרצו לארגן היום?</h2><p>לוח גאנט, מיפוי כיתה או מטלות לצוות — כתבו את הבקשה וצרפו קובץ. השינויים יוצגו לבדיקה לפני שמירה.</p><p>החיבור דורש Codex מחובר במחשב. בדיקת ההתחברות משתמשת בנתונים סינתטיים בלבד. אין צורך בשדרוג Blaze.</p><button className="btn btn-primary" disabled={busy} onClick={() => perform('connect')}>חיבור ובדיקת פרטיות</button></div> : <>
      <div className="zoki-codex-history" aria-live="polite">{history.map((entry, index) => <p key={index} className={`zoki-codex-${entry.role}`}>{entry.text}</p>)}</div>
      {proposal && <section className="zoki-codex-proposal"><header><strong>הצעה לבדיקה · גרסה {proposal.revision}</strong><span>{active.length} פריטים · {unresolved.length} לבירור</span></header>
        {proposal.excludedSources?.length > 0 && <details><summary>{proposal.excludedSources.length} שורות או עמודים שאינם נכללים בייבוא</summary>{proposal.excludedSources.map(row => <p key={row.id}>{row.label || row.id} — {row.reason}</p>)}</details>}
        {draft.length > 0 && <><p>אפשר לערוך ערכים, להסיר שורות או לבקש תיקון בשיחה. יצירת תלמידים וכיתות נכללת רק באישור המפורש של ההצעה.</p>
          <div className="zoki-codex-table"><table><thead><tr><th>לייבא</th><th>פריט ומקור</th><th>הערכים המוצעים</th><th>התאמה ובירורים</th></tr></thead><tbody>{draft.slice(page * 20, page * 20 + 20).map(item => <tr key={item.key}><td><input type="checkbox" aria-label={`לייבא ${item.label}`} checked={item.enabled} disabled={busy || completed > 0} onChange={event => patch(item.key, { enabled: event.target.checked })}/></td><td><strong>{item.label || kindNames[item.kind]}</strong><small>{kindNames[item.kind]} · {item.intent === 'create' ? 'חדש' : item.intent === 'archive' ? 'ארכוב' : 'עדכון'}</small><small>{item.source || 'בקשה בשיחה'}</small>{item.targets?.map(target => <small key={`${target.kind}:${target.id}`}>{target.name}{target.academicYear ? ` · ${target.academicYear}` : ''}</small>)}</td><td>{Object.entries(item.fields).filter(([key]) => fieldNames[key]).map(([key, value]) => <label key={key}>{fieldNames[key]}<input type={typeof value === 'boolean' ? 'checkbox' : typeof value === 'number' ? 'number' : ['date', 'dueDate', 'endDate', 'dateKey'].includes(key) ? 'date' : 'text'} {...(typeof value === 'boolean' ? { checked: value } : { value: value ?? '' })} disabled={busy || completed > 0} onChange={event => patch(item.key, { fields: { ...item.fields, [key]: typeof value === 'boolean' ? event.target.checked : typeof value === 'number' ? (event.target.value === '' ? '' : Number(event.target.value)) : event.target.value } })}/></label>)}<details><summary>השינוי המלא</summary>{item.changes.map((change, index) => <div key={index}><small>קיים: {describe(change.before)}</small><small>מוצע: {describe(change.patch || change.data)}</small></div>)}</details></td><td><p>{item.reason}</p>{item.notificationCount > 0 && <small>{item.notificationCount} התראות יישלחו אחרי האישור</small>}{item.errors?.map(code => <p className="zoki-codex-error" key={code}>{errors[code] || 'פרטי השורה אינם תקינים. בקשו תיקון בשיחה.'}</p>)}{item.needsReview && <label><input type="checkbox" disabled={busy} checked={false} onChange={() => patch(item.key, { needsReview: false })}/> בדקתי את ההתאמה המוצגת ואישרתי אותה</label>}</td></tr>)}</tbody></table></div>
          {draft.length > 20 && <nav aria-label="עמודי ההצעה"><button disabled={!page} onClick={() => setPage(p => p - 1)}>הקודם</button><span>{page + 1} מתוך {Math.ceil(draft.length / 20)}</span><button disabled={(page + 1) * 20 >= draft.length} onClick={() => setPage(p => p + 1)}>הבא</button></nav>}
          <footer>{edited ? <button className="btn btn-primary" disabled={busy} onClick={() => perform('preview', { hash: proposal.hash, actions: draft.map(({ changes: _changes, reads: _reads, errors: _errors, route: _route, ...item }) => item) })}>בדיקת השינויים והכנת גרסה לאישור</button> : <button className="btn btn-primary" disabled={busy || !active.length || unresolved.length > 0 || completed === active.length} onClick={() => perform('approve', { hash: proposal.hash })}>{completed > 0 ? 'חידוש הפריטים שנותרו' : `אישור וביצוע ${active.length} פריטים`}</button>}</footer>
        </>}
      </section>}
      {results.length > 0 && <section aria-live="polite">{reportRoute && <a href={`#${reportRoute}`}>פתיחת דוח הייבוא</a>}<p>{completed} מתוך {active.length} פריטים הושלמו.</p>{results.map(result => <p key={result.itemId}>{result.status === 'done' ? <a href={`#${result.route}`}>פתיחת הפריט שבוצע</a> : <>{messageFor(result)} {result.confirmationPending && <small>לא התקבל אישור סופי מהשרת. בחידוש נבדוק מה נשמר לפני שננסה שוב.</small>} {result.committedWrites > 0 && <small>חלק מהפריט כבר נשמר. חידוש ימשיך מהנקודה שנשמרה.</small>}</>}</p>)}<small>תיקון לאחר ביצוע יוצר הצעה חדשה, בהתאם לנתונים העדכניים.</small></section>}
      <form onSubmit={send} className="zoki-codex-composer"><label className="zoki-codex-attach"><Paperclip size={18}/><span>צירוף קובץ</span><input ref={fileInput} type="file" accept=".xlsx,.csv,.pdf,.png,.jpg,.jpeg,.webp" disabled={busy} onChange={event => { setFile(event.target.files?.[0] || null); setError(''); }}/></label>{file && <span>{file.name}<button type="button" aria-label="הסרת הקובץ" onClick={() => { setFile(null); fileInput.current.value = ''; }}><X size={15}/></button></span>}<textarea aria-label="כתיבה לזוקי" value={question} onChange={event => setQuestion(event.target.value)} placeholder="למשל: חבר את המיפוי לכיתה י״א של שרון, והכן הצעה לבדיקה" maxLength={12000} disabled={busy} rows={3}/><button type="submit" className="btn btn-primary" disabled={busy || (!question.trim() && !file)}><Send size={17}/> שליחה</button></form>
    </>}
    {busy && <p role="status">{phase}… {connected && <button type="button" onClick={() => { request('cancel').catch(() => {}); controller.current?.abort(); }}>ביטול</button>}</p>}
    {error && <p role="alert" className="zoki-codex-error">{error}</p>}
  </section>;
}
