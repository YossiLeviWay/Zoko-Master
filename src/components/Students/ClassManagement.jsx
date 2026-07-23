import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Archive,
  CalendarDays,
  Edit3,
  FileSpreadsheet,
  Plus,
  RotateCcw,
  School,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import {
  CLASS_STATUS,
  createClass,
  setClassArchived,
  updateClass,
} from '../../services/firestore/classStudentRepository';
import { db } from '../../firebase';

const GRADES = ['ז׳', 'ח׳', 'ט׳', 'י׳', 'י״א', 'י״ב'];
const STUDY_DAYS = [
  { id: '0', label: 'א׳' }, { id: '1', label: 'ב׳' }, { id: '2', label: 'ג׳' },
  { id: '3', label: 'ד׳' }, { id: '4', label: 'ה׳' }, { id: '5', label: 'ו׳' },
];
const PROGRAMS = [
  { id: 'full_matriculation', label: 'בגרות מלאה' },
  { id: 'tech_matriculation', label: 'בגרות טכנולוגית' },
  { id: 'professional_cert', label: 'תעודת מקצוע' },
  { id: 'completion_cert', label: 'תעודת גמר' },
];

function defaultAcademicYear() {
  const now = new Date();
  const start = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return `${start}-${start + 1}`;
}

function emptyClass() {
  return {
    name: '',
    gradeLevel: 'י׳',
    academicYear: defaultAcademicYear(),
    teacherId: '',
    staffIds: [],
    trackIds: [],
    programTypes: [],
    studyDays: ['0', '1', '2', '3', '4'],
    status: CLASS_STATUS.ACTIVE,
  };
}

function formFromClass(item) {
  return {
    ...emptyClass(),
    ...item,
    staffIds: item.staffIds || [],
    trackIds: item.trackIds || [],
    programTypes: item.programTypes || [],
    studyDays: item.studyDays || [],
  };
}

function toggleValue(values, value) {
  return values.includes(value) ? values.filter(item => item !== value) : [...values, value];
}

