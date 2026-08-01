import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeftRight,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Mail,
  MessageCircleReply,
  Send,
  UserRoundCheck,
  XCircle,
} from 'lucide-react';
import {
  applyCommunicationFollowUpAction,
  buildReminderDraft,
  recordReminderDraftCreated,
  subscribeCommunicationEvents,
} from '../../services/firestore/communicationRepository';
import { copyTextToClipboard, prepareMailtoLaunch } from '../../utils/mailto';
import { createNotification } from '../../utils/notifications';

const STATUS_LABELS = {
  awaiting_send: 'ממתין לשליחה',
  awaiting_reply: 'ממתין למענה',
  reply_received_in_progress: 'התקבל מענה — עדיין בטיפול',
  action_required: 'נדרשת פעולה נוספת',
  postponed: 'נדחה למועד אחר',
  resolved: 'נפתר',
  closed_without_reply: 'נסגר ללא מענה',
  cancelled: 'בוטל',
};

const EVENT_LABELS = {
  draft_created: 'הטיוטה נוצרה',
  mailto_opened: 'טיוטת המייל נפתחה',
  send_confirmed: 'המשתמש אישר שהמייל נשלח',
  cancelled: 'המעקב בוטל',
  reply_received_resolved: 'התקבלה תשובה והטיפול נפתר',
  reply_received: 'התקבלה תשובה והטיפול נמשך',
  no_reply_reported: 'דווח שלא התקבלה תשובה',
  action_required: 'סומנה פעולה נוספת',
  follow_up_postponed: 'המעקב נדחה',
  follow_up_date_changed: 'מועד המעקב שונה',
  responsibility_reassigned: 'האחריות הועברה',
  closed_without_reply: 'המעקב נסגר ללא מענה',
  reminder_draft_created: 'נוצרה טיוטת מייל תזכורת',
  follow_up_reminder_due: 'הגיעה תזכורת המעקב',
};

const ACTIONS = [
  { id: 'reply_resolved', label: 'התקבלה תשובה ונפתר', icon: CheckCircle2 },
  { id: 'reply_continue', label: 'התקבלה תשובה — ממשיכים', icon: MessageCircleReply },
  { id: 'no_reply', label: 'לא התקבלה תשובה', icon: Clock3, needsDate: true },
  { id: 'action_required', label: 'נדרשת פעולה נוספת', icon: AlertCircle },
  { id: 'postpone', label: 'דחיית המעקב', icon: CalendarClock, needsDate: true },
  { id: 'change_date', label: 'שינוי מועד', icon: CalendarClock, needsDate: true },
  { id: 'reassign', label: 'העברת אחריות', icon: ArrowLeftRight, needsAssignee: true },
  { id: 'close_without_reply', label: 'סגירה ללא מענה', icon: XCircle, closing: true },
];

function formatDate(value) {
  if (!value) return 'לא נקבע';
  const date = value?.toDate?.() || new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? 'לא נקבע' : date.toLocaleDateString('he-IL');
}

function eventDetails(event, staffById) {
  const metadata = event.metadata || {};
  if (event.type === 'responsibility_reassigned') return `הועבר אל ${staffById.get(metadata.nextAssigneeId) || 'איש צוות'}`;
  if (['follow_up_date_changed', 'follow_up_postponed', 'no_reply_reported'].includes(event.type) && metadata.nextDate) return `מועד חדש: ${formatDate(metadata.nextDate)}`;
  if (event.type === 'reminder_draft_created') return metadata.reminderTone === 'direct' ? 'נוסח ישיר' : 'נוסח עדין';
  return metadata.note || '';
}

