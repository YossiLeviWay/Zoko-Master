import { useMemo, useState } from 'react';
import { arrayRemove, arrayUnion, serverTimestamp, updateDoc } from 'firebase/firestore';
import { Save, X } from 'lucide-react';
import { db } from '../../firebase';
import { schoolDoc } from '../../services/firestore/paths';
import { studentEnrollmentId, transferEnrollmentWithinYear } from '../../services/firestore/studentLifecycleRepository';

export default function BulkStudentEditDialog({
  schoolId, actor, students, enrollments, classes, tracks, programs, academicYearId, onClose, onComplete,
}) {
  const [form, setForm] = useState({ classId: '', addTrackId: '', removeTrackId: '', addProgramId: '', removeProgramId: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const hasChange = Object.values(form).some(Boolean);
  const classById = useMemo(() => new Map(classes.map(item => [item.id, item])), [classes]);

  async function submit(event) {
    event.preventDefault();
    if (!hasChange || students.length === 0) return;
    const nextClass = form.classId ? classById.get(form.classId) : null;
    setSaving(true);
    setError('');
    try {
      for (const student of students) {
        const enrollment = enrollments.find(item => item.studentId === student.id);
        if (nextClass && enrollment && enrollment.classId !== nextClass.id) {
          await transferEnrollmentWithinYear({
            db, schoolId, actor, student, enrollment, nextClass,
            effectiveDate: new Date().toISOString().slice(0, 10),
            reason: 'עריכה מרוכזת',
          });
        }
        const studentPatch = { updatedBy: actor.uid, updatedAt: serverTimestamp() };
        const enrollmentPatch = { updatedBy: actor.uid, updatedAt: serverTimestamp() };
        if (form.addTrackId) { studentPatch.trackIds = arrayUnion(form.addTrackId); enrollmentPatch.majorIds = arrayUnion(form.addTrackId); }
        if (form.removeTrackId) { studentPatch.trackIds = arrayRemove(form.removeTrackId); enrollmentPatch.majorIds = arrayRemove(form.removeTrackId); }
        if (form.addProgramId) { studentPatch.programTypes = arrayUnion(form.addProgramId); enrollmentPatch.studyProgramIds = arrayUnion(form.addProgramId); }
        if (form.removeProgramId) { studentPatch.programTypes = arrayRemove(form.removeProgramId); enrollmentPatch.studyProgramIds = arrayRemove(form.removeProgramId); }
        if (Object.keys(studentPatch).length > 2) {
          await Promise.all([
            updateDoc(schoolDoc(db, schoolId, 'students', student.id), studentPatch),
            enrollment && !enrollment.legacy ? updateDoc(schoolDoc(db, schoolId, 'studentEnrollments', studentEnrollmentId(student.id, academicYearId)), enrollmentPatch) : Promise.resolve(),
          ]);
        }
      }
      onComplete(students.length);
    } catch {
      setError('העריכה המרוכזת לא הושלמה עבור כל התלמידים. בדקו הרשאות ונסו שוב.');
    } finally {
      setSaving(false);
    }
  }

  return <div className="modal-overlay" onClick={onClose}><div className="modal-content" role="dialog" aria-modal="true" aria-label="עריכה מרוכזת של תלמידים" onClick={event => event.stopPropagation()}><div className="modal-header"><div><h3>עריכה מרוכזת</h3><p>{students.length} תלמידים נבחרו</p></div><button className="modal-close" onClick={onClose} aria-label="סגירה"><X size={18} /></button></div><form className="modal-form" onSubmit={submit}>{error && <div className="students-feedback students-feedback--error">{error}</div>}<div className="form-group"><label>העברה לכיתה</label><select value={form.classId} onChange={event => setForm(previous => ({ ...previous, classId: event.target.value }))}><option value="">ללא שינוי</option>{classes.filter(item => item.status !== 'archived').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div className="student-form-grid"><label className="form-group">הוספת מגמה<select value={form.addTrackId} onChange={event => setForm(previous => ({ ...previous, addTrackId: event.target.value }))}><option value="">ללא</option>{tracks.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="form-group">הסרת מגמה<select value={form.removeTrackId} onChange={event => setForm(previous => ({ ...previous, removeTrackId: event.target.value }))}><option value="">ללא</option>{tracks.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="form-group">הוספת תוכנית<select value={form.addProgramId} onChange={event => setForm(previous => ({ ...previous, addProgramId: event.target.value }))}><option value="">ללא</option>{programs.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label className="form-group">הסרת תוכנית<select value={form.removeProgramId} onChange={event => setForm(previous => ({ ...previous, removeProgramId: event.target.value }))}><option value="">ללא</option>{programs.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label></div><div className="modal-actions"><button className="btn btn-primary" disabled={!hasChange || saving}><Save size={15} /> {saving ? 'שומר…' : 'החלת השינויים'}</button><button type="button" className="btn btn-secondary" onClick={onClose}>ביטול</button></div></form></div></div>;
}
