import { useEffect, useMemo, useState } from 'react';
import { getDoc, onSnapshot } from 'firebase/firestore';
import {
  Archive,
  ArrowLeftRight,
  Edit3,
  Eye,
  Filter,
  GraduationCap,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { db } from '../../firebase';
import { schoolCollection, schoolDoc } from '../../services/firestore/paths';
import {
  STUDENT_STATUS,
  createStudent,
  listSchoolStaff,
  setStudentStatus,
  subscribeClasses,
  subscribeStudents,
  transferStudent,
  updateStudent,
} from '../../services/firestore/classStudentRepository';
import Header from '../Layout/Header';
import PagePermissionsPanel from '../Shared/PagePermissionsPanel';
import TrackManager from './TrackManager';
import StudentProfile from './StudentProfile';
import ClassManagement from './ClassManagement';
import '../Gantt/Gantt.css';
import './Students.css';

const PROGRAM_TYPES = [
  { id: 'full_matriculation', label: 'בגרות מלאה' },
  { id: 'tech_matriculation', label: 'בגרות טכנולוגית' },
  { id: 'professional_cert', label: 'תעודת מקצוע' },
  { id: 'completion_cert', label: 'תעודת גמר' },
];
const STATUS_LABELS = {
  active: 'פעיל', transferred: 'עבר כיתה', graduated: 'סיים', archived: 'ארכיון',
};

function localDateKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function emptyStudent() {
  return {
    firstName: '', lastName: '', fullName: '', idNumber: '', phone: '', parentPhone: '',
    classId: '', trackIds: [], programTypes: [], additionalSubjects: [],
    joinedAt: localDateKey(), endDate: '', status: STUDENT_STATUS.ACTIVE,
  };
}

function formFromStudent(student) {
  const nameParts = (student.fullName || '').trim().split(/\s+/);
  return {
    ...emptyStudent(),
    ...student,
    firstName: student.firstName || nameParts[0] || '',
    lastName: student.lastName || nameParts.slice(1).join(' '),
    classId: student.classId || '',
    trackIds: student.trackIds || (student.trackId ? [student.trackId] : []),
    programTypes: student.programTypes || (student.programType ? [student.programType] : []),
    additionalSubjects: student.additionalSubjects || [],
  };
}

function toggle(values, value) {
  return values.includes(value) ? values.filter(item => item !== value) : [...values, value];
}

export default function Students() {
  const { currentUser, userData, selectedSchool, isPrincipal, isGlobalAdmin } = useAuth();
  const { permissions, schoolWidePermissions } = usePermissions();
  const schoolId = selectedSchool || userData?.schoolId;
  const actor = { uid: currentUser?.uid, fullName: userData?.fullName || '' };
  const isAdmin = isPrincipal() || isGlobalAdmin();

  const [activeTab, setActiveTab] = useState('students');
  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [tracks, setTracks] = useState([]);
  const [staff, setStaff] = useState([]);
  const [legacyClassNames, setLegacyClassNames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [showPermissionsPanel, setShowPermissionsPanel] = useState(false);
  const [showTrackManager, setShowTrackManager] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editingStudent, setEditingStudent] = useState(null);
  const [form, setForm] = useState(emptyStudent);
  const [newSubject, setNewSubject] = useState('');
  const [saving, setSaving] = useState(false);
  const [profileStudent, setProfileStudent] = useState(null);
  const [transferTarget, setTransferTarget] = useState(null);
  const [transferForm, setTransferForm] = useState({ classId: '', effectiveDate: localDateKey(), reason: '' });

  const [search, setSearch] = useState('');
  const [filterClass, setFilterClass] = useState('');
  const [filterStatus, setFilterStatus] = useState('active');
  const [filterProgram, setFilterProgram] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState('table');

  const canViewAllClasses = isAdmin
    || schoolWidePermissions.classes_view === true
    || schoolWidePermissions.classes_create === true
    || schoolWidePermissions.classes_update === true
    || schoolWidePermissions.classes_archive === true
    || schoolWidePermissions.classes_assign_teacher === true
    || schoolWidePermissions.students_view === true
    || schoolWidePermissions.students_edit === true
    || schoolWidePermissions.students_create === true
    || schoolWidePermissions.students_update === true
    || schoolWidePermissions.students_archive === true
    || schoolWidePermissions.students_transfer_class === true
    || schoolWidePermissions.students_manage_programs === true;
  const canViewAllStudents = isAdmin
    || schoolWidePermissions.students_view === true
    || schoolWidePermissions.students_edit === true
    || schoolWidePermissions.students_update === true
    || schoolWidePermissions.students_archive === true
    || schoolWidePermissions.students_transfer_class === true
    || schoolWidePermissions.students_manage_programs === true;

  useEffect(() => {
    if (!schoolId || !actor.uid) return undefined;
    setLoading(true);
    const unsubscribe = subscribeClasses({
      db, schoolId, uid: actor.uid, canViewAll: canViewAllClasses,
      onData: items => { setClasses(items); setLoading(false); },
      onError: () => { setError('לא ניתן לטעון את הכיתות.'); setLoading(false); },
    });
    return unsubscribe;
  }, [actor.uid, canViewAllClasses, schoolId]);

  const accessibleClassIds = useMemo(() => classes.map(item => item.id), [classes]);

  useEffect(() => {
    if (!schoolId || !actor.uid) return undefined;
    return subscribeStudents({
      db, schoolId, classIds: accessibleClassIds, legacyClassNames, canViewAll: canViewAllStudents,
      onData: setStudents,
      onError: () => setError('לא ניתן לטעון את התלמידים המורשים.'),
    });
  }, [accessibleClassIds, actor.uid, canViewAllStudents, legacyClassNames, schoolId]);

  useEffect(() => {
    if (!schoolId) return undefined;
    const unsubscribe = onSnapshot(
      schoolCollection(db, schoolId, 'tracks'),
      snapshot => setTracks(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))),
      () => setTracks([]),
    );
    listSchoolStaff(db, schoolId).then(setStaff).catch(() => setStaff([]));
    getDoc(schoolDoc(db, schoolId, 'settings', 'class_permissions')).then(snapshot => {
      const configured = snapshot.data()?.classes || {};
      const names = Object.entries(configured)
        .filter(([, access]) => (
          access?.teacherIds?.includes(actor.uid)
          || access?.teamIds?.some(teamId => userData?.teamIds?.includes(teamId))
        ))
        .map(([name]) => name);
      setLegacyClassNames(names);
    }).catch(() => setLegacyClassNames([]));
    return unsubscribe;
  }, [actor.uid, schoolId, userData?.teamIds]);

  const classById = useMemo(() => new Map(classes.map(item => [item.id, item])), [classes]);
  const activeClasses = classes.filter(item => item.status !== 'archived');
  const managedClassIds = useMemo(() => new Set(classes
    .filter(item => item.teacherId === actor.uid)
    .map(item => item.id)), [actor.uid, classes]);

  function hasStudentPermission(key, student) {
    if (isAdmin || permissions[key]) return true;
    if (key === 'students_create' || key === 'students_update' || key === 'students_edit') {
      return Boolean(student?.classId && managedClassIds.has(student.classId));
    }
    return false;
  }

  const classPermissions = {
    classes_create: isAdmin || permissions.classes_create,
    classes_update: isAdmin || permissions.classes_update,
    classes_archive: isAdmin || permissions.classes_archive,
    classes_assign_teacher: isAdmin || permissions.classes_assign_teacher,
  };

  const canCreateAnyStudent = isAdmin || permissions.students_create || managedClassIds.size > 0;
  const canManagePrograms = isAdmin || permissions.students_manage_programs;
  const canTransfer = isAdmin || permissions.students_transfer_class;
  const canArchive = isAdmin || permissions.students_archive;

  const filteredStudents = students.filter(student => {
    if (filterClass && student.classId !== filterClass) return false;
    if (filterStatus && (student.status || STUDENT_STATUS.ACTIVE) !== filterStatus) return false;
    if (filterProgram && !(student.programTypes || [student.programType]).includes(filterProgram)) return false;
    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      if (![student.fullName, student.className].some(value => String(value || '').toLowerCase().includes(needle))) return false;
    }
    return true;
  });

  function showSuccess(text) {
    setMessage(text);
    window.setTimeout(() => setMessage(''), 2500);
  }

  function openAdd(classId = filterClass) {
    setEditingStudent(null);
    setForm({ ...emptyStudent(), classId: classId || '' });
    setNewSubject('');
    setError('');
    setShowForm(true);
  }

  function openEdit(student) {
    setEditingStudent(student);
    setForm(formFromStudent(student));
    setNewSubject('');
    setError('');
    setShowForm(true);
  }

  function addSubject() {
    if (!newSubject.trim()) return;
    setForm(previous => ({
      ...previous,
      additionalSubjects: [...previous.additionalSubjects, { name: newSubject.trim(), status: 'pending' }],
    }));
    setNewSubject('');
  }

  async function saveStudent(keepOpen = false) {
    const fullName = `${form.firstName.trim()} ${form.lastName.trim()}`.trim() || form.fullName.trim();
    const selectedClass = classById.get(form.classId);
    if (!fullName || !selectedClass) {
      setError('יש להזין שם ולבחור כיתה פעילה.');
      return;
    }
    if (!editingStudent && !hasStudentPermission('students_create', { classId: selectedClass.id })) {
      setError('אין הרשאה להוסיף תלמיד לכיתה שנבחרה.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const input = { ...form, fullName };
      if (editingStudent) {
        await updateStudent({ db, schoolId, actor, student: editingStudent, input, classItem: selectedClass });
        showSuccess('פרטי התלמיד עודכנו.');
      } else {
        await createStudent({ db, schoolId, actor, input, classItem: selectedClass });
        showSuccess('התלמיד נוסף בהצלחה.');
      }
      if (keepOpen && !editingStudent) setForm(previous => ({ ...emptyStudent(), classId: previous.classId, joinedAt: previous.joinedAt }));
      else setShowForm(false);
    } catch {
      setError('לא ניתן לשמור את התלמיד. בדקו את ההרשאה ונסו שוב.');
    } finally {
      setSaving(false);
    }
  }

  async function archiveStudent(student) {
    const archived = (student.status || STUDENT_STATUS.ACTIVE) !== STUDENT_STATUS.ARCHIVED;
    if (!window.confirm(archived ? 'להעביר את התלמיד לארכיון? המידע ההיסטורי יישמר.' : 'להחזיר את התלמיד לפעילות?')) return;
    try {
      await setStudentStatus({
        db, schoolId, actor, student,
        status: archived ? STUDENT_STATUS.ARCHIVED : STUDENT_STATUS.ACTIVE,
        effectiveDate: localDateKey(),
      });
      showSuccess(archived ? 'התלמיד הועבר לארכיון.' : 'התלמיד חזר לפעילות.');
    } catch {
      setError('לא ניתן לשנות את סטטוס התלמיד.');
    }
  }

  function openTransfer(student) {
    setTransferTarget(student);
    setTransferForm({ classId: '', effectiveDate: localDateKey(), reason: '' });
  }

  async function confirmTransfer(event) {
    event.preventDefault();
    const nextClass = classById.get(transferForm.classId);
    if (!nextClass || nextClass.id === transferTarget.classId) return;
    setSaving(true);
    try {
      await transferStudent({ db, schoolId, actor, student: transferTarget, nextClass, ...transferForm });
      setTransferTarget(null);
      showSuccess('התלמיד הועבר והיסטוריית השיוך נשמרה.');
    } catch {
      setError('לא ניתן להעביר את התלמיד.');
    } finally {
      setSaving(false);
    }
  }

  function openClassStudents(item) {
    setActiveTab('students');
    setFilterClass(item.id);
    setFilterStatus('active');
  }

  function getTrackNames(student) {
    const ids = student.trackIds || (student.trackId ? [student.trackId] : []);
    return ids.map(id => tracks.find(track => track.id === id)?.name).filter(Boolean).join(', ') || '—';
  }

  if (loading) return <div className="page"><Header title="כיתות ותלמידים" /><div className="page-content"><div className="students-loading">טוען כיתות ותלמידים…</div></div></div>;

  return (
    <div className="page">
      <Header title="כיתות ותלמידים" onPermissions={isAdmin ? () => setShowPermissionsPanel(true) : undefined} />
      {showPermissionsPanel && <PagePermissionsPanel feature="students" onClose={() => setShowPermissionsPanel(false)} />}
      <div className="page-content">
        <div className="students-main-tabs" role="tablist" aria-label="תצוגת תלמידים וכיתות">
          <button role="tab" aria-selected={activeTab === 'students'} className={activeTab === 'students' ? 'active' : ''} onClick={() => setActiveTab('students')}><GraduationCap size={17} /> תלמידים</button>
          <button role="tab" aria-selected={activeTab === 'classes'} className={activeTab === 'classes' ? 'active' : ''} onClick={() => setActiveTab('classes')}><Users size={17} /> כיתות</button>
        </div>

        {message && <div className="students-feedback students-feedback--success" role="status">{message}</div>}
        {error && <div className="students-feedback students-feedback--error" role="alert">{error}</div>}

        {activeTab === 'classes' ? (
          <ClassManagement
            schoolId={schoolId}
            actor={actor}
            classes={classes}
            students={students}
            staff={staff}
            tracks={tracks}
            permissions={classPermissions}
            onOpenStudents={openClassStudents}
          />
        ) : (
          <section aria-label="רשימת תלמידים">
            <div className="page-toolbar students-toolbar">
              <div className="students-toolbar-actions">
                <div className="view-toggle"><button className={`toggle-btn ${viewMode === 'table' ? 'active' : ''}`} onClick={() => setViewMode('table')}>טבלה</button><button className={`toggle-btn ${viewMode === 'grid' ? 'active' : ''}`} onClick={() => setViewMode('grid')}>כרטיסיות</button></div>
                {canCreateAnyStudent && <button className="btn btn-primary" onClick={() => openAdd()}><Plus size={16} /> הוספת תלמיד</button>}
                {canManagePrograms && <button className="btn btn-secondary" onClick={() => setShowTrackManager(true)}><Settings size={16} /> ניהול מגמות</button>}
              </div>
              <div className="students-toolbar-search">
                <div className="search-bar"><Search size={14} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="חיפוש תלמיד" aria-label="חיפוש תלמיד" /></div>
                <button className="btn btn-secondary btn-sm" onClick={() => setShowFilters(value => !value)}><Filter size={14} /> סינון</button>
                <span className="staff-count">{filteredStudents.length} תלמידים</span>
              </div>
            </div>

            {showFilters && <div className="staff-filters-bar"><div className="staff-filter-group"><label>כיתה</label><select value={filterClass} onChange={event => setFilterClass(event.target.value)}><option value="">כל הכיתות</option>{classes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div className="staff-filter-group"><label>סטטוס</label><select value={filterStatus} onChange={event => setFilterStatus(event.target.value)}><option value="">כל הסטטוסים</option>{Object.entries(STATUS_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></div><div className="staff-filter-group"><label>תוכנית</label><select value={filterProgram} onChange={event => setFilterProgram(event.target.value)}><option value="">הכול</option>{PROGRAM_TYPES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div></div>}

            {viewMode === 'table' ? (
              <div className="data-table-wrap"><table className="data-table"><thead><tr><th>שם תלמיד</th><th>כיתה</th><th>שנת לימודים</th><th>מגמות</th><th>סטטוס</th><th>פעולות</th></tr></thead><tbody>{filteredStudents.map(student => {
                const canEdit = hasStudentPermission('students_update', student) || hasStudentPermission('students_edit', student);
                return <tr key={student.id}><td className="td-bold"><div className="td-user"><div className="td-avatar">{student.fullName?.charAt(0) || '?'}</div>{student.fullName}</div></td><td>{student.className || classById.get(student.classId)?.name || 'לא משויך'}</td><td>{student.academicYear || '—'}</td><td>{getTrackNames(student)}</td><td><span className={`student-state student-state--${student.status || 'active'}`}>{STATUS_LABELS[student.status || 'active']}</span></td><td><div className="td-actions"><button className="icon-btn" onClick={() => setProfileStudent(student)} aria-label={`פתיחת פרופיל ${student.fullName}`}><Eye size={15} /></button>{canEdit && <button className="icon-btn" onClick={() => openEdit(student)} aria-label={`עריכת ${student.fullName}`}><Edit3 size={15} /></button>}{canTransfer && <button className="icon-btn" onClick={() => openTransfer(student)} aria-label={`העברת ${student.fullName} לכיתה אחרת`}><ArrowLeftRight size={15} /></button>}{canArchive && <button className="icon-btn" onClick={() => archiveStudent(student)} aria-label={student.status === 'archived' ? `שחזור ${student.fullName}` : `ארכוב ${student.fullName}`}>{student.status === 'archived' ? <RotateCcw size={15} /> : <Archive size={15} />}</button>}</div></td></tr>;
              })}{filteredStudents.length === 0 && <tr><td colSpan={6} className="td-empty">אין תלמידים התואמים לסינון. תלמידים ישנים ללא `classId` זמינים למנהל לצורך שיוך לכיתה.</td></tr>}</tbody></table></div>
            ) : (
              <div className="students-grid">{filteredStudents.map(student => <article key={student.id} className={`student-card ${student.status === 'archived' ? 'student-card--archived' : ''}`}><div className="student-card-avatar">{student.fullName?.charAt(0) || '?'}</div><h4 className="student-card-name">{student.fullName}</h4><p className="student-card-class">{student.className || 'ללא כיתה'} · {student.academicYear || '—'}</p><p className="student-card-track">{getTrackNames(student)}</p><span className={`student-state student-state--${student.status || 'active'}`}>{STATUS_LABELS[student.status || 'active']}</span><div className="student-card-actions"><button className="icon-btn" onClick={() => setProfileStudent(student)} aria-label={`פרופיל ${student.fullName}`}><Eye size={14} /></button>{hasStudentPermission('students_update', student) && <button className="icon-btn" onClick={() => openEdit(student)} aria-label={`עריכת ${student.fullName}`}><Edit3 size={14} /></button>}</div></article>)}{filteredStudents.length === 0 && <div className="empty-state students-empty"><GraduationCap size={42} className="empty-icon" /><p>אין תלמידים להצגה.</p></div>}</div>
            )}
          </section>
        )}
      </div>

      {showForm && <div className="modal-overlay" onClick={() => setShowForm(false)}><div className="modal-content modal-content--wide" role="dialog" aria-modal="true" aria-label={editingStudent ? 'עריכת תלמיד' : 'הוספת תלמיד'} onClick={event => event.stopPropagation()}><div className="modal-header"><h3>{editingStudent ? 'עריכת תלמיד' : 'הוספת תלמיד'}</h3><button className="modal-close" onClick={() => setShowForm(false)} aria-label="סגירה"><X size={18} /></button></div><form className="modal-form" onSubmit={event => { event.preventDefault(); saveStudent(false); }}>{error && <div className="students-feedback students-feedback--error" role="alert">{error}</div>}<div className="student-form-grid"><div className="form-group"><label>שם פרטי *</label><input value={form.firstName} onChange={event => setForm(previous => ({ ...previous, firstName: event.target.value }))} required /></div><div className="form-group"><label>שם משפחה *</label><input value={form.lastName} onChange={event => setForm(previous => ({ ...previous, lastName: event.target.value }))} required /></div><div className="form-group"><label>מספר מזהה</label><input value={form.idNumber} onChange={event => setForm(previous => ({ ...previous, idNumber: event.target.value }))} dir="ltr" /></div><div className="form-group"><label>כיתה *</label><select value={form.classId} onChange={event => setForm(previous => ({ ...previous, classId: event.target.value }))} disabled={Boolean(editingStudent)} required><option value="">בחרו כיתה</option>{activeClasses.filter(item => isAdmin || permissions.students_create || managedClassIds.has(item.id) || item.id === form.classId).map(item => <option key={item.id} value={item.id}>{item.name} · {item.academicYear}</option>)}</select>{editingStudent && <span className="form-hint">העברת כיתה מתבצעת בפעולה הייעודית כדי לשמור היסטוריה.</span>}</div><div className="form-group"><label>תאריך הצטרפות</label><input type="date" value={form.joinedAt} onChange={event => setForm(previous => ({ ...previous, joinedAt: event.target.value }))} disabled={Boolean(editingStudent)} /></div><div className="form-group"><label>טלפון תלמיד</label><input value={form.phone} onChange={event => setForm(previous => ({ ...previous, phone: event.target.value }))} dir="ltr" /></div><div className="form-group"><label>טלפון הורה</label><input value={form.parentPhone} onChange={event => setForm(previous => ({ ...previous, parentPhone: event.target.value }))} dir="ltr" /></div></div>
        <fieldset className="students-choice-group" disabled={!canManagePrograms}><legend>תוכניות לימוד</legend><div className="students-check-grid">{PROGRAM_TYPES.map(item => <label key={item.id}><input type="checkbox" checked={form.programTypes.includes(item.id)} onChange={() => setForm(previous => ({ ...previous, programTypes: toggle(previous.programTypes, item.id) }))} /> {item.label}</label>)}</div></fieldset>
        <fieldset className="students-choice-group" disabled={!canManagePrograms}><legend>מגמות</legend><div className="students-check-grid">{tracks.map(item => <label key={item.id}><input type="checkbox" checked={form.trackIds.includes(item.id)} onChange={() => setForm(previous => ({ ...previous, trackIds: toggle(previous.trackIds, item.id) }))} /> {item.name}</label>)}</div></fieldset>
        <div className="form-group"><label>מקצועות נוספים</label><div className="student-subjects-list">{form.additionalSubjects.map((subject, index) => <div className="student-subject-chip" key={`${subject.name}_${index}`}><span>{subject.name}</span><button type="button" onClick={() => setForm(previous => ({ ...previous, additionalSubjects: previous.additionalSubjects.filter((_, itemIndex) => itemIndex !== index) }))} aria-label={`הסרת ${subject.name}`}><X size={11} /></button></div>)}</div><div className="students-inline-input"><input value={newSubject} onChange={event => setNewSubject(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addSubject(); } }} placeholder="מקצוע נוסף" /><button type="button" className="btn btn-secondary btn-sm" onClick={addSubject} aria-label="הוספת מקצוע"><Plus size={14} /></button></div></div>
        <div className="modal-actions"><button className="btn btn-primary" disabled={saving}>{saving ? 'שומר…' : 'שמירה'}</button>{!editingStudent && <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => saveStudent(true)}>שמירה והוספת הבא</button>}<button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>ביטול</button></div></form></div></div>}

      {transferTarget && <div className="modal-overlay" onClick={() => setTransferTarget(null)}><div className="modal-content" role="dialog" aria-modal="true" aria-label="העברת תלמיד" onClick={event => event.stopPropagation()}><div className="modal-header"><h3>העברת {transferTarget.fullName}</h3><button className="modal-close" onClick={() => setTransferTarget(null)} aria-label="סגירה"><X size={18} /></button></div><form className="modal-form" onSubmit={confirmTransfer}><div className="students-transfer-summary">הכיתה הנוכחית: <strong>{transferTarget.className || 'ללא כיתה'}</strong>. ההיסטוריה תישמר.</div><div className="form-group"><label>כיתה חדשה *</label><select value={transferForm.classId} onChange={event => setTransferForm(previous => ({ ...previous, classId: event.target.value }))} required><option value="">בחרו כיתה</option>{activeClasses.filter(item => item.id !== transferTarget.classId).map(item => <option key={item.id} value={item.id}>{item.name} · {item.academicYear}</option>)}</select></div><div className="form-group"><label>תאריך תחילת השיוך *</label><input type="date" value={transferForm.effectiveDate} onChange={event => setTransferForm(previous => ({ ...previous, effectiveDate: event.target.value }))} required /></div><div className="form-group"><label>סיבה, אופציונלי</label><textarea value={transferForm.reason} onChange={event => setTransferForm(previous => ({ ...previous, reason: event.target.value }))} rows={3} maxLength={500} /></div><div className="modal-actions"><button className="btn btn-primary" disabled={saving}>אישור העברה</button><button type="button" className="btn btn-secondary" onClick={() => setTransferTarget(null)}>ביטול</button></div></form></div></div>}

      {showTrackManager && <TrackManager schoolId={schoolId} onClose={() => setShowTrackManager(false)} />}
      {profileStudent && <StudentProfile student={profileStudent} tracks={tracks} schoolId={schoolId} actor={actor} canEdit={hasStudentPermission('students_update', profileStudent) || hasStudentPermission('students_edit', profileStudent)} canAddNotes={isAdmin || permissions.students_add_notes} canViewNotes={isAdmin || permissions.students_view_notes} onClose={() => setProfileStudent(null)} onEdit={() => { setProfileStudent(null); openEdit(profileStudent); }} />}
    </div>
  );
}
