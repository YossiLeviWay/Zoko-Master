import { useEffect, useMemo, useState } from 'react';
import { GraduationCap, X } from 'lucide-react';
import { graduateClass, previewClassGraduation } from '../../services/adminUserService';

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export default function ClassGraduationDialog({ schoolId, classItem, academicYear, onClose, onComplete }) {
  const [graduationDate, setGraduationDate] = useState(todayKey);
  const [preview, setPreview] = useState(null);
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const academicYearId = academicYear?.id || classItem.academicYearId;
  const requestId = useMemo(() => `graduate_${classItem.id}_${academicYearId}_${Date.now()}`, [academicYearId, classItem.id]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    previewClassGraduation({ schoolId, classId: classItem.id, academicYearId, graduationDate })
      .then(result => { if (active) { setPreview(result); setError(''); } })
      .catch(() => { if (active) setError('לא ניתן להכין תצוגה מקדימה. בדקו את ההרשאה ונתוני הכיתה.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [academicYearId, classItem.id, graduationDate, schoolId]);

  async function submit(event) {
    event.preventDefault();
    if (!preview || confirmation !== preview.confirmationText) return;
    setSaving(true);
    setError('');
    try {
      const result = await graduateClass({ schoolId, classId: classItem.id, academicYearId, graduationDate, confirmationText: confirmation, requestId });
      onComplete(result.graduatedCount || 0);
    } catch {
      setError('הפעולה לא הושלמה. לא בוצע שינוי חלקי; רעננו את הנתונים ונסו שוב.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content modal-content--wide" role="dialog" aria-modal="true" aria-label="הפיכת כיתה לבוגרים" onClick={event => event.stopPropagation()}>
        <div className="modal-header"><h3><GraduationCap size={20} /> הפיכת הכיתה לבוגרים</h3><button className="modal-close" onClick={onClose} aria-label="סגירה"><X size={18} /></button></div>
        <form className="modal-form" onSubmit={submit}>
          <div className="form-group"><label>תאריך סיום לימודים</label><input type="date" value={graduationDate} onChange={event => setGraduationDate(event.target.value)} required /></div>
          {loading && <p>מכין תצוגה מקדימה…</p>}
          {error && <div className="students-feedback students-feedback--error">{error}</div>}
          {preview && <>
            <div className="graduation-preview-grid">
              <span><strong>כיתה</strong>{preview.className}</span>
              <span><strong>שנת לימודים</strong>{preview.academicYearLabel || academicYearId}</span>
              <span><strong>תלמידים שיוגדרו כבוגרים</strong>{preview.activeStudentCount}</span>
              <span><strong>כבר בוגרים</strong>{preview.alreadyGraduatedCount}</span>
              <span><strong>נושרים / לא פעילים שלא ייכללו</strong>{preview.excludedStudentCount}</span>
              <span><strong>מידע חסר</strong>{preview.missingDataCount}</span>
              <span><strong>מטרות ותעודות לכיתה</strong>{preview.outcomeTargetCount}</span>
            </div>
            <div className="students-feedback students-feedback--warning">הפעולה תשנה את סטטוס כל התלמידים המתאימים ותשמור את נתוני הכיתה ב־Snapshot היסטורי. ציונים, נוכחות, תיק אישי ומסמכים לא יימחקו.</div>
            <div className="form-group"><label>להמשך, הקלידו בדיוק: <strong>{preview.confirmationText}</strong></label><input value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" /></div>
          </>}
          <div className="modal-actions"><button className="btn btn-primary" disabled={!preview || saving || confirmation !== preview.confirmationText}>{saving ? 'מבצע במנות בטוחות…' : 'אישור הפיכת הכיתה לבוגרים'}</button><button type="button" className="btn btn-secondary" onClick={onClose}>ביטול</button></div>
        </form>
      </div>
    </div>
  );
}