export default function CommunicationFollowUpPanel({ db, schoolId, user, draft, staff, permissions, onClose, onSuccess, onError }) {
  const [events, setEvents] = useState([]);
  const [selectedAction, setSelectedAction] = useState('');
  const [nextDate, setNextDate] = useState(draft.nextFollowUpAt?.slice(0, 10) || '');
  const [nextAssigneeId, setNextAssigneeId] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const staffById = useMemo(() => new Map(staff.map(member => [member.uid || member.id, member.fullName || member.email || 'איש צוות'])), [staff]);
  const actionConfig = ACTIONS.find(item => item.id === selectedAction);
  const isResponsible = [draft.createdBy, draft.followUpAssigneeId].includes(user.uid);
  const canReassign = permissions.reassign;
  const canClose = isResponsible || permissions.close;
  const terminal = ['resolved', 'closed_without_reply', 'cancelled'].includes(draft.communicationStatus);

  useEffect(() => subscribeCommunicationEvents({
    db,
    schoolId,
    draftId: draft.id,
    onData: setEvents,
    onError: () => onError('לא ניתן לטעון את ציר הזמן של המעקב.'),
  }), [db, draft.id, onError, schoolId]);

  async function runAction() {
    if (!actionConfig || saving) return;
    if (actionConfig.needsDate && !nextDate) {
      onError('יש לבחור מועד מעקב חדש.');
      return;
    }
    if (actionConfig.needsAssignee && !nextAssigneeId) {
      onError('יש לבחור איש צוות להעברת האחריות.');
      return;
    }
    setSaving(true);
    try {
      await applyCommunicationFollowUpAction({
        db,
        schoolId,
        actorId: user.uid,
        draft,
        action: selectedAction,
        note,
        nextFollowUpAt: nextDate,
        nextAssigneeId,
      });
      if (selectedAction === 'reassign' && nextAssigneeId !== user.uid) {
        await createNotification(nextAssigneeId, {
          schoolId,
          title: `הועבר אליך מעקב: ${draft.subject}`,
          body: note || 'נדרש להמשיך טיפול בפנייה החיצונית.',
          type: 'communication',
          link: '/tasks?view=communications',
        });
      }
      onSuccess('המעקב עודכן והפעולה נוספה לציר הזמן.');
      onClose();
    } catch {
      onError('עדכון המעקב נכשל. לא בוצע שינוי חלקי.');
    } finally {
      setSaving(false);
    }
  }

  async function openReminder(tone) {
    setSaving(true);
    try {
      const reminder = buildReminderDraft(draft, tone);
      const launch = prepareMailtoLaunch(reminder);
      if (launch.copyBodyRequired) await copyTextToClipboard(reminder.body);
      await recordReminderDraftCreated({ db, schoolId, actorId: user.uid, draft, tone });
      window.location.href = launch.href;
    } catch {
      onError('לא ניתן ליצור את טיוטת התזכורת כרגע.');
    } finally {
      setSaving(false);
    }
  }

  return <div className="communication-followup-detail">
    <section className="communication-followup-summary">
      <div><span className={`communication-status communication-status--${draft.communicationStatus}`}><Mail size={15} /> {STATUS_LABELS[draft.communicationStatus] || 'מעקב'}</span><h3>{draft.subject}</h3><p>{draft.summary || 'ללא תקציר פנימי'}</p></div>
      <dl><div><dt>נמען</dt><dd dir="ltr">{draft.to?.join('; ')}</dd></div><div><dt>מועד מעקב</dt><dd>{formatDate(draft.nextFollowUpAt)}</dd></div><div><dt>אחראי</dt><dd>{staffById.get(draft.followUpAssigneeId) || (draft.followUpAssigneeId === user.uid ? 'אני' : 'איש צוות')}</dd></div><div><dt>הקשר</dt><dd>{draft.linkedContextLabel || 'פנייה כללית'}</dd></div></dl>
    </section>

    {!terminal && <section className="communication-followup-actions"><div><h3>מה קרה מאז?</h3><p>כל פעולה נשמרת כאירוע חדש ואינה מוחקת את ההיסטוריה.</p></div><div className="communication-action-grid">{ACTIONS.filter(action => (!action.needsAssignee || canReassign) && (!action.closing || canClose)).map(action => { const Icon = action.icon; return <button key={action.id} type="button" className={selectedAction === action.id ? 'active' : ''} onClick={() => setSelectedAction(action.id)} disabled={!isResponsible && !action.closing && !action.needsAssignee}><Icon size={15} /> {action.label}</button>; })}</div>{actionConfig && <div className="communication-action-form">{actionConfig.needsDate && <label>מועד מעקב חדש<input type="date" value={nextDate} onChange={event => setNextDate(event.target.value)} /></label>}{actionConfig.needsAssignee && <label>אחראי חדש<select value={nextAssigneeId} onChange={event => setNextAssigneeId(event.target.value)}><option value="">בחירת איש צוות</option>{staff.filter(member => (member.uid || member.id) !== draft.followUpAssigneeId).map(member => <option key={member.uid || member.id} value={member.uid || member.id}>{member.fullName || member.email}</option>)}</select></label>}<label>הערה לתיעוד<textarea value={note} onChange={event => setNote(event.target.value)} maxLength={1000} placeholder="מה השתנה או מה נדרש בהמשך?" /></label><button type="button" className="btn btn-primary" onClick={runAction} disabled={saving}>{saving ? 'שומר...' : 'שמירת הפעולה'}</button></div>}
      {isResponsible && <div className="communication-reminder-drafts"><strong><Send size={15} /> יצירת טיוטת תזכורת ידנית</strong><span>המערכת תפתח טיוטה בלבד ולא תשלח אותה.</span><div><button type="button" className="btn btn-secondary btn-sm" onClick={() => openReminder('gentle')} disabled={saving}>תזכורת עדינה</button><button type="button" className="btn btn-secondary btn-sm" onClick={() => openReminder('direct')} disabled={saving}>תזכורת ישירה</button></div></div>}
    </section>}

    <section className="communication-timeline"><div><h3>היסטוריית טיפול</h3><span>{events.length} אירועים</span></div>{events.map(event => <article key={event.id}><span className="communication-timeline-dot"><UserRoundCheck size={13} /></span><div><strong>{EVENT_LABELS[event.type] || 'המעקב עודכן'}</strong><p>{eventDetails(event, staffById)}</p><small>{staffById.get(event.actorId) || (event.actorId === user.uid ? 'אני' : 'איש צוות')} · {formatDate(event.createdAt)}</small></div></article>)}{events.length === 0 && <p className="communication-timeline-empty">עדיין אין אירועים להצגה.</p>}</section>
  </div>;
}
