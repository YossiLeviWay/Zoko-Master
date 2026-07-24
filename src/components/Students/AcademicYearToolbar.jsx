import { useState } from 'react';
import { CalendarRange, Check, Plus, Settings2, X } from 'lucide-react';
import {
  createAcademicYear,
  setActiveAcademicYear,
} from '../../services/firestore/academicYearRepository';
import { db } from '../../firebase';
import { academicYearDisplay, CURRENT_HEBREW_ACADEMIC_YEAR, hebrewYearLabel } from '../../utils/academicYears';

export default function AcademicYearToolbar({
  schoolId,
  actor,
  years,
  selectedYearId,
  activeYearId,
  canManage,
  onSelect,
}) {
  const [showManage, setShowManage] = useState(false);
  const [form, setForm] = useState({ hebrewYearNumber: CURRENT_HEBREW_ACADEMIC_YEAR + 1 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const selected = years.find(year => year.id === selectedYearId);

  async function addYear(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const id = await createAcademicYear({
        db, schoolId, actor,
        input: form,
      });
      onSelect(id);
      setForm(previous => ({ hebrewYearNumber: Number(previous.hebrewYearNumber) + 1 }));
    } catch {
      setError('לא ניתן להוסיף את שנת הלימודים.');
    } finally {
      setSaving(false);
    }
  }

  async function makeActive(yearId) {
    setSaving(true);
    setError('');
    try {
      await setActiveAcademicYear({ db, schoolId, actor, academicYearId: yearId });
      onSelect(yearId);
    } catch {
      setError('לא ניתן להגדיר שנה פעילה.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="academic-year-toolbar">
        <div>
          <CalendarRange size={17} />
          <label htmlFor="academic-year-select">שנת לימודים מוצגת</label>
          <select id="academic-year-select" value={selectedYearId} onChange={event => onSelect(event.target.value)}>
            {years.map(year => <option key={year.id} value={year.id}>{academicYearDisplay(year)}{year.id === activeYearId ? ' · פעילה' : ''}</option>)}
          </select>
        </div>
        <span className="academic-year-context">כל הפעולות במסך זה יחולו על <strong>{selected?.label || 'השנה שנבחרה'}</strong></span>
        {canManage && <button className="btn btn-secondary btn-sm" onClick={() => setShowManage(true)}><Settings2 size={14} /> ניהול שנים</button>}
      </div>

      {showManage && (
        <div className="modal-overlay" onClick={() => setShowManage(false)}>
          <div className="modal-content" role="dialog" aria-modal="true" aria-label="ניהול שנות לימודים" onClick={event => event.stopPropagation()}>
            <div className="modal-header"><h3>שנות לימודים</h3><button className="modal-close" onClick={() => setShowManage(false)} aria-label="סגירה"><X size={18} /></button></div>
            <div className="academic-year-manager">
              {error && <div className="students-feedback students-feedback--error" role="alert">{error}</div>}
              <div className="academic-year-list">
                {years.map(year => <article key={year.id}><div><strong>{year.hebrewLabel || year.label}</strong><span>{year.gregorianStartYear || year.startYear}-{year.gregorianEndYear || year.endYear}</span></div>{year.id === activeYearId ? <span className="academic-year-active"><Check size={13} /> שנה פעילה</span> : <button className="btn btn-secondary btn-sm" disabled={saving} onClick={() => makeActive(year.id)}>הגדרה כפעילה</button>}</article>)}
              </div>
              <form className="academic-year-add" onSubmit={addYear}>
                <h4>הוספת שנה עתידית</h4>
                <label>שנה עברית<input type="number" min="5786" max="6000" value={form.hebrewYearNumber} onChange={event => setForm({ hebrewYearNumber: event.target.value })} required /></label>
                <label>תצוגה<input value={`${hebrewYearLabel(form.hebrewYearNumber)} (${Number(form.hebrewYearNumber) - 3761}-${Number(form.hebrewYearNumber) - 3760})`} readOnly /></label>
                <button className="btn btn-primary" disabled={saving}><Plus size={15} /> הוספת שנה</button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
