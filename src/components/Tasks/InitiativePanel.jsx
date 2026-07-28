import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArrowRight,
  CalendarRange,
  CheckCircle2,
  CircleAlert,
  Copy,
  FileText,
  Flag,
  Link2,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Plus,
  Save,
  Target,
  Users,
  X,
} from 'lucide-react';
import { db } from '../../firebase';
import { createNotifications } from '../../utils/notifications';
import {
  addInitiativeUpdate,
  addInitiativeUpdateComment,
  archiveInitiative,
  createInitiative,
  createMilestone,
  duplicateInitiative,
  recomputeInitiativeSummary,
  saveInitiativeTemplate,
  setInitiativeHealthOverride,
  subscribeInitiativeDetails,
  subscribeInitiativeTemplates,
  updateInitiative,
  updateMilestone,
} from '../../services/firestore/initiativeRepository';
import {
  deriveInitiativeHealth,
  findHolidayConflict,
  INITIATIVE_HEALTH,
  INITIATIVE_STATUSES,
  initiativeProgress,
  MILESTONE_DATE_TYPES,
  MILESTONE_STATUSES,
  milestoneDate,
  nextAvailableSchoolDate,
  nextInitiativeMilestone,
  UPDATE_TYPES,
} from '../../utils/initiatives';

function dateLabel(value) {
  if (!value) return 'טרם נקבע';
  return new Date(`${value}T00:00:00`).toLocaleDateString('he-IL');
}

function emptyInitiativeForm(year) {
  return {
    title: '', description: '', academicYearId: year?.id || '', academicYearLabel: year?.hebrewLabel || year?.label || '',
    category: '', startDate: '', endDate: '', ownerId: '', ownerName: '', memberIds: [], teamIds: [], classIds: [],
    goalsText: '', fileIds: [], status: 'active', nextAction: '', templateId: '',
  };
}

function emptyMilestone(order = 0) {
  return {
    title: '', description: '', ownerId: '', participantIds: [], status: 'not_started', priority: 'medium', weight: 1,
    dateType: 'unset', startDate: '', endDate: '', proposedDate: '', requiredOutput: '', approverId: '', dependencyId: '',
    reminderAt: '', fileIds: [], evidenceIds: [], requiresEvidence: false, completionSummary: '', cancelReason: '', order,
  };
}

function emptyUpdate() {
  return {
    type: 'progress', text: '', milestoneId: '', taskId: '', fileIds: [], link: '', mentionedUserIds: [],
    blockerOwnerId: '', blockerDueDate: '', blockerStatus: 'open',
  };
}

function emptyClosing() {
  return { summary: '', outcome: '', achievedGoals: '', unachievedGoals: '', lessons: '', recommendations: '' };
}

function timestampLabel(value) {
  const date = value?.toDate?.();
  return date ? date.toLocaleString('he-IL') : '';
}

function toggleId(list, id, checked) {
  return checked ? [...new Set([...list, id])] : list.filter(item => item !== id);
}

function Modal({ title, children, onClose }) {
  return <div className="task-edit-overlay" onClick={onClose}>
    <section className="task-edit-modal initiative-modal" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
      <div className="task-edit-header"><h3>{title}</h3><button className="icon-btn" onClick={onClose} aria-label="סגירה"><X size={18} /></button></div>
      {children}
    </section>
  </div>;
}

