import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, FileSpreadsheet, Plus, Trash2, Upload, X } from 'lucide-react';
import { bulkImportStudents } from '../../services/adminUserService';

const FIELD_OPTIONS = Object.freeze([
  ['firstName', 'שם פרטי'], ['lastName', 'שם משפחה'], ['idNumber', 'מספר מזהה'],
  ['className', 'כיתה'], ['academicYear', 'שנת לימודים'], ['status', 'סטטוס'],
  ['gradeLevel', 'שכבה'], ['birthDate', 'תאריך לידה'], ['phone', 'טלפון תלמיד'],
  ['email', 'דוא״ל תלמיד'], ['contactName', 'שם איש קשר'], ['contactPhone', 'טלפון איש קשר'],
  ['joinedAt', 'תאריך הצטרפות'], ['initialNote', 'הערה ראשונית'],
]);
const REQUIRED = new Set(['firstName', 'lastName', 'idNumber']);
const EMPTY_ROW = Object.freeze({
  firstName: '', lastName: '', idNumber: '', classId: '', className: '', academicYear: '', status: 'active',
  gradeLevel: '', birthDate: '', phone: '', email: '', contactName: '', contactPhone: '', joinedAt: '', initialNote: '',
});

function parseDelimited(text) {
  const delimiter = text.includes('\t') ? '\t' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cell.trim()); cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; cell = '';
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function statusValue(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const values = { פעיל: 'active', active: 'active', בוגר: 'graduated', graduated: 'graduated', פורש: 'withdrawn', withdrawn: 'withdrawn', נושר: 'dropout', dropout: 'dropout' };
  return values[normalized] || 'active';
}

