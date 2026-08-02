import { useEffect, useMemo, useState } from 'react';
import { BookmarkPlus, Check, Clipboard, ExternalLink, FileText, Mail, RotateCcw, ShieldCheck, X } from 'lucide-react';
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
import {
  CONTACT_SCOPE,
  createContact,
  normalizeContactEmail,
  subscribeContacts,
} from '../../services/firestore/contactRepository';
import { communicationContextLabel } from '../../utils/communicationContext';
import CommunicationAgentPanel from './CommunicationAgentPanel';
import CommunicationFollowUpPanel from './CommunicationFollowUpPanel';
import CommunicationTemplatesPanel from './CommunicationTemplatesPanel';
import './CommunicationComposer.css';

function dateAfter(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function sourceLabel(task) {
  if (task.communicationContext?.type) return communicationContextLabel(task.communicationContext.type);
  return task._source === 'personal' ? 'משימה אישית' : 'משימת מוסד';
}

export default function CommunicationComposer({ schoolId, user, task, staff = [], files = [], contactPermissions = {}, communicationPermissions = {}, onClose, onSuccess, onError }) {
  const context = task.communicationContext || {};
  const [form, setForm] = useState({
    to: context.recipientEmail || '',
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
  const [savedDraft, setSavedDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(task.workflowType === 'external_email_followup');
  const [loadFailed, setLoadFailed] = useState(false);
  const [notice, setNotice] = useState('');
  const [contacts, setContacts] = useState([]);
  const [linkedContactId, setLinkedContactId] = useState('');
  const [contactDraft, setContactDraft] = useState(null);
  const [linkedFileIds, setLinkedFileIds] = useState(() => context.fileIds || (task.attachedFileId ? [task.attachedFileId] : []));
  const [visibility, setVisibility] = useState(() => context.type === 'team' && context.participantIds?.length ? 'team' : context.participantIds?.length ? 'participants' : 'private');

  const draft = useMemo(() => ({
    to: normalizeEmailList(form.to),
    cc: normalizeEmailList(form.cc),
    bcc: normalizeEmailList(form.bcc),
    subject: form.subject.trim(),
    body: form.body.trim(),
  }), [form]);

  useEffect(() => subscribeContacts({
    db,
    schoolId,
    userId: user.uid,
    includeInstitutional: contactPermissions.view === true,
    canReadRestricted: contactPermissions.edit === true,
    onData: setContacts,
    onError: () => setContacts([]),
  }), [contactPermissions.edit, contactPermissions.view, schoolId, user.uid]);

  const unknownRecipients = useMemo(() => {
    const known = new Set([
      ...contacts.flatMap(contact => contact.normalizedEmails || []),
      ...staff.map(member => member.email).filter(Boolean).map(normalizeContactEmail),
    ]);
    return [...new Set([...draft.to, ...draft.cc, ...draft.bcc].map(normalizeContactEmail))]
      .filter(email => email && !known.has(email));
  }, [contacts, draft.bcc, draft.cc, draft.to, staff]);

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
        setLinkedContactId(saved.linkedContactId || '');
        setLinkedFileIds(saved.linkedFileIds || []);
        setVisibility(saved.visibility || 'private');
        setSavedDraft(saved);
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

  function applyAgentProposal(proposal) {
    setForm(previous => ({
      ...previous,
      to: proposal.recipients?.join('; ') || previous.to,
      cc: proposal.cc?.join('; ') || '',
      bcc: proposal.bcc?.join('; ') || '',
      subject: proposal.subject || previous.subject,
      body: proposal.body || previous.body,
      summary: proposal.summary || previous.summary,
      nextFollowUpAt: proposal.followUpAt || previous.nextFollowUpAt,
      priority: proposal.priority === 'normal' ? 'medium' : (proposal.priority || previous.priority),
      completionCriteria: proposal.completionCriteria || previous.completionCriteria,
    }));
    setNotice('הצעת הסוכן הוחלה על הטיוטה. היא עדיין לא נשמרה ולא נשלחה.');
  }

  function applyTemplate(template) {
    setForm(previous => ({
      ...previous,
      subject: template.subject || previous.subject,
      body: template.body || previous.body,
    }));
    setNotice('התבנית הוחלה על הטיוטה. ניתן לערוך אותה לפני השמירה.');
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
    const links = form.linksText.split('\n').map(item => item.trim()).filter(Boolean);
    const invalidLink = links.find(item => {
      try {
        const url = new URL(item);
        return !['http:', 'https:'].includes(url.protocol)
          || /(^|\.)firebaseio\.com$|(^|\.)firebasestorage\.googleapis\.com$/i.test(url.hostname)
          || (url.hostname === 'yossileviway.github.io' && url.pathname.startsWith('/Zoko-Master'));
      } catch { return true; }
    });
    if (invalidLink) return 'יש להזין רק קישורי web חיצוניים תקינים. קישור פנימי של Firebase או Zoko אינו נשלח במייל.';
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
          linkedContactId,
          linkedFileIds,
          visibility,
          participantIds: context.participantIds || [],
          recipientLabel: draft.to[0],
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

  function addKnownContact(contactKey) {
    const [scope, contactId] = contactKey.split(':');
    const contact = contacts.find(item => item.scope === scope && item.id === contactId);
    if (!contact?.primaryEmail) return;
    const recipients = normalizeEmailList(form.to);
    change('to', [...new Set([...recipients, contact.primaryEmail])].join('; '));
    setLinkedContactId(contact.id);
  }

  async function saveRecipientContact() {
    if (!contactDraft?.email || !contactDraft.fullName?.trim()) {
      setNotice('יש להזין שם עבור איש הקשר.');
      return;
    }
    if (contactDraft.scope === CONTACT_SCOPE.INSTITUTIONAL
      && !contactDraft.organization?.trim()
      && !contactDraft.category?.trim()) {
      setNotice('לאיש קשר מוסדי יש להזין ארגון או קטגוריה.');
      return;
    }
    setSaving(true);
    try {
      const saved = await createContact({
        db,
        schoolId,
        actor: { uid: user.uid },
        scope: contactDraft.scope,
        input: {
          fullName: contactDraft.fullName,
          primaryEmail: contactDraft.email,
          organization: contactDraft.organization,
          category: contactDraft.category,
          visibility: 'institution',
          ownerStaffIds: [user.uid],
        },
        permissions: contactPermissions,
      });
      setLinkedContactId(saved.id);
      setContactDraft(null);
      setNotice(contactDraft.scope === CONTACT_SCOPE.PRIVATE ? 'הנמען נשמר כאיש קשר פרטי.' : 'הנמען נשמר כאיש קשר מוסדי.');
    } catch (saveError) {
      setNotice(saveError.message === 'DUPLICATE_CONTACT'
        ? `הכתובת כבר שמורה אצל ${saveError.duplicate?.fullName || 'איש קשר קיים'}.`
        : 'לא ניתן לשמור את הנמען כרגע.');
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
          <div><span className="communication-eyebrow"><Mail size={15} /> מייל ומעקב</span><h2>טיוטת מייל ומעקב</h2><p>{sourceLabel(task)}: {task.title}</p></div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="סגירה"><X size={18} /></button>
        </header>

        {loading ? <div className="communication-loading">טוען את טיוטת המייל...</div> : loadFailed ? <div className="communication-loading"><p>הטיוטה לא נטענה, ולכן לא ייווצר מעקב כפול.</p><button className="btn btn-secondary" type="button" onClick={onClose}>סגירה</button></div> : !record ? (
          <form className="communication-form" onSubmit={createAndOpen}>
            <div className="communication-context-note"><strong>מקושר אל:</strong> {sourceLabel(task)} — {task.title}</div>
            {context.type === 'student' && <div className="communication-student-warning"><ShieldCheck size={17} /><span><strong>הטיוטה קשורה לתלמיד.</strong> אין להעתיק אליה מספר זהות, ציונים, מסמכים, מידע רפואי או הערות אישיות. המערכת לא מוסיפה מידע כזה אוטומטית.</span></div>}
            <div className="communication-privacy-note">פתיחת חלון המייל אינה מאשרת שהמייל נשלח. לפני השמירה מוצג למי תהיה גישה למעקב בתוך Zoko.</div>
            <div className={`communication-compose-workspace${communicationPermissions.useAgent ? ' communication-compose-workspace--agent' : ''}`}>
            {communicationPermissions.useAgent && <CommunicationAgentPanel schoolId={schoolId} task={task} form={form} contacts={contacts} staff={staff} onApply={applyAgentProposal} />}
            <div className="communication-structured-fields">
            <CommunicationTemplatesPanel db={db} schoolId={schoolId} userId={user.uid} currentForm={form} canManageInstitutional={communicationPermissions.manageTemplates === true} onApply={applyTemplate} onSuccess={setNotice} onError={onError} />
            <div className="form-group"><label>אל</label><input value={form.to} onChange={event => change('to', event.target.value)} placeholder="name@example.com; second@example.com" dir="ltr" autoFocus />{contacts.length > 0 && <select className="communication-contact-picker" value="" onChange={event => addKnownContact(event.target.value)}><option value="">הוספת נמען מאנשי הקשר...</option>{contacts.filter(contact => !contact.archived && contact.primaryEmail).map(contact => <option key={`${contact.scope}:${contact.id}`} value={`${contact.scope}:${contact.id}`}>{contact.fullName} — {contact.primaryEmail}{contact.scope === CONTACT_SCOPE.PRIVATE ? ' (פרטי)' : ''}</option>)}</select>}</div>
            <div className="form-row"><div className="form-group"><label>עותק</label><input value={form.cc} onChange={event => change('cc', event.target.value)} dir="ltr" /></div><div className="form-group"><label>עותק מוסתר</label><input value={form.bcc} onChange={event => change('bcc', event.target.value)} dir="ltr" /></div></div>
            {unknownRecipients.length > 0 && <div className="communication-new-recipients"><strong>נמענים שאינם שמורים</strong>{unknownRecipients.map(email => <div key={email}><span dir="ltr">{email}</span><div>{contactPermissions.create && <button type="button" onClick={() => setContactDraft({ email, scope: CONTACT_SCOPE.INSTITUTIONAL, fullName: '', organization: '', category: '' })}><BookmarkPlus size={13} /> מוסדי</button>}<button type="button" onClick={() => setContactDraft({ email, scope: CONTACT_SCOPE.PRIVATE, fullName: '', organization: '', category: '' })}><BookmarkPlus size={13} /> פרטי שלי</button><span>או השתמשו הפעם בלבד</span></div></div>)}</div>}
            {contactDraft && <div className="communication-contact-save"><div><strong>{contactDraft.scope === CONTACT_SCOPE.PRIVATE ? 'שמירה כאיש קשר פרטי' : 'שמירה כאיש קשר מוסדי'}</strong><button type="button" onClick={() => setContactDraft(null)} aria-label="ביטול שמירה"><X size={14} /></button></div><input value={contactDraft.fullName} onChange={event => setContactDraft(previous => ({ ...previous, fullName: event.target.value }))} placeholder="שם מלא" maxLength={160} />{contactDraft.scope === CONTACT_SCOPE.INSTITUTIONAL && <div className="form-row"><input value={contactDraft.organization} onChange={event => setContactDraft(previous => ({ ...previous, organization: event.target.value }))} placeholder="ארגון" maxLength={160} /><input value={contactDraft.category} onChange={event => setContactDraft(previous => ({ ...previous, category: event.target.value }))} placeholder="קטגוריה" maxLength={80} /></div>}<button type="button" className="btn btn-secondary btn-sm" onClick={saveRecipientContact} disabled={saving}>שמירת הנמען</button></div>}
            <div className="form-group"><label>נושא</label><input value={form.subject} onChange={event => change('subject', event.target.value)} maxLength={300} /></div>
            <div className="form-group"><label>הטיוטה שנוצרה במערכת</label><textarea className="communication-body" value={form.body} onChange={event => change('body', event.target.value)} maxLength={10000} placeholder="כתבו את תוכן המייל..." /></div>
            <div className="form-group"><label>תקציר פנימי למעקב</label><textarea value={form.summary} onChange={event => change('summary', event.target.value)} maxLength={1000} /></div>
            <div className="form-row"><div className="form-group"><label>מועד מעקב הבא</label><input type="date" value={form.nextFollowUpAt} onChange={event => change('nextFollowUpAt', event.target.value)} /></div><div className="form-group"><label>עדיפות</label><select value={form.priority} onChange={event => change('priority', event.target.value)}><option value="low">נמוכה</option><option value="medium">בינונית</option><option value="high">גבוהה</option></select></div></div>
            <div className="form-group"><label>תנאי השלמה</label><input value={form.completionCriteria} onChange={event => change('completionCriteria', event.target.value)} maxLength={1000} /></div>
            <div className="form-group"><label>קישורים נלווים (קישור בכל שורה)</label><textarea value={form.linksText} onChange={event => change('linksText', event.target.value)} dir="ltr" /></div>
            {files.length > 0 && <fieldset className="communication-files"><legend>קבצים קיימים ב־Zoko — עד 20</legend>{files.filter(file => !file.trashedAt && !file.deletedAt).slice(0, 100).map(file => <label key={file.id}><input type="checkbox" checked={linkedFileIds.includes(file.id)} onChange={event => setLinkedFileIds(previous => event.target.checked ? [...new Set([...previous, file.id])].slice(0, 20) : previous.filter(id => id !== file.id))} /><FileText size={13} /> {file.name || 'קובץ'}</label>)}</fieldset>}
            {linkedFileIds.length > 0 && <div className="communication-attachment-note"><strong>רשימת צירוף ידנית:</strong> `mailto` אינו מצרף קבצים. יש לצרף ידנית {linkedFileIds.length} קבצים בחלון המייל; במעקב נשמרים רק מזהי הקבצים המורשים.</div>}
            <div className="form-group communication-visibility"><label>מי יוכל לראות את המעקב בתוך Zoko?</label><select value={visibility} onChange={event => setVisibility(event.target.value)} disabled={context.type === 'student'}><option value="private">רק אני</option>{context.participantIds?.length > 0 && <option value="participants">אני והמשתתפים המקושרים ({context.participantIds.length})</option>}{context.type === 'team' && context.teamId && <option value="team">חברי הצוות המקושר</option>}</select><small>{context.type === 'student' ? 'מעקב הקשור לתלמיד נשמר פרטי כברירת אבטחה מחייבת.' : visibility === 'private' ? 'רק יוצר המעקב.' : 'רק חברי המוסד שנכללו בהקשר המקורי.'}</small></div>
            </div>
            </div>
            <div className="communication-copy-actions"><button type="button" className="btn btn-secondary btn-sm" onClick={() => copy(draft.body, 'תוכן הטיוטה')}><Clipboard size={14} /> העתקת תוכן</button><button type="button" className="btn btn-secondary btn-sm" onClick={() => copy(draft.subject, 'הנושא')}><Clipboard size={14} /> העתקת נושא</button><button type="button" className="btn btn-secondary btn-sm" onClick={() => copy([...draft.to, ...draft.cc, ...draft.bcc].join('; '), 'הנמענים')}><Clipboard size={14} /> העתקת נמענים</button></div>
            {notice && <p className="communication-notice" role="status">{notice}</p>}
            <footer className="form-actions"><button className="btn btn-primary" disabled={saving}><ExternalLink size={16} /> {saving ? 'שומר ופותח...' : 'פתיחת טיוטת מייל'}</button><button className="btn btn-secondary" type="button" onClick={onClose}>ביטול</button></footer>
          </form>
        ) : record.communicationStatus !== 'awaiting_send' && savedDraft ? (
          <CommunicationFollowUpPanel
            db={db}
            schoolId={schoolId}
            user={user}
            draft={savedDraft}
            staff={staff}
            permissions={communicationPermissions}
            onClose={onClose}
            onSuccess={onSuccess}
            onError={onError}
          />
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
