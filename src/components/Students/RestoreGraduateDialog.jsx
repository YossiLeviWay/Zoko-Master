import { useMemo, useState } from 'react';
import { restoreGraduate } from '../../services/adminUserService';

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function RestoreGraduateDialog({ schoolId, student, years, classes, onClose, onComplete }) {
  const openYears = useMemo(() => years.filter(item => item.status !== 'closed' && item.isActive !== false), [years]);
  const [academicYearId, setAcademicYearId] = useState(openYears[0]?.id || '');
  const availableClasses = useMemo(() => classes.filter(item => item.academicYearId === academicYearId && item.status !== 'archived'), [academicYearId, classes]);
  const [classId, setClassId] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(today);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    if (reason.trim().length < 5) return setError('יש להזין סיבה באורך 5 תווים לפחות.');
    setSaving(true); setError('');
    try {
      await restoreGraduate({
        schoolId,
        studentId: student.id,
        targetAcademicYearId: academicYearId,
        targetClassId: classId,
        effectiveDate,
        reason: reason.trim(),
        requestId: `restore_${student.id}_${Date.now()}`,
      });
      onComplete();
    } catch {
      setError('לא ניתן להחזיר את הבוגר. ודאו שהשנה והכיתה פעילות ושיש הרשאה מתאימה.');
    } finally { setSaving(false); }
  }

  return <div className="modal-overlay" onClick={onClose}><div className="modal-content" role="dialog" aria-modal="true" aria-label="החזרת בוגר לפעילות" onClick={event => event.stopPropagation()}><div className="modal-header"><h3>החזרת {student.fullName} לפעילות</h3><button className="modal-close" onClick={onClose} aria-label="סגירה">×</button></div><form className="modal-form" onSubmit={submit}>{error && <div className="students-feedback students-feedback--error" role="alert">{error}</div>}<p className="form-hint">הפעולה יוצרת שיוך שנתי חדש ושומרת את היסטוריית הסיום המקורית.</p><label className="form-group">שנת לימודים פעילה<select value={academicYearId} onChange={event => { setAcademicYearId(event.target.value); setClassId(''); }} required><option value="">בחירת שנה</option>{openYears.map(item => <option key={item.id} value={item.id}>{item.label || item.id}</option>)}</select></label><label className="form-group">כיתה חדשה<select value={classId} onChange={event => setClassId(event.target.value)} required><option value="">בחירת כיתה</option>{availableClasses.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="form-group">תאריך תחילה<input type="date" value={effectiveDate} onChange={event => setEffectiveDate(event.target.value)} required /></label><label className="form-group">סיבה<textarea value={reason} onChange={event => setReason(event.target.value)} minLength={5} maxLength={500} required /></label><div className="modal-actions"><button className="btn btn-primary" disabled={saving || !classId}>{saving ? 'מחזיר…' : 'אישור החזרה'}</button><button type="button" className="btn btn-secondary" onClick={onClose}>ביטול</button></div></form></div></div>;
}
