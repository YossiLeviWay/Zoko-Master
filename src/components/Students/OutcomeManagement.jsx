import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { Calculator, Copy, Plus, Power, X } from 'lucide-react';
import { db } from '../../firebase';
import {
  calculateClassOutcomes,
  initializeOutcomeTemplates,
  outcomeDefinitionAction,
  upsertClassOutcomeTarget,
  upsertOutcomeDefinition,
} from '../../services/adminUserService';

const TYPES = [
  ['subject_min', 'ציון מינימלי במקצוע'], ['average_min', 'ממוצע מינימלי'], ['units_min', 'מספר יחידות'],
  ['practical_complete', 'התנסות מעשית הושלמה'], ['work_hours_min', 'שעות עבודה'], ['attendance_min', 'נוכחות מינימלית'],
  ['professional_exam_passed', 'בחינה מקצועית עברה'], ['evidence_uploaded', 'אסמכתה הועלתה'], ['manual_approval', 'אישור ידני'],
];
const MINIMUM_TYPES = new Set(['subject_min', 'average_min', 'units_min', 'work_hours_min', 'attendance_min']);

function emptyDefinition(academicYearId) {
  return { name: '', description: '', academicYearId, calculationMode: 'calculated', dropoutPolicy: 'exclude', operator: 'AND', criteria: [{ type: 'average_min', minimum: 55, subjectId: '' }] };
}

