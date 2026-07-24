import { useEffect, useMemo, useState } from 'react';
import { serverTimestamp, updateDoc } from 'firebase/firestore';
import {
  AlertCircle, BookOpen, CheckCircle2, Circle, Clock3, Edit3, FileBarChart2, FileUser,
  GraduationCap, History, LockKeyhole, MessageSquare, Phone, Plus, UserRound, X,
} from 'lucide-react';
import { db } from '../../firebase';
import { schoolDoc } from '../../services/firestore/paths';
import {
  addStudentNote, subscribeStudentHistory, subscribeStudentNotes,
} from '../../services/firestore/classStudentRepository';
import PersonalFileTab from './PersonalFileTab';
import CvBuilderTab from './CvBuilderTab';
import GradeMappingEditor from '../Files/GradeMappingEditor';
import { ensureClassGradebook, subscribeClassGradebooks } from '../../services/firestore/gradebookRepository';

const PROGRAM_LABELS = {
  full_matriculation: 'בגרות מלאה', tech_matriculation: 'בגרות טכנולוגית',
  professional_cert: 'תעודת מקצוע', completion_cert: 'תעודת גמר',
};
const STATUS_OPTIONS = [
  { id: 'pending', label: 'טרם הושלם', icon: Circle, color: '#94a3b8' },
  { id: 'in_progress', label: 'בתהליך', icon: AlertCircle, color: '#f59e0b' },
  { id: 'done', label: 'הושלם', icon: CheckCircle2, color: '#22c55e' },
];
const HISTORY_LABELS = {
  student_created: 'התלמיד נוסף למערכת', class_transfer: 'העברה בין כיתות',
  student_archived: 'העברה לארכיון', student_status_changed: 'שינוי סטטוס',
  student_promoted: 'עלייה לשנת לימודים חדשה', student_graduated: 'סיום לימודים',
  student_withdrawn: 'פרישה', student_dropout: 'נשירה', student_restored: 'חזרה לפעילות',
};
const PROFILE_TABS = [
  { id: 'general', label: 'פרטים כלליים', icon: UserRound },
  { id: 'study', label: 'מסלול לימודים', icon: BookOpen },
  { id: 'personal', label: 'תיק אישי', icon: FileUser },
  { id: 'cv', label: 'קורות חיים', icon: GraduationCap },
  { id: 'history', label: 'היסטוריה', icon: History },
];

function timestampMillis(value) {
  if (value?.toMillis) return value.toMillis();
  if (typeof value === 'string') return Date.parse(value) || 0;
  return 0;
}

function formatTimestamp(value) {
  const millis = timestampMillis(value);
  return millis ? new Date(millis).toLocaleString('he-IL') : 'ממתין לסנכרון';
}

