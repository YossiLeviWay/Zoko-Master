import { useMemo, useState } from 'react';
import { ArrowLeft, Check, GraduationCap, UserMinus, X } from 'lucide-react';
import { changeEnrollmentStatus, ENROLLMENT_STATUS, promoteStudents } from '../../services/firestore/studentLifecycleRepository';
import { academicYearIdFromLegacy } from '../../services/firestore/academicYearRepository';
import { db } from '../../firebase';

function localDateKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const EXIT_LABELS = {
  [ENROLLMENT_STATUS.WITHDRAWN]: 'פורש',
  [ENROLLMENT_STATUS.DROPOUT]: 'נושר',
  [ENROLLMENT_STATUS.TRANSFERRED]: 'עבר למוסד אחר',
};

export default function StudentLifecycleDialog({
  mode,
  schoolId,
  actor,
  students,
  enrollments,
  classes,
  years,
  selectedYear,
  onClose,
  onComplete,
}) {
  const [selectedIds, setSelectedIds] = useState(() => students.map(student => student.id));
  const [targetYearId, setTargetYearId] = useState('');
  const [targetClassId, setTargetClassId] = useState('');
  const [status, setStatus] = useState(mode === 'graduate' ? ENROLLMENT_STATUS.GRADUATED : ENROLLMENT_STATUS.WITHDRAWN);
  const [effectiveDate, setEffectiveDate] = useState(localDateKey);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const selectedStudents = students.filter(student => selectedIds.includes(student.id));
  const targetYear = years.find(year => year.id === targetYearId);
  const targetClasses = classes.filter(item => (
    (item.academicYearId || academicYearIdFromLegacy(item.academicYear)) === targetYearId
    && item.status !== 'archived'
  ));
  const targetClass = targetClasses.find(item => item.id === targetClassId);
  const title = mode === 'promote' ? 'העלאת תלמידים לשנת לימודים חדשה' : mode === 'graduate' ? 'הפיכת תלמידים לבוגרים' : mode === 'restore' ? 'החזרת תלמידים לפעילות' : 'עדכון סטטוס לימודים';

  const selections = useMemo(() => selectedStudents.map(student => ({
    student,
    enrollment: enrollments.find(item => item.studentId === student.id),
    currentClass: classes.find(item => item.id === (enrollments.find(value => value.studentId === student.id)?.classId || student.classId)),
    academicYear: selectedYear,
  })), [classes, enrollments, selectedStudents, selectedYear]);

  function toggleStudent(studentId) {
    setSelectedIds(previous => previous.includes(studentId) ? previous.filter(id => id !== studentId) : [...previous, studentId]);
  }

  async function submit(event) {
    event.preventDefault();
    if (selectedStudents.length === 0) return;
    if (mode === 'promote' && (!targetYear || !targetClass)) {
      setError('יש לבחור שנת לימודים וכיתת יעד.');
      return;
    }
    if (mode === 'exit' && !reason.trim()) {
      setError('יש להזין סיבה.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (mode === 'promote') {
        await promoteStudents({ db, schoolId, actor, selections, sourceAcademicYear: selectedYear, targetAcademicYear: targetYear, targetClass, effectiveDate });
      } else {
        await changeEnrollmentStatus({
          db, schoolId, actor, selections,
          status: mode === 'graduate' ? ENROLLMENT_STATUS.GRADUATED : mode === 'restore' ? ENROLLMENT_STATUS.ACTIVE : status,
          effectiveDate, reason, note,
          graduationYear: mode === 'graduate' ? String(selectedYear?.endYear || '') : '',
        });
      }
      onComplete(selectedStudents.length);
    } catch (submitError) {
      setError(submitError.message === 'ENROLLMENT_EXISTS'
        ? 'לאחד התלמידים כבר קיימת הרשמה בשנת היעד. לא בוצע שינוי.'
        : 'הפעולה נכשלה. לא נמחק מידע; בדקו הרשאות ונסו שוב.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content modal-content--wide lifecycle-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={event => event.stopPropagation()}>
        <div className="modal-header"><h3>{title}</h3><button className="modal-close" onClick={onClose} aria-label="סגירה"><X size={18} /></button></div>
        <form className="modal-form" onSubmit={submit}>
          {error && <div className="students-feedback students-feedback--error" role="alert">{error}</div>}
          <div className="lifecycle-summary"><strong>{selectedStudents.length}</strong> מתוך {students.length} תלמידים נבחרו. המידע ההיסטורי והתיק האישי לא יימחקו.</div>
          {mode === 'promote' && <div className="student-form-grid"><div className="form-group"><label>שנת יעד *</label><select value={targetYearId} onChange={event => { setTargetYearId(event.target.value); setTargetClassId(''); }} required><option value="">בחירת שנה</option>{years.filter(year => year.startYear > (selectedYear?.startYear || 0)).map(year => <option key={year.id} value={year.id}>{year.label} · {year.startYear}-{year.endYear}</option>)}</select></div><div className="form-group"><label>כיתת יעד *</label><select value={targetClassId} onChange={event => setTargetClassId(event.target.value)} required disabled={!targetYearId}><option value="">בחירת כיתה</option>{targetClasses.map(item => <option key={item.id} value={item.id}>{item.name} · {item.gradeLevel}</option>)}</select></div></div>}
          {mode === 'exit' && <div className="student-form-grid"><div className="form-group"><label>סטטוס *</label><select value={status} onChange={event => setStatus(event.target.value)}>{Object.entries(EXIT_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></div><div className="form-group"><label>סיבה *</label><input value={reason} onChange={event => setReason(event.target.value)} maxLength={300} required /></div><div className="form-group form-group--wide"><label>הערה</label><textarea value={note} onChange={event => setNote(event.target.value)} rows={3} maxLength={1000} /></div></div>}
          <div className="form-group"><label>תאריך תחולה *</label><input type="date" value={effectiveDate} onChange={event => setEffectiveDate(event.target.value)} required /></div>
          <div className="lifecycle-student-list">{students.map(student => <label key={student.id}><input type="checkbox" checked={selectedIds.includes(student.id)} onChange={() => toggleStudent(student.id)} /><span>{student.fullName}</span><small>{student.className || 'ללא כיתה'}</small></label>)}</div>
          <div className="modal-actions"><button className="btn btn-primary" disabled={saving || selectedStudents.length === 0}>{mode === 'promote' ? <ArrowLeft size={15} /> : mode === 'graduate' ? <GraduationCap size={15} /> : mode === 'exit' ? <UserMinus size={15} /> : <Check size={15} />}{saving ? 'מבצע…' : 'אישור הפעולה'}</button><button type="button" className="btn btn-secondary" onClick={onClose}>ביטול</button></div>
        </form>
      </div>
    </div>
  );
}
