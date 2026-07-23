import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileStack, X } from 'lucide-react';
import { db } from '../../firebase';
import {
  createBulkCvDrafts, previewBulkCv, subscribeCvTemplates,
} from '../../services/firestore/cvTemplateRepository';

function missingLabels(item) {
  return [
    item.missingPhone && 'טלפון', item.missingEmail && 'דוא״ל',
    item.missingExperience && 'ניסיון', item.missingVerifiedSkills && 'מיומנויות מאומתות',
    item.missingCredentials && 'הסמכות',
  ].filter(Boolean);
}

export default function CvBulkDialog({ schoolId, actorUid, students, classes, academicYearId, templateAccess, onClose, onComplete }) {
  const [classId, setClassId] = useState(classes[0]?.id || '');
  const [selectedIds, setSelectedIds] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('classic_professional');
  const [titlePrefix, setTitlePrefix] = useState('קורות חיים');
  const [preview, setPreview] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!templateAccess) return undefined;
    return subscribeCvTemplates({ db, schoolId, actorUid, onData: setTemplates, onError: () => {} });
  }, [actorUid, schoolId, templateAccess]);
  const classStudents = useMemo(() => students.filter(student => student.classId === classId && (student.status || 'active') === 'active'), [classId, students]);
  useEffect(() => { setSelectedIds(classStudents.map(student => student.id)); setPreview([]); }, [classStudents]);
  const byId = useMemo(() => new Map(students.map(student => [student.id, student])), [students]);
  async function loadPreview() {
    if (!classId || selectedIds.length === 0) return;
    setBusy(true); setError('');
    try {
      const result = await previewBulkCv({ schoolId, classId, academicYearId, studentIds: selectedIds });
      setPreview(result.students || []);
    } catch { setError('לא ניתן להכין תצוגה מקדימה. בדקו הרשאה לכיתה.'); } finally { setBusy(false); }
  }
  async function createDrafts() {
    if (preview.length === 0) { setError('יש להריץ תחילה בדיקת נתונים חסרים.'); return; }
    if (!window.confirm(`ליצור ${selectedIds.length} טיוטות נפרדות? לא יופק PDF בשלב זה.`)) return;
    setBusy(true); setError('');
    try {
      const requestId = globalThis.crypto.randomUUID().replaceAll('-', '');
      const result = await createBulkCvDrafts({ schoolId, classId, academicYearId, studentIds: selectedIds, templateId, titlePrefix, requestId });
      onComplete(result.createdCount, result.existingCount);
    } catch { setError('יצירת הטיוטות נכשלה. לא נוצר מסמך משותף.'); } finally { setBusy(false); }
  }
  return <div className="modal-overlay" onClick={onClose}><div className="modal-content modal-content--wide cv-bulk-dialog" role="dialog" aria-modal="true" aria-label="יצירה מרוכזת של קורות חיים" onClick={event => event.stopPropagation()}><div className="modal-header"><div><h3>יצירת טיוטות קורות חיים לכיתה</h3><p>לכל תלמיד תיווצר טיוטה נפרדת. מיומנויות מהתבנית יסומנו כהצעה לאימות.</p></div><button className="modal-close" onClick={onClose} aria-label="סגירה"><X size={18} /></button></div><div className="modal-form">{error && <div className="students-feedback students-feedback--error" role="alert">{error}</div>}<div className="student-form-grid"><label>כיתה<select value={classId} onChange={event => setClassId(event.target.value)}>{classes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>תבנית<select value={templateId} onChange={event => setTemplateId(event.target.value)}><option value="classic_professional">קלאסי מקצועי</option>{templates.map(item => <option key={item.id} value={item.id}>{item.name} · {item.type === 'design' ? 'עיצוב' : 'תוכן'}</option>)}</select></label><label>כותרת הטיוטה<input value={titlePrefix} maxLength={120} onChange={event => setTitlePrefix(event.target.value)} /></label></div><div className="cv-bulk-selection"><div><strong>{selectedIds.length} מתוך {classStudents.length} תלמידים נבחרו</strong><button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelectedIds(selectedIds.length === classStudents.length ? [] : classStudents.map(item => item.id))}>{selectedIds.length === classStudents.length ? 'ביטול הכול' : 'בחירת הכול'}</button></div>{classStudents.map(student => <label key={student.id}><input type="checkbox" checked={selectedIds.includes(student.id)} onChange={() => setSelectedIds(previous => previous.includes(student.id) ? previous.filter(id => id !== student.id) : [...previous, student.id])} />{student.fullName}</label>)}</div>{preview.length > 0 && <div className="cv-bulk-preview"><h4>בדיקת נתונים לפני יצירה</h4>{preview.map(item => { const missing = missingLabels(item); return <article key={item.studentId}>{missing.length === 0 ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}<strong>{byId.get(item.studentId)?.fullName || 'תלמיד'}</strong><span>{missing.length ? `חסר: ${missing.join(', ')}` : 'כל נתוני הבסיס קיימים'}</span></article>; })}</div>}<div className="modal-actions"><button className="btn btn-secondary" onClick={loadPreview} disabled={busy || selectedIds.length === 0}>בדיקת נתונים חסרים</button><button className="btn btn-primary" onClick={createDrafts} disabled={busy || preview.length === 0}><FileStack size={15} /> יצירת טיוטות</button><button className="btn btn-secondary" onClick={onClose}>ביטול</button></div></div></div></div>;
}
