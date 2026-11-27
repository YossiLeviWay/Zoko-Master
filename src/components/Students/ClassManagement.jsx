import { ClassPedagogicalMappings } from './PedagogicalMapping.jsx';
import { Fragment, useMemo, useState } from 'react';
import { useContextMenu } from '../Common/ContextMenu';
import { useNavigate } from 'react-router-dom';
import {
  CalendarDays,
  FileBarChart2,
  FileSpreadsheet,
  GraduationCap,
  Plus,
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
import { academicYearDisplay, academicYearForDate } from '../../utils/academicYears';
import { classGradebookId, ensureClassFolder, ensureClassGradebook } from '../../services/firestore/gradebookRepository';

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
  return academicYearForDate().hebrewLabel;
}

function emptyClass(academicYear) {
  return {
    name: '',
    gradeLevel: 'י׳',
    academicYear: academicYear?.hebrewLabel || academicYear?.label || defaultAcademicYear(),
    academicYearLabel: academicYear?.hebrewLabel || academicYear?.label || '',
    academicYearRange: academicYear ? `${academicYear.gregorianStartYear || academicYear.startYear}-${academicYear.gregorianEndYear || academicYear.endYear}` : '',
    academicYearId: academicYear?.id || '',
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
  academicYear,
  onOpenStudents,
  onGraduateClass,
  canViewGradesForClass,
  canManageGradebookForClass,
}) {
  const navigate = useNavigate();
  const { menuProps } = useContextMenu();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(() => emptyClass(academicYear));
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [openingMapping, setOpeningMapping] = useState('');

  const canCreate = permissions.classes_create;
  const canUpdate = permissions.classes_update;
  const canArchive = permissions.classes_archive;
  const canAssignTeacher = permissions.classes_assign_teacher;
  const canCreateAttendance = permissions.attendance_create;
  const canGraduateClass = permissions.students_graduate_class;

  const studentCounts = useMemo(() => {
    const counts = new Map();
    students.forEach(student => {
      if (!student.classId) return;
      counts.set(student.classId, (counts.get(student.classId) || 0) + 1);
    });
    return counts;
  }, [students]);

  // A class whose students have all graduated is a graduates' class, shown apart from the current classes.
  const graduatedCounts = useMemo(() => {
    const counts = new Map();
    students.forEach(student => {
      if (!student.classId) return;
      const entry = counts.get(student.classId) || { graduated: 0, other: 0 };
      if (student.status === 'graduated') entry.graduated += 1; else entry.other += 1;
      counts.set(student.classId, entry);
    });
    return counts;
  }, [students]);
  const isGraduatesClass = item => {
    const entry = graduatedCounts.get(item.id);
    return Boolean(item.graduatedAt) || Boolean(entry && entry.graduated > 0 && entry.other === 0);
  };

  const matching = classes.filter(item => {
    if (!showArchived && item.status === CLASS_STATUS.ARCHIVED) return false;
    if (!search.trim()) return true;
    const needle = search.trim().toLowerCase();
    return [item.name, item.gradeLevel, item.academicYear].some(value => String(value || '').toLowerCase().includes(needle));
  });
  const currentClasses = matching.filter(item => !isGraduatesClass(item));
  const graduateClasses = matching.filter(isGraduatesClass);
  const visible = [...currentClasses, ...graduateClasses];

  function openCreate() {
    setEditing(null);
    setForm(emptyClass(academicYear));
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

  function classActions(item) {
    return [
      { label: 'תלמידי הכיתה', onClick: () => onOpenStudents(item) },
      { label: 'נוכחות', onClick: () => navigate(`/files?openAttendanceClass=${encodeURIComponent(item.id)}`) },
      (canCreateAttendance || item.teacherId === actor.uid) && { label: 'גיליון נוכחות חדש', onClick: () => openAttendanceMapping(item) },
      (canViewGradesForClass(item.id) || item.teacherId === actor.uid) && { label: 'מיפוי ציונים', onClick: () => openGradeMapping(item) },
      canUpdate && { label: 'עריכת הכיתה', onClick: () => openEdit(item) },
      ...(canGraduateClass && item.status !== CLASS_STATUS.ARCHIVED ? [{ separator: true }, { label: 'הפיכת הכיתה לבוגרים', danger: true, onClick: () => onGraduateClass(item) }] : []),
      canArchive && { label: item.status === CLASS_STATUS.ARCHIVED ? 'שחזור מהארכיון' : 'העברה לארכיון', danger: true, onClick: () => toggleArchived(item) },
    ].filter(Boolean);
  }

  function teacherName(id) {
    return staff.find(user => user.id === id)?.fullName || 'לא שויך מחנך';
  }

  async function openGradeMapping(item) {
    setOpeningMapping(`grades_${item.id}`);
    setError('');
    try {
      const mapping = (canManageGradebookForClass(item.id) || item.teacherId === actor.uid)
        ? await ensureClassGradebook({ db, schoolId, actor, classItem: item })
        : { fileId: `gradebook_${classGradebookId(item.id, item.academicYearId)}` };
      navigate(`/files?openFile=${encodeURIComponent(mapping.fileId)}`);
    } catch {
      setError('לא ניתן לפתוח את מיפוי הציונים. בדקו את ההרשאות ונסו שוב.');
    } finally {
      setOpeningMapping('');
    }
  }

  async function openAttendanceMapping(item) {
    setOpeningMapping(`attendance_${item.id}`);
    setError('');
    try {
      const folderId = await ensureClassFolder({ db, schoolId, actor, classItem: item });
      navigate(`/files?createAttendance=${encodeURIComponent(item.id)}&folderId=${encodeURIComponent(folderId)}`);
    } catch {
      setError('לא ניתן לפתוח את מיפוי הנוכחות. בדקו את ההרשאות ונסו שוב.');
    } finally {
      setOpeningMapping('');
    }
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
        {visible.map((item, index) => (
          <Fragment key={item.id}>
          {graduateClasses.length > 0 && index === 0 && currentClasses.length > 0 && <h3 className="classes-group-title">כיתות פעילות <small>{currentClasses.length}</small></h3>}
          {graduateClasses.length > 0 && index === currentClasses.length && <h3 className="classes-group-title classes-group-title--graduates"><GraduationCap size={17} /> כיתות בוגרים <small>{graduateClasses.length}</small></h3>}
          <article className={`class-card ${item.status === CLASS_STATUS.ARCHIVED ? 'class-card--archived' : ''} ${isGraduatesClass(item) ? 'class-card--graduates' : ''}`} {...menuProps(() => classActions(item))}>
            <div className="class-card-header">
              <div>
                <h3>{item.name}</h3>
                <p>{item.gradeLevel || 'ללא שכבה'} · {item.academicYearLabel || item.academicYear}{item.academicYearRange ? ` (${item.academicYearRange})` : ''}</p>
              </div>
              <span className={`class-status class-status--${isGraduatesClass(item) && item.status !== CLASS_STATUS.ARCHIVED ? 'graduates' : item.status || CLASS_STATUS.ACTIVE}`}>
                {item.status === CLASS_STATUS.ARCHIVED ? 'ארכיון' : isGraduatesClass(item) ? 'בוגרים' : 'פעילה'}
              </span>
            </div>
            <div className="class-card-details">
              <span><UserRound size={14} /> {teacherName(item.teacherId)}</span>
              <span><Users size={14} /> {studentCounts.get(item.id) || 0} {isGraduatesClass(item) ? 'בוגרים' : 'תלמידים'}</span>
              <span><CalendarDays size={14} /> {(item.studyDays || []).map(day => STUDY_DAYS.find(value => value.id === day)?.label).filter(Boolean).join(', ') || 'לא הוגדרו ימים'}</span>
            </div>
            {(item.trackIds || []).length > 0 && (
              <div className="class-tags">{item.trackIds.map(trackId => <span key={trackId}>{tracks.find(track => track.id === trackId)?.name || 'מגמה'}</span>)}</div>
            )}
            <ClassPedagogicalMappings schoolId={schoolId} classId={item.id} />
            <div className="class-card-actions">
              <button className="btn btn-secondary btn-sm" onClick={() => onOpenStudents(item)}><Users size={14} /> תלמידי הכיתה</button>
              <button className="btn btn-primary btn-sm" onClick={() => navigate(`/files?openAttendanceClass=${encodeURIComponent(item.id)}`)} disabled={item.status === CLASS_STATUS.ARCHIVED}>נוכחות</button>
              {(canViewGradesForClass(item.id) || item.teacherId === actor.uid) && <button
                className="btn btn-secondary btn-sm"
                onClick={() => openGradeMapping(item)}
                disabled={item.status === CLASS_STATUS.ARCHIVED || openingMapping === `grades_${item.id}`}
                title="פתיחת מיפוי הציונים של כל תלמידי הכיתה"
              >
                <FileBarChart2 size={14} /> {openingMapping === `grades_${item.id}` ? 'פותח…' : 'מיפוי ציונים'}
              </button>}
              {(canCreateAttendance || item.teacherId === actor.uid) && <button
                className="btn btn-secondary btn-sm"
                onClick={() => openAttendanceMapping(item)}
                disabled={item.status === CLASS_STATUS.ARCHIVED || openingMapping === `attendance_${item.id}`}
                title="יצירת גיליון נוכחות חדש לכיתה"
              >
                <FileSpreadsheet size={14} /> {openingMapping === `attendance_${item.id}` ? 'פותח…' : 'גיליון נוכחות חדש'}
              </button>}
              {(canGraduateClass || canArchive || canUpdate) && <details className="class-overflow">
                <summary>עוד</summary>
                {canUpdate && <button type="button" onClick={() => openEdit(item)}>עריכת הכיתה</button>}
                {canGraduateClass && item.status !== CLASS_STATUS.ARCHIVED && <button type="button" className="is-danger" onClick={() => onGraduateClass(item)}><GraduationCap size={14} /> הפיכת הכיתה לבוגרים</button>}
                {canArchive && <button type="button" className="is-danger" onClick={() => toggleArchived(item)}>{item.status === CLASS_STATUS.ARCHIVED ? 'שחזור מהארכיון' : 'העברה לארכיון'}</button>}
              </details>}
            </div>
          </article>
          </Fragment>
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
                <div className="form-group"><label>שנת לימודים</label><input value={academicYearDisplay(academicYear) || form.academicYear} readOnly /><span className="form-hint">הכיתה תישמר תחת השנה שנבחרה בראש הדף.</span></div>
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
