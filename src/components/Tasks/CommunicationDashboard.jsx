import { AlertCircle, CalendarClock, CheckCircle2, MailPlus, Search, Send, UserRound } from 'lucide-react';
import { useMemo, useState } from 'react';

const STATUS = {
  awaiting_send: { label: 'ממתין לשליחה', group: 'send', icon: Send },
  awaiting_reply: { label: 'ממתין לתשובה', group: 'reply', icon: CalendarClock },
  reply_received_in_progress: { label: 'התקבלה תשובה', group: 'action', icon: AlertCircle },
  action_required: { label: 'נדרשת פעולה', group: 'action', icon: AlertCircle },
  postponed: { label: 'נדחה', group: 'action', icon: CalendarClock },
  resolved: { label: 'טופל', group: 'resolved', icon: CheckCircle2 },
  closed_without_reply: { label: 'נסגר ללא תשובה', group: 'resolved', icon: CheckCircle2 },
  cancelled: { label: 'בוטל', group: 'resolved', icon: CheckCircle2 },
};

function dateMillis(value) {
  if (value?.toMillis) return value.toMillis();
  if (typeof value === 'string') return Date.parse(value) || 0;
  return 0;
}

function daysSince(value) {
  const millis = dateMillis(value);
  return millis ? Math.max(0, Math.floor((Date.now() - millis) / 86400000)) : 0;
}

function dueLabel(value) {
  if (!value) return 'לא נקבע';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? 'לא נקבע' : date.toLocaleDateString('he-IL');
}

export default function CommunicationDashboard({ tasks, staff = [], onOpen, onCreate }) {
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('all');
  const today = new Date().toISOString().slice(0, 10);
  const staffById = useMemo(() => new Map(staff.map(member => [member.uid || member.id, member.fullName || member.email || 'איש צוות'])), [staff]);
  const followUps = useMemo(() => {
    const byDraft = new Map();
    tasks.filter(task => task.workflowType === 'external_email_followup').forEach(task => {
      const key = task.communicationDraftId || task.id;
      const current = byDraft.get(key);
      if (!current || task._source === 'communication') byDraft.set(key, task);
    });
    return [...byDraft.values()].sort((left, right) => dateMillis(right.createdAt) - dateMillis(left.createdAt));
  }, [tasks]);
  const counts = useMemo(() => ({
    send: followUps.filter(task => (STATUS[task.communicationStatus]?.group || 'send') === 'send').length,
    reply: followUps.filter(task => (STATUS[task.communicationStatus]?.group || 'send') === 'reply').length,
    action: followUps.filter(task => (STATUS[task.communicationStatus]?.group || 'send') === 'action').length,
    late: followUps.filter(task => !['resolved', 'closed_without_reply', 'cancelled'].includes(task.communicationStatus) && task.nextFollowUpAt && task.nextFollowUpAt.slice(0, 10) < today).length,
    resolved: followUps.filter(task => (STATUS[task.communicationStatus]?.group || 'send') === 'resolved').length,
  }), [followUps, today]);
  const displayed = followUps.filter(task => {
    const statusGroup = STATUS[task.communicationStatus]?.group || 'send';
    if (group === 'late' && !(task.nextFollowUpAt && task.nextFollowUpAt.slice(0, 10) < today && statusGroup !== 'resolved')) return false;
    if (!['all', 'late'].includes(group) && statusGroup !== group) return false;
    const needle = search.trim().toLowerCase();
    return !needle || [task.communicationSubject, task.externalRecipientLabel, task.linkedContextLabel, task.title]
      .some(value => String(value || '').toLowerCase().includes(needle));
  });

  return <section className="communication-dashboard" aria-label="מיילים ומעקבים">
    <header><div><span><MailPlus size={16} /> מרכז מיילים ומעקבים</span><h2>כל הטיוטות והמעקבים במקום אחד</h2><p>פתיחת מייל נשארת בשליטתך; המערכת שומרת את ההקשר ואת מועד המעקב.</p></div><button className="btn btn-primary" onClick={onCreate}><MailPlus size={16} /> מייל ומעקב חדש</button></header>
    <div className="communication-dashboard-stats">
      {[['send', 'ממתין לשליחה', counts.send], ['reply', 'ממתין לתשובה', counts.reply], ['action', 'נדרשת פעולה', counts.action], ['late', 'באיחור', counts.late], ['resolved', 'טופלו לאחרונה', counts.resolved]].map(([value, label, count]) => <button key={value} className={group === value ? 'active' : ''} onClick={() => setGroup(previous => previous === value ? 'all' : value)}><strong>{count}</strong><span>{label}</span></button>)}
    </div>
    <label className="communication-dashboard-search"><Search size={15} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="חיפוש לפי נושא, נמען או הקשר..." /></label>
    <div className="communication-dashboard-list">{displayed.map(task => {
      const config = STATUS[task.communicationStatus] || STATUS.awaiting_send;
      const Icon = config.icon;
      return <article key={task._key || task.id} className={`communication-followup-card communication-followup-card--${config.group}`}>
        <div className="communication-followup-status"><Icon size={16} /><span>{config.label}</span></div>
        <div className="communication-followup-main"><h3>{task.communicationSubject || task.title}</h3><p><UserRound size={13} /> {task.externalRecipientLabel || 'נמען חיצוני'}</p><div><span>נוצר לפני {daysSince(task.createdAt)} ימים</span><span>מעקב הבא: {dueLabel(task.nextFollowUpAt)}</span><span>אחראי: {staffById.get(task.followUpAssigneeId) || 'אני'}</span></div></div>
        <div className="communication-followup-context"><small>מקושר אל</small><strong>{task.linkedContextLabel || 'משימת מקור'}</strong><span>{task.completionCriteria || 'התקבלה תשובה וטופלה הפעולה הנדרשת'}</span></div>
        <button className="btn btn-secondary btn-sm" onClick={() => onOpen(task)}>{task.communicationStatus === 'awaiting_send' ? 'פתיחת הטיוטה' : 'פתיחת המעקב'}</button>
      </article>;
    })}{displayed.length === 0 && <div className="empty-state"><MailPlus size={32} /><p>אין מעקבים שמתאימים לתצוגה.</p></div>}</div>
  </section>;
}
