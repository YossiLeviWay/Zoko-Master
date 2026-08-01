import { useEffect, useMemo, useState } from 'react';
import { Check, Clipboard, ExternalLink, Mail, RotateCcw, X } from 'lucide-react';
import { db } from '../../firebase';
import {
  cancelEmailFollowUp,
  confirmEmailSent,
  createEmailFollowUp,
  getEmailDraft,
  markEmailDraftOpened,
} from '../../services/firestore/communicationRepository';
import {
  copyTextToClipboard,
  invalidEmailAddresses,
  normalizeEmailList,
  prepareMailtoLaunch,
} from '../../utils/mailto';
import './CommunicationComposer.css';

function dateAfter(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function sourceLabel(task) {
  return task._source === 'personal' ? 'משימה אישית' : 'משימת מוסד';
}

export default function CommunicationComposer({ schoolId, user, task, onClose, onSuccess, onError }) {
  const [form, setForm] = useState({
    to: '',
    cc: '',
    bcc: '',
    subject: task.title ? `בנושא: ${task.title}` : '',
    body: '',
    summary: task.description || '',
    nextFollowUpAt: dateAfter(3),
    priority: task.priority || 'medium',
    completionCriteria: 'התקבלה תשובה וטופלה הפעולה הנדרשת',
    linksText: '',
  });
  const [record, setRecord] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(task.workflowType === 'external_email_followup');
  const [loadFailed, setLoadFailed] = useState(false);
  const [notice, setNotice] = useState('');

  const draft = useMemo(() => ({
    to: normalizeEmailList(form.to),
    cc: normalizeEmailList(form.cc),
    bcc: normalizeEmailList(form.bcc),
    subject: form.subject.trim(),
    body: form.body.trim(),
  }), [form]);

  useEffect(() => {
    if (task.workflowType !== 'external_email_followup' || !task.communicationDraftId) return undefined;
    let active = true;
    getEmailDraft({ db, schoolId, draftId: task.communicationDraftId })
      .then(saved => {
        if (!active) return;
        setForm(previous => ({
          ...previous,
          to: saved.to?.join('; ') || '',
          cc: saved.cc?.join('; ') || '',
          bcc: saved.bcc?.join('; ') || '',
          subject: saved.subject || '',
          body: saved.draftBody || '',
          summary: saved.summary || '',
          nextFollowUpAt: saved.nextFollowUpAt || '',
          priority: saved.priority || 'medium',
          completionCriteria: saved.completionCriteria || '',
          linksText: saved.links?.join('\n') || '',
        }));
        setRecord({
          draftId: saved.id,
          taskId: saved.taskId,
          trackingId: saved.trackingId,
          communicationStatus: saved.communicationStatus,
        });
      })
      .catch(() => {
        setLoadFailed(true);
        onError('לא ניתן לטעון את טיוטת המייל השמורה.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [onError, schoolId, task.communicationDraftId, task.workflowType]);

  function change(field, value) {
    setForm(previous => ({ ...previous, [field]: value }));
  }

  function validate() {
    const invalid = [
      ...invalidEmailAddresses(form.to),
      ...invalidEmailAddresses(form.cc),
      ...invalidEmailAddresses(form.bcc),
    ];
    if (!draft.to.length) return 'יש להזין לפחות נמען אחד.';
    if (invalid.length) return `כתובת המייל אינה תקינה: ${invalid[0]}`;
    if (!draft.subject) return 'יש להזין נושא.';
    if (!draft.body) return 'יש להזין תוכן לטיוטה.';
    return '';
  }

  async function copy(value, label) {
    try {
      await copyTextToClipboard(value);
      setNotice(`${label} הועתק.`);
    } catch {
      setNotice('הדפדפן חסם העתקה אוטומטית. ניתן לסמן ולהעתיק ידנית.');
    }
  }

  async function openMailto(existingRecord = record) {
    const launch = prepareMailtoLaunch(draft);
    if (launch.copyBodyRequired) {
      await copy(draft.body, 'תוכן הטיוטה');
      setNotice('הטיוטה ארוכה: התוכן הועתק, וחלון המייל ייפתח עם הנמענים והנושא בלבד.');
    }
    if (existingRecord) {
      try {
        await markEmailDraftOpened({
          db,
          schoolId,
          userId: user.uid,
          draftId: existingRecord.draftId,
          taskId: existingRecord.taskId,
        });
      } catch {
        setNotice('הטיוטה נשמרה, אך רישום פתיחת חלון המייל נכשל. ניתן לנסות שוב.');
      }
    }
    window.location.href = launch.href;
  }

  async function createAndOpen(event) {
    event.preventDefault();
    const validationError = validate();
    if (validationError) {
      onError(validationError);
      return;
    }
    setSaving(true);
    try {
      const created = await createEmailFollowUp({
        db,
        schoolId,
        user,
        sourceTask: task,
        input: {
          ...draft,
          summary: form.summary,
          nextFollowUpAt: form.nextFollowUpAt,
          priority: form.priority,
          completionCriteria: form.completionCriteria,
          links: form.linksText.split('\n').map(item => item.trim()).filter(Boolean),
        },
      });
      setRecord(created);
      await openMailto(created);
    } catch {
      onError('לא ניתן לשמור את טיוטת המייל ומשימת המעקב. השינוי לא בוצע.');
    } finally {
      setSaving(false);
    }
  }

  async function confirmSent() {
    setSaving(true);
    try {
      await confirmEmailSent({ db, schoolId, userId: user.uid, ...record });
      onSuccess('המייל סומן כנשלח ומשימת המעקב ממתינה לתשובה.');
      onClose();
    } catch {
      onError('האישור לא נשמר. הטיוטה נשארה במצב ממתינה לשליחה.');
    } finally {
      setSaving(false);
    }
  }

  async function cancelFollowUp() {
    setSaving(true);
    try {
      await cancelEmailFollowUp({ db, schoolId, userId: user.uid, ...record });
      onSuccess('המעקב בוטל.');
      onClose();
    } catch {
      onError('לא ניתן לבטל את המעקב כרגע.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="task-edit-overlay communication-overlay" onClick={onClose}>
      <section className="communication-modal" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="יצירת מייל ומעקב" dir="rtl">
        <header className="communication-header">
          <div><span className="communication-eyebrow"><Mail size={15} /> מייל ומעקב</span><h2>טיוטת מייל מתוך משימה</h2><p>{sourceLabel(task)}: {task.title}</p></div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="סגירה"><X size={18} /></button>
        </header>

        {loading ? <div className="communication-loading">טוען את טיוטת המייל...</div> : loadFailed ? <div className="communication-loading"><p>הטיוטה לא נטענה, ולכן לא ייווצר מעקב כפול.</p><button className="btn btn-secondary" type="button" onClick={onClose}>סגירה</button></div> : !record ? (
          <form className="communication-form" onSubmit={createAndOpen}>
            <div className="communication-privacy-note">הטיוטה תישמר כפרטית. פתיחת חלון המייל אינה מאשרת שהמייל נשלח.</div>
            <div className="form-group"><label>אל</label><input value={form.to} onChange={event => change('to', event.target.value)} placeholder="name@example.com; second@example.com" dir="ltr" autoFocus /></div>
            <div className="form-row"><div className="form-group"><label>עותק</label><input value={form.cc} onChange={event => change('cc', event.target.value)} dir="ltr" /></div><div className="form-group"><label>עותק מוסתר</label><input value={form.bcc} onChange={event => change('bcc', event.target.value)} dir="ltr" /></div></div>
            <div className="form-group"><label>נושא</label><input value={form.subject} onChange={event => change('subject', event.target.value)} maxLength={300} /></div>
            <div className="form-group"><label>הטיוטה שנוצרה במערכת</label><textarea className="communication-body" value={form.body} onChange={event => change('body', event.target.value)} maxLength={10000} placeholder="כתבו את תוכן המייל..." /></div>
            <div className="form-group"><label>תקציר פנימי למעקב</label><textarea value={form.summary} onChange={event => change('summary', event.target.value)} maxLength={1000} /></div>
            <div className="form-row"><div className="form-group"><label>מועד מעקב הבא</label><input type="date" value={form.nextFollowUpAt} onChange={event => change('nextFollowUpAt', event.target.value)} /></div><div className="form-group"><label>עדיפות</label><select value={form.priority} onChange={event => change('priority', event.target.value)}><option value="low">נמוכה</option><option value="medium">בינונית</option><option value="high">גבוהה</option></select></div></div>
            <div className="form-group"><label>תנאי השלמה</label><input value={form.completionCriteria} onChange={event => change('completionCriteria', event.target.value)} maxLength={1000} /></div>
            <div className="form-group"><label>קישורים נלווים (קישור בכל שורה)</label><textarea value={form.linksText} onChange={event => change('linksText', event.target.value)} dir="ltr" /></div>
            {task.attachedFileId && <div className="communication-attachment-note">הקובץ המקושר למשימה יישמר כהפניה במעקב. `mailto` אינו מצרף קבצים אוטומטית.</div>}
            <div className="communication-copy-actions"><button type="button" className="btn btn-secondary btn-sm" onClick={() => copy(draft.body, 'תוכן הטיוטה')}><Clipboard size={14} /> העתקת תוכן</button><button type="button" className="btn btn-secondary btn-sm" onClick={() => copy(draft.subject, 'הנושא')}><Clipboard size={14} /> העתקת נושא</button><button type="button" className="btn btn-secondary btn-sm" onClick={() => copy([...draft.to, ...draft.cc, ...draft.bcc].join('; '), 'הנמענים')}><Clipboard size={14} /> העתקת נמענים</button></div>
            {notice && <p className="communication-notice" role="status">{notice}</p>}
            <footer className="form-actions"><button className="btn btn-primary" disabled={saving}><ExternalLink size={16} /> {saving ? 'שומר ופותח...' : 'פתיחת טיוטת מייל'}</button><button className="btn btn-secondary" type="button" onClick={onClose}>ביטול</button></footer>
          </form>
        ) : (
          <div className="communication-confirmation">
            <div className="communication-confirmation-icon"><Mail size={30} /></div>
            <h3>האם המייל נשלח?</h3>
            <p>המערכת אינה יכולה לדעת מה קרה באפליקציית המייל. רק אישור ידני יעביר את המעקב למצב „ממתין לתשובה”.</p>
            <dl><div><dt>מזהה מעקב</dt><dd dir="ltr">{record.trackingId}</dd></div><div><dt>סטטוס נוכחי</dt><dd>ממתין לשליחה</dd></div></dl>
            <div className="communication-copy-actions communication-copy-actions--center"><button type="button" className="btn btn-secondary btn-sm" onClick={() => copy(draft.body, 'תוכן הטיוטה')}><Clipboard size={14} /> תוכן</button><button type="button" className="btn btn-secondary btn-sm" onClick={() => copy(draft.subject, 'הנושא')}><Clipboard size={14} /> נושא</button><button type="button" className="btn btn-secondary btn-sm" onClick={() => copy([...draft.to, ...draft.cc, ...draft.bcc].join('; '), 'הנמענים')}><Clipboard size={14} /> נמענים</button></div>
            {notice && <p className="communication-notice" role="status">{notice}</p>}
            <div className="communication-confirm-actions"><button className="btn btn-primary" onClick={confirmSent} disabled={saving}><Check size={16} /> כן, המייל נשלח</button><button className="btn btn-secondary" onClick={onClose} disabled={saving}>לא נשלח כעת</button><button className="btn btn-secondary" onClick={() => openMailto()} disabled={saving}><RotateCcw size={15} /> פתיחה מחדש</button><button className="btn btn-danger" onClick={cancelFollowUp} disabled={saving}>ביטול המעקב</button></div>
          </div>
        )}
      </section>
    </div>
  );
}
