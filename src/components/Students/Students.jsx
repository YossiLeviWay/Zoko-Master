import { useEffect, useMemo, useState } from 'react';
import { getDoc, onSnapshot } from 'firebase/firestore';
import {
  ArrowLeftRight,
  Edit3,
  Eye,
  Filter,
  FileStack,
  GraduationCap,
  Plus,
  Search,
  Settings,
  UserMinus,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { db } from '../../firebase';
import { schoolCollection, schoolDoc } from '../../services/firestore/paths';
import {
  createStudent,
  listSchoolStaff,
  subscribeClasses,
  subscribeStudents,
  updateStudent,
} from '../../services/firestore/classStudentRepository';
import {
  ensureInitialAcademicYears,
  subscribeAcademicYears,
  subscribeAcademicYearSettings,
  academicYearIdFromLegacy,
} from '../../services/firestore/academicYearRepository';
import {
  ENROLLMENT_STATUS,
  enrollmentFromStudent,
  subscribeStudentEnrollments,
  transferEnrollmentWithinYear,
} from '../../services/firestore/studentLifecycleRepository';
import Header from '../Layout/Header';
import PagePermissionsPanel from '../Shared/PagePermissionsPanel';
import TrackManager from './TrackManager';
import StudentProfile from './StudentProfile';
import ClassManagement from './ClassManagement';
import AcademicYearToolbar from './AcademicYearToolbar';
import StudentLifecycleDialog from './StudentLifecycleDialog';
import CvBulkDialog from './CvBulkDialog';
import '../Gantt/Gantt.css';
import './Students.css';

const PROGRAM_TYPES = [
  { id: 'full_matriculation', label: 'בגרות מלאה' },
  { id: 'tech_matriculation', label: 'בגרות טכנולוגית' },
  { id: 'professional_cert', label: 'תעודת מקצוע' },
  { id: 'completion_cert', label: 'תעודת גמר' },
];

const STATUS_LABELS = {
  active: 'פעיל', completed: 'הושלם', graduated: 'בוגר',
  withdrawn: 'פורש', dropout: 'נושר', transferred: 'עבר מוסד', archived: 'ארכיון',
};

function localDateKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function emptyStudent() {
  return {
    firstName: '', lastName: '', fullName: '', idNumber: '', phone: '', parentPhone: '',
    classId: '', trackIds: [], programTypes: [], additionalSubjects: [],
    joinedAt: localDateKey(), endDate: '', status: 'active',
  };
}

function formFromStudent(student) {
  const nameParts = (student.fullName || '').trim().split(/\s+/);
  return {
    ...emptyStudent(), ...student,
    firstName: student.firstName || nameParts[0] || '',
    lastName: student.lastName || nameParts.slice(1).join(' '),
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
  const { permissions, schoolWidePermissions, permissionScopes } = usePermissions();
  const schoolId = selectedSchool || userData?.schoolId;
  const actor = useMemo(() => ({
    uid: currentUser?.uid,
    fullName: userData?.fullName || '',
  }), [currentUser?.uid, userData?.fullName]);
  const isAdmin = isPrincipal() || isGlobalAdmin();

  const [activeTab, setActiveTab] = useState('active');
  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [years, setYears] = useState([]);
  const [activeYearId, setActiveYearId] = useState('');
  const [selectedYearId, setSelectedYearId] = useState('');
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
  const [lifecycle, setLifecycle] = useState(null);
  const [showCvBulk, setShowCvBulk] = useState(false);
  const [selectedStudentIds, setSelectedStudentIds] = useState([]);
  const [search, setSearch] = useState('');
  const [filterClass, setFilterClass] = useState('');
  const [filterGrade, setFilterGrade] = useState('');
  const [filterTrack, setFilterTrack] = useState('');
  const [filterProgram, setFilterProgram] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState('table');

  const canManageYears = isAdmin || (
    permissions['academicYears.manage']
    && permissionScopes['academicYears.manage']?.type !== 'classes'
  );
  const canViewAllClasses = isAdmin || [
    'classes_view', 'classes_create', 'classes_update', 'classes_archive', 'classes_assign_teacher',
    'students_view', 'students_edit', 'students_create', 'students_update', 'students_archive',
    'students_transfer_class', 'students_manage_programs', 'students.promote', 'students.markGraduate',
    'classes.view', 'classes.create', 'classes.update', 'classes.archive', 'classes.assignTeacher',
    'students.view', 'students.create', 'students.update', 'students.archive', 'students.transferClass',
  ].some(key => schoolWidePermissions[key] === true);
  const canViewAllStudents = isAdmin || [
    'students_view', 'students_edit', 'students_update', 'students_archive',
    'students_transfer_class', 'students_manage_programs', 'students.promote',
    'students.markGraduate', 'students.markWithdrawn', 'students.markDropout', 'students.restore',
    'students.view', 'students.update', 'students.archive', 'students.transferClass',
  ].some(key => schoolWidePermissions[key] === true);
  const scopedClassIds = useMemo(() => [...new Set([
    'classes.view', 'classes.update', 'students.view', 'students.create', 'students.update',
    'students.transferClass', 'students.promote', 'students.markGraduate',
    'students.markWithdrawn', 'students.markDropout', 'students.restore',
  ].flatMap(key => permissionScopes[key]?.type === 'classes' ? permissionScopes[key].classIds : []))], [permissionScopes]);

  useEffect(() => {
    if (!schoolId) return undefined;
    const unsubscribeYears = subscribeAcademicYears({ db, schoolId, onData: setYears, onError: () => setError('לא ניתן לטעון שנות לימודים.') });
    const unsubscribeSettings = subscribeAcademicYearSettings({
      db, schoolId,
      onData: settings => {
        setActiveYearId(settings.activeAcademicYearId);
        setSelectedYearId(previous => previous || settings.activeAcademicYearId);
      },
      onError: () => setError('לא ניתן לטעון את השנה הפעילה.'),
    });
    if (canManageYears && actor.uid) ensureInitialAcademicYears({ db, schoolId, actor }).catch(() => undefined);
    return () => { unsubscribeYears(); unsubscribeSettings(); };
  }, [actor, canManageYears, schoolId]);

  useEffect(() => {
    if (!schoolId || !actor.uid) return undefined;
    setLoading(true);
    return subscribeClasses({
      db, schoolId, uid: actor.uid, canViewAll: canViewAllClasses,
      explicitClassIds: scopedClassIds,
      onData: items => { setClasses(items); setLoading(false); },
      onError: () => { setError('לא ניתן לטעון את הכיתות.'); setLoading(false); },
    });
  }, [actor.uid, canViewAllClasses, schoolId, scopedClassIds]);

  const selectedYear = years.find(year => year.id === selectedYearId);
  const classesForYear = useMemo(() => classes.filter(item => {
    const id = item.academicYearId || academicYearIdFromLegacy(item.academicYear);
    return id === selectedYearId;
  }), [classes, selectedYearId]);
  const accessibleClassIds = useMemo(() => classes.map(item => item.id), [classes]);

  useEffect(() => {
    if (!schoolId || !actor.uid) return undefined;
    return subscribeStudents({
      db, schoolId, classIds: accessibleClassIds, legacyClassNames, canViewAll: canViewAllStudents,
      onData: setStudents, onError: () => setError('לא ניתן לטעון את התלמידים המורשים.'),
    });
  }, [accessibleClassIds, actor.uid, canViewAllStudents, legacyClassNames, schoolId]);

  useEffect(() => {
    if (!schoolId || !selectedYearId) return undefined;
    return subscribeStudentEnrollments({
      db, schoolId, academicYearId: selectedYearId,
      classIds: classesForYear.map(item => item.id), canViewAll: canViewAllStudents,
      onData: setEnrollments, onError: () => setError('לא ניתן לטעון את השיוכים השנתיים.'),
    });
  }, [canViewAllStudents, classesForYear, schoolId, selectedYearId]);

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
      setLegacyClassNames(Object.entries(configured).filter(([, access]) => (
        access?.teacherIds?.includes(actor.uid)
        || access?.teamIds?.some(teamId => userData?.teamIds?.includes(teamId))
      )).map(([name]) => name));
    }).catch(() => setLegacyClassNames([]));
    return unsubscribe;
  }, [actor.uid, schoolId, userData?.teamIds]);

  const studentById = useMemo(() => new Map(students.map(item => [item.id, item])), [students]);
  const classById = useMemo(() => new Map(classes.map(item => [item.id, item])), [classes]);
  const effectiveEnrollments = useMemo(() => {
    const result = new Map(enrollments.map(item => [item.studentId, item]));
    students.forEach(student => {
      if (result.has(student.id)) return;
      const classItem = classById.get(student.classId);
      const yearId = classItem?.academicYearId || academicYearIdFromLegacy(student.academicYear || classItem?.academicYear);
      if (yearId === selectedYearId) result.set(student.id, enrollmentFromStudent({ student, classItem, academicYearId: yearId }));
    });
    return [...result.values()];
  }, [classById, enrollments, selectedYearId, students]);

  const yearStudents = useMemo(() => effectiveEnrollments.map(enrollment => {
    const student = studentById.get(enrollment.studentId);
    return {
      ...(student || { id: enrollment.studentId, fullName: enrollment.displayName, schoolId }),
      enrollment,
      classId: enrollment.classId,
      className: enrollment.className,
      gradeLevel: enrollment.grade,
      academicYear: enrollment.academicYearLabel,
      trackIds: enrollment.majorIds || student?.trackIds || [],
      programTypes: enrollment.studyProgramIds || student?.programTypes || [],
      status: enrollment.enrollmentStatus,
    };
  }), [effectiveEnrollments, schoolId, studentById]);

  const managedClassIds = useMemo(() => new Set(classes.filter(item => item.teacherId === actor.uid).map(item => item.id)), [actor.uid, classes]);
  const permissionApplies = (keys, classId) => keys.some(key => {
    if (!permissions[key]) return false;
    const scope = permissionScopes[key];
    return !scope || scope.type === 'school' || Boolean(classId && scope.classIds.includes(classId));
  });
  const hasStudentPermission = (key, student) => {
    const aliases = key === 'students_update' ? ['students_update', 'students_edit', 'students.update']
      : key === 'students_create' ? ['students_create', 'students.create']
      : [key];
    return isAdmin || permissionApplies(aliases, student?.classId) || Boolean(
      student?.classId && managedClassIds.has(student.classId) && ['students_create', 'students_update', 'students_edit'].includes(key),
    );
  };
  const canCreateAnyStudent = isAdmin || permissionApplies(['students_create', 'students.create']) || managedClassIds.size > 0;
  const canManagePrograms = isAdmin || permissionApplies(['students_manage_programs', 'students.managePrograms']);
  const canTransfer = isAdmin || permissionApplies(['students_transfer_class', 'students.transferClass']);
  const canPromote = isAdmin || permissions['students.promote'] || permissions['classes.promote'];
  const canGraduate = isAdmin || permissions['students.markGraduate'];
  const canExit = isAdmin || permissions['students.markWithdrawn'] || permissions['students.markDropout'];
  const canRestore = isAdmin || permissions['students.restore'];
  const canBulkCv = isAdmin || permissions['cv.bulkGenerate'];
  const personalFileAccessFor = student => ({
    view: isAdmin || permissionApplies(['personalFile.view', 'personalFile.manage'], student.classId),
    manage: isAdmin || permissionApplies(['personalFile.manage'], student.classId),
    upload: isAdmin || permissionApplies(['personalFile.upload'], student.classId),
    documents: isAdmin || permissionApplies(['personalFile.manage'], student.classId),
    credentials: isAdmin || permissionApplies(['cv.manageCredentials'], student.classId),
    experiences: isAdmin || permissionApplies(['cv.manageExperience'], student.classId),
    skills: isAdmin || permissionApplies(['cv.manageSkills'], student.classId),
    recommendations: isAdmin || permissionApplies(['cv.manageRecommendations'], student.classId),
  });
  const cvAccessFor = student => ({
    view: isAdmin || permissionApplies(['cv.view', 'cv.edit', 'cv.create'], student.classId),
    create: isAdmin || permissionApplies(['cv.create'], student.classId),
    edit: isAdmin || permissionApplies(['cv.edit'], student.classId),
    deleteDraft: isAdmin || permissionApplies(['cv.deleteDraft'], student.classId),
    finalize: isAdmin || permissionApplies(['cv.finalize'], student.classId),
    exportPdf: isAdmin || permissionApplies(['cv.exportPdf'], student.classId),
    bulkGenerate: isAdmin || permissionApplies(['cv.bulkGenerate'], student.classId),
    templatesCreate: isAdmin || permissionApplies(['cvTemplates.create'], student.classId),
    templatesView: isAdmin || permissionApplies(['cvTemplates.view'], student.classId),
    personalView: personalFileAccessFor(student).view,
  });

  const tabStatuses = activeTab === 'graduates' ? ['graduated'] : activeTab === 'leavers' ? ['withdrawn', 'dropout', 'transferred'] : ['active'];
  const filteredStudents = yearStudents.filter(student => {
    if (activeTab !== 'classes' && !tabStatuses.includes(student.status || 'active')) return false;
    if (filterClass && student.classId !== filterClass) return false;
    if (filterGrade && student.gradeLevel !== filterGrade) return false;
    if (filterTrack && !(student.trackIds || []).includes(filterTrack)) return false;
    if (filterProgram && !(student.programTypes || []).includes(filterProgram)) return false;
    if (filterStatus && student.status !== filterStatus) return false;
    const needle = search.trim().toLowerCase();
    return !needle || [student.fullName, student.className].some(value => String(value || '').toLowerCase().includes(needle));
  });

  const showSuccess = text => { setMessage(text); window.setTimeout(() => setMessage(''), 3000); };
  const selectedStudents = yearStudents.filter(student => selectedStudentIds.includes(student.id));
  const activeClasses = classesForYear.filter(item => item.status !== 'archived');

  function openAdd(classId = filterClass) {
    setEditingStudent(null);
    setForm({ ...emptyStudent(), classId: classId || '' });
    setNewSubject(''); setError(''); setShowForm(true);
  }

  function openEdit(student) {
    setEditingStudent(studentById.get(student.id) || student);
    setForm(formFromStudent(studentById.get(student.id) || student));
    setNewSubject(''); setError(''); setShowForm(true);
  }

  function addSubject() {
    if (!newSubject.trim()) return;
    setForm(previous => ({ ...previous, additionalSubjects: [...previous.additionalSubjects, { name: newSubject.trim(), status: 'pending' }] }));
    setNewSubject('');
  }

  async function saveStudent(keepOpen = false) {
    const fullName = `${form.firstName.trim()} ${form.lastName.trim()}`.trim() || form.fullName.trim();
    const selectedClass = classById.get(form.classId);
    if (!fullName || !selectedClass) { setError('יש להזין שם ולבחור כיתה בשנה המוצגת.'); return; }
    setSaving(true); setError('');
    try {
      const input = { ...form, fullName };
      if (editingStudent) await updateStudent({ db, schoolId, actor, student: editingStudent, input, classItem: selectedClass });
      else await createStudent({ db, schoolId, actor, input, classItem: selectedClass });
      showSuccess(editingStudent ? 'פרטי התלמיד עודכנו.' : 'התלמיד והתיק השנתי נוצרו בהצלחה.');
      if (keepOpen && !editingStudent) setForm(previous => ({ ...emptyStudent(), classId: previous.classId, joinedAt: previous.joinedAt }));
      else setShowForm(false);
    } catch { setError('לא ניתן לשמור את התלמיד. בדקו הרשאות ונסו שוב.'); }
    finally { setSaving(false); }
  }

  async function confirmTransfer(event) {
    event.preventDefault();
    const nextClass = classById.get(transferForm.classId);
    const enrollment = effectiveEnrollments.find(item => item.studentId === transferTarget.id);
    if (!nextClass || !enrollment || nextClass.id === enrollment.classId) return;
    setSaving(true);
    try {
      await transferEnrollmentWithinYear({ db, schoolId, actor, student: studentById.get(transferTarget.id) || transferTarget, enrollment, nextClass, ...transferForm });
      setTransferTarget(null); showSuccess('התלמיד הועבר בכיתה של השנה המוצגת וההיסטוריה נשמרה.');
    } catch { setError('לא ניתן להעביר את התלמיד.'); }
    finally { setSaving(false); }
  }

  function lifecycleStudents(mode) {
    const candidates = selectedStudents.length > 0 ? selectedStudents : filteredStudents;
    const keys = mode === 'promote' ? ['students.promote', 'classes.promote']
      : mode === 'graduate' ? ['students.markGraduate']
      : mode === 'restore' ? ['students.restore']
      : ['students.markWithdrawn', 'students.markDropout'];
    return isAdmin ? candidates : candidates.filter(student => permissionApplies(keys, student.classId));
  }

  function openClassStudents(item) {
    setActiveTab('active'); setFilterClass(item.id); setSelectedStudentIds([]);
  }

  function toggleSelected(studentId) {
    setSelectedStudentIds(previous => previous.includes(studentId) ? previous.filter(id => id !== studentId) : [...previous, studentId]);
  }

  function getTrackNames(student) {
    return (student.trackIds || []).map(id => tracks.find(track => track.id === id)?.name).filter(Boolean).join(', ') || '—';
  }

  if (loading || !selectedYearId) return <div className="page"><Header title="כיתות ותלמידים" /><div className="page-content"><div className="students-loading">טוען שנות לימודים, כיתות ותלמידים…</div></div></div>;

  const classPermissions = {
    classes_create: isAdmin || permissions.classes_create || permissions['classes.create'],
    classes_update: isAdmin || permissions.classes_update || permissions['classes.update'],
    classes_archive: isAdmin || permissions.classes_archive || permissions['classes.archive'],
    classes_assign_teacher: isAdmin || permissions.classes_assign_teacher || permissions['classes.assignTeacher'],
    attendance_create: isAdmin || permissions.attendance_create,
  };

  return (
    <div className="page">
      <Header title="כיתות ותלמידים" onPermissions={isAdmin ? () => setShowPermissionsPanel(true) : undefined} />
      {showPermissionsPanel && <PagePermissionsPanel feature="students" onClose={() => setShowPermissionsPanel(false)} />}
      <div className="page-content">
        <AcademicYearToolbar schoolId={schoolId} actor={actor} years={years} selectedYearId={selectedYearId} activeYearId={activeYearId} canManage={canManageYears} onSelect={yearId => { setSelectedYearId(yearId); setFilterClass(''); setSelectedStudentIds([]); }} />
        <div className="students-main-tabs" role="tablist" aria-label="תצוגת תלמידים וכיתות">
          <button role="tab" aria-selected={activeTab === 'active'} className={activeTab === 'active' ? 'active' : ''} onClick={() => setActiveTab('active')}><GraduationCap size={17} /> תלמידים פעילים</button>
          <button role="tab" aria-selected={activeTab === 'classes'} className={activeTab === 'classes' ? 'active' : ''} onClick={() => setActiveTab('classes')}><Users size={17} /> כיתות</button>
          <button role="tab" aria-selected={activeTab === 'graduates'} className={activeTab === 'graduates' ? 'active' : ''} onClick={() => setActiveTab('graduates')}><GraduationCap size={17} /> בוגרים</button>
          <button role="tab" aria-selected={activeTab === 'leavers'} className={activeTab === 'leavers' ? 'active' : ''} onClick={() => setActiveTab('leavers')}><UserMinus size={17} /> פורשים ונושרים</button>
        </div>
        {message && <div className="students-feedback students-feedback--success" role="status">{message}</div>}
        {error && <div className="students-feedback students-feedback--error" role="alert">{error}</div>}

        {activeTab === 'classes' ? (
          <ClassManagement schoolId={schoolId} actor={actor} classes={classesForYear} students={yearStudents} staff={staff} tracks={tracks} permissions={classPermissions} academicYear={selectedYear} onOpenStudents={openClassStudents} />
        ) : (
          <section aria-label={`רשימת תלמידים לשנת ${selectedYear?.label || ''}`}>
            <div className="page-toolbar students-toolbar">
              <div className="students-toolbar-actions">
                <div className="view-toggle"><button className={`toggle-btn ${viewMode === 'table' ? 'active' : ''}`} onClick={() => setViewMode('table')}>טבלה</button><button className={`toggle-btn ${viewMode === 'grid' ? 'active' : ''}`} onClick={() => setViewMode('grid')}>כרטיסיות</button></div>
                {activeTab === 'active' && canCreateAnyStudent && <button className="btn btn-primary" onClick={() => openAdd()}><Plus size={16} /> תלמיד חדש</button>}
                {canManagePrograms && <button className="btn btn-secondary" onClick={() => setShowTrackManager(true)}><Settings size={16} /> ניהול מגמות</button>}
                {activeTab === 'active' && canBulkCv && <button className="btn btn-secondary" onClick={() => setShowCvBulk(true)}><FileStack size={16} /> קורות חיים לכיתה</button>}
              </div>
              <div className="students-toolbar-search"><div className="search-bar"><Search size={14} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="חיפוש תלמיד" aria-label="חיפוש תלמיד" /></div><button className="btn btn-secondary btn-sm" onClick={() => setShowFilters(value => !value)}><Filter size={14} /> סינון</button><span className="staff-count">{filteredStudents.length} תלמידים</span></div>
            </div>

            {showFilters && <div className="staff-filters-bar"><div className="staff-filter-group"><label>כיתה</label><select value={filterClass} onChange={event => setFilterClass(event.target.value)}><option value="">כל הכיתות</option>{classesForYear.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div className="staff-filter-group"><label>שכבה</label><select value={filterGrade} onChange={event => setFilterGrade(event.target.value)}><option value="">כל השכבות</option>{[...new Set(classesForYear.map(item => item.gradeLevel).filter(Boolean))].map(grade => <option key={grade}>{grade}</option>)}</select></div><div className="staff-filter-group"><label>מגמה</label><select value={filterTrack} onChange={event => setFilterTrack(event.target.value)}><option value="">כל המגמות</option>{tracks.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div className="staff-filter-group"><label>תוכנית</label><select value={filterProgram} onChange={event => setFilterProgram(event.target.value)}><option value="">הכול</option>{PROGRAM_TYPES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div><div className="staff-filter-group"><label>סטטוס</label><select value={filterStatus} onChange={event => setFilterStatus(event.target.value)}><option value="">לפי הלשונית</option>{Object.entries(STATUS_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></div></div>}

            {filteredStudents.length > 0 && <div className="students-bulk-bar"><label><input type="checkbox" checked={filteredStudents.every(student => selectedStudentIds.includes(student.id))} onChange={event => setSelectedStudentIds(event.target.checked ? filteredStudents.map(student => student.id) : [])} /> בחירת כל המוצגים</label><span>{selectedStudents.length} נבחרו</span>{activeTab === 'active' && canPromote && <button className="btn btn-secondary btn-sm" onClick={() => setLifecycle({ mode: 'promote', students: lifecycleStudents('promote') })}>העלאה לשנה חדשה</button>}{activeTab === 'active' && canGraduate && <button className="btn btn-secondary btn-sm" onClick={() => setLifecycle({ mode: 'graduate', students: lifecycleStudents('graduate') })}>הפיכה לבוגרים</button>}{activeTab === 'active' && canExit && <button className="btn btn-secondary btn-sm" onClick={() => setLifecycle({ mode: 'exit', students: lifecycleStudents('exit') })}>פורש / נושר</button>}{activeTab !== 'active' && canRestore && <button className="btn btn-secondary btn-sm" onClick={() => setLifecycle({ mode: 'restore', students: lifecycleStudents('restore') })}>החזרה לפעילות</button>}</div>}

            {viewMode === 'table' ? (
              <div className="data-table-wrap"><table className="data-table"><thead><tr><th aria-label="בחירה" /><th>שם תלמיד</th><th>כיתה</th><th>שנת לימודים</th><th>מגמות</th><th>סטטוס</th><th>פעולות</th></tr></thead><tbody>{filteredStudents.map(student => <tr key={student.id}><td><input type="checkbox" checked={selectedStudentIds.includes(student.id)} onChange={() => toggleSelected(student.id)} aria-label={`בחירת ${student.fullName}`} /></td><td className="td-bold"><div className="td-user"><div className="td-avatar">{student.fullName?.charAt(0) || '?'}</div>{student.fullName}</div></td><td>{student.className || 'לא משויך'}</td><td>{selectedYear?.label} · {selectedYear?.startYear}-{selectedYear?.endYear}</td><td>{getTrackNames(student)}</td><td><span className={`student-state student-state--${student.status || 'active'}`}>{STATUS_LABELS[student.status || 'active']}</span></td><td><div className="td-actions"><button className="icon-btn" onClick={() => setProfileStudent(student)} aria-label={`פתיחת תיק ${student.fullName}`}><Eye size={15} /></button>{hasStudentPermission('students_update', student) && <button className="icon-btn" onClick={() => openEdit(student)} aria-label={`עריכת ${student.fullName}`}><Edit3 size={15} /></button>}{activeTab === 'active' && canTransfer && (isAdmin || permissionApplies(['students_transfer_class', 'students.transferClass'], student.classId)) && <button className="icon-btn" onClick={() => { setTransferTarget(student); setTransferForm({ classId: '', effectiveDate: localDateKey(), reason: '' }); }} aria-label={`העברת ${student.fullName} לכיתה אחרת`}><ArrowLeftRight size={15} /></button>}</div></td></tr>)}{filteredStudents.length === 0 && <tr><td colSpan={7} className="td-empty">אין תלמידים התואמים לשנה ולסינון שנבחרו.</td></tr>}</tbody></table></div>
            ) : (
              <div className="students-grid">{filteredStudents.map(student => <article key={student.id} className="student-card"><label className="student-card-select"><input type="checkbox" checked={selectedStudentIds.includes(student.id)} onChange={() => toggleSelected(student.id)} /> בחירה</label><div className="student-card-avatar">{student.fullName?.charAt(0) || '?'}</div><h4 className="student-card-name">{student.fullName}</h4><p className="student-card-class">{student.className || 'ללא כיתה'} · {selectedYear?.label}</p><p className="student-card-track">{getTrackNames(student)}</p><span className={`student-state student-state--${student.status || 'active'}`}>{STATUS_LABELS[student.status || 'active']}</span><div className="student-card-actions"><button className="icon-btn" onClick={() => setProfileStudent(student)} aria-label={`פתיחת תיק ${student.fullName}`}><Eye size={14} /></button></div></article>)}{filteredStudents.length === 0 && <div className="empty-state students-empty"><GraduationCap size={42} className="empty-icon" /><p>אין תלמידים להצגה בשנת הלימודים שנבחרה.</p></div>}</div>
            )}
          </section>
        )}
      </div>

      {showForm && <div className="modal-overlay" onClick={() => setShowForm(false)}><div className="modal-content modal-content--wide" role="dialog" aria-modal="true" aria-label={editingStudent ? 'עריכת תלמיד' : 'הוספת תלמיד'} onClick={event => event.stopPropagation()}><div className="modal-header"><h3>{editingStudent ? 'עריכת תלמיד' : `תלמיד חדש · ${selectedYear?.label}`}</h3><button className="modal-close" onClick={() => setShowForm(false)} aria-label="סגירה"><X size={18} /></button></div><form className="modal-form" onSubmit={event => { event.preventDefault(); saveStudent(false); }}>{error && <div className="students-feedback students-feedback--error" role="alert">{error}</div>}<div className="student-form-grid"><div className="form-group"><label>שם פרטי *</label><input value={form.firstName} onChange={event => setForm(previous => ({ ...previous, firstName: event.target.value }))} required /></div><div className="form-group"><label>שם משפחה *</label><input value={form.lastName} onChange={event => setForm(previous => ({ ...previous, lastName: event.target.value }))} required /></div><div className="form-group"><label>מספר מזהה</label><input value={form.idNumber} onChange={event => setForm(previous => ({ ...previous, idNumber: event.target.value }))} dir="ltr" /></div><div className="form-group"><label>כיתה בשנת {selectedYear?.label} *</label><select value={form.classId} onChange={event => setForm(previous => ({ ...previous, classId: event.target.value }))} disabled={Boolean(editingStudent)} required><option value="">בחירת כיתה</option>{activeClasses.filter(item => isAdmin || permissions.students_create || managedClassIds.has(item.id) || item.id === form.classId).map(item => <option key={item.id} value={item.id}>{item.name} · {item.gradeLevel}</option>)}</select>{editingStudent && <span className="form-hint">העברת כיתה מתבצעת בפעולה הייעודית כדי לשמור את ההיסטוריה.</span>}</div><div className="form-group"><label>תאריך הצטרפות</label><input type="date" value={form.joinedAt} onChange={event => setForm(previous => ({ ...previous, joinedAt: event.target.value }))} disabled={Boolean(editingStudent)} /></div><div className="form-group"><label>טלפון תלמיד</label><input value={form.phone} onChange={event => setForm(previous => ({ ...previous, phone: event.target.value }))} dir="ltr" /></div><div className="form-group"><label>טלפון הורה</label><input value={form.parentPhone} onChange={event => setForm(previous => ({ ...previous, parentPhone: event.target.value }))} dir="ltr" /></div></div><fieldset className="students-choice-group" disabled={!canManagePrograms}><legend>תוכניות לימוד</legend><div className="students-check-grid">{PROGRAM_TYPES.map(item => <label key={item.id}><input type="checkbox" checked={form.programTypes.includes(item.id)} onChange={() => setForm(previous => ({ ...previous, programTypes: toggle(previous.programTypes, item.id) }))} /> {item.label}</label>)}</div></fieldset><fieldset className="students-choice-group" disabled={!canManagePrograms}><legend>מגמות</legend><div className="students-check-grid">{tracks.map(item => <label key={item.id}><input type="checkbox" checked={form.trackIds.includes(item.id)} onChange={() => setForm(previous => ({ ...previous, trackIds: toggle(previous.trackIds, item.id) }))} /> {item.name}</label>)}</div></fieldset><div className="form-group"><label>מקצועות נוספים</label><div className="student-subjects-list">{form.additionalSubjects.map((subject, index) => <div className="student-subject-chip" key={`${subject.name}_${index}`}><span>{subject.name}</span><button type="button" onClick={() => setForm(previous => ({ ...previous, additionalSubjects: previous.additionalSubjects.filter((_, itemIndex) => itemIndex !== index) }))} aria-label={`הסרת ${subject.name}`}><X size={11} /></button></div>)}</div><div className="students-inline-input"><input value={newSubject} onChange={event => setNewSubject(event.target.value)} placeholder="מקצוע נוסף" /><button type="button" className="btn btn-secondary btn-sm" onClick={addSubject}><Plus size={14} /></button></div></div><div className="modal-actions"><button className="btn btn-primary" disabled={saving}>{saving ? 'שומר…' : 'שמירה'}</button>{!editingStudent && <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => saveStudent(true)}>שמירה והוספת הבא</button>}<button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>ביטול</button></div></form></div></div>}

      {transferTarget && <div className="modal-overlay" onClick={() => setTransferTarget(null)}><div className="modal-content" role="dialog" aria-modal="true" aria-label="העברת תלמיד" onClick={event => event.stopPropagation()}><div className="modal-header"><h3>העברת {transferTarget.fullName} · {selectedYear?.label}</h3><button className="modal-close" onClick={() => setTransferTarget(null)} aria-label="סגירה"><X size={18} /></button></div><form className="modal-form" onSubmit={confirmTransfer}><div className="students-transfer-summary">הכיתה הנוכחית: <strong>{transferTarget.className || 'ללא כיתה'}</strong>. רק הרשומת השנתית הנוכחית תעודכן.</div><div className="form-group"><label>כיתה חדשה *</label><select value={transferForm.classId} onChange={event => setTransferForm(previous => ({ ...previous, classId: event.target.value }))} required><option value="">בחירת כיתה</option>{activeClasses.filter(item => item.id !== transferTarget.classId).map(item => <option key={item.id} value={item.id}>{item.name} · {item.gradeLevel}</option>)}</select></div><div className="form-group"><label>תאריך תחילת השיוך *</label><input type="date" value={transferForm.effectiveDate} onChange={event => setTransferForm(previous => ({ ...previous, effectiveDate: event.target.value }))} required /></div><div className="form-group"><label>סיבה</label><textarea value={transferForm.reason} onChange={event => setTransferForm(previous => ({ ...previous, reason: event.target.value }))} rows={3} maxLength={500} /></div><div className="modal-actions"><button className="btn btn-primary" disabled={saving}>אישור העברה</button><button type="button" className="btn btn-secondary" onClick={() => setTransferTarget(null)}>ביטול</button></div></form></div></div>}

      {lifecycle && <StudentLifecycleDialog mode={lifecycle.mode} schoolId={schoolId} actor={actor} students={lifecycle.students} enrollments={effectiveEnrollments} classes={classes} years={years} selectedYear={selectedYear} onClose={() => setLifecycle(null)} onComplete={count => { setLifecycle(null); setSelectedStudentIds([]); showSuccess(`הפעולה הושלמה עבור ${count} תלמידים.`); }} />}
      {showTrackManager && <TrackManager schoolId={schoolId} onClose={() => setShowTrackManager(false)} />}
      {showCvBulk && <CvBulkDialog schoolId={schoolId} actorUid={actor.uid} students={yearStudents} classes={activeClasses} academicYearId={selectedYearId} templateAccess={isAdmin || permissions['cvTemplates.view']} onClose={() => setShowCvBulk(false)} onComplete={(created, existing) => { setShowCvBulk(false); showSuccess(`נוצרו ${created} טיוטות${existing ? `; ${existing} כבר היו קיימות בבקשה זו` : ''}.`); }} />}
      {profileStudent && <StudentProfile student={profileStudent} tracks={tracks} schoolId={schoolId} actor={actor} canEdit={hasStudentPermission('students_update', profileStudent) || hasStudentPermission('students_edit', profileStudent)} canAddNotes={isAdmin || permissionApplies(['students.addNotes', 'students_add_notes'], profileStudent.classId)} canViewNotes={isAdmin || canViewAllStudents || permissionApplies(['students.viewSensitiveNotes', 'students_view_notes', 'students.view'], profileStudent.classId)} personalFileAccess={personalFileAccessFor(profileStudent)} cvAccess={cvAccessFor(profileStudent)} onClose={() => setProfileStudent(null)} onEdit={() => { setProfileStudent(null); openEdit(profileStudent); }} />}
    </div>
  );
}