export default function InitiativePanel({
  schoolId,
  actor,
  initiatives,
  staff,
  teams,
  classes,
  files,
  holidays,
  academicYears,
  tasks,
  permissions,
  createRequest,
  initialInitiativeId,
  attentionOnly,
  onClearAttention,
  onAddTask,
  onLinkTask,
  onDetailChange,
  onMessage,
  onError,
}) {
  const [activeId, setActiveId] = useState('');
  const [details, setDetails] = useState({ milestones: [], updates: [], comments: [], activity: [] });
  const [templates, setTemplates] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showMilestone, setShowMilestone] = useState(false);
  const [editingMilestoneId, setEditingMilestoneId] = useState('');
  const [showUpdate, setShowUpdate] = useState(false);
  const [showLinkTask, setShowLinkTask] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [initiativeForm, setInitiativeForm] = useState(() => emptyInitiativeForm(academicYears[0]));
  const [milestoneForm, setMilestoneForm] = useState(emptyMilestone);
  const [updateForm, setUpdateForm] = useState(emptyUpdate);
  const [closingForm, setClosingForm] = useState(emptyClosing);
  const [saving, setSaving] = useState(false);

  const activeInitiative = initiatives.find(item => item.id === activeId) || null;
  const canCreate = permissions['initiatives.create'];
  const canEdit = permissions['initiatives.edit'] || (activeInitiative?.ownerId === actor.uid && canCreate);
  const canCreateMilestones = permissions['initiatives.createMilestones'] || canEdit;
  const canApproveMilestones = permissions['initiatives.approveMilestones'];
  const canChangeHealth = permissions['initiatives.changeHealth'];
  const canTemplate = permissions['initiatives.createTemplate'];
  const canDuplicate = permissions['initiatives.duplicate'];
  const canArchive = permissions['initiatives.archive'];

  useEffect(() => {
    if (createRequest && canCreate) {
      const activeYear = academicYears.find(item => item.isActive) || academicYears[0];
      setInitiativeForm(emptyInitiativeForm(activeYear));
      setShowCreate(true);
    }
  }, [academicYears, canCreate, createRequest]);

  useEffect(() => {
    if (initialInitiativeId && initiatives.some(item => item.id === initialInitiativeId)) setActiveId(initialInitiativeId);
  }, [initialInitiativeId, initiatives]);

  useEffect(() => subscribeInitiativeTemplates({
    db, schoolId, onData: setTemplates, onError: () => setTemplates([]),
  }), [schoolId]);

  useEffect(() => {
    if (!activeId) {
      setDetails({ milestones: [], updates: [], comments: [], activity: [] });
      return undefined;
    }
    return subscribeInitiativeDetails({
      db, schoolId, initiativeId: activeId, onData: setDetails, onError,
    });
  }, [activeId, onError, schoolId]);

  useEffect(() => {
    onDetailChange?.(Boolean(activeId));
  }, [activeId, onDetailChange]);

  const calculated = useMemo(() => initiativeProgress(details.milestones), [details.milestones]);
  const health = useMemo(() => activeInitiative
    ? deriveInitiativeHealth({ initiative: activeInitiative, milestones: details.milestones, updates: details.updates })
    : 'on_track', [activeInitiative, details.milestones, details.updates]);
  const nextMilestone = useMemo(() => nextInitiativeMilestone(details.milestones), [details.milestones]);
  const linkedTasks = useMemo(() => tasks.filter(task => task.initiativeId === activeId), [activeId, tasks]);
  const initiativeStaff = useMemo(() => {
    if (!activeInitiative) return [];
    const allowed = new Set([activeInitiative.ownerId, ...(activeInitiative.memberIds || [])]);
    return staff.filter(item => allowed.has(item.uid || item.id));
  }, [activeInitiative, staff]);

  const displayedInitiatives = useMemo(() => initiatives.filter(item => {
    if (showArchived) return item.status === 'archived';
    if (item.status === 'archived') return false;
    if (!attentionOnly) return true;
    return ['attention', 'at_risk'].includes(item.health);
  }), [attentionOnly, initiatives, showArchived]);

  async function notifyPeople(userIds, title, body, initiativeId = activeId) {
    const recipients = [...new Set(userIds.filter(id => id && id !== actor.uid))];
    if (!recipients.length) return;
    await createNotifications(recipients, {
      schoolId,
      title,
      body,
      type: 'task',
      link: `/tasks?initiative=${initiativeId}`,
    });
  }

  function selectTemplate(templateId) {
    const template = templates.find(item => item.id === templateId);
    setInitiativeForm(previous => ({
      ...previous,
      templateId,
      ...(template ? {
        title: template.title || '', description: template.description || '', category: template.category || '',
        goalsText: Array.isArray(template.goals) ? template.goals.join('\n') : '',
      } : {}),
    }));
  }

  async function submitInitiative(event) {
    event.preventDefault();
    if (!initiativeForm.title.trim() || !initiativeForm.academicYearId) return;
    setSaving(true);
    try {
      const year = academicYears.find(item => item.id === initiativeForm.academicYearId);
      const owner = staff.find(item => (item.uid || item.id) === initiativeForm.ownerId);
      const initiativeId = await createInitiative({
        db, schoolId, actor,
        input: {
          ...initiativeForm,
          academicYearLabel: year?.hebrewLabel || year?.label || initiativeForm.academicYearLabel,
          ownerId: initiativeForm.ownerId || actor.uid,
          ownerName: owner?.fullName || actor.fullName,
          goals: initiativeForm.goalsText.split('\n').map(item => item.trim()).filter(Boolean),
        },
      });
      const template = templates.find(item => item.id === initiativeForm.templateId);
      if (template?.milestoneTemplates?.length) {
        for (const item of template.milestoneTemplates) {
          await createMilestone({ db, schoolId, initiativeId, actor, input: { ...emptyMilestone(item.order), ...item, dateType: 'unset' } });
        }
      }
      const teamMemberIds = teams
        .filter(team => initiativeForm.teamIds.includes(team.id))
        .flatMap(team => Array.isArray(team.memberIds) ? team.memberIds : []);
      await notifyPeople(
        [...initiativeForm.memberIds, ...teamMemberIds, initiativeForm.ownerId],
        `צורפת לתכנית: ${initiativeForm.title.trim()}`,
        'תכנית ארוכת טווח חדשה זמינה בפאנל המשימות.',
        initiativeId,
      );
      setShowCreate(false);
      setActiveId(initiativeId);
      onMessage('התכנית נוצרה בתוך פאנל המשימות.');
    } catch {
      onError('לא ניתן ליצור את התכנית. בדקו הרשאה ושדות חובה.');
    } finally {
      setSaving(false);
    }
  }

  async function submitMilestone(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const previous = details.milestones.find(item => item.id === editingMilestoneId);
      if (editingMilestoneId) {
        await updateMilestone({ db, schoolId, initiativeId: activeId, milestoneId: editingMilestoneId, actor, input: milestoneForm });
      } else {
        await createMilestone({ db, schoolId, initiativeId: activeId, actor, input: milestoneForm });
      }
      const recipients = [milestoneForm.ownerId, milestoneForm.approverId, ...milestoneForm.participantIds];
      if (!editingMilestoneId) {
        await notifyPeople(recipients, `אבן דרך חדשה: ${milestoneForm.title}`, activeInitiative.title);
      } else if (milestoneDate(previous) !== milestoneDate(milestoneForm)) {
        await notifyPeople(recipients, `מועד אבן הדרך השתנה: ${milestoneForm.title}`, dateLabel(milestoneDate(milestoneForm)));
      }
      setShowMilestone(false);
      setEditingMilestoneId('');
      setMilestoneForm(emptyMilestone(details.milestones.length));
      onMessage(editingMilestoneId ? 'אבן הדרך עודכנה.' : 'אבן הדרך נוספה.');
    } catch (error) {
      onError(error?.message === 'EVIDENCE_REQUIRED' ? 'נדרשת ראיית ביצוע לפני השלמה.' : 'לא ניתן להוסיף את אבן הדרך.');
    } finally {
      setSaving(false);
    }
  }

  async function changeMilestoneStatus(item, status) {
    if (status === 'cancelled') {
      const reason = window.prompt('יש להזין סיבה לביטול אבן הדרך:');
      if (!reason?.trim()) return;
      item = { ...item, cancelReason: reason.trim() };
    }
    if (status === 'completed' && item.requiresEvidence === true
      && !(item.evidenceIds || []).length && !item.completionSummary?.trim()) {
      const completionSummary = window.prompt('אבן דרך זו דורשת ראיית ביצוע. ניתן להזין סיכום ביצוע מאומת:');
      if (!completionSummary?.trim()) return;
      item = { ...item, completionSummary: completionSummary.trim() };
    }
    setSaving(true);
    try {
      await updateMilestone({ db, schoolId, initiativeId: activeId, milestoneId: item.id, actor, input: { ...item, status } });
      const nextMilestones = details.milestones.map(value => value.id === item.id ? { ...item, status } : value);
      if (canEdit) {
        await recomputeInitiativeSummary({ db, schoolId, initiative: activeInitiative, milestones: nextMilestones, updates: details.updates, actor });
      }
      if (status === 'completed') {
        await notifyPeople([item.approverId], `אבן הדרך הושלמה: ${item.title}`, activeInitiative.title);
      }
      onMessage('אבן הדרך עודכנה.');
    } catch (error) {
      onError(error?.message === 'EVIDENCE_REQUIRED' ? 'אי אפשר להשלים ללא ראיית ביצוע או טקסט מסכם.' : 'לא ניתן לעדכן את אבן הדרך.');
    } finally {
      setSaving(false);
    }
  }

  async function submitUpdate(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await addInitiativeUpdate({ db, schoolId, initiativeId: activeId, actor, input: updateForm });
      await notifyPeople(
        updateForm.type === 'blocker'
          ? [updateForm.blockerOwnerId, ...updateForm.mentionedUserIds]
          : updateForm.mentionedUserIds,
        updateForm.type === 'blocker' ? `חסם חדש: ${activeInitiative.title}` : `אזכור חדש: ${activeInitiative.title}`,
        updateForm.text.slice(0, 120),
      );
      setUpdateForm(emptyUpdate());
      setShowUpdate(false);
      onMessage('העדכון פורסם בתכנית.');
    } catch {
      onError('לא ניתן לפרסם את העדכון. חסם דורש אחראי ותאריך טיפול.');
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive(event) {
    event.preventDefault();
    if (!closingForm.summary.trim()) return;
    setSaving(true);
    try {
      await archiveInitiative({ db, schoolId, initiativeId: activeId, actor, closing: closingForm });
      setShowArchive(false);
      setClosingForm(emptyClosing());
      setActiveId('');
      onMessage('התכנית הועברה לארכיון ללא מחיקת מידע.');
    } catch {
      onError('לא ניתן לארכב את התכנית.');
    } finally {
      setSaving(false);
    }
  }

  async function handleAddComment(updateId) {
    const text = window.prompt('תגובה קצרה לעדכון:');
    if (!text?.trim()) return;
    try {
      await addInitiativeUpdateComment({ db, schoolId, initiativeId: activeId, updateId, actor, text });
      onMessage('התגובה נוספה לעדכון.');
    } catch {
      onError('לא ניתן להוסיף תגובה לעדכון.');
    }
  }

  async function handleTemplate() {
    try {
      await saveInitiativeTemplate({ db, schoolId, initiative: activeInitiative, milestones: details.milestones, actor });
      onMessage('התכנית נשמרה כתבנית ללא עדכונים וראיות.');
    } catch {
      onError('לא ניתן לשמור תבנית.');
    }
  }

  async function handleEditInitiative(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const ownerId = String(formData.get('ownerId') || activeInitiative.ownerId || actor.uid);
    const owner = staff.find(item => (item.uid || item.id) === ownerId);
    setSaving(true);
    try {
      await updateInitiative({
        db,
        schoolId,
        initiativeId: activeId,
        actor,
        input: {
          ...activeInitiative,
          title: String(formData.get('title') || ''),
          description: String(formData.get('description') || ''),
          startDate: String(formData.get('startDate') || ''),
          endDate: String(formData.get('endDate') || ''),
          nextAction: String(formData.get('nextAction') || ''),
          ownerId,
          ownerName: owner?.fullName || activeInitiative.ownerName || actor.fullName,
        },
        activityDetails: 'פרטי התכנית עודכנו',
      });
      setShowEdit(false);
      onMessage('פרטי התכנית עודכנו.');
    } catch {
      onError('לא ניתן לעדכן את פרטי התכנית.');
    } finally {
      setSaving(false);
    }
  }

  async function handleHealthOverride() {
    const entries = Object.entries(INITIATIVE_HEALTH);
    const choice = window.prompt(`בחרו מצב: ${entries.map(([value, label]) => `${value}=${label}`).join(', ')}`, health);
    if (!choice || !INITIATIVE_HEALTH[choice]) return;
    const reason = window.prompt('יש להזין סיבה לדריסת המצב המחושב:');
    if (!reason?.trim()) return;
    try {
      await setInitiativeHealthOverride({ db, schoolId, initiativeId: activeId, actor, health: choice, reason });
      onMessage('מצב התכנית עודכן עם נימוק ונרשם ביומן הפעילות.');
    } catch {
      onError('לא ניתן לשנות את מצב התכנית.');
    }
  }

  async function handleDuplicate() {
    if (!window.confirm('לשכפל את מבנה אבני הדרך ללא עדכונים, תגובות וראיות?')) return;
    try {
      const year = academicYears.find(item => item.isActive) || academicYears[0];
      const id = await duplicateInitiative({
        db, schoolId, source: activeInitiative, milestones: details.milestones, actor,
        options: { academicYearId: year?.id, academicYearLabel: year?.hebrewLabel || year?.label, includeMilestones: true },
      });
      setActiveId(id);
      onMessage('נוצר עותק בטוח ללא מידע רגיש.');
    } catch {
      onError('לא ניתן לשכפל את התכנית.');
    }
  }

  function requestTask(context) {
    setActiveId('');
    onAddTask(context);
  }

  if (activeInitiative) {
    const openBlockers = details.updates.filter(item => item.type === 'blocker' && item.blockerStatus !== 'resolved');
    const linkedFileIds = new Set([
      ...(activeInitiative.fileIds || []),
      ...details.milestones.flatMap(item => item.fileIds || []),
      ...details.updates.flatMap(item => item.fileIds || []),
    ]);
    return <section className="initiative-detail" aria-label={`תכנית ${activeInitiative.title}`}>
      <div className="initiative-detail-nav">
        <button className="btn btn-secondary btn-sm" onClick={() => setActiveId('')}><ArrowRight size={15} /> חזרה לכל המשימות</button>
        <div className="initiative-more-wrap">
          <button className="icon-btn" onClick={() => setShowMore(value => !value)} aria-label="פעולות נוספות"><MoreHorizontal size={18} /></button>
          {showMore && <div className="initiative-more-menu">
            {canEdit && <button onClick={() => { setShowEdit(true); setShowMore(false); }}><Pencil size={14} /> עריכת פרטי התכנית</button>}
            {canChangeHealth && <button onClick={handleHealthOverride}><CircleAlert size={14} /> שינוי מצב מנומק</button>}
            {canTemplate && <button onClick={handleTemplate}><Save size={14} /> שמירה כתבנית</button>}
            {canDuplicate && <button onClick={handleDuplicate}><Copy size={14} /> שכפול לשנה חדשה</button>}
            {canArchive && activeInitiative.status !== 'archived' && <button onClick={() => { setShowArchive(true); setShowMore(false); }}><Archive size={14} /> סגירה וארכוב</button>}
          </div>}
        </div>
      </div>

      <header className="initiative-hero">
        <div><span className={`initiative-health initiative-health--${health}`}>{INITIATIVE_HEALTH[health]}</span><h2>{activeInitiative.title}</h2><p>{activeInitiative.description || 'לא נוסף תיאור.'}</p></div>
        <div className="initiative-hero-actions">
          {canCreateMilestones && <button className="btn btn-secondary" onClick={() => { setEditingMilestoneId(''); setMilestoneForm(emptyMilestone(details.milestones.length)); setShowMilestone(true); }}><Flag size={15} /> הוספת אבן דרך</button>}
          {canEdit && <button className="btn btn-secondary" onClick={() => requestTask({ initiativeId: activeId, milestoneId: '' })}><Plus size={15} /> הוספת משימה</button>}
          <button className="btn btn-primary" onClick={() => setShowUpdate(true)}><MessageSquarePlus size={15} /> הוספת עדכון</button>
        </div>
      </header>

      <div className="initiative-overview-grid">
        <article><Target size={18} /><span>התקדמות</span><strong>{calculated.percent === null ? '—' : `${calculated.percent}%`}</strong><small>{calculated.label}</small></article>
        <article><CalendarRange size={18} /><span>טווח</span><strong>{dateLabel(activeInitiative.startDate)} — {dateLabel(activeInitiative.endDate)}</strong><small>{activeInitiative.academicYearLabel}</small></article>
        <article><Users size={18} /><span>מוביל</span><strong>{activeInitiative.ownerName || staff.find(item => (item.uid || item.id) === activeInitiative.ownerId)?.fullName || 'לא הוגדר'}</strong><small>{activeInitiative.memberIds?.length || 0} משתתפים</small></article>
        <article><Flag size={18} /><span>הפעולה הבאה</span><strong>{activeInitiative.nextAction || nextMilestone?.title || 'לא הוגדרה'}</strong><small>{nextMilestone ? dateLabel(milestoneDate(nextMilestone)) : ''}</small></article>
      </div>

      {openBlockers.length > 0 && <div className="initiative-blocker-banner"><CircleAlert size={18} /><strong>{openBlockers.length} חסמים פתוחים</strong><span>{openBlockers[0].text}</span></div>}

      <section className="initiative-section">
        <div className="initiative-section-title"><div><h3>אבני דרך</h3><p>תחנות מרכזיות לאורך התכנית</p></div></div>
        <div className="milestone-timeline">
          {details.milestones.map((item, index) => {
            const date = milestoneDate(item);
            const conflict = findHolidayConflict(date, holidays);
            const suggestedDate = conflict ? nextAvailableSchoolDate(date, holidays) : '';
            const taskCount = linkedTasks.filter(task => task.milestoneId === item.id);
            return <article className={`milestone-card milestone-card--${item.status}`} key={item.id}>
              <div className="milestone-index">{index + 1}</div>
              <div className="milestone-content"><div className="milestone-title-line"><h4>{item.title}</h4>{item.dateType === 'proposed' && <span className="milestone-proposed">מוצע</span>}</div>
                <p>{item.description || item.requiredOutput || 'ללא תיאור'}</p>
                <div className="milestone-meta"><span>{MILESTONE_DATE_TYPES[item.dateType] || 'תאריך'}: {dateLabel(date)}</span><span>משקל: {item.weight || 1}</span><span>{taskCount.filter(task => task.status === 'done' || task.status === 'completed').length} מתוך {taskCount.length} משימות הושלמו</span></div>
                {conflict && <div className="milestone-warning"><CircleAlert size={14} /> התאריך חל ב־{conflict.name}. היום הזמין הקרוב לפי לוח החופשות: {dateLabel(suggestedDate)}. התאריך לא ישתנה ללא אישור.</div>}
              </div>
              <div className="milestone-actions"><select value={item.status} disabled={!(canEdit || (canApproveMilestones && item.approverId === actor.uid)) || saving} onChange={event => changeMilestoneStatus(item, event.target.value)}>{Object.entries(MILESTONE_STATUSES).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>{canEdit && <button className="icon-btn" onClick={() => { setEditingMilestoneId(item.id); setMilestoneForm({ ...emptyMilestone(item.order), ...item }); setShowMilestone(true); }} aria-label={`עריכת ${item.title}`}><Pencil size={14} /></button>}<button className="btn btn-secondary btn-sm" onClick={() => requestTask({ initiativeId: activeId, milestoneId: item.id })}><Plus size={13} /> משימה</button></div>
            </article>;
          })}
          {details.milestones.length === 0 && <div className="initiative-empty"><Flag size={28} /><p>עדיין לא הוגדרו אבני דרך.</p>{canCreateMilestones && <button className="btn btn-primary btn-sm" onClick={() => { setEditingMilestoneId(''); setMilestoneForm(emptyMilestone()); setShowMilestone(true); }}>הוספת אבן דרך ראשונה</button>}</div>}
        </div>
      </section>

      <section className="initiative-section">
        <div className="initiative-section-title"><div><h3>משימות פתוחות</h3><p>אותן משימות שמופיעות גם ברשימת המשימות הרגילה</p></div>{canEdit && <button className="btn btn-secondary btn-sm" onClick={() => setShowLinkTask(true)}><Link2 size={14} /> קישור משימה קיימת</button>}</div>
        <div className="initiative-task-list">{linkedTasks.filter(task => !['done', 'completed'].includes(task.status)).map(task => <article key={task._key}><span>{task.title}</span><small>{task.milestoneId ? details.milestones.find(item => item.id === task.milestoneId)?.title || 'אבן דרך' : 'כלל התכנית'}</small><strong>{dateLabel(task.dueDate)}</strong></article>)}{linkedTasks.length === 0 && <p>אין עדיין משימות מקושרות.</p>}</div>
      </section>

      <section className="initiative-split">
        <div className="initiative-section"><div className="initiative-section-title"><div><h3>קבצים וקישורים</h3><p>קישורים לקבצים הקיימים במערכת</p></div></div><div className="initiative-files">{files.filter(file => linkedFileIds.has(file.id)).map(file => <span key={file.id}><FileText size={14} /> {file.name}</span>)}{linkedFileIds.size === 0 && <p>לא קושרו קבצים.</p>}</div></div>
        <div className="initiative-section"><div className="initiative-section-title"><div><h3>עדכונים אחרונים</h3><p>התקדמות, החלטות, חסמים ותגובות</p></div></div><div className="initiative-updates">{details.updates.slice(0, 8).map(item => {
          const comments = details.comments.filter(comment => comment.updateId === item.id);
          const context = item.milestoneId
            ? details.milestones.find(milestone => milestone.id === item.milestoneId)?.title
            : item.taskId ? tasks.find(task => task.id === item.taskId || task._key === item.taskId)?.title : '';
          return <article key={item.id}><div className="initiative-update-head"><span>{UPDATE_TYPES[item.type] || 'עדכון'}</span><small>{timestampLabel(item.createdAt)}</small></div><p>{item.text}</p>{context && <small>בהקשר: {context}</small>}{item.link && <a href={item.link} target="_blank" rel="noreferrer">פתיחת קישור מצורף</a>}{(item.fileIds || []).map(fileId => { const file = files.find(value => value.id === fileId); return file ? <small key={fileId}><FileText size={12} /> {file.name}</small> : null; })}<small>{item.authorName || 'איש צוות'}</small><div className="initiative-comments">{comments.map(comment => <p key={comment.id}><strong>{comment.authorName || 'איש צוות'}:</strong> {comment.text}</p>)}<button className="btn btn-secondary btn-sm" onClick={() => handleAddComment(item.id)}>תגובה {comments.length ? `(${comments.length})` : ''}</button></div></article>;
        })}{details.updates.length === 0 && <p>לא פורסמו עדכונים.</p>}</div></div>
      </section>

      {showMilestone && <Modal title={editingMilestoneId ? 'עריכת אבן דרך' : 'הוספת אבן דרך'} onClose={() => { setShowMilestone(false); setEditingMilestoneId(''); }}><form className="task-form" onSubmit={submitMilestone}>
        <div className="form-group"><label>כותרת</label><input value={milestoneForm.title} onChange={event => setMilestoneForm(value => ({ ...value, title: event.target.value }))} required autoFocus /></div>
        <div className="form-group"><label>תיאור קצר</label><textarea value={milestoneForm.description} onChange={event => setMilestoneForm(value => ({ ...value, description: event.target.value }))} /></div>
        <div className="form-row"><div className="form-group"><label>אחראי</label><select value={milestoneForm.ownerId} onChange={event => setMilestoneForm(value => ({ ...value, ownerId: event.target.value }))}><option value="">טרם הוגדר</option>{initiativeStaff.map(item => <option key={item.uid || item.id} value={item.uid || item.id}>{item.fullName}</option>)}</select></div><div className="form-group"><label>חשיבות</label><select value={milestoneForm.priority} onChange={event => setMilestoneForm(value => ({ ...value, priority: event.target.value }))}><option value="low">רגילה</option><option value="medium">חשובה</option><option value="high">קריטית</option></select></div><div className="form-group"><label>משקל</label><input type="number" min="1" max="100" value={milestoneForm.weight} onChange={event => setMilestoneForm(value => ({ ...value, weight: event.target.value }))} /></div></div>
        <div className="form-row"><div className="form-group"><label>סוג תאריך</label><select value={milestoneForm.dateType} onChange={event => setMilestoneForm(value => ({ ...value, dateType: event.target.value }))}>{Object.entries(MILESTONE_DATE_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>{['exact', 'range'].includes(milestoneForm.dateType) && <div className="form-group"><label>תאריך התחלה</label><input type="date" value={milestoneForm.startDate} onChange={event => setMilestoneForm(value => ({ ...value, startDate: event.target.value }))} /></div>}{milestoneForm.dateType === 'range' && <div className="form-group"><label>תאריך סיום</label><input type="date" value={milestoneForm.endDate} onChange={event => setMilestoneForm(value => ({ ...value, endDate: event.target.value }))} /></div>}{milestoneForm.dateType === 'proposed' && <div className="form-group"><label>תאריך מוצע</label><input type="date" value={milestoneForm.proposedDate} onChange={event => setMilestoneForm(value => ({ ...value, proposedDate: event.target.value }))} /></div>}</div>
        <div className="form-row"><div className="form-group"><label>תוצר נדרש</label><input value={milestoneForm.requiredOutput} onChange={event => setMilestoneForm(value => ({ ...value, requiredOutput: event.target.value }))} /></div><div className="form-group"><label>גורם מאשר</label><select value={milestoneForm.approverId} onChange={event => setMilestoneForm(value => ({ ...value, approverId: event.target.value }))}><option value="">לא נדרש</option>{initiativeStaff.map(item => <option key={item.uid || item.id} value={item.uid || item.id}>{item.fullName}</option>)}</select></div></div>
        <div className="form-row"><div className="form-group"><label>תלויה באבן דרך</label><select value={milestoneForm.dependencyId} onChange={event => setMilestoneForm(value => ({ ...value, dependencyId: event.target.value }))}><option value="">ללא תלות</option>{details.milestones.filter(item => item.id !== editingMilestoneId).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></div><div className="form-group"><label>תזכורת</label><input type="datetime-local" value={milestoneForm.reminderAt} onChange={event => setMilestoneForm(value => ({ ...value, reminderAt: event.target.value }))} /></div></div>
        {initiativeStaff.length > 0 && <fieldset className="initiative-inline-fieldset"><legend>משתתפים באבן הדרך</legend>{initiativeStaff.map(item => { const id = item.uid || item.id; return <label key={id}><input type="checkbox" checked={milestoneForm.participantIds.includes(id)} onChange={event => setMilestoneForm(value => ({ ...value, participantIds: toggleId(value.participantIds, id, event.target.checked) }))} /> {item.fullName}</label>; })}</fieldset>}
        <div className="form-row"><label className="initiative-check"><input type="checkbox" checked={milestoneForm.requiresEvidence} onChange={event => setMilestoneForm(value => ({ ...value, requiresEvidence: event.target.checked }))} /> השלמה תחייב ראיית ביצוע</label>{files.length > 0 && <div className="form-group"><label>קובץ תוצר או ראיה (אופציונלי)</label><select value={milestoneForm.fileIds[0] || ''} onChange={event => { const fileIds = event.target.value ? [event.target.value] : []; setMilestoneForm(value => ({ ...value, fileIds, evidenceIds: value.requiresEvidence ? fileIds : value.evidenceIds })); }}><option value="">ללא קובץ</option>{files.map(file => <option key={file.id} value={file.id}>{file.name}</option>)}</select></div>}</div>
        <div className="form-actions"><button className="btn btn-primary" disabled={saving}>שמירה</button><button type="button" className="btn btn-secondary" onClick={() => setShowMilestone(false)}>ביטול</button></div>
      </form></Modal>}

      {showUpdate && <Modal title="הוספת עדכון" onClose={() => setShowUpdate(false)}><form className="task-form" onSubmit={submitUpdate}>
        <div className="form-row"><div className="form-group"><label>סוג עדכון</label><select value={updateForm.type} onChange={event => setUpdateForm(value => ({ ...value, type: event.target.value }))}>{Object.entries(UPDATE_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="form-group"><label>אבן דרך קשורה</label><select value={updateForm.milestoneId} onChange={event => setUpdateForm(value => ({ ...value, milestoneId: event.target.value, taskId: event.target.value ? '' : value.taskId }))}><option value="">כלל התכנית</option>{details.milestones.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></div><div className="form-group"><label>משימה קשורה</label><select value={updateForm.taskId} onChange={event => setUpdateForm(value => ({ ...value, taskId: event.target.value, milestoneId: event.target.value ? '' : value.milestoneId }))}><option value="">ללא משימה</option>{linkedTasks.map(item => <option key={item._key} value={item.id}>{item.title}</option>)}</select></div></div>
        <div className="form-group"><label>תוכן</label><textarea value={updateForm.text} maxLength={4000} onChange={event => setUpdateForm(value => ({ ...value, text: event.target.value }))} required autoFocus /></div>
        {updateForm.type === 'blocker' && <div className="form-row"><div className="form-group"><label>אחראי לטיפול</label><select value={updateForm.blockerOwnerId} onChange={event => setUpdateForm(value => ({ ...value, blockerOwnerId: event.target.value }))} required><option value="">בחירה</option>{staff.map(item => <option key={item.uid || item.id} value={item.uid || item.id}>{item.fullName}</option>)}</select></div><div className="form-group"><label>יעד לטיפול</label><input type="date" value={updateForm.blockerDueDate} onChange={event => setUpdateForm(value => ({ ...value, blockerDueDate: event.target.value }))} required /></div></div>}
        <fieldset className="initiative-inline-fieldset"><legend>אזכור אנשי צוות (אופציונלי)</legend>{initiativeStaff.map(item => { const id = item.uid || item.id; return <label key={id}><input type="checkbox" checked={updateForm.mentionedUserIds.includes(id)} onChange={event => setUpdateForm(value => ({ ...value, mentionedUserIds: toggleId(value.mentionedUserIds, id, event.target.checked) }))} /> {item.fullName}</label>; })}</fieldset>
        <div className="form-group"><label>קישור חיצוני (אופציונלי)</label><input type="url" value={updateForm.link} onChange={event => setUpdateForm(value => ({ ...value, link: event.target.value }))} /></div>
        {files.length > 0 && <div className="form-group"><label>קובץ קיים (אופציונלי)</label><select value={updateForm.fileIds[0] || ''} onChange={event => setUpdateForm(value => ({ ...value, fileIds: event.target.value ? [event.target.value] : [] }))}><option value="">ללא קובץ</option>{files.map(file => <option key={file.id} value={file.id}>{file.name}</option>)}</select></div>}
        <div className="form-actions"><button className="btn btn-primary" disabled={saving}>פרסום</button><button type="button" className="btn btn-secondary" onClick={() => setShowUpdate(false)}>ביטול</button></div>
      </form></Modal>}

      {showLinkTask && <Modal title="קישור משימה קיימת" onClose={() => setShowLinkTask(false)}><div className="initiative-link-list">{tasks.filter(task => !task.initiativeId || task.initiativeId === activeId).map(task => <button key={task._key} onClick={async () => { await onLinkTask(task, activeId, ''); setShowLinkTask(false); }}><span>{task.title}</span><small>{task.scope === 'personal' ? 'אישית' : 'ארגונית'}</small></button>)}{tasks.length === 0 && <p>אין משימות זמינות לקישור.</p>}</div></Modal>}
      {showEdit && <Modal title="עריכת תכנית ארוכת טווח" onClose={() => setShowEdit(false)}><form className="task-form" onSubmit={handleEditInitiative}>
        <div className="form-group"><label>שם התכנית</label><input name="title" defaultValue={activeInitiative.title} maxLength={200} required autoFocus /></div>
        <div className="form-group"><label>תיאור ומטרה</label><textarea name="description" defaultValue={activeInitiative.description || ''} maxLength={4000} /></div>
        <div className="form-row"><div className="form-group"><label>תאריך התחלה</label><input name="startDate" type="date" defaultValue={activeInitiative.startDate || ''} /></div><div className="form-group"><label>תאריך סיום</label><input name="endDate" type="date" defaultValue={activeInitiative.endDate || ''} /></div></div>
        <div className="form-row"><div className="form-group"><label>מוביל התכנית</label><select name="ownerId" defaultValue={activeInitiative.ownerId || actor.uid}>{staff.map(item => <option key={item.uid || item.id} value={item.uid || item.id}>{item.fullName}</option>)}</select></div><div className="form-group"><label>הפעולה הבאה</label><input name="nextAction" defaultValue={activeInitiative.nextAction || ''} maxLength={300} /></div></div>
        <div className="form-actions"><button className="btn btn-primary" disabled={saving}>שמירת שינויים</button><button type="button" className="btn btn-secondary" onClick={() => setShowEdit(false)}>ביטול</button></div>
      </form></Modal>}
      {showArchive && <Modal title="סגירת תכנית והעברתה לארכיון" onClose={() => setShowArchive(false)}><form className="task-form" onSubmit={handleArchive}>
        <p className="initiative-archive-note">המידע לא יימחק. התכנית תישאר בארכיון וניתן יהיה לשכפל את המבנה לשנה חדשה.</p>
        <div className="form-group"><label>סיכום קצר</label><textarea value={closingForm.summary} onChange={event => setClosingForm(value => ({ ...value, summary: event.target.value }))} required autoFocus /></div>
        <div className="form-row"><div className="form-group"><label>תוצאה בפועל</label><textarea value={closingForm.outcome} onChange={event => setClosingForm(value => ({ ...value, outcome: event.target.value }))} /></div><div className="form-group"><label>יעדים שהושגו</label><textarea value={closingForm.achievedGoals} onChange={event => setClosingForm(value => ({ ...value, achievedGoals: event.target.value }))} /></div></div>
        <div className="form-row"><div className="form-group"><label>יעדים שלא הושגו</label><textarea value={closingForm.unachievedGoals} onChange={event => setClosingForm(value => ({ ...value, unachievedGoals: event.target.value }))} /></div><div className="form-group"><label>לקחים</label><textarea value={closingForm.lessons} onChange={event => setClosingForm(value => ({ ...value, lessons: event.target.value }))} /></div></div>
        <div className="form-group"><label>המלצות לשנה הבאה</label><textarea value={closingForm.recommendations} onChange={event => setClosingForm(value => ({ ...value, recommendations: event.target.value }))} /></div>
        <div className="form-actions"><button className="btn btn-primary" disabled={saving}>סגירה והעברה לארכיון</button><button type="button" className="btn btn-secondary" onClick={() => setShowArchive(false)}>ביטול</button></div>
      </form></Modal>}
    </section>;
  }

  return <section className="initiative-dashboard" aria-label="תכניות ארוכות טווח">
    <div className="initiative-section-title"><div><h2>{showArchived ? 'ארכיון תכניות' : 'תכניות ארוכות טווח'}</h2><p>{showArchived ? 'תכניות סגורות שנשמרו לצורך עיון ושכפול בטוח' : 'מהלכים, אבני דרך וביצוע לאורך שנת הלימודים'}</p></div><div className="initiative-title-actions">{attentionOnly && <button className="btn btn-secondary btn-sm" onClick={onClearAttention}>הצגת כל התכניות</button>}<button className="btn btn-secondary btn-sm" onClick={() => setShowArchived(value => !value)}><Archive size={14} /> {showArchived ? 'חזרה לפעילות' : 'ארכיון'}</button>{canCreate && !showArchived && <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}><Plus size={14} /> תכנית חדשה</button>}</div></div>
    <div className="initiative-card-grid">
      {displayedInitiatives.map(item => <button className="initiative-card" key={item.id} onClick={() => setActiveId(item.id)}>
        <div className="initiative-card-head"><span className={`initiative-health initiative-health--${item.health}`}>{INITIATIVE_HEALTH[item.health] || INITIATIVE_STATUSES[item.status]}</span><span>{item.academicYearLabel}</span></div>
        <h3>{item.title}</h3><p>{item.description || item.nextAction || 'ללא תיאור'}</p>
        <div className="initiative-card-progress"><div><span style={{ width: `${item.progressPercent || 0}%` }} /></div><strong>{item.progressPercent == null ? '—' : `${item.progressPercent}%`}</strong></div>
        <div className="initiative-card-meta"><span><Users size={13} /> {item.ownerName || 'לא הוגדר מוביל'}</span><span><Flag size={13} /> {item.completedMilestones || 0}/{item.totalMilestones || 0}</span></div>
      </button>)}
      {displayedInitiatives.length === 0 && <div className="initiative-empty"><Target size={28} /><p>{attentionOnly ? 'אין תכניות הדורשות תשומת לב.' : 'עדיין לא נוצרו תכניות ארוכות טווח.'}</p></div>}
    </div>

    {showCreate && <Modal title="יצירת תכנית ארוכת טווח" onClose={() => setShowCreate(false)}><form className="task-form" onSubmit={submitInitiative}>
      {templates.length > 0 && <div className="form-group"><label>התחלה</label><select value={initiativeForm.templateId} onChange={event => selectTemplate(event.target.value)}><option value="">תכנית ריקה</option>{templates.map(item => <option key={item.id} value={item.id}>מתבנית: {item.title}</option>)}</select></div>}
      <div className="form-group"><label>שם התכנית</label><input value={initiativeForm.title} onChange={event => setInitiativeForm(value => ({ ...value, title: event.target.value }))} maxLength={200} required autoFocus /></div>
      <div className="form-group"><label>תיאור ומטרה</label><textarea value={initiativeForm.description} onChange={event => setInitiativeForm(value => ({ ...value, description: event.target.value }))} maxLength={4000} /></div>
      <div className="form-row"><div className="form-group"><label>שנת לימודים</label><select value={initiativeForm.academicYearId} onChange={event => setInitiativeForm(value => ({ ...value, academicYearId: event.target.value }))} required><option value="">בחירה</option>{academicYears.map(item => <option key={item.id} value={item.id}>{item.hebrewLabel || item.label} ({item.gregorianStartYear || item.startYear}-{item.gregorianEndYear || item.endYear})</option>)}</select></div><div className="form-group"><label>סוג תכנית</label><input value={initiativeForm.category} onChange={event => setInitiativeForm(value => ({ ...value, category: event.target.value }))} list="initiative-categories" /><datalist id="initiative-categories">{[...new Set(initiatives.map(item => item.category).filter(Boolean))].map(value => <option value={value} key={value} />)}</datalist></div><div className="form-group"><label>מוביל התכנית</label><select value={initiativeForm.ownerId} onChange={event => setInitiativeForm(value => ({ ...value, ownerId: event.target.value }))}><option value="">אני</option>{staff.map(item => <option key={item.uid || item.id} value={item.uid || item.id}>{item.fullName}</option>)}</select></div></div>
      <div className="form-row"><div className="form-group"><label>תאריך התחלה</label><input type="date" value={initiativeForm.startDate} onChange={event => setInitiativeForm(value => ({ ...value, startDate: event.target.value }))} /></div><div className="form-group"><label>תאריך סיום</label><input type="date" value={initiativeForm.endDate} onChange={event => setInitiativeForm(value => ({ ...value, endDate: event.target.value }))} /></div></div>
      <div className="form-group"><label>תוצאות רצויות — יעד אחד בכל שורה</label><textarea value={initiativeForm.goalsText} onChange={event => setInitiativeForm(value => ({ ...value, goalsText: event.target.value }))} placeholder="לדוגמה: השתתפות של לפחות 80% מהתלמידים" /></div>
      <div className="initiative-selection-grid"><fieldset><legend>משתתפים</legend>{staff.filter(item => (item.uid || item.id) !== (initiativeForm.ownerId || actor.uid)).map(item => { const id = item.uid || item.id; return <label key={id}><input type="checkbox" checked={initiativeForm.memberIds.includes(id)} onChange={event => setInitiativeForm(value => ({ ...value, memberIds: toggleId(value.memberIds, id, event.target.checked) }))} /> {item.fullName}</label>; })}</fieldset><fieldset><legend>צוותים</legend>{teams.map(item => <label key={item.id}><input type="checkbox" checked={initiativeForm.teamIds.includes(item.id)} onChange={event => setInitiativeForm(value => ({ ...value, teamIds: toggleId(value.teamIds, item.id, event.target.checked) }))} /> {item.name}</label>)}</fieldset><fieldset><legend>כיתות וקבוצות</legend>{classes.map(item => <label key={item.id}><input type="checkbox" checked={initiativeForm.classIds.includes(item.id)} onChange={event => setInitiativeForm(value => ({ ...value, classIds: toggleId(value.classIds, item.id, event.target.checked) }))} /> {item.name}</label>)}</fieldset></div>
      <div className="form-actions"><button className="btn btn-primary" disabled={saving}>יצירת תכנית</button><button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>ביטול</button></div>
    </form></Modal>}
  </section>;
}
