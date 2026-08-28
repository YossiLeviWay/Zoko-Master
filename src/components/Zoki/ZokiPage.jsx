import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDocs } from 'firebase/firestore';
import { BookOpen, Bot, CheckCircle2, ExternalLink, Pencil, Plus, Save, Send, Settings2, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { db } from '../../firebase.js';
import { askZoki, callableReason, executeZokiGrade, executeZokiStudentTransfer, executeZokiTask } from '../../services/adminUserService.js';
import { saveZokiBrain, subscribeZokiBrain } from '../../services/firestore/zokiBrainRepository.js';
import { listSchoolStaff } from '../../services/firestore/classStudentRepository.js';
import { schoolCollection } from '../../services/firestore/paths.js';
import { useTaskAssistantContext } from '../../hooks/useTaskAssistantContext.js';
import TaskAssistantEntry from '../Tasks/TaskAssistantEntry.jsx';
import Header from '../Layout/Header.jsx';
import zokiAvatar from '../../assets/zoki-avatar.png';
import './Zoki.css';

const STARTERS = [
  'באיזו כיתה לומד תלמיד מסוים?',
  'איפה נמצא קובץ מסוים?',
  'איך יוצרים משימה חדשה?',
  'מה הנוהל הבית־ספרי בנושא טיולים?',
];

const EMPTY_ENTRY = { title: '', body: '', category: 'נוהל', validUntil: '', status: 'published', audience: { type: 'school', roleIds: [], userIds: [] } };

function errorMessage(error) {
  const reason = callableReason(error);
  if (reason === 'zoki-not-configured') return 'זוקי עדיין אינו מחובר למודל ה-AI בסביבת השרת.';
  if (reason === 'permission-denied') return 'אין לך הרשאה לקבל את המידע הזה.';
  if (reason === 'resource-exhausted') return 'נשלחו הרבה שאלות בזמן קצר. אפשר לנסות שוב בעוד כמה דקות.';
  return 'לא הצלחתי לענות כרגע. אפשר לנסות שוב.';
}

function displayName(item, fallback) {
  return item.fullName || item.displayName || item.name || item.title || fallback;
}

function zokiTaskAction(proposal, context) {
  const responsible = proposal?.assignmentPlan?.responsible || [];
  const assignedStaff = responsible.find(item => item.source === 'staff' && item.id);
  const assignedTeam = responsible.find(item => item.source === 'team' && item.id);
  const scope = proposal?.taskType === 'personal' ? 'personal'
    : assignedStaff ? 'assigned'
      : assignedTeam ? 'team' : null;
  if (!scope) return null;
  return {
    scope,
    title: proposal.title,
    description: proposal.description || '',
    priority: ['low', 'medium', 'high'].includes(proposal.priority) ? proposal.priority : 'medium',
    dueDate: proposal.dueDate || proposal.dateRange?.endDate || '',
    startDate: proposal.dateRange?.startDate || '',
    endDate: proposal.dateRange?.endDate || '',
    completionCriteria: proposal.completionCriteria || '',
    assigneeIds: assignedStaff ? [assignedStaff.id] : [],
    teamId: assignedTeam?.id || '',
    agentSessionId: context?.sessionId || '',
    workPlanSteps: (proposal.workPlanSteps || []).map((step, index) => ({
      id: step.id || `step_${index + 1}`,
      title: step.title,
      dueDate: '',
      status: 'todo',
      responsibleIds: (step.suggestedParties || []).filter(item => item.source === 'staff' && item.id).map(item => item.id).slice(0, 10),
      teamId: (step.suggestedParties || []).find(item => item.source === 'team' && item.id)?.id || '',
      dependencyStepId: '',
      order: index,
    })),
  };
}

export default function ZokiPage() {
  const { userData, currentUser, selectedSchool, isPrincipal, isGlobalAdmin } = useAuth();
  const navigate = useNavigate();
  const schoolId = selectedSchool || userData?.schoolId;
  const canManage = isPrincipal() || isGlobalAdmin();
  const [mode, setMode] = useState('ask');
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [brainOpen, setBrainOpen] = useState(false);
  const [brain, setBrain] = useState({ instructions: '', entries: [] });
  const [brainDraft, setBrainDraft] = useState({ instructions: '', entries: [] });
  const [savingBrain, setSavingBrain] = useState(false);
  const [brainMessage, setBrainMessage] = useState('');
  const [audienceStaff, setAudienceStaff] = useState([]);
  const [audienceRoles, setAudienceRoles] = useState([]);
  const [audienceLoading, setAudienceLoading] = useState(false);
  const [pendingTask, setPendingTask] = useState(null);
  const [executingTask, setExecutingTask] = useState(false);
  const [taskActionResult, setTaskActionResult] = useState(null);
  const endRef = useRef(null);
  const { schoolContext: taskAssistantSchoolContext, loading: taskAssistantContextLoading } = useTaskAssistantContext();

  useEffect(() => {
    if (!schoolId || !canManage) return undefined;
    return subscribeZokiBrain({ db, schoolId, onData: value => { setBrain(value); setBrainDraft(value); }, onError: () => undefined });
  }, [canManage, schoolId]);

  useEffect(() => {
    if (!schoolId || !canManage) return undefined;
    let active = true;
    setAudienceLoading(true);
    Promise.all([
      listSchoolStaff(db, schoolId),
      Promise.all([
        getDocs(schoolCollection(db, schoolId, 'roleDefinitions', 'nested')).catch(() => null),
        getDocs(schoolCollection(db, schoolId, 'roleDefinitions', 'legacy')).catch(() => null),
      ]),
    ]).then(([staff, roleSnapshots]) => {
      if (!active) return;
      const roles = new Map();
      roleSnapshots.filter(Boolean).forEach(snapshot => snapshot.docs.forEach(item => roles.set(item.id, { id: item.id, ...item.data() })));
      setAudienceStaff(staff.sort((left, right) => displayName(left, '').localeCompare(displayName(right, ''), 'he')));
      setAudienceRoles([...roles.values()].filter(role => role.status !== 'archived').sort((left, right) => displayName(left, '').localeCompare(displayName(right, ''), 'he')));
    }).catch(() => {
      if (active) setBrainMessage('לא ניתן לטעון כרגע את רשימות התפקידים ואנשי הצוות.');
    }).finally(() => {
      if (active) setAudienceLoading(false);
    });
    return () => { active = false; };
  }, [canManage, schoolId]);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages, loading]);

  const greeting = useMemo(() => {
    const firstName = (userData?.fullName || '').trim().split(/\s+/u)[0];
    return firstName ? `היי ${firstName}, איך אפשר לעזור?` : 'היי, איך אפשר לעזור?';
  }, [userData?.fullName]);

  async function submitQuestion(text = question) {
    const nextQuestion = text.trim();
    if (!nextQuestion || loading || !schoolId) return;
    setQuestion('');
    setMessages(previous => [...previous, { id: `user_${Date.now()}`, role: 'user', text: nextQuestion }]);
    setLoading(true);
    try {
      const history = messages.slice(-8).filter(message => !message.error).map(message => ({
        role: message.role === 'user' ? 'user' : 'assistant',
        text: message.text,
      }));
      const result = await askZoki({ schoolId, question: nextQuestion, history });
      const actionRequestId = result.actionProposal
        ? (globalThis.crypto?.randomUUID?.().replaceAll('-', '_') || `request_${Date.now()}`)
        : '';
      setMessages(previous => [...previous, {
        id: `zoki_${Date.now()}`, role: 'zoki', text: result.answer,
        sources: result.sources || [], followUpQuestion: result.followUpQuestion || '',
        actionProposal: result.actionProposal ? { ...result.actionProposal, requestId: actionRequestId } : null,
      }]);
    } catch (error) {
      setMessages(previous => [...previous, { id: `error_${Date.now()}`, role: 'zoki', error: true, text: errorMessage(error) }]);
    } finally {
      setLoading(false);
    }
  }

  function patchMessage(messageId, patch) {
    setMessages(previous => previous.map(item => item.id === messageId ? { ...item, ...patch } : item));
  }

  async function confirmGradeAction(message) {
    const action = message.actionProposal;
    if (!action || message.actionStatus === 'executing' || message.actionStatus === 'executed') return;
    patchMessage(message.id, { actionStatus: 'executing', actionError: '' });
    try {
      const result = await executeZokiGrade({
        schoolId, requestId: action.requestId, confirm: true,
        gradebookId: action.gradebookId, studentId: action.studentId,
        subjectId: action.subjectId, componentId: action.componentId,
        score: action.score, expectedPreviousScore: action.previousScore,
      });
      patchMessage(message.id, { actionStatus: 'executed', actionResult: result, actionError: '' });
    } catch (error) {
      const reason = callableReason(error);
      const messagesByReason = {
        'permission-denied': 'אין לך הרשאה להזין את הציון הזה.',
        'grade-changed': 'הציון השתנה מאז ההצעה. בקשו מזוקי לבדוק את הערך העדכני לפני אישור נוסף.',
        'grade-component-changed': 'מבנה המקצוע או הרכיב השתנה. יש לבקש מזוקי הצעה חדשה.',
        'grade-formula-invalid': 'לא ניתן לחשב את הציון לפי הנוסחה הנוכחית.',
      };
      patchMessage(message.id, { actionStatus: 'failed', actionError: messagesByReason[reason] || 'עדכון הציון לא הושלם.' });
    }
  }

  async function confirmStudentTransferAction(message) {
    const action = message.actionProposal;
    if (!action || message.actionStatus === 'executing' || message.actionStatus === 'executed') return;
    patchMessage(message.id, { actionStatus: 'executing', actionError: '' });
    try {
      const result = await executeZokiStudentTransfer({
        schoolId, requestId: action.requestId, confirm: true,
        studentId: action.studentId, targetClassId: action.targetClassId,
        expectedCurrentClassId: action.expectedCurrentClassId,
        effectiveDate: action.effectiveDate, reason: action.reason || '',
      });
      patchMessage(message.id, { actionStatus: 'executed', actionResult: result, actionError: '' });
    } catch (error) {
      const reason = callableReason(error);
      const messagesByReason = {
        'permission-denied': 'אין לך הרשאה להעביר את התלמיד בין הכיתות שנבחרו.',
        'student-class-changed': 'שיוך התלמיד השתנה מאז ההצעה. בקשו מזוקי לבדוק מחדש.',
        'cross-year-transfer': 'העברה דרך זוקי אפשרית רק בין כיתות באותה שנת לימודים.',
      };
      patchMessage(message.id, { actionStatus: 'failed', actionError: messagesByReason[reason] || 'העברת התלמיד לא הושלמה.' });
    }
  }

  function updateEntry(index, field, value) {
    setBrainDraft(previous => ({ ...previous, entries: previous.entries.map((entry, itemIndex) => itemIndex === index ? { ...entry, [field]: value } : entry) }));
  }

  function toggleAudienceEntry(index, field, id) {
    const current = brainDraft.entries[index]?.audience?.[field] || [];
    const next = current.includes(id) ? current.filter(item => item !== id) : [...current, id];
    updateEntry(index, 'audience', { ...brainDraft.entries[index].audience, [field]: next });
  }

  async function persistBrain() {
    setSavingBrain(true);
    setBrainMessage('');
    try {
      const entries = await saveZokiBrain({ db, schoolId, actorId: currentUser.uid, instructions: brainDraft.instructions, entries: brainDraft.entries });
      setBrainDraft(previous => ({ ...previous, entries }));
      setBrainMessage('המוח של זוקי נשמר. מידע שפורסם זמין מיד לצוות המורשה.');
    } catch {
      setBrainMessage('לא ניתן לשמור. בדקו שיש לך הרשאת מנהל מוסד.');
    } finally {
      setSavingBrain(false);
    }
  }

  function openTaskProposal(proposal, context) {
    const requestId = globalThis.crypto?.randomUUID?.().replaceAll('-', '_') || `request_${Date.now()}`;
    setTaskActionResult(null);
    setPendingTask({ proposal, context, requestId, action: zokiTaskAction(proposal, context) });
  }

  function editTaskProposal() {
    if (!pendingTask) return;
    navigate('/tasks', { state: { zokiTaskDraft: { proposal: pendingTask.proposal, context: pendingTask.context } } });
  }

  async function confirmTaskCreation() {
    if (!pendingTask?.action || executingTask) return;
    setExecutingTask(true);
    setTaskActionResult(null);
    try {
      const result = await executeZokiTask({
        schoolId, requestId: pendingTask.requestId, confirm: true, task: pendingTask.action,
      });
      setTaskActionResult({ ok: true, ...result });
      setPendingTask(null);
    } catch (error) {
      const reason = callableReason(error);
      setTaskActionResult({
        ok: false,
        message: reason === 'permission-denied'
          ? 'אין לך הרשאה ליצור או להקצות את המשימה הזאת.'
          : 'יצירת המשימה לא הושלמה. אפשר לערוך את הפרטים ולנסות שוב.',
      });
    } finally {
      setExecutingTask(false);
    }
  }

  return <div className="page zoki-page">
    <Header title="זוקי" />
    <div className="page-content zoki-shell">
      <header className="zoki-hero">
        <div className="zoki-identity"><img src={zokiAvatar} alt="זוקי" /><div><span><Sparkles size={15} /> הסוכן הבית־ספרי</span><h1>{greeting}</h1><p>מידע, הכוונה ויצירת משימות—תמיד בהתאם להרשאות שלך.</p></div></div>
        {canManage && <button type="button" className="btn btn-secondary" onClick={() => setBrainOpen(true)}><Settings2 size={16} /> ניהול המוח של זוקי</button>}
      </header>

      <div className="zoki-mode-switch" role="tablist" aria-label="סוג העזרה">
        <button type="button" role="tab" aria-selected={mode === 'ask'} className={mode === 'ask' ? 'active' : ''} onClick={() => setMode('ask')}><Bot size={17} /> שאלה ומידע</button>
        <button type="button" role="tab" aria-selected={mode === 'task'} className={mode === 'task' ? 'active' : ''} onClick={() => setMode('task')}><Sparkles size={17} /> יצירת משימה</button>
      </div>

      {mode === 'ask' ? <section className="zoki-chat" aria-label="שיחה עם זוקי">
        <div className="zoki-messages" aria-live="polite">
          {messages.length === 0 && <div className="zoki-empty"><img src={zokiAvatar} alt="" /><h2>אפשר לשאול אותי על כל מה שנמצא במערכת</h2><p>אם המידע אינו בהרשאה שלך, לא אחשוף אם הוא קיים.</p><div>{STARTERS.map(starter => <button type="button" key={starter} onClick={() => submitQuestion(starter)}>{starter}</button>)}</div></div>}
          {messages.map(message => <article key={message.id} className={`zoki-message zoki-message--${message.role}${message.error ? ' is-error' : ''}`}>
            {message.role === 'zoki' && <img src={zokiAvatar} alt="" />}
            <div><p>{message.text}</p>{message.followUpQuestion && <button type="button" className="zoki-follow-up" onClick={() => setQuestion(message.followUpQuestion)}>{message.followUpQuestion}</button>}
              {message.actionProposal?.type === 'grade_update' && <section className={`zoki-inline-action ${message.actionStatus === 'executed' ? 'is-complete' : ''}`}><header><ShieldCheck size={14} /><strong>{message.actionStatus === 'executed' ? 'הציון עודכן' : 'אישור עדכון ציון'}</strong></header><div><span>{message.actionProposal.studentName}</span><span>{message.actionProposal.subjectName} · {message.actionProposal.componentName}</span><b>מ־{message.actionProposal.previousScore ?? 'ללא ציון'} ל־{message.actionProposal.score}</b></div>{message.actionStatus !== 'executed' && message.actionStatus !== 'cancelled' && <footer><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => confirmGradeAction(message)}><CheckCircle2 size={14} /> {message.actionStatus === 'executing' ? 'מעדכן…' : 'אישור ועדכון'}</button><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => patchMessage(message.id, { actionStatus: 'cancelled' })}>ביטול</button></footer>}{message.actionStatus === 'cancelled' && <small>הפעולה בוטלה ולא נשמר שינוי.</small>}{message.actionError && <small className="is-error">{message.actionError}</small>}{message.actionStatus === 'executed' && <button type="button" className="zoki-action-link" onClick={() => navigate(message.actionResult.route)}>פתיחת כרטיס התלמיד</button>}</section>}
              {message.actionProposal?.type === 'student_transfer' && <section className={`zoki-inline-action ${message.actionStatus === 'executed' ? 'is-complete' : ''}`}><header><ShieldCheck size={14} /><strong>{message.actionStatus === 'executed' ? 'העברת התלמיד הושלמה' : 'אישור העברת תלמיד'}</strong></header><div><span>{message.actionProposal.studentName}</span><span>מ־{message.actionProposal.currentClassName || 'ללא כיתה'} אל {message.actionProposal.targetClassName}</span><b>{message.actionProposal.effectiveDate}</b></div>{message.actionProposal.reason && <small>סיבה: {message.actionProposal.reason}</small>}{message.actionStatus !== 'executed' && message.actionStatus !== 'cancelled' && <footer><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => confirmStudentTransferAction(message)}><CheckCircle2 size={14} /> {message.actionStatus === 'executing' ? 'מעביר…' : 'אישור והעברה'}</button><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => patchMessage(message.id, { actionStatus: 'cancelled' })}>ביטול</button></footer>}{message.actionStatus === 'cancelled' && <small>הפעולה בוטלה ולא נשמר שינוי.</small>}{message.actionError && <small className="is-error">{message.actionError}</small>}{message.actionStatus === 'executed' && <button type="button" className="zoki-action-link" onClick={() => navigate(message.actionResult.route)}>פתיחת כרטיס התלמיד</button>}</section>}
              {message.sources?.length > 0 && <footer><span><BookOpen size={13} /> מקורות</span>{message.sources.map(item => <button type="button" key={item.id} onClick={() => navigate(item.route)}>{item.label}<ExternalLink size={12} /></button>)}</footer>}
            </div>
          </article>)}
          {loading && <article className="zoki-message zoki-message--zoki"><img src={zokiAvatar} alt="" /><div className="zoki-thinking"><span /><span /><span /></div></article>}
          <div ref={endRef} />
        </div>
        <form className="zoki-composer" onSubmit={event => { event.preventDefault(); submitQuestion(); }}><label className="sr-only" htmlFor="zoki-question">שאלה לזוקי</label><textarea id="zoki-question" value={question} onChange={event => setQuestion(event.target.value)} maxLength={2000} rows={2} placeholder="שאלו את זוקי על תלמידים, ציונים, קבצים, נהלים או איך עושים משהו…" onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submitQuestion(); } }} /><button type="submit" disabled={loading || question.trim().length < 2} aria-label="שליחה"><Send size={19} /></button><small><ShieldCheck size={13} /> התשובה מוגבלת להרשאות שלך</small></form>
      </section> : <section className="zoki-task-mode"><div className="zoki-task-intro"><h2>ספרו לזוקי מה צריך לקדם</h2><p>זוקי ינסח משימה ויציג את הפרטים לאישור. דבר לא יישמר לפני לחיצה מפורשת.</p></div>
        {taskActionResult?.ok && <div className="zoki-task-result is-success" role="status"><CheckCircle2 size={20} /><div><strong>המשימה נוצרה בהצלחה</strong><span>זוקי שמר אותה פעם אחת בלבד.</span></div><button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate(taskActionResult.route)}>פתיחת המשימה</button></div>}
        {taskActionResult && !taskActionResult.ok && <div className="zoki-task-result is-error" role="alert"><ShieldCheck size={20} /><span>{taskActionResult.message}</span></div>}
        {pendingTask && <article className="zoki-task-confirmation"><header><span><ShieldCheck size={15} /> ממתין לאישור</span><h3>{pendingTask.proposal.title || 'משימה חדשה'}</h3></header><p>{pendingTask.proposal.description || 'ללא תיאור נוסף.'}</p><dl><div><dt>עדיפות</dt><dd>{pendingTask.proposal.priority === 'high' ? 'גבוהה' : pendingTask.proposal.priority === 'low' ? 'נמוכה' : 'רגילה'}</dd></div><div><dt>תאריך יעד</dt><dd>{pendingTask.action?.dueDate || 'לא נקבע'}</dd></div><div><dt>סוג</dt><dd>{pendingTask.action?.scope === 'assigned' ? 'משימה מוקצית' : pendingTask.action?.scope === 'team' ? 'משימת צוות' : pendingTask.action?.scope === 'personal' ? 'משימה אישית' : 'נדרשים פרטים נוספים'}</dd></div></dl><footer>{pendingTask.action && <button type="button" className="btn btn-primary" disabled={executingTask} onClick={confirmTaskCreation}><CheckCircle2 size={16} /> {executingTask ? 'יוצר…' : 'אישור ויצירת המשימה'}</button>}<button type="button" className="btn btn-secondary" onClick={editTaskProposal}><Pencil size={16} /> עריכת כל הפרטים</button><button type="button" className="btn btn-link" onClick={() => setPendingTask(null)}>ביטול</button></footer>{!pendingTask.action && <small>כדי להקצות משימה לאדם או לצוות, יש לבחור את היעד המדויק בטופס המלא.</small>}</article>}
        <TaskAssistantEntry uid={currentUser?.uid} schoolId={schoolId} schoolContext={taskAssistantSchoolContext} contextLoading={taskAssistantContextLoading} onManual={() => navigate('/tasks', { state: { openManualTask: true } })} onProposal={openTaskProposal} />
      </section>}
    </div>

    {brainOpen && <div className="zoki-brain-overlay" onClick={() => setBrainOpen(false)}><aside className="zoki-brain-panel" role="dialog" aria-modal="true" aria-labelledby="zoki-brain-title" onClick={event => event.stopPropagation()}>
      <header><div><span><Settings2 size={15} /> פאנל מנהל</span><h2 id="zoki-brain-title">המוח של זוקי</h2><p>הוראות וידע בית־ספרי שזוקי יציג לצוות.</p></div><button type="button" onClick={() => setBrainOpen(false)} aria-label="סגירה"><X size={20} /></button></header>
      <div className="zoki-brain-body"><label>הוראות קבועות לזוקי<textarea rows={5} maxLength={8000} value={brainDraft.instructions} onChange={event => setBrainDraft(previous => ({ ...previous, instructions: event.target.value }))} placeholder="לדוגמה: בכל שאלה על טיולים יש להפנות תחילה לנוהל הבטיחות…" /></label>
        <div className="zoki-knowledge-head"><div><h3>נהלים, כללים ומידע</h3><span>{brainDraft.entries.length} פריטים</span></div><button type="button" className="btn btn-secondary btn-sm" onClick={() => setBrainDraft(previous => ({ ...previous, entries: [...previous.entries, { ...EMPTY_ENTRY, id: `knowledge_${Date.now()}` }] }))}><Plus size={14} /> הוספת פריט</button></div>
        {brainDraft.entries.length === 0 && <div className="zoki-no-knowledge">עדיין לא הוזן ידע בית־ספרי.</div>}
        {brainDraft.entries.map((entry, index) => <article className="zoki-knowledge-card" key={entry.id || index}><div><label>כותרת<input value={entry.title} maxLength={160} onChange={event => updateEntry(index, 'title', event.target.value)} placeholder="שם הנוהל או הכלל" /></label><label>קטגוריה<input value={entry.category} maxLength={80} onChange={event => updateEntry(index, 'category', event.target.value)} /></label></div><label>תוכן<textarea rows={5} value={entry.body} maxLength={6000} onChange={event => updateEntry(index, 'body', event.target.value)} placeholder="המידע שזוקי צריך לדעת…" /></label><footer><label>מצב<select value={entry.status} onChange={event => updateEntry(index, 'status', event.target.value)}><option value="published">מפורסם</option><option value="draft">טיוטה</option></select></label><label>קהל<select value={entry.audience?.type || 'school'} onChange={event => updateEntry(index, 'audience', { type: event.target.value, roleIds: [], userIds: [] })}><option value="school">כל צוות בית הספר</option><option value="roles">תפקידים מסוימים</option><option value="users">משתמשים מסוימים</option></select></label><label>בתוקף עד<input type="date" value={entry.validUntil || ''} onChange={event => updateEntry(index, 'validUntil', event.target.value)} /></label><button type="button" className="zoki-delete-entry" onClick={() => setBrainDraft(previous => ({ ...previous, entries: previous.entries.filter((_, itemIndex) => itemIndex !== index) }))} aria-label="מחיקת הפריט"><Trash2 size={16} /></button></footer>
          {entry.audience?.type === 'roles' && <fieldset className="zoki-audience-picker"><legend>אילו תפקידים יוכלו לקבל את המידע?</legend>{audienceLoading ? <span>טוען תפקידים…</span> : audienceRoles.length > 0 ? <div>{audienceRoles.map(role => <label key={role.id}><input type="checkbox" checked={(entry.audience.roleIds || []).includes(role.id)} onChange={() => toggleAudienceEntry(index, 'roleIds', role.id)} /> {displayName(role, 'תפקיד')}</label>)}</div> : <span>לא נמצאו תפקידים מוגדרים.</span>}</fieldset>}
          {entry.audience?.type === 'users' && <fieldset className="zoki-audience-picker"><legend>אילו אנשי צוות יוכלו לקבל את המידע?</legend>{audienceLoading ? <span>טוען אנשי צוות…</span> : audienceStaff.length > 0 ? <div>{audienceStaff.map(staff => <label key={staff.id}><input type="checkbox" checked={(entry.audience.userIds || []).includes(staff.id)} onChange={() => toggleAudienceEntry(index, 'userIds', staff.id)} /> {displayName(staff, 'איש צוות')}</label>)}</div> : <span>לא נמצאו אנשי צוות פעילים.</span>}</fieldset>}
        </article>)}
      </div>
      <footer className="zoki-brain-actions">{brainMessage && <span>{brainMessage}</span>}<button type="button" className="btn btn-secondary" onClick={() => { setBrainDraft(brain); setBrainOpen(false); }}>ביטול</button><button type="button" className="btn btn-primary" disabled={savingBrain} onClick={persistBrain}><Save size={16} /> {savingBrain ? 'שומר…' : 'שמירת המוח'}</button></footer>
    </aside></div>}
  </div>;
}