function safeRequestId() {
  return globalThis.crypto?.randomUUID?.() || `import_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export default function BulkStudentImportWizard({ schoolId, classes, academicYear, onClose, onComplete }) {
  const [step, setStep] = useState(1);
  const [source, setSource] = useState('table');
  const [pasteValue, setPasteValue] = useState('');
  const [headers, setHeaders] = useState([]);
  const [rawRows, setRawRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [rows, setRows] = useState([{ ...EMPTY_ROW, rowId: 'row_1' }]);
  const [defaultClassId, setDefaultClassId] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const classByName = useMemo(() => new Map(classes.flatMap(item => [
    [String(item.name || '').trim().toLowerCase(), item], [item.id, item],
  ])), [classes]);

  const validation = useMemo(() => {
    const seen = new Set();
    return rows.map(row => {
      const errors = [];
      if (!row.firstName?.trim()) errors.push('חסר שם פרטי');
      if (!row.lastName?.trim()) errors.push('חסר שם משפחה');
      const normalizedId = String(row.idNumber || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
      if (!normalizedId) errors.push('חסר מספר מזהה');
      else if (seen.has(normalizedId)) errors.push('מספר מזהה כפול בקובץ');
      seen.add(normalizedId);
      if (!(row.classId || defaultClassId)) errors.push('לא נבחרה כיתה');
      return { rowId: row.rowId, errors };
    });
  }, [defaultClassId, rows]);
  const invalidCount = validation.filter(item => item.errors.length > 0).length;

  function addRow() {
    setRows(previous => [...previous, { ...EMPTY_ROW, rowId: `row_${Date.now()}_${previous.length}` }]);
  }

  function updateRow(index, key, value) {
    setRows(previous => previous.map((row, itemIndex) => itemIndex === index ? { ...row, [key]: value } : row));
  }

  function loadText(text) {
    const parsed = parseDelimited(text).slice(0, 201);
    if (parsed.length < 2) { setError('לא נמצאה טבלה עם כותרת ולפחות שורת תלמיד אחת.'); return; }
    const nextHeaders = parsed[0].map((header, index) => header || `עמודה ${index + 1}`);
    setHeaders(nextHeaders);
    setRawRows(parsed.slice(1));
    const suggested = {};
    nextHeaders.forEach((header, index) => {
      const normalized = header.replace(/\s/g, '').toLowerCase();
      const aliases = {
        שםפרטי: 'firstName', firstname: 'firstName', שםמשפחה: 'lastName', lastname: 'lastName',
        מספרמזהה: 'idNumber', תז: 'idNumber', idnumber: 'idNumber', כיתה: 'className', class: 'className',
        סטטוס: 'status', status: 'status', שנתלימודים: 'academicYear', academicyear: 'academicYear',
        שכבה: 'gradeLevel', תאריךלידה: 'birthDate', טלפון: 'phone', דואל: 'email', email: 'email',
      };
      if (aliases[normalized]) suggested[index] = aliases[normalized];
    });
    setMapping(suggested);
    setError('');
    setStep(2);
  }

  function applyMapping() {
    const mappedFields = new Set(Object.values(mapping));
    const missing = [...REQUIRED].filter(field => !mappedFields.has(field));
    if (missing.length) { setError('יש למפות שם פרטי, שם משפחה ומספר מזהה.'); return; }
    setRows(rawRows.map((values, rowIndex) => {
      const item = { ...EMPTY_ROW, rowId: `row_${rowIndex + 1}` };
      Object.entries(mapping).forEach(([column, field]) => { if (field) item[field] = values[Number(column)] || ''; });
      item.status = statusValue(item.status);
      item.classId = classByName.get(String(item.className || '').trim().toLowerCase())?.id || '';
      return item;
    }));
    setError(''); setStep(3);
  }

  async function importRows() {
    if (invalidCount) { setError('יש לתקן את השורות המסומנות לפני הייבוא.'); return; }
    setSaving(true); setError('');
    try {
      const requestId = safeRequestId();
      const response = await bulkImportStudents({
        requestId,
        students: rows.map(row => {
          const classId = row.classId || defaultClassId;
          const classItem = classes.find(item => item.id === classId);
          return {
            rowId: row.rowId,
            firstName: row.firstName.trim(), lastName: row.lastName.trim(), idNumber: row.idNumber.trim(),
            classId, academicYearId: academicYear.id, academicYear: academicYear.label || academicYear.name,
            status: statusValue(row.status), gradeLevel: row.gradeLevel || classItem?.gradeLevel || '',
            birthDate: row.birthDate || '', phone: row.phone || '', email: row.email || '',
            contactName: row.contactName || '', contactPhone: row.contactPhone || '',
            initialNote: row.initialNote || '', joinedAt: row.joinedAt || '',
            trackIds: [], programTypes: [], duplicateAction: 'review',
          };
        }),
      });
      setResult(response); setStep(4); onComplete?.(response);
    } catch {
      setError('הייבוא נדחה. בדקו הרשאה, כפילויות ותקינות הנתונים ונסו שוב.');
    } finally { setSaving(false); }
  }

  function downloadErrors() {
    if (!result?.errors?.length) return;
    const content = ['rowId,reason', ...result.errors.map(item => `${item.rowId},${item.reason}`)].join('\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `student-import-${result.requestId}-errors.csv`; anchor.click();
    URL.revokeObjectURL(url);
  }

  return <div className="modal-overlay" onClick={onClose}><div className="modal-content modal-content--wide bulk-import-modal" role="dialog" aria-modal="true" aria-label="הוספה מאסיבית של תלמידים" onClick={event => event.stopPropagation()}>
    <div className="modal-header"><div><h3>הוספה מאסיבית</h3><small>שלב {step} מתוך 4</small></div><button className="modal-close" onClick={onClose} aria-label="סגירה"><X size={18} /></button></div>
    <div className="bulk-import-progress" aria-label="התקדמות האשף">{['מקור', 'מיפוי', 'אימות', 'דוח'].map((label, index) => <span key={label} className={step >= index + 1 ? 'active' : ''}>{index + 1}. {label}</span>)}</div>
    {error && <div className="students-feedback students-feedback--error" role="alert">{error}</div>}
    {step === 1 && <div className="bulk-import-step"><div className="bulk-source-options"><button className={source === 'table' ? 'active' : ''} onClick={() => setSource('table')}><FileSpreadsheet size={20} /> הזנה בטבלה</button><button className={source === 'paste' ? 'active' : ''} onClick={() => setSource('paste')}><FileSpreadsheet size={20} /> הדבקה מ־Excel</button><button className={source === 'csv' ? 'active' : ''} onClick={() => setSource('csv')}><Upload size={20} /> CSV</button></div>
      {source === 'table' ? <><label className="form-group">כיתה לכל השורות<select value={defaultClassId} onChange={event => setDefaultClassId(event.target.value)}><option value="">בחירת כיתה</option>{classes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="bulk-manual-table"><table><thead><tr><th>שם פרטי *</th><th>שם משפחה *</th><th>מספר מזהה *</th><th>כיתה</th><th>סטטוס</th><th /></tr></thead><tbody>{rows.map((row, index) => <tr key={row.rowId}><td><input value={row.firstName} onChange={event => updateRow(index, 'firstName', event.target.value)} /></td><td><input value={row.lastName} onChange={event => updateRow(index, 'lastName', event.target.value)} /></td><td><input value={row.idNumber} onChange={event => updateRow(index, 'idNumber', event.target.value)} dir="ltr" /></td><td><select value={row.classId} onChange={event => updateRow(index, 'classId', event.target.value)}><option value="">ברירת מחדל</option>{classes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></td><td><select value={row.status} onChange={event => updateRow(index, 'status', event.target.value)}><option value="active">פעיל</option><option value="graduated">בוגר</option><option value="withdrawn">פורש</option><option value="dropout">נושר</option></select></td><td><button className="icon-btn icon-btn--danger" disabled={rows.length === 1} onClick={() => setRows(previous => previous.filter((_, itemIndex) => itemIndex !== index))} aria-label="מחיקת שורה"><Trash2 size={14} /></button></td></tr>)}</tbody></table></div><button className="btn btn-secondary btn-sm" onClick={addRow}><Plus size={14} /> שורה</button></> : source === 'paste' ? <label className="form-group">הדביקו טבלה עם שורת כותרת<textarea rows={10} value={pasteValue} onChange={event => setPasteValue(event.target.value)} placeholder="שם פרטי&#9;שם משפחה&#9;מספר מזהה&#9;כיתה" /></label> : <><input ref={fileRef} hidden type="file" accept=".csv,text/csv" onChange={event => { const file = event.target.files?.[0]; if (file && file.size <= 2_000_000) file.text().then(loadText); else setError('קובץ CSV חייב להיות קטן מ־2MB.'); }} /><button className="bulk-upload-zone" onClick={() => fileRef.current?.click()}><Upload size={30} /> בחירת קובץ CSV עד 2MB</button><p className="form-hint">XLSX אינו מעובד בדפדפן. שמרו כ־CSV או הדביקו ישירות כדי להימנע מהפעלת תוכן לא מהימן.</p></>}
      <div className="modal-actions"><button className="btn btn-primary" onClick={() => source === 'table' ? setStep(3) : source === 'paste' ? loadText(pasteValue) : fileRef.current?.click()}>המשך <ArrowLeft size={15} /></button></div></div>}
    {step === 2 && <div className="bulk-import-step"><p>בחרו לאיזה שדה במערכת שייכת כל עמודה. אי אפשר ליצור מפתחות הרשאה או שדות מערכת שרירותיים.</p><div className="bulk-mapping-grid">{headers.map((header, index) => <label key={`${header}_${index}`} className="form-group"><span>{header}</span><select value={mapping[index] || ''} onChange={event => setMapping(previous => ({ ...previous, [index]: event.target.value }))}><option value="">לא לייבא</option>{FIELD_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><small>{rawRows[0]?.[index] || '—'}</small></label>)}</div><div className="modal-actions"><button className="btn btn-primary" onClick={applyMapping}>אימות <ArrowLeft size={15} /></button><button className="btn btn-secondary" onClick={() => setStep(1)}><ArrowRight size={15} /> חזרה</button></div></div>}
    {step === 3 && <div className="bulk-import-step"><div className={`bulk-validation-summary ${invalidCount ? 'has-errors' : 'valid'}`}>{invalidCount ? <AlertTriangle size={20} /> : <CheckCircle2 size={20} />}<strong>{rows.length - invalidCount} שורות תקינות</strong><span>{invalidCount} שורות דורשות תיקון</span></div><label className="form-group">כיתת ברירת מחדל<select value={defaultClassId} onChange={event => setDefaultClassId(event.target.value)}><option value="">ללא</option>{classes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="bulk-preview-table"><table><thead><tr><th>שורה</th><th>תלמיד</th><th>כיתה</th><th>סטטוס</th></tr></thead><tbody>{rows.map((row, index) => { const check = validation[index]; return <tr key={row.rowId} className={check.errors.length ? 'invalid' : ''}><td>{index + 1}</td><td>{row.firstName} {row.lastName}</td><td>{classes.find(item => item.id === (row.classId || defaultClassId))?.name || 'לא נבחרה'}</td><td>{check.errors.length ? check.errors.join(' · ') : 'תקין'}</td></tr>; })}</tbody></table></div><p className="form-hint">בדיקת הכפילויות הסופית מתבצעת בשרת. מספרי הזיהוי אינם מוצגים בתצוגה ואינם נכתבים ללוג.</p><div className="modal-actions"><button className="btn btn-primary" disabled={saving || invalidCount > 0 || !schoolId || !academicYear?.id} onClick={importRows}>{saving ? 'מייבא…' : `ייבוא ${rows.length} תלמידים`}</button><button className="btn btn-secondary" onClick={() => setStep(source === 'table' ? 1 : 2)}><ArrowRight size={15} /> חזרה</button></div></div>}
    {step === 4 && result && <div className="bulk-import-step bulk-result"><CheckCircle2 size={44} /><h4>פעולת הייבוא הסתיימה</h4><div className="bulk-result-grid"><span><strong>{result.totals.created}</strong> נוצרו</span><span><strong>{result.totals.updated}</strong> עודכנו</span><span><strong>{result.totals.skipped}</strong> דולגו</span><span><strong>{result.totals.failed}</strong> נכשלו</span></div><code>{result.requestId}</code>{result.errors?.length > 0 && <button className="btn btn-secondary" onClick={downloadErrors}>הורדת דוח שגיאות</button>}<button className="btn btn-primary" onClick={onClose}>סיום</button></div>}
  </div></div>;
}