export default function StudentProfile({
  student, tracks, schoolId, actor, canEdit, canAddNotes, canViewNotes,
  personalFileAccess, cvAccess, classItem, canViewGrades, canEditGrades,
  canManageGradebooks, onClose, onEdit,
}) {
  const trackIds = student.trackIds || (student.trackId ? [student.trackId] : []);
  const selectedTracks = tracks.filter(track => trackIds.includes(track.id));
  const requirements = selectedTracks.flatMap(track => (track.requirements || []).map(item => ({ ...item, trackName: track.name })));
  const [activeTab, setActiveTab] = useState('general');
  const [requirementStatus, setRequirementStatus] = useState(student.requirementStatus || {});
  const [history, setHistory] = useState([]);
  const [notes, setNotes] = useState([]);
  const [noteForm, setNoteForm] = useState({ content: '', type: 'general', visibility: 'class_staff' });
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [gradebooks, setGradebooks] = useState([]);
  const [creatingGradebook, setCreatingGradebook] = useState(false);

  useEffect(() => subscribeStudentHistory({ db, schoolId, studentId: student.id, onData: setHistory, onError: () => setHistory([]) }), [schoolId, student.id]);
  useEffect(() => {
    if (!canViewNotes) return undefined;
    return subscribeStudentNotes({ db, schoolId, studentId: student.id, onData: setNotes, onError: () => setNotes([]) });
  }, [canViewNotes, schoolId, student.id]);
  useEffect(() => {
    if (!canViewGrades || !student.classId) return undefined;
    return subscribeClassGradebooks({
      db, schoolId, classId: student.classId,
      onData: setGradebooks,
      onError: () => setGradebooks([]),
    });
  }, [canViewGrades, schoolId, student.classId]);

  const sortedHistory = useMemo(() => [...history].sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt)), [history]);
  const sortedNotes = useMemo(() => [...notes].sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt)), [notes]);

  async function toggleRequirement(requirementId) {
    if (!canEdit) return;
    const current = requirementStatus[requirementId] || 'pending';
    const next = current === 'pending' ? 'in_progress' : current === 'in_progress' ? 'done' : 'pending';
    const updated = { ...requirementStatus, [requirementId]: next };
    setRequirementStatus(updated);
    try {
      await updateDoc(schoolDoc(db, schoolId, 'students', student.id), { requirementStatus: updated, updatedBy: actor.uid, updatedAt: serverTimestamp() });
    } catch {
      setRequirementStatus(requirementStatus);
      setError('לא ניתן לעדכן את ההתקדמות.');
    }
  }

  async function submitNote(event) {
    event.preventDefault();
    if (!noteForm.content.trim()) return;
    setSaving(true);
    setError('');
    try {
      await addStudentNote({ db, schoolId, actor, studentId: student.id, ...noteForm });
      setNoteForm({ content: '', type: 'general', visibility: 'class_staff' });
      setShowNoteForm(false);
    } catch {
      setError('לא ניתן לשמור את ההערה.');
    } finally {
      setSaving(false);
    }
  }

  async function createGradebook() {
    if (!classItem) return;
    setCreatingGradebook(true);
    setError('');
    try {
      await ensureClassGradebook({ db, schoolId, actor, classItem });
    } catch {
      setError('לא ניתן ליצור מיפוי ציונים לכיתה.');
    } finally {
      setCreatingGradebook(false);
    }
  }

  function statusIcon(statusId) {
    const option = STATUS_OPTIONS.find(item => item.id === statusId) || STATUS_OPTIONS[0];
    const Icon = option.icon;
    return <Icon size={16} color={option.color} />;
  }

  return <div className="modal-overlay" onClick={onClose}><div className="modal-content modal-content--wide student-profile-modal" role="dialog" aria-modal="true" aria-label={`פרופיל ${student.fullName}`} onClick={event => event.stopPropagation()}>
    <div className="modal-header"><div className="student-profile-heading"><div className="student-profile-avatar">{student.fullName?.charAt(0) || '?'}</div><div><h3>{student.fullName}</h3><p>{student.className || 'ללא כיתה'} · {student.gradeLevel || 'ללא שכבה'} · {student.academicYear || 'ללא שנת לימודים'}</p></div></div><div className="student-profile-actions">{canEdit && <button className="icon-btn" onClick={onEdit} aria-label="עריכת תלמיד"><Edit3 size={16} /></button>}<button className="modal-close" onClick={onClose} aria-label="סגירה"><X size={18} /></button></div></div>
    <nav className="student-profile-tabs" aria-label="חלקי פרופיל התלמיד">{PROFILE_TABS.map(tab => { const Icon = tab.icon; return <button type="button" key={tab.id} className={activeTab === tab.id ? 'active' : ''} onClick={() => setActiveTab(tab.id)}><Icon size={15} />{tab.label}</button>; })}</nav>
    <div className="modal-form student-profile-content">
      {error && <div className="students-feedback students-feedback--error" role="alert">{error}</div>}
      {activeTab === 'general' && <>
        <div className="student-profile-chips">{(student.programTypes || (student.programType ? [student.programType] : [])).map(program => <span className="student-info-chip" key={program}><GraduationCap size={14} /> {PROGRAM_LABELS[program] || program}</span>)}{selectedTracks.map(track => <span className="student-info-chip" key={track.id}><BookOpen size={14} /> {track.name}</span>)}{student.phone && <span className="student-info-chip"><Phone size={14} /><span dir="ltr">{student.phone}</span></span>}</div>
        <section className="student-profile-section"><div className="student-profile-section-heading"><h4 className="student-profile-section-title"><MessageSquare size={15} /> הערות מובנות</h4>{canAddNotes && <button className="btn btn-secondary btn-sm" onClick={() => setShowNoteForm(value => !value)}><Plus size={14} /> הערה</button>}</div>
          {!canViewNotes ? <p className="students-muted">אין לך הרשאה לצפות בהערות תלמיד.</p> : <>{showNoteForm && <form className="student-note-form" onSubmit={submitNote}><textarea value={noteForm.content} onChange={event => setNoteForm(previous => ({ ...previous, content: event.target.value }))} rows={3} maxLength={2000} placeholder="תוכן ההערה" required /><div className="student-note-options"><select value={noteForm.type} onChange={event => setNoteForm(previous => ({ ...previous, type: event.target.value }))}><option value="general">כללית</option><option value="academic">לימודית</option><option value="behavior">התנהגותית</option><option value="welfare">רווחה</option></select><select value={noteForm.visibility} onChange={event => setNoteForm(previous => ({ ...previous, visibility: event.target.value }))}><option value="class_staff">צוות הכיתה המורשה</option><option value="school_admin">מנהלים בלבד</option></select><button className="btn btn-primary btn-sm" disabled={saving}>שמירה</button></div></form>}{student.notes && <div className="student-note student-note--legacy"><strong>הערה מהמודל הישן</strong><p>{student.notes}</p></div>}{sortedNotes.map(note => <article className="student-note" key={note.id}><div><strong>{note.createdByName || 'איש צוות'}</strong><span>{note.visibility === 'school_admin' ? 'מנהלים בלבד' : 'צוות הכיתה'} · {formatTimestamp(note.createdAt)}</span></div><p>{note.content}</p></article>)}{!student.notes && sortedNotes.length === 0 && <p className="students-muted">אין הערות להצגה.</p>}</>}
        </section>
      </>}
      {activeTab === 'study' && <>
        <section className="student-profile-section"><h4 className="student-profile-section-title">התקדמות במסלול הלימודים</h4>{requirements.length === 0 ? <div className="student-empty-state"><BookOpen size={26} /><strong>אין דרישות מסלול מוגדרות</strong><p>המגמות והשנתונים נשמרים ברשומות הלימודים השנתיות.</p></div> : <div className="req-checklist">{requirements.map(requirement => { const state = requirementStatus[requirement.id] || 'pending'; return <button type="button" key={`${requirement.trackName}_${requirement.id}`} className={`req-checklist-item req-status--${state} ${canEdit ? 'req-checklist-item--clickable' : ''}`} onClick={() => toggleRequirement(requirement.id)} disabled={!canEdit}><span>{statusIcon(state)}</span><span className="req-checklist-name">{requirement.name}<small>{requirement.trackName}</small></span><span className="req-status-label">{STATUS_OPTIONS.find(item => item.id === state)?.label}</span></button>; })}</div>}</section>
        <section className="student-profile-section"><h4 className="student-profile-section-title"><FileBarChart2 size={15} /> ציוני התלמיד</h4>{!canViewGrades ? <div className="student-empty-state"><LockKeyhole size={26} /><strong>הציונים מוגנים</strong><p>אין לך הרשאה לצפות במיפוי הציונים של כיתה זו.</p></div> : gradebooks.length === 0 ? <div className="student-empty-state"><FileBarChart2 size={26} /><strong>טרם נוצר מיפוי ציונים לכיתה</strong>{canManageGradebooks && <button className="btn btn-primary btn-sm" onClick={createGradebook} disabled={creatingGradebook}>{creatingGradebook ? 'יוצר…' : 'יצירת מיפוי ציונים'}</button>}</div> : gradebooks.map(gradebook => <GradeMappingEditor key={gradebook.id} file={{ ...gradebook, gradebookId: gradebook.id }} schoolId={schoolId} actor={actor} canEditScores={canEditGrades} studentOnly={student} />)}</section>
      </>}
      {activeTab === 'personal' && <PersonalFileTab student={student} schoolId={schoolId} access={personalFileAccess} />}
      {activeTab === 'cv' && (cvAccess.view ? <CvBuilderTab student={student} schoolId={schoolId} actorUid={actor.uid} access={cvAccess} /> : <div className="student-empty-state"><LockKeyhole size={30} /><strong>קורות החיים מוגנים</strong><p>אין לך הרשאת צפייה בקורות החיים של תלמיד זה.</p></div>)}
      {activeTab === 'history' && <section className="student-profile-section"><h4 className="student-profile-section-title"><Clock3 size={15} /> היסטוריית שינויים</h4><div className="student-history-list">{sortedHistory.map(entry => <article key={entry.id}><span className="student-history-dot" /><div><strong>{HISTORY_LABELS[entry.type] || 'שינוי בפרטי התלמיד'}</strong>{entry.type === 'class_transfer' && <p>{entry.previousClassName || 'ללא כיתה'} ← {entry.nextClassName || 'ללא כיתה'}{entry.reason ? ` · ${entry.reason}` : ''}</p>}<small>{entry.effectiveDate || formatTimestamp(entry.createdAt)}</small></div></article>)}{sortedHistory.length === 0 && <p className="students-muted">אין היסטוריה מתועדת. רשומות ישנות נשמרות ללא שינוי.</p>}</div></section>}
    </div>
  </div></div>;
}
