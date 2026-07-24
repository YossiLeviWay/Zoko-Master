import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, CalendarDays, Check, ChevronLeft, ChevronRight, FileSpreadsheet, Search, Users, X } from 'lucide-react';
import { db } from '../../firebase';
import { subscribeClasses, subscribeStudents } from '../../services/firestore/classStudentRepository';
import { createAttendanceSheets } from '../../services/firestore/attendanceRepository';
import {
  subscribeAcademicYears,
  subscribeAcademicYearSettings,
} from '../../services/firestore/academicYearRepository';
import { buildScheduledDays, DEFAULT_ATTENDANCE_LEGEND } from '../../utils/attendance';
import { academicYearDisplay } from '../../utils/academicYears';
import './Attendance.css';

const STEP_LABELS = ['פרטים', 'כיתות', 'תלמידים', 'תאריכים ומקראה'];

function defaultDateRange() {
  const start = new Date();
  const end = new Date(start);
  end.setDate(end.getDate() + 30);
  const key = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return { startDate: key(start), endDate: key(end) };
}

export default function AttendanceSheetWizard({
  schoolId,
  actor,
  folders,
  initialFolderId,
  initialClassId,
  canViewAllClasses,
  onClose,
  onCreated,
}) {
  const dates = useMemo(defaultDateRange, []);
  const [step, setStep] = useState(0);
  const [details, setDetails] = useState({
    title: 'גיליון נוכחות',
    academicYearId: '',
    academicYear: '',
    academicYearRange: '',
    startDate: dates.startDate,
    endDate: dates.endDate,
    folderId: initialFolderId || '',
    description: '',
  });
  const [classes, setClasses] = useState([]);
  const [academicYears, setAcademicYears] = useState([]);
  const [activeAcademicYearId, setActiveAcademicYearId] = useState('');
  const [selectedClassIds, setSelectedClassIds] = useState([]);
  const [students, setStudents] = useState([]);
  const [excludedByClass, setExcludedByClass] = useState({});
  const [orderByClass, setOrderByClass] = useState({});
  const [search, setSearch] = useState('');
  const [gradeFilter, setGradeFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const unsubscribeYears = subscribeAcademicYears({ db, schoolId, onData: setAcademicYears, onError: () => setError('לא ניתן לטעון שנות לימודים.') });
    const unsubscribeSettings = subscribeAcademicYearSettings({
      db,
      schoolId,
      onData: settings => setActiveAcademicYearId(settings.activeAcademicYearId),
      onError: () => setError('לא ניתן לטעון את שנת הלימודים הפעילה.'),
    });
    return () => { unsubscribeYears(); unsubscribeSettings(); };
  }, [schoolId]);

  useEffect(() => {
    if (!activeAcademicYearId || academicYears.length === 0) return;
    setDetails(previous => {
      if (previous.academicYearId) return previous;
      const year = academicYears.find(item => item.id === activeAcademicYearId);
      return year ? {
        ...previous,
        academicYearId: year.id,
        academicYear: year.hebrewLabel || year.label,
        academicYearRange: `${year.gregorianStartYear || year.startYear}-${year.gregorianEndYear || year.endYear}`,
      } : previous;
    });
  }, [academicYears, activeAcademicYearId]);

  useEffect(() => subscribeClasses({
    db,
    schoolId,
    uid: actor.uid,
    canViewAll: canViewAllClasses,
    onData: items => {
      const active = items.filter(item => item.status !== 'archived');
      setClasses(active);
      if (initialClassId && active.some(item => item.id === initialClassId)) {
        setSelectedClassIds(previous => previous.length ? previous : [initialClassId]);
      }
      setLoading(false);
    },
    onError: () => {
      setError('לא ניתן לטעון את הכיתות המורשות.');
      setLoading(false);
    },
  }), [actor.uid, canViewAllClasses, initialClassId, schoolId]);

  useEffect(() => {
    if (selectedClassIds.length === 0) {
      setStudents([]);
      return undefined;
    }
    return subscribeStudents({
      db,
      schoolId,
      classIds: selectedClassIds,
      canViewAll: false,
      onData: items => {
        const active = items.filter(item => item.status === 'active' && selectedClassIds.includes(item.classId));
        setStudents(active);
        setOrderByClass(previous => {
          const next = { ...previous };
          selectedClassIds.forEach(classId => {
            const ids = active.filter(item => item.classId === classId).map(item => item.id);
            next[classId] = [...(next[classId] || []).filter(id => ids.includes(id)), ...ids.filter(id => !(next[classId] || []).includes(id))];
          });
          return next;
        });
      },
      onError: () => setError('לא ניתן לטעון תלמידים עבור הכיתות שנבחרו.'),
    });
  }, [schoolId, selectedClassIds]);

  const yearClasses = classes.filter(item => !details.academicYearId || item.academicYearId === details.academicYearId);
  const selectedClasses = yearClasses.filter(item => selectedClassIds.includes(item.id));
  const visibleClasses = classes.filter(item => {
    const needle = search.trim().toLowerCase();
    const matchesSearch = !needle || [item.name, item.gradeLevel, item.academicYear]
      .some(value => String(value || '').toLowerCase().includes(needle));
    return matchesSearch && (!gradeFilter || item.gradeLevel === gradeFilter)
      && (!details.academicYearId || item.academicYearId === details.academicYearId);
  });
  const grades = [...new Set(classes.map(item => item.gradeLevel).filter(Boolean))];

  function toggleClass(classId) {
    setSelectedClassIds(previous => previous.includes(classId)
      ? previous.filter(id => id !== classId)
      : [...previous, classId]);
  }

  function orderedStudents(classId) {
    const byId = new Map(students.filter(item => item.classId === classId).map(item => [item.id, item]));
    return (orderByClass[classId] || [...byId.keys()]).map(id => byId.get(id)).filter(Boolean);
  }

  function toggleStudent(classId, studentId) {
    setExcludedByClass(previous => {
      const excluded = new Set(previous[classId] || []);
      if (excluded.has(studentId)) excluded.delete(studentId);
      else excluded.add(studentId);
      return { ...previous, [classId]: [...excluded] };
    });
  }

  function moveStudent(classId, studentId, offset) {
    setOrderByClass(previous => {
      const order = [...(previous[classId] || [])];
      const index = order.indexOf(studentId);
      const nextIndex = index + offset;
      if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return previous;
      [order[index], order[nextIndex]] = [order[nextIndex], order[index]];
      return { ...previous, [classId]: order };
    });
  }

  function includedStudents(classId) {
    const excluded = new Set(excludedByClass[classId] || []);
    return orderedStudents(classId).filter(student => !excluded.has(student.id));
  }

  function validateStep() {
    setError('');
    if (step === 0 && (!details.title.trim() || !details.folderId || !details.startDate || !details.endDate)) {
      setError('יש למלא שם, תיקייה וטווח תאריכים.');
      return false;
    }
    if (step === 0 && details.startDate > details.endDate) {
      setError('תאריך הסיום חייב להיות לאחר תאריך ההתחלה.');
      return false;
    }
    if (step === 1 && selectedClassIds.length === 0) {
      setError('יש לבחור לפחות כיתה אחת.');
      return false;
    }
    if (step === 2 && selectedClasses.some(item => includedStudents(item.id).length === 0)) {
      setError('בכל גיליון חייב להישאר לפחות תלמיד אחד.');
      return false;
    }
    return true;
  }

  function nextStep() {
    if (!validateStep()) return;
    if (step === 1 && !details.academicYear && selectedClasses[0]) {
      setDetails(previous => ({ ...previous, academicYear: selectedClasses[0].academicYear || '' }));
    }
    setStep(previous => Math.min(STEP_LABELS.length - 1, previous + 1));
  }

  async function createSheets() {
    if (!validateStep()) return;
    setSaving(true);
    setError('');
    try {
      const created = await createAttendanceSheets({
        db,
        schoolId,
        actor,
        folderId: details.folderId,
        input: details,
        selections: selectedClasses.map(classItem => ({
          classItem,
          students: includedStudents(classItem.id),
        })),
      });
      onCreated(created);
    } catch {
      setError('יצירת גיליונות הנוכחות נכשלה. לא נמחקו כיתות או תלמידים; נסו שוב.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="attendance-modal" role="dialog" aria-modal="true" aria-label="יצירת גיליון נוכחות">
      <div className="attendance-wizard">
        <div className="attendance-wizard-header">
          <div><h2><FileSpreadsheet size={21} /> גיליון נוכחות חדש</h2><p>ייווצר קובץ נפרד לכל כיתה.</p></div>
          <button className="icon-btn" onClick={onClose} aria-label="סגירת האשף"><X size={18} /></button>
        </div>

        <ol className="attendance-steps" aria-label="שלבי יצירה">
          {STEP_LABELS.map((label, index) => <li key={label} className={index === step ? 'active' : index < step ? 'done' : ''}><span>{index < step ? <Check size={13} /> : index + 1}</span>{label}</li>)}
        </ol>

        <div className="attendance-wizard-body">
          {error && <div className="attendance-feedback attendance-feedback--error" role="alert">{error}</div>}
          {step === 0 && (
            <div className="attendance-form-grid">
              <label>שם בסיסי לגיליון<input value={details.title} onChange={event => setDetails(previous => ({ ...previous, title: event.target.value }))} maxLength={100} /></label>
              <label>תיקיית יעד<select value={details.folderId} onChange={event => setDetails(previous => ({ ...previous, folderId: event.target.value }))}><option value="">בחירת תיקייה</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>
              <label>שנת לימודים<select value={details.academicYearId} onChange={event => { const year = academicYears.find(item => item.id === event.target.value); setSelectedClassIds([]); setDetails(previous => ({ ...previous, academicYearId: year?.id || '', academicYear: year?.hebrewLabel || year?.label || '', academicYearRange: year ? `${year.gregorianStartYear || year.startYear}-${year.gregorianEndYear || year.endYear}` : '' })); }}><option value="">בחירת שנה</option>{academicYears.map(year => <option key={year.id} value={year.id}>{academicYearDisplay(year)}{year.id === activeAcademicYearId ? ' · פעילה' : ''}</option>)}</select></label>
              <label>מתאריך<input type="date" value={details.startDate} onChange={event => setDetails(previous => ({ ...previous, startDate: event.target.value }))} /></label>
              <label>עד תאריך<input type="date" value={details.endDate} onChange={event => setDetails(previous => ({ ...previous, endDate: event.target.value }))} /></label>
              <label className="attendance-form-wide">תיאור<textarea value={details.description} onChange={event => setDetails(previous => ({ ...previous, description: event.target.value }))} maxLength={500} rows={3} /></label>
            </div>
          )}

          {step === 1 && (
            <div>
              <div className="attendance-filter-row"><div className="search-bar"><Search size={14} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="חיפוש כיתה" /></div><select value={gradeFilter} onChange={event => setGradeFilter(event.target.value)}><option value="">כל השכבות</option>{grades.map(grade => <option key={grade}>{grade}</option>)}</select><button className="btn btn-secondary btn-sm" onClick={() => setSelectedClassIds(visibleClasses.map(item => item.id))}>בחירת הכל</button></div>
              {loading ? <div className="attendance-empty">טוען כיתות…</div> : <div className="attendance-class-picker">{visibleClasses.map(item => <label key={item.id} className={selectedClassIds.includes(item.id) ? 'selected' : ''}><input type="checkbox" checked={selectedClassIds.includes(item.id)} onChange={() => toggleClass(item.id)} /><span><strong>{item.name}</strong><small>{item.gradeLevel || 'ללא שכבה'} · {item.academicYearLabel || item.academicYear}{item.academicYearRange ? ` (${item.academicYearRange})` : ''}</small></span></label>)}</div>}
              <p className="attendance-count"><Users size={14} /> נבחרו {selectedClassIds.length} כיתות — ייווצרו {selectedClassIds.length} גיליונות.</p>
            </div>
          )}

          {step === 2 && (
            <div className="attendance-student-preview">
              {selectedClasses.map(classItem => (
                <section key={classItem.id}><h3>{classItem.name} <span>{includedStudents(classItem.id).length} תלמידים</span></h3><div className="attendance-student-list">{orderedStudents(classItem.id).map((student, index) => { const excluded = (excludedByClass[classItem.id] || []).includes(student.id); return <div key={student.id} className={excluded ? 'excluded' : ''}><label><input type="checkbox" checked={!excluded} onChange={() => toggleStudent(classItem.id, student.id)} />{student.fullName}</label><span><button className="icon-btn" onClick={() => moveStudent(classItem.id, student.id, -1)} disabled={index === 0} aria-label={`העלאת ${student.fullName}`}><ArrowUp size={13} /></button><button className="icon-btn" onClick={() => moveStudent(classItem.id, student.id, 1)} disabled={index === orderedStudents(classItem.id).length - 1} aria-label={`הורדת ${student.fullName}`}><ArrowDown size={13} /></button></span></div>; })}</div></section>
              ))}
            </div>
          )}

          {step === 3 && (
            <div className="attendance-final-preview">
              <div className="attendance-date-preview">{selectedClasses.map(classItem => { let count = 0; try { count = buildScheduledDays({ startDate: details.startDate, endDate: details.endDate, studyDays: classItem.studyDays || [] }).length; } catch { count = 0; } return <article key={classItem.id}><CalendarDays size={22} /><div><strong>{classItem.name}</strong><span>{count} ימי לימוד לפי מערכת הכיתה</span><small>{includedStudents(classItem.id).length} תלמידים</small></div></article>; })}</div>
              <div><h3>מקראה ראשונית</h3><div className="attendance-legend-preview">{DEFAULT_ATTENDANCE_LEGEND.map(item => <span key={item.id} style={{ '--legend-color': item.color }}><b>{item.shortCode}</b>{item.label}</span>)}</div><p className="attendance-note">חגים, חופשות וימים חסומים יחוברו בשלב לוח השנה הבא. כרגע נוצרים רק ימי הלימוד הקבועים של הכיתה.</p></div>
            </div>
          )}
        </div>

        <div className="attendance-wizard-footer">
          <button className="btn btn-secondary" onClick={step === 0 ? onClose : () => setStep(previous => previous - 1)}><ChevronRight size={15} /> {step === 0 ? 'ביטול' : 'הקודם'}</button>
          {step < STEP_LABELS.length - 1 ? <button className="btn btn-primary" onClick={nextStep}>המשך <ChevronLeft size={15} /></button> : <button className="btn btn-primary" onClick={createSheets} disabled={saving}>{saving ? 'יוצר גיליונות…' : `יצירת ${selectedClasses.length} גיליונות`}</button>}
        </div>
      </div>
    </div>
  );
}
