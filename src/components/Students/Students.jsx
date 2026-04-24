import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../firebase';
import { usePermissions } from '../../hooks/usePermissions';
import {
  collection, query, where, getDocs, addDoc, updateDoc,
  deleteDoc, doc, onSnapshot, orderBy, getDoc
} from 'firebase/firestore';
import Header from '../Layout/Header';
import PagePermissionsPanel from '../Shared/PagePermissionsPanel';
import TrackManager from './TrackManager';
import StudentProfile from './StudentProfile';
import ClassPermissionsManager from './ClassPermissionsManager';
import {
  Plus, Search, Edit3, Trash2, X, Users, BookOpen,
  GraduationCap, Filter, ChevronDown, Settings, Eye, Lock
} from 'lucide-react';
import '../Gantt/Gantt.css';
import './Students.css';

const PROGRAM_TYPES = [
  { id: 'full_matriculation', label: 'בגרות מלאה' },
  { id: 'tech_matriculation', label: 'בגרות טכנולוגית' },
  { id: 'professional_cert', label: 'תעודת מקצוע' },
  { id: 'completion_cert', label: 'תעודת גמר' },
];

const GRADE_LEVELS = ['ז׳', 'ח׳', 'ט׳', 'י׳', 'י״א', 'י״ב'];

const EMPTY_FORM = {
  fullName: '',
  idNumber: '',
  gradeLevel: 'י״ב',
  className: '',
  programType: '',
  trackId: '',
  phone: '',
  parentPhone: '',
  notes: '',
  additionalSubjects: [],
};