export default function ClassManagement({
  schoolId,
  actor,
  classes,
  students,
  staff,
  tracks,
  permissions,
  onOpenStudents,
}) {
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyClass);
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const canCreate = permissions.classes_create;
  const canUpdate = permissions.classes_update;
  const canArchive = permissions.classes_archive;
  const canAssignTeacher = permissions.classes_assign_teacher;
  const canCreateAttendance = permissions.attendance_create;

  const studentCounts = useMemo(() => {
    const counts = new Map();
    students.forEach(student => {
      if (!student.classId) return;
      counts.set(student.classId, (counts.get(student.classId) || 0) + 1);
    });
    return counts;
  }, [students]);

  const visible = classes.filter(item => {
    if (!showArchived && item.status === CLASS_STATUS.ARCHIVED) return false;
    if (!search.trim()) return true;
    const needle = search.trim().toLowerCase();
    return [item.name, item.gradeLevel, item.academicYear].some(value => String(value || '').toLowerCase().includes(needle));
  });

  function openCreate() {
    setEditing(null);
    setForm(emptyClass());
    setError('');
    setShowForm(true);
  }

  function openEdit(item) {
    setEditing(item);
    setForm(formFromClass(item));
    setError('');
    setShowForm(true);
  }

  async function save(event) {
    event.preventDefault();
    if (!form.name.trim() || !form.academicYear.trim()) return;
    setSaving(true);
    setError('');
    try {
      if (editing) await updateClass({ db, schoolId, actor, current: editing, input: form });
      else await createClass({ db, schoolId, actor, input: form });
      setShowForm(false);
      setMessage(editing ? 'פרטי הכיתה עודכנו.' : 'הכיתה נוצרה בהצלחה.');
      window.setTimeout(() => setMessage(''), 2500);
    } catch (saveError) {
      setError(saveError.message === 'CLASS_EXISTS'
        ? 'כבר קיימת כיתה בשם הזה בשנת הלימודים שנבחרה.'
        : 'לא ניתן לשמור את הכיתה. בדקו את ההרשאות ונסו שוב.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchived(item) {
    const archived = item.status !== CLASS_STATUS.ARCHIVED;
    if (!window.confirm(archived ? 'להעביר את הכיתה לארכיון?' : 'להחזיר את הכיתה לפעילות?')) return;
    try {
      await setClassArchived({ db, schoolId, actor, classItem: item, archived });
      setMessage(archived ? 'הכיתה הועברה לארכיון.' : 'הכיתה חזרה לפעילות.');
    } catch {
      setError('לא ניתן לשנות את סטטוס הכיתה.');
    }
  }

  function teacherName(id) {
    return staff.find(user => user.id === id)?.fullName || 'לא שויך מחנך';
  }

  return (
    <section className="classes-section" aria-label="ניהול כיתות">
      <div className="students-section-toolbar">
        <div className="search-bar">
          <School size={15} />
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="חיפוש כיתה" aria-label="חיפוש כיתה" />
        </div>
        <label className="students-inline-check">
          <input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} />
          הצגת ארכיון
        </label>
        {canCreate && <button className="btn btn-primary" onClick={openCreate}><Plus size={16} /> כיתה חדשה</button>}
        <span className="staff-count">{visible.length} כיתות</span>
      </div>

      {message && <div className="students-feedback students-feedback--success" role="status">{message}</div>}
      {error && <div className="students-feedback students-feedback--error" role="alert">{error}</div>}

      <div className="classes-grid">
        {visible.map(item => (
          <article key={item.id} className={`class-card ${item.status === CLASS_STATUS.ARCHIVED ? 'class-card--archived' : ''}`}>
            <div className="class-card-header">
              <div>
                <h3>{item.name}</h3>
                <p>{item.gradeLevel || 'ללא שכבה'} · {item.academicYear}</p>
              </div>
              <span className={`class-status class-status--${item.status || CLASS_STATUS.ACTIVE}`}>
                {item.status === CLASS_STATUS.ARCHIVED ? 'ארכיון' : 'פעילה'}
              </span>
            </div>
            <div className="class-card-details">
              <span><UserRound size={14} /> {teacherName(item.teacherId)}</span>
              <span><Users size={14} /> {studentCounts.get(item.id) || 0} תלמידים</span>
              <span><CalendarDays size={14} /> {(item.studyDays || []).map(day => STUDY_DAYS.find(value => value.id === day)?.label).filter(Boolean).join(', ') || 'לא הוגדרו ימים'}</span>
            </div>
            {(item.trackIds || []).length > 0 && (
              <div className="class-tags">{item.trackIds.map(trackId => <span key={trackId}>{tracks.find(track => track.id === trackId)?.name || 'מגמה'}</span>)}</div>
            )}
            <div className="class-card-actions">
              <button className="btn btn-secondary btn-sm" onClick={() => onOpenStudents(item)}><Users size={14} /> תלמידי הכיתה</button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => navigate(`/files?createAttendance=${encodeURIComponent(item.id)}`)}
                disabled={item.status === CLASS_STATUS.ARCHIVED || (!canCreateAttendance && item.teacherId !== actor.uid)}
                title={item.status === CLASS_STATUS.ARCHIVED ? 'לא ניתן ליצור גיליון לכיתה בארכיון' : 'יצירת גיליון נוכחות לכיתה'}
              >
                <FileSpreadsheet size={14} /> גיליון נוכחות
              </button>
              {canUpdate && <button className="icon-btn" onClick={() => openEdit(item)} aria-label={`עריכת ${item.name}`}><Edit3 size={15} /></button>}
              {canArchive && (
                <button className="icon-btn" onClick={() => toggleArchived(item)} aria-label={item.status === CLASS_STATUS.ARCHIVED ? `שחזור ${item.name}` : `ארכוב ${item.name}`}>
                  {item.status === CLASS_STATUS.ARCHIVED ? <RotateCcw size={15} /> : <Archive size={15} />}
                </button>
              )}
            </div>
          </article>
        ))}
        {visible.length === 0 && (
          <div className="empty-state classes-empty"><School size={42} className="empty-icon" /><p>אין כיתות להצגה.</p>{canCreate && <button className="btn btn-primary" onClick={openCreate}>יצירת כיתה ראשונה</button>}</div>
        )}
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-content modal-content--wide" role="dialog" aria-modal="true" aria-label={editing ? 'עריכת כיתה' : 'יצירת כיתה'} onClick={event => event.stopPropagation()}>
            <div className="modal-header"><h3>{editing ? 'עריכת כיתה' : 'כיתה חדשה'}</h3><button className="modal-close" onClick={() => setShowForm(false)} aria-label="סגירה"><X size={18} /></button></div>
            <form className="modal-form" onSubmit={save}>
              {error && <div className="students-feedback students-feedback--error" role="alert">{error}</div>}
              <div className="student-form-grid">
                <div className="form-group"><label>שם הכיתה *</label><input value={form.name} onChange={event => setForm(previous => ({ ...previous, name: event.target.value }))} required maxLength={80} /></div>
                <div className="form-group"><label>שכבה</label><select value={form.gradeLevel} onChange={event => setForm(previous => ({ ...previous, gradeLevel: event.target.value }))}>{GRADES.map(grade => <option key={grade}>{grade}</option>)}</select></div>
                <div className="form-group"><label>שנת לימודים *</label><input value={form.academicYear} onChange={event => setForm(previous => ({ ...previous, academicYear: event.target.value }))} placeholder="2026-2027" required maxLength={20} /></div>
                <div className="form-group"><label>מחנך</label><select value={form.teacherId} onChange={event => setForm(previous => ({ ...previous, teacherId: event.target.value }))} disabled={!canAssignTeacher}><option value="">ללא מחנך</option>{staff.map(user => <option key={user.id} value={user.id}>{user.fullName}</option>)}</select></div>
              </div>

              <fieldset className="students-choice-group"><legend>אנשי צוות נוספים</legend><div className="students-check-grid">{staff.filter(user => user.id !== form.teacherId).map(user => <label key={user.id}><input type="checkbox" checked={form.staffIds.includes(user.id)} onChange={() => setForm(previous => ({ ...previous, staffIds: toggleValue(previous.staffIds, user.id) }))} /> {user.fullName}</label>)}</div></fieldset>
              <fieldset className="students-choice-group"><legend>ימי לימוד קבועים</legend><div className="students-check-row">{STUDY_DAYS.map(day => <label key={day.id}><input type="checkbox" checked={form.studyDays.includes(day.id)} onChange={() => setForm(previous => ({ ...previous, studyDays: toggleValue(previous.studyDays, day.id) }))} /> {day.label}</label>)}</div></fieldset>
              <fieldset className="students-choice-group"><legend>תוכניות לימוד</legend><div className="students-check-grid">{PROGRAMS.map(program => <label key={program.id}><input type="checkbox" checked={form.programTypes.includes(program.id)} onChange={() => setForm(previous => ({ ...previous, programTypes: toggleValue(previous.programTypes, program.id) }))} /> {program.label}</label>)}</div></fieldset>
              <fieldset className="students-choice-group"><legend>מגמות</legend><div className="students-check-grid">{tracks.map(track => <label key={track.id}><input type="checkbox" checked={form.trackIds.includes(track.id)} onChange={() => setForm(previous => ({ ...previous, trackIds: toggleValue(previous.trackIds, track.id) }))} /> {track.name}</label>)}</div></fieldset>

              <div className="modal-actions"><button className="btn btn-primary" disabled={saving}>{saving ? 'שומר…' : 'שמירה'}</button><button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>ביטול</button></div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