export default function OutcomeManagement({ schoolId, academicYear, classes, permissions, onClose }) {
  const [definitions, setDefinitions] = useState([]);
  const [targets, setTargets] = useState([]);
  const [summaries, setSummaries] = useState([]);
  const [form, setForm] = useState(() => emptyDefinition(academicYear.id));
  const [target, setTarget] = useState({ classId: '', outcomeDefinitionId: '', targetPercentage: 70, targetDate: '', managementNote: '' });
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const canManage = permissions.manageDefinitions;
  const canAssign = permissions.assignToClass;
  const canCalculate = permissions.calculate;

  useEffect(() => {
    const definitionsQuery = query(collection(db, `schools/${schoolId}/outcomeDefinitions`), where('academicYearId', '==', academicYear.id));
    const targetsQuery = query(collection(db, `schools/${schoolId}/classOutcomeTargets`), where('academicYearId', '==', academicYear.id));
    const summariesQuery = query(collection(db, `schools/${schoolId}/outcomeSummaries`), where('academicYearId', '==', academicYear.id));
    const unsubscribers = [
      onSnapshot(definitionsQuery, snapshot => setDefinitions(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))), () => setError('לא ניתן לטעון הגדרות תעודה.')),
      onSnapshot(targetsQuery, snapshot => setTargets(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))), () => undefined),
      onSnapshot(summariesQuery, snapshot => setSummaries(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))), () => undefined),
    ];
    return () => unsubscribers.forEach(unsubscribe => unsubscribe());
  }, [academicYear.id, schoolId]);

  const latestSummaries = useMemo(() => {
    const map = new Map();
    summaries.forEach(item => {
      const key = `${item.classId}_${item.outcomeDefinitionId}`;
      if (!map.has(key) || (item.outcomeDefinitionVersion || 0) > (map.get(key).outcomeDefinitionVersion || 0)) map.set(key, item);
    });
    return map;
  }, [summaries]);

  function updateCriterion(index, field, value) {
    setForm(previous => ({ ...previous, criteria: previous.criteria.map((criterion, itemIndex) => itemIndex === index ? { ...criterion, [field]: value } : criterion) }));
  }

  async function saveDefinition(event) {
    event.preventDefault();
    setSaving(true); setError('');
    try {
      const leaves = form.criteria.map(criterion => {
        const result = { type: criterion.type };
        if (criterion.type === 'subject_min') { result.subjectId = criterion.subjectId.trim(); result.subjectName = criterion.subjectName?.trim() || ''; }
        if (MINIMUM_TYPES.has(criterion.type)) result.minimum = Number(criterion.minimum);
        return result;
      });
      const criteria = leaves.length > 1 ? [{ type: 'group', operator: form.operator, criteria: leaves }] : leaves;
      await upsertOutcomeDefinition({ schoolId, name: form.name.trim(), description: form.description.trim(), academicYearId: academicYear.id, applicableGrades: [], applicableTracks: [], applicablePrograms: [], active: true, calculationMode: form.calculationMode, criteria, dropoutPolicy: form.dropoutPolicy });
      setForm(emptyDefinition(academicYear.id)); setShowForm(false); setMessage('הגדרת התעודה נשמרה בגרסה חדשה.');
    } catch { setError('לא ניתן לשמור את ההגדרה. ודאו שכל הקריטריונים מלאים.'); }
    finally { setSaving(false); }
  }

  async function initialize() {
    setSaving(true); setError('');
    try { const result = await initializeOutcomeTemplates({ schoolId, academicYearId: academicYear.id }); setMessage(result.alreadyInitialized ? 'התבניות כבר קיימות.' : `נוצרו ${result.created} תבניות התחלתיות.`); }
    catch { setError('לא ניתן ליצור את התבניות.'); }
    finally { setSaving(false); }
  }

  async function saveTarget(event) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      await upsertClassOutcomeTarget({ schoolId, classId: target.classId, academicYearId: academicYear.id, outcomeDefinitionId: target.outcomeDefinitionId, targetPercentage: Number(target.targetPercentage), includedStudentIds: [], responsibleUserIds: [], targetDate: target.targetDate, managementNote: target.managementNote });
      setMessage('היעד שויך לכיתה.');
    } catch { setError('לא ניתן לשייך את היעד לכיתה.'); }
    finally { setSaving(false); }
  }

  async function calculate(classId) {
    const ids = targets.filter(item => item.classId === classId).map(item => item.outcomeDefinitionId);
    if (!ids.length) { setError('יש לשייך לפחות תעודה אחת לכיתה לפני החישוב.'); return; }
    setSaving(true); setError('');
    try { await calculateClassOutcomes({ schoolId, classId, academicYearId: academicYear.id, outcomeDefinitionIds: [...new Set(ids)], requestId: `outcomes_${classId}_${Date.now()}` }); setMessage('החישוב הושלם ונשמר לפי גרסת ההגדרה הנוכחית.'); }
    catch { setError('חישוב הזכאות נכשל. בדקו את הנתונים וההרשאה.'); }
    finally { setSaving(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content modal-content--fullscreen" role="dialog" aria-modal="true" aria-label="תעודות ומדדי זכאות" onClick={event => event.stopPropagation()}>
        <div className="modal-header"><h3>תעודות ומדדי זכאות · {academicYear.label}</h3><button className="modal-close" onClick={onClose}><X size={18} /></button></div>
        <div className="modal-form outcomes-layout">
          {error && <div className="students-feedback students-feedback--error">{error}</div>}{message && <div className="students-feedback students-feedback--success">{message}</div>}
          <div className="page-toolbar"><strong>הגדרות מוסדיות עצמאיות</strong><div>{canManage && <button className="btn btn-secondary btn-sm" onClick={initialize} disabled={saving}>יצירת תבניות התחלתיות</button>} {canManage && <button className="btn btn-primary btn-sm" onClick={() => setShowForm(value => !value)}><Plus size={14} /> תעודה חדשה</button>}</div></div>
          <p className="form-hint">התבניות הן נקודת פתיחה בלבד ואינן הצהרה שהן משקפות את כל דרישות משרד החינוך או משרד העבודה.</p>
          {showForm && <form className="card outcome-definition-form" onSubmit={saveDefinition}>
            <div className="student-form-grid"><label className="form-group">שם<input value={form.name} onChange={event => setForm(previous => ({ ...previous, name: event.target.value }))} required /></label><label className="form-group">מצב חישוב<select value={form.calculationMode} onChange={event => setForm(previous => ({ ...previous, calculationMode: event.target.value }))}><option value="calculated">מחושב</option><option value="manual">ידני</option><option value="combined">משולב</option></select></label><label className="form-group">מדיניות נושרים<select value={form.dropoutPolicy} onChange={event => setForm(previous => ({ ...previous, dropoutPolicy: event.target.value }))}><option value="exclude">לא נכללים</option><option value="include">נכללים</option><option value="separate">מוצגים בנפרד</option></select></label><label className="form-group">קשר בין התנאים<select value={form.operator} onChange={event => setForm(previous => ({ ...previous, operator: event.target.value }))}><option value="AND">כל התנאים (AND)</option><option value="OR">לפחות תנאי אחד (OR)</option></select></label></div>
            <label className="form-group">תיאור<textarea value={form.description} onChange={event => setForm(previous => ({ ...previous, description: event.target.value }))} /></label>
            <div className="outcome-criteria">{form.criteria.map((criterion, index) => <div className="outcome-criterion" key={`${criterion.type}_${index}`}><select value={criterion.type} onChange={event => updateCriterion(index, 'type', event.target.value)}>{TYPES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>{criterion.type === 'subject_min' && <input placeholder="מזהה מקצוע" value={criterion.subjectId || ''} onChange={event => updateCriterion(index, 'subjectId', event.target.value)} required />}{MINIMUM_TYPES.has(criterion.type) && <input type="number" min="0" max={criterion.type === 'work_hours_min' ? 10000 : 100} value={criterion.minimum ?? 0} onChange={event => updateCriterion(index, 'minimum', event.target.value)} required />}<button type="button" className="icon-btn" disabled={form.criteria.length === 1} onClick={() => setForm(previous => ({ ...previous, criteria: previous.criteria.filter((_, itemIndex) => itemIndex !== index) }))}><X size={13} /></button></div>)}</div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setForm(previous => ({ ...previous, criteria: [...previous.criteria, { type: 'average_min', minimum: 55 }] }))}>הוספת תנאי</button>
            <div className="modal-actions"><button className="btn btn-primary" disabled={saving}>שמירת הגדרה</button></div>
          </form>}
          <div className="data-table-wrap"><table className="data-table"><thead><tr><th>תעודה</th><th>מצב</th><th>גרסה</th><th>פעולות</th></tr></thead><tbody>{definitions.map(item => <tr key={item.id}><td><strong>{item.name}</strong><small>{item.description}</small></td><td>{item.active === false ? 'מושבתת' : item.calculationMode}</td><td>{item.version || 1}</td><td>{canManage && <><button className="icon-btn" title="שכפול" onClick={() => outcomeDefinitionAction({ schoolId, definitionId: item.id, action: 'clone' }).catch(() => setError('השכפול נכשל.'))}><Copy size={14} /></button><button className="icon-btn" title="השבתה" disabled={item.active === false} onClick={() => outcomeDefinitionAction({ schoolId, definitionId: item.id, action: 'disable' }).catch(() => setError('ההשבתה נכשלה.'))}><Power size={14} /></button></>}</td></tr>)}{!definitions.length && <tr><td colSpan="4" className="td-empty">טרם הוגדרו תעודות.</td></tr>}</tbody></table></div>
          {canAssign && <form className="card outcome-target-form" onSubmit={saveTarget}><h4>שיוך יעד לכיתה</h4><select value={target.classId} onChange={event => setTarget(previous => ({ ...previous, classId: event.target.value }))} required><option value="">בחירת כיתה</option>{classes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select value={target.outcomeDefinitionId} onChange={event => setTarget(previous => ({ ...previous, outcomeDefinitionId: event.target.value }))} required><option value="">בחירת תעודה</option>{definitions.filter(item => item.active !== false).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><input type="number" min="0" max="100" value={target.targetPercentage} onChange={event => setTarget(previous => ({ ...previous, targetPercentage: event.target.value }))} aria-label="יעד באחוזים" /><input type="date" value={target.targetDate} onChange={event => setTarget(previous => ({ ...previous, targetDate: event.target.value }))} /><button className="btn btn-primary btn-sm" disabled={saving}>שמירת יעד</button></form>}
          <div className="outcomes-class-list">{classes.map(classItem => <section className="card" key={classItem.id}><div className="outcome-class-heading"><h4>{classItem.name}</h4>{canCalculate && <button className="btn btn-secondary btn-sm" onClick={() => calculate(classItem.id)} disabled={saving}><Calculator size={14} /> חישוב זכאות</button>}</div>{targets.filter(item => item.classId === classItem.id).map(item => { const definition = definitions.find(value => value.id === item.outcomeDefinitionId); const summary = latestSummaries.get(`${classItem.id}_${item.outcomeDefinitionId}`); return <div className="outcome-summary-row" key={item.id}><strong>{definition?.name || 'תעודה'}</strong>{summary ? <span>זכאות: {summary.eligibilityPercentage}% | {summary.numerator} מתוך {summary.denominator} | {summary.pending} ממתינים · יעד {summary.targetPercentage}% · שלמות {summary.dataCompletenessPercentage}%</span> : <span>יעד {item.targetPercentage}% · טרם חושב</span>}{summary?.pending > 0 && <em>הנתון אינו סופי משום שחסר מידע.</em>}</div>; })}</section>)}</div>
        </div>
      </div>
    </div>
  );
}