export default function Students() {
  const { userData, selectedSchool, isPrincipal, isGlobalAdmin } = useAuth();
  const { permissions } = usePermissions();
  const [showPermissionsPanel, setShowPermissionsPanel] = useState(false);

  const [students, setStudents] = useState([]);
  const [tracks, setTracks] = useState([]);
  const [classes, setClasses] = useState([]);

  const [showForm, setShowForm] = useState(false);
  const [editingStudent, setEditingStudent] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [newSubject, setNewSubject] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [filterClass, setFilterClass] = useState('');
  const [filterProgram, setFilterProgram] = useState('');
  const [filterGrade, setFilterGrade] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const [viewMode, setViewMode] = useState('table');
  const [showTrackManager, setShowTrackManager] = useState(false);
  const [showClassPerms, setShowClassPerms] = useState(false);
  const [classPermissions, setClassPermissions] = useState({}); // { className: { teacherIds, teamIds } }
  const [userTeamIds, setUserTeamIds] = useState([]);
  const [profileStudent, setProfileStudent] = useState(null);

  const schoolId = selectedSchool || userData?.schoolId;
  const isAdmin = isPrincipal() || isGlobalAdmin();
  const canEdit = isAdmin || permissions?.students_edit;

  useEffect(() => {
    if (!schoolId) return;
    const unsub = onSnapshot(collection(db, `students_${schoolId}`), snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setStudents(list);
      // Derive unique classes
      const classSet = new Set(list.map(s => s.className).filter(Boolean));
      setClasses([...classSet].sort());
    });
    return unsub;
  }, [schoolId]);

  useEffect(() => {
    if (!schoolId) return;
    const unsub = onSnapshot(collection(db, `tracks_${schoolId}`), snap => {
      setTracks(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [schoolId]);

  // Load class permissions and user's teams (for filtering)
  useEffect(() => {
    if (!schoolId) return;
    async function loadClassPerms() {
      try {
        const snap = await getDoc(doc(db, `settings_${schoolId}`, 'class_permissions'));
        if (snap.exists()) setClassPermissions(snap.data().classes || {});
      } catch {}
    }
    async function loadTeams() {
      try {
        const snap = await getDocs(collection(db, `teams_${schoolId}`));
        const myTeams = snap.docs
          .filter(d => (d.data().memberIds || []).includes(userData?.uid))
          .map(d => d.id);
        setUserTeamIds(myTeams);
      } catch {}
    }
    loadClassPerms();
    loadTeams();
  }, [schoolId, userData?.uid]);

  function openAdd() {
    setForm(EMPTY_FORM);
    setEditingStudent(null);
    setNewSubject('');
    setShowForm(true);
  }

  function openEdit(student) {
    setForm({
      fullName: student.fullName || '',
      idNumber: student.idNumber || '',
      gradeLevel: student.gradeLevel || 'י״ב',
      className: student.className || '',
      programType: student.programType || '',
      trackId: student.trackId || '',
      phone: student.phone || '',
      parentPhone: student.parentPhone || '',
      notes: student.notes || '',
      additionalSubjects: student.additionalSubjects || [],
    });
    setEditingStudent(student.id);
    setNewSubject('');
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.fullName.trim() || !schoolId) return;
    const data = {
      ...form,
      updatedAt: new Date().toISOString(),
    };
    if (editingStudent) {
      await updateDoc(doc(db, `students_${schoolId}`, editingStudent), data);
    } else {
      await addDoc(collection(db, `students_${schoolId}`), {
        ...data,
        requirementStatus: {},
        createdAt: new Date().toISOString(),
      });
    }
    setShowForm(false);
    setEditingStudent(null);
  }

  async function handleDelete(studentId) {
    if (!confirm('האם למחוק תלמיד זה?')) return;
    await deleteDoc(doc(db, `students_${schoolId}`, studentId));
  }

  function addSubject() {
    if (!newSubject.trim()) return;
    setForm(prev => ({
      ...prev,
      additionalSubjects: [...prev.additionalSubjects, { name: newSubject.trim(), status: 'pending' }],
    }));
    setNewSubject('');
  }

  function removeSubject(index) {
    setForm(prev => ({
      ...prev,
      additionalSubjects: prev.additionalSubjects.filter((_, i) => i !== index),
    }));
  }

  function getTrackName(trackId) {
    return tracks.find(t => t.id === trackId)?.name || '—';
  }

  function getProgramLabel(programType) {
    return PROGRAM_TYPES.find(p => p.id === programType)?.label || '—';
  }

  function getStudentProgress(student) {
    const track = tracks.find(t => t.id === student.trackId);
    if (!track || !track.requirements?.length) return null;
    const reqs = track.requirements;
    const status = student.requirementStatus || {};
    const done = reqs.filter(r => status[r.id] === 'done').length;
    return { done, total: reqs.length, pct: Math.round((done / reqs.length) * 100) };
  }

  // Determine which classes this user can see
  function canSeeClass(className) {
    if (isAdmin) return true; // admin sees all
    if (!className) return true;
    const perms = classPermissions[className];
    if (!perms) return true; // no restriction = everyone can see
    const hasTeacherAccess = (perms.teacherIds || []).includes(userData?.uid);
    const hasTeamAccess = (perms.teamIds || []).some(tid => userTeamIds.includes(tid));
    return hasTeacherAccess || hasTeamAccess;
  }

  const filteredStudents = students.filter(s => {
    if (!canSeeClass(s.className)) return false;
    if (filterClass && s.className !== filterClass) return false;
    if (filterProgram && s.programType !== filterProgram) return false;
    if (filterGrade && s.gradeLevel !== filterGrade) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (s.fullName || '').toLowerCase().includes(q) ||
             (s.idNumber || '').toLowerCase().includes(q) ||
             (s.className || '').toLowerCase().includes(q);
    }
    return true;
  });

  // Only show classes the user has access to in the filter dropdown
  const visibleClasses = classes.filter(canSeeClass);

  const tracksByProgram = form.programType
    ? tracks.filter(t => t.programType === form.programType)
    : tracks;

  const activeFilters = [filterClass, filterProgram, filterGrade].filter(Boolean).length;

  return (
    <div className="page">
      <Header title="תלמידים" onPermissions={isAdmin ? () => setShowPermissionsPanel(true) : undefined} />
      {showPermissionsPanel && (
        <PagePermissionsPanel feature="students" onClose={() => setShowPermissionsPanel(false)} />
      )}

      <div className="page-content">
        <div className="page-toolbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <div className="view-toggle">
              <button className={`toggle-btn ${viewMode === 'table' ? 'active' : ''}`} onClick={() => setViewMode('table')}>טבלה</button>
              <button className={`toggle-btn ${viewMode === 'grid' ? 'active' : ''}`} onClick={() => setViewMode('grid')}>כרטיסיות</button>
            </div>
            {canEdit && (
              <button className="btn btn-primary" onClick={openAdd}>
                <Plus size={16} />
                הוספת תלמיד
              </button>
            )}
            {isAdmin && (
              <button className="btn btn-secondary" onClick={() => setShowTrackManager(true)}>
                <Settings size={16} />
                ניהול מגמות
              </button>
            )}
            {isAdmin && classes.length > 0 && (
              <button className="btn btn-secondary" onClick={() => setShowClassPerms(true)}>
                <Lock size={16} />
                הרשאות כיתות
              </button>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <div className="search-bar">
              <Search size={14} />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="חיפוש תלמיד..."
              />
            </div>
            <button
              className={`btn btn-secondary btn-sm staff-filter-btn ${activeFilters > 0 ? 'staff-filter-btn--active' : ''}`}
              onClick={() => setShowFilters(f => !f)}
            >
              <Filter size={14} />
              סינון
              {activeFilters > 0 && <span className="filter-badge">{activeFilters}</span>}
            </button>
            <span className="staff-count">{filteredStudents.length} תלמידים</span>
          </div>
        </div>

        {showFilters && (
          <div className="staff-filters-bar">
            <div className="staff-filter-group">
              <label>כיתה</label>
              <select value={filterClass} onChange={e => setFilterClass(e.target.value)}>
                <option value="">הכל</option>
                {visibleClasses.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="staff-filter-group">
              <label>שכבה</label>
              <select value={filterGrade} onChange={e => setFilterGrade(e.target.value)}>
                <option value="">הכל</option>
                {GRADE_LEVELS.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div className="staff-filter-group">
              <label>מסלול</label>
              <select value={filterProgram} onChange={e => setFilterProgram(e.target.value)}>
                <option value="">הכל</option>
                {PROGRAM_TYPES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            {activeFilters > 0 && (
              <button className="btn btn-secondary btn-sm" onClick={() => { setFilterClass(''); setFilterProgram(''); setFilterGrade(''); }}>
                <X size={13} />
                נקה
              </button>
            )}
          </div>
        )}

        {/* Add/Edit Form Modal */}
        {showForm && (
          <div className="modal-overlay" onClick={() => setShowForm(false)}>
            <div className="modal-content modal-content--wide" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h3>{editingStudent ? 'עריכת תלמיד' : 'הוספת תלמיד'}</h3>
                <button className="modal-close" onClick={() => setShowForm(false)}><X size={18} /></button>
              </div>
              <div className="modal-form">
                <form onSubmit={handleSubmit} className="add-staff-form">
                  <div className="student-form-grid">
                    <div className="form-group">
                      <label>שם מלא *</label>
                      <input
                        value={form.fullName}
                        onChange={e => setForm(p => ({ ...p, fullName: e.target.value }))}
                        placeholder="שם פרטי ומשפחה"
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>מספר ת.ז.</label>
                      <input
                        value={form.idNumber}
                        onChange={e => setForm(p => ({ ...p, idNumber: e.target.value }))}
                        placeholder="מספר תעודת זהות"
                        dir="ltr"
                      />
                    </div>
                    <div className="form-group">
                      <label>שכבה</label>
                      <select value={form.gradeLevel} onChange={e => setForm(p => ({ ...p, gradeLevel: e.target.value }))}>
                        {GRADE_LEVELS.map(g => <option key={g} value={g}>{g}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>כיתה</label>
                      <input
                        value={form.className}
                        onChange={e => setForm(p => ({ ...p, className: e.target.value }))}
                        placeholder='לדוגמה: "י״ב 3"'
                      />
                    </div>
                    <div className="form-group">
                      <label>מסלול לימודים</label>
                      <select
                        value={form.programType}
                        onChange={e => setForm(p => ({ ...p, programType: e.target.value, trackId: '' }))}
                      >
                        <option value="">בחר מסלול...</option>
                        {PROGRAM_TYPES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>מגמה</label>
                      <select
                        value={form.trackId}
                        onChange={e => setForm(p => ({ ...p, trackId: e.target.value }))}
                        disabled={!form.programType}
                      >
                        <option value="">{form.programType ? 'בחר מגמה...' : 'קודם בחר מסלול'}</option>
                        {tracksByProgram.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                      {form.programType && tracksByProgram.length === 0 && (
                        <span className="form-hint">אין מגמות למסלול זה — צור מגמה ב״ניהול מגמות״</span>
                      )}
                    </div>
                    <div className="form-group">
                      <label>טלפון תלמיד</label>
                      <input
                        value={form.phone}
                        onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                        placeholder="050-0000000"
                        dir="ltr"
                      />
                    </div>
                    <div className="form-group">
                      <label>טלפון הורה</label>
                      <input
                        value={form.parentPhone}
                        onChange={e => setForm(p => ({ ...p, parentPhone: e.target.value }))}
                        placeholder="050-0000000"
                        dir="ltr"
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label>מקצועות נוספים (מחוץ למסלול)</label>
                    <div className="student-subjects-list">
                      {form.additionalSubjects.map((subj, i) => (
                        <div key={i} className="student-subject-chip">
                          <span>{subj.name}</span>
                          <button type="button" onClick={() => removeSubject(i)}><X size={11} /></button>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.4rem' }}>
                      <input
                        value={newSubject}
                        onChange={e => setNewSubject(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSubject(); } }}
                        placeholder="הוסף מקצוע..."
                        style={{ flex: 1 }}
                      />
                      <button type="button" className="btn btn-secondary btn-sm" onClick={addSubject}>
                        <Plus size={14} />
                      </button>
                    </div>
                  </div>

                  <div className="form-group">
                    <label>הערות</label>
                    <textarea
                      value={form.notes}
                      onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                      placeholder="הערות, המלצות, מידע נוסף..."
                      rows={3}
                      style={{ resize: 'vertical' }}
                    />
                  </div>

                  <div className="modal-actions">
                    <button type="submit" className="btn btn-primary">
                      {editingStudent ? 'שמירה' : 'הוספה'}
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>ביטול</button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Table View */}
        {viewMode === 'table' ? (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>שם תלמיד</th>
                  <th>כיתה</th>
                  <th>מסלול</th>
                  <th>מגמה</th>
                  <th>התקדמות</th>
                  {canEdit && <th>פעולות</th>}
                </tr>
              </thead>
              <tbody>
                {filteredStudents.map(student => {
                  const progress = getStudentProgress(student);
                  return (
                    <tr key={student.id}>
                      <td className="td-bold">
                        <div className="td-user">
                          <div className="td-avatar">{student.fullName?.charAt(0) || '?'}</div>
                          {student.fullName}
                        </div>
                      </td>
                      <td>{student.className || '—'}</td>
                      <td>
                        {student.programType
                          ? <span className={`student-program-badge student-program--${student.programType}`}>{getProgramLabel(student.programType)}</span>
                          : '—'}
                      </td>
                      <td>{student.trackId ? getTrackName(student.trackId) : '—'}</td>
                      <td>
                        {progress ? (
                          <div className="student-progress-cell">
                            <div className="student-progress-bar">
                              <div className="student-progress-fill" style={{ width: `${progress.pct}%` }} />
                            </div>
                            <span className="student-progress-text">{progress.done}/{progress.total}</span>
                          </div>
                        ) : '—'}
                      </td>
                      {canEdit && (
                        <td>
                          <div className="td-actions">
                            <button className="icon-btn" title="פרופיל תלמיד" onClick={() => setProfileStudent(student)}>
                              <Eye size={15} />
                            </button>
                            <button className="icon-btn" title="עריכה" onClick={() => openEdit(student)}>
                              <Edit3 size={15} />
                            </button>
                            <button className="icon-btn icon-btn--danger" title="מחיקה" onClick={() => handleDelete(student.id)}>
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {filteredStudents.length === 0 && (
                  <tr>
                    <td colSpan={canEdit ? 6 : 5} className="td-empty">
                      {searchQuery || activeFilters ? 'לא נמצאו תוצאות' : 'אין תלמידים רשומים'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          /* Grid View */
          <div className="students-grid">
            {filteredStudents.map(student => {
              const progress = getStudentProgress(student);
              return (
                <div key={student.id} className="student-card">
                  <div className="student-card-avatar">{student.fullName?.charAt(0) || '?'}</div>
                  <h4 className="student-card-name">{student.fullName}</h4>
                  <p className="student-card-class">{student.className || '—'} • {student.gradeLevel}</p>
                  {student.programType && (
                    <span className={`student-program-badge student-program--${student.programType}`}>
                      {getProgramLabel(student.programType)}
                    </span>
                  )}
                  {student.trackId && (
                    <p className="student-card-track">{getTrackName(student.trackId)}</p>
                  )}
                  {progress && (
                    <div className="student-progress-cell" style={{ marginTop: '0.5rem' }}>
                      <div className="student-progress-bar">
                        <div className="student-progress-fill" style={{ width: `${progress.pct}%` }} />
                      </div>
                      <span className="student-progress-text">{progress.pct}%</span>
                    </div>
                  )}
                  <div className="student-card-actions">
                    <button className="icon-btn" onClick={() => setProfileStudent(student)} title="פרופיל">
                      <Eye size={14} />
                    </button>
                    {canEdit && (
                      <>
                        <button className="icon-btn" onClick={() => openEdit(student)} title="עריכה">
                          <Edit3 size={14} />
                        </button>
                        <button className="icon-btn icon-btn--danger" onClick={() => handleDelete(student.id)} title="מחיקה">
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
            {filteredStudents.length === 0 && (
              <div className="empty-state" style={{ gridColumn: '1/-1' }}>
                <GraduationCap size={40} className="empty-icon" />
                <p>{searchQuery || activeFilters ? 'לא נמצאו תוצאות' : 'אין תלמידים רשומים'}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Track Manager Modal */}
      {showTrackManager && (
        <TrackManager
          schoolId={schoolId}
          onClose={() => setShowTrackManager(false)}
        />
      )}

      {/* Class Permissions Modal */}
      {showClassPerms && (
        <ClassPermissionsManager
          schoolId={schoolId}
          classes={classes}
          onClose={() => {
            setShowClassPerms(false);
            // Reload class permissions after save
            getDoc(doc(db, `settings_${schoolId}`, 'class_permissions'))
              .then(snap => { if (snap.exists()) setClassPermissions(snap.data().classes || {}); })
              .catch(() => {});
          }}
        />
      )}

      {/* Student Profile Modal */}
      {profileStudent && (
        <StudentProfile
          student={profileStudent}
          tracks={tracks}
          schoolId={schoolId}
          canEdit={canEdit}
          onClose={() => setProfileStudent(null)}
          onEdit={() => { setProfileStudent(null); openEdit(profileStudent); }}
        />
      )}
    </div>
  );
}
