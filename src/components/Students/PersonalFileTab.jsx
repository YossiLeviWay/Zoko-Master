import { useEffect, useMemo, useState } from 'react';
import {
  Archive, Award, BriefcaseBusiness, Download, FileText, Plus, Save,
  ShieldCheck, Sparkles, Upload, UserRoundCheck, X,
} from 'lucide-react';
import { db, storage } from '../../firebase';
import {
  archivePersonalItem,
  auditPersonalFileView,
  downloadPersonalFile,
  PERSONAL_FILE_KINDS,
  savePersonalFileItem,
  saveSkillCatalogItem,
  subscribePersonalFileKind,
  subscribeSkillCatalog,
  uploadPersonalFile,
} from '../../services/firestore/personalFileRepository';

const SECTION_CONFIG = Object.freeze({
  documents: { label: 'מסמכים', singular: 'מסמך', icon: FileText },
  credentials: { label: 'הסמכות ותעודות', singular: 'הסמכה', icon: Award },
  experiences: { label: 'ניסיון והתנסות מקצועית', singular: 'ניסיון', icon: BriefcaseBusiness },
  skills: { label: 'מיומנויות', singular: 'מיומנות', icon: Sparkles },
  recommendations: { label: 'המלצות מעסיקים', singular: 'המלצה', icon: UserRoundCheck },
});
const STATUS_LABELS = {
  draft: 'טיוטה', pending_verification: 'ממתינה לאימות', verified: 'מאומתת',
  expired: 'פגה', archived: 'ארכיון', active: 'פעיל',
};
const PROFICIENCY_LABELS = {
  familiarity: 'היכרות', learning: 'בתהליך למידה', practical: 'התנסות מעשית',
  independent: 'עבודה עצמאית', advanced: 'רמה מתקדמת',
};
const EMPTY_FORM = Object.freeze({
  title: '', description: '', status: 'draft', issuer: '', field: '', issueDate: '',
  expiryDate: '', credentialNumber: '', workplace: '', roleTitle: '', startDate: '',
  endDate: '', isCurrent: false, workload: '', responsibilitiesText: '', achievementsText: '',
  supervisorName: '', recommendationLink: '', recommenderName: '', recommenderRole: '',
  organization: '', relationship: '', workPeriod: '', content: '', shortQuote: '', contact: '',
  recommendationDate: '', cvVisibility: 'hidden', skillId: '', category: 'hard', name: '',
  proficiency: 'learning', assessmentSource: '', evidence: '', showInCv: false, attachments: [],
});

function listFromText(value) {
  return String(value || '').split('\n').map(item => item.trim()).filter(Boolean).slice(0, 30);
}

function formFromItem(item = {}) {
  return {
    ...EMPTY_FORM,
    ...item,
    responsibilitiesText: (item.responsibilities || []).join('\n'),
    achievementsText: (item.achievements || []).join('\n'),
    attachments: item.attachments || [],
  };
}

function timestampMillis(value) {
  if (value?.toMillis) return value.toMillis();
  if (typeof value === 'string') return Date.parse(value) || 0;
  return 0;
}

function itemTitle(kind, item) {
  if (kind === 'credentials' || kind === 'documents') return item.title || SECTION_CONFIG[kind].singular;
  if (kind === 'experiences') return [item.roleTitle, item.workplace].filter(Boolean).join(' · ') || 'ניסיון מקצועי';
  if (kind === 'skills') return item.name || 'מיומנות';
  return [item.recommenderName, item.organization].filter(Boolean).join(' · ') || 'המלצה';
}

function itemSummary(kind, item) {
  if (kind === 'credentials') return [item.issuer, item.field, item.issueDate].filter(Boolean).join(' · ');
  if (kind === 'experiences') return [item.field, item.startDate, item.isCurrent ? 'עד היום' : item.endDate].filter(Boolean).join(' · ');
  if (kind === 'skills') return [item.category === 'hard' ? 'מקצועית' : 'רכה', PROFICIENCY_LABELS[item.proficiency]].filter(Boolean).join(' · ');
  if (kind === 'recommendations') return item.shortQuote || item.relationship || '';
  return item.description || '';
}

function PersonalFileForm({ kind, form, setForm, catalog, canUpload, selectedFile, setSelectedFile, canManageSkills, onAddCatalog }) {
  const field = (name, label, type = 'text') => <label className="personal-file-field"><span>{label}</span><input type={type} value={form[name] || ''} onChange={event => setForm(previous => ({ ...previous, [name]: event.target.value }))} /></label>;
  const textarea = (name, label, rows = 3) => <label className="personal-file-field personal-file-field--wide"><span>{label}</span><textarea rows={rows} value={form[name] || ''} onChange={event => setForm(previous => ({ ...previous, [name]: event.target.value }))} /></label>;
  return <div className="personal-file-form-grid">
    {kind === 'documents' && <>{field('title', 'שם המסמך')}{textarea('description', 'תיאור')}</>}
    {kind === 'credentials' && <>
      {field('title', 'שם ההסמכה')}{field('issuer', 'גוף מנפיק')}{field('field', 'תחום')}
      {field('issueDate', 'תאריך הנפקה', 'date')}{field('expiryDate', 'תאריך תפוגה', 'date')}
      {field('credentialNumber', 'מספר תעודה')}{textarea('description', 'תיאור')}
    </>}
    {kind === 'experiences' && <>
      {field('workplace', 'מקום עבודה / התנסות')}{field('roleTitle', 'תפקיד')}{field('field', 'תחום')}
      {field('startDate', 'תאריך התחלה', 'date')}{field('endDate', 'תאריך סיום', 'date')}
      <label className="personal-file-check"><input type="checkbox" checked={form.isCurrent} onChange={event => setForm(previous => ({ ...previous, isCurrent: event.target.checked }))} /> עדיין עובד/ת</label>
      {field('workload', 'היקף עבודה')}{field('supervisorName', 'שם הממונה')}{field('recommendationLink', 'קישור להמלצה', 'url')}
      {textarea('description', 'תיאור התפקיד')}{textarea('responsibilitiesText', 'משימות מרכזיות — שורה לכל משימה')}{textarea('achievementsText', 'הישגים — שורה לכל הישג')}
    </>}
    {kind === 'skills' && <>
      <label className="personal-file-field"><span>מיומנות מהקטלוג</span><select value={form.skillId} onChange={event => { const skill = catalog.find(item => item.id === event.target.value); setForm(previous => ({ ...previous, skillId: event.target.value, name: skill?.name || previous.name, category: skill?.category || previous.category, description: skill?.description || previous.description })); }}><option value="">מיומנות מותאמת</option>{catalog.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {field('name', 'שם המיומנות')}
      <label className="personal-file-field"><span>קטגוריה</span><select value={form.category} onChange={event => setForm(previous => ({ ...previous, category: event.target.value }))}><option value="hard">מקצועית / קשה</option><option value="soft">רכה / אישית</option></select></label>
      <label className="personal-file-field"><span>רמת שליטה</span><select value={form.proficiency} onChange={event => setForm(previous => ({ ...previous, proficiency: event.target.value }))}>{Object.entries(PROFICIENCY_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      {field('assessmentSource', 'מקור ההערכה')}{field('evidence', 'ראיה תומכת')}{textarea('description', 'תיאור')}
      <label className="personal-file-check"><input type="checkbox" checked={form.showInCv} onChange={event => setForm(previous => ({ ...previous, showInCv: event.target.checked }))} /> להציג בקורות החיים</label>
      {canManageSkills && <button type="button" className="btn btn-secondary btn-sm" onClick={onAddCatalog}><Plus size={14} /> שמירה בקטלוג המוסדי</button>}
    </>}
    {kind === 'recommendations' && <>
      {field('recommenderName', 'שם הממליץ/ה')}{field('recommenderRole', 'תפקיד הממליץ/ה')}{field('organization', 'ארגון')}
      {field('relationship', 'הקשר לתלמיד')}{field('workPeriod', 'תקופת העבודה')}{field('recommendationDate', 'תאריך', 'date')}
      {field('contact', 'טלפון או דוא״ל')}{textarea('content', 'תוכן ההמלצה', 5)}{textarea('shortQuote', 'ציטוט קצר לקורות החיים')}
      <label className="personal-file-field"><span>תצוגה בקורות החיים</span><select value={form.cvVisibility} onChange={event => setForm(previous => ({ ...previous, cvVisibility: event.target.value }))}><option value="hidden">לא להציג</option><option value="quote">ציטוט קצר</option><option value="name_only">שם הממליץ בלבד</option><option value="full">המלצה מלאה</option></select></label>
    </>}
    {kind !== 'experiences' && kind !== 'skills' && <label className="personal-file-field"><span>סטטוס</span><select value={form.status} onChange={event => setForm(previous => ({ ...previous, status: event.target.value }))}><option value="draft">טיוטה</option><option value="pending_verification">ממתינה לאימות</option><option value="verified">מאומתת</option><option value="expired">פגה</option></select></label>}
    {canUpload && kind !== 'skills' && <label className="personal-file-upload personal-file-field--wide"><Upload size={18} /><span>{selectedFile?.name || 'בחירת קובץ מצורף (עד 25MB)'}</span><input type="file" onChange={event => setSelectedFile(event.target.files?.[0] || null)} /></label>}
  </div>;
}

export default function PersonalFileTab({ student, schoolId, access }) {
  const [items, setItems] = useState(Object.fromEntries(PERSONAL_FILE_KINDS.map(kind => [kind, []])));
  const [catalog, setCatalog] = useState([]);
  const [activeKind, setActiveKind] = useState('documents');
  const [editing, setEditing] = useState(null);
  const [showEditor, setShowEditor] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [selectedFile, setSelectedFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!access.view) return undefined;
    auditPersonalFileView({ schoolId, studentId: student.id }).catch(() => undefined);
    const unsubscribers = PERSONAL_FILE_KINDS.map(kind => subscribePersonalFileKind({
      db, schoolId, studentId: student.id, kind,
      onData: values => setItems(previous => ({ ...previous, [kind]: values })),
      onError: () => setError('לא ניתן לטעון חלק מנתוני התיק האישי.'),
    }));
    unsubscribers.push(subscribeSkillCatalog({ db, schoolId, onData: setCatalog, onError: () => setCatalog([]) }));
    return () => unsubscribers.forEach(unsubscribe => unsubscribe());
  }, [access.view, schoolId, student.id]);

  const visibleItems = useMemo(() => [...(items[activeKind] || [])]
    .filter(item => item.status !== 'archived')
    .sort((a, b) => timestampMillis(b.updatedAt) - timestampMillis(a.updatedAt)), [activeKind, items]);
  const canEdit = access.manage || access[activeKind];
  const ActiveSectionIcon = SECTION_CONFIG[activeKind].icon;

  function openForm(item = null) {
    setEditing(item);
    setForm(formFromItem(item || {}));
    setSelectedFile(null);
    setError('');
    setShowEditor(true);
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      let attachments = [...(form.attachments || [])];
      if (selectedFile) {
        if (selectedFile.size > 25 * 1024 * 1024) throw new Error('FILE_TOO_LARGE');
        attachments.push(await uploadPersonalFile({ storage, schoolId, studentId: student.id, kind: activeKind, file: selectedFile }));
      }
      const payload = {
        ...form,
        attachments,
        responsibilities: listFromText(form.responsibilitiesText),
        achievements: listFromText(form.achievementsText),
      };
      delete payload.responsibilitiesText;
      delete payload.achievementsText;
      delete payload.id;
      delete payload.schoolId;
      delete payload.studentId;
      delete payload.createdAt;
      delete payload.updatedAt;
      delete payload.createdBy;
      delete payload.updatedBy;
      delete payload.verifiedBy;
      delete payload.verifiedAt;
      await savePersonalFileItem({ schoolId, studentId: student.id, kind: activeKind, itemId: editing?.id, payload });
      setEditing(null);
      setShowEditor(false);
      setMessage('הפריט נשמר בהצלחה.');
      window.setTimeout(() => setMessage(''), 3000);
    } catch {
      setError('לא ניתן לשמור את הפריט. בדוק את השדות והקובץ המצורף.');
    } finally {
      setSaving(false);
    }
  }

  async function archive(item) {
    if (!window.confirm(`להעביר את ${SECTION_CONFIG[activeKind].singular} לארכיון?`)) return;
    try {
      await archivePersonalItem({ schoolId, studentId: student.id, kind: activeKind, itemId: item.id });
      setMessage('הפריט הועבר לארכיון ונשמר בהיסטוריה.');
    } catch {
      setError('לא ניתן להעביר את הפריט לארכיון.');
    }
  }

  async function addToCatalog() {
    if (!form.name.trim()) { setError('יש להזין שם מיומנות לפני שמירה בקטלוג.'); return; }
    try {
      const result = await saveSkillCatalogItem({ schoolId, name: form.name, category: form.category, description: form.description, status: 'active' });
      setForm(previous => ({ ...previous, skillId: result.skillId }));
      setMessage('המיומנות נוספה לקטלוג המוסדי.');
    } catch {
      setError('לא ניתן לעדכן את קטלוג המיומנויות.');
    }
  }

  if (!access.view) return <div className="student-empty-state"><ShieldCheck size={28} /><strong>התיק האישי מוגן</strong><p>אין לך הרשאה לצפות בתיק האישי של תלמיד זה.</p></div>;

  return <div className="personal-file-tab">
    {message && <div className="students-feedback students-feedback--success" role="status">{message}</div>}
    {error && <div className="students-feedback students-feedback--error" role="alert">{error}</div>}
    <nav className="personal-file-sections" aria-label="חלקי התיק האישי">{PERSONAL_FILE_KINDS.map(kind => { const Icon = SECTION_CONFIG[kind].icon; return <button type="button" key={kind} className={activeKind === kind ? 'active' : ''} onClick={() => { setActiveKind(kind); setEditing(null); setShowEditor(false); }}><Icon size={15} />{SECTION_CONFIG[kind].label}<span>{(items[kind] || []).filter(item => item.status !== 'archived').length}</span></button>; })}</nav>
    <div className="student-profile-section-heading"><h4 className="student-profile-section-title">{SECTION_CONFIG[activeKind].label}</h4>{canEdit && <button className="btn btn-primary btn-sm" onClick={() => openForm()}><Plus size={14} /> הוספה</button>}</div>
    {visibleItems.length === 0 ? <div className="student-empty-state"><ActiveSectionIcon size={25} /><strong>עדיין אין {SECTION_CONFIG[activeKind].label}</strong><p>{canEdit ? 'אפשר להוסיף את הפריט הראשון ולשמור אותו בתיק הקבוע.' : 'לא נשמרו פריטים להצגה.'}</p></div> : <div className="personal-file-list">{visibleItems.map(item => <article key={item.id} className="personal-file-card"><div className="personal-file-card-main"><strong>{itemTitle(activeKind, item)}</strong><p>{itemSummary(activeKind, item) || 'ללא תיאור נוסף'}</p><div className="personal-file-card-meta"><span>{STATUS_LABELS[item.status] || item.status}</span>{item.verifiedBy && <span><ShieldCheck size={12} /> אומת</span>}{item.showInCv && <span>מוצג בקורות החיים</span>}</div>{(item.attachments || []).map(attachment => <button type="button" className="personal-file-attachment" key={attachment.storagePath} onClick={() => downloadPersonalFile({ storage, schoolId, studentId: student.id, kind: activeKind, itemId: item.id, attachment }).catch(() => setError('לא ניתן להוריד את הקובץ.'))}><Download size={13} /> {attachment.originalName}</button>)}</div>{canEdit && <div className="personal-file-card-actions"><button className="icon-btn" onClick={() => openForm(item)} aria-label={`עריכת ${itemTitle(activeKind, item)}`}><Save size={15} /></button><button className="icon-btn icon-btn--danger" onClick={() => archive(item)} aria-label={`ארכוב ${itemTitle(activeKind, item)}`}><Archive size={15} /></button></div>}</article>)}</div>}
    {showEditor && <div className="modal-overlay" onClick={() => setShowEditor(false)}><div className="modal-content modal-content--wide" role="dialog" aria-modal="true" aria-label={`${editing ? 'עריכת' : 'הוספת'} ${SECTION_CONFIG[activeKind].singular}`} onClick={event => event.stopPropagation()}><div className="modal-header"><div><h3>{editing ? 'עריכת' : 'הוספת'} {SECTION_CONFIG[activeKind].singular}</h3><p className="students-muted">הפריט נשמר בתיק האישי הקבוע ואינו תלוי בכיתה הנוכחית.</p></div><button className="modal-close" onClick={() => setShowEditor(false)} aria-label="סגירה"><X size={18} /></button></div><form className="modal-form" onSubmit={save}><PersonalFileForm kind={activeKind} form={form} setForm={setForm} catalog={catalog} canUpload={access.upload} selectedFile={selectedFile} setSelectedFile={setSelectedFile} canManageSkills={access.manage || access.skills} onAddCatalog={addToCatalog} /><div className="modal-actions"><button className="btn btn-primary" disabled={saving}><Save size={15} /> {saving ? 'שומר…' : 'שמירה'}</button><button type="button" className="btn btn-secondary" onClick={() => setShowEditor(false)}>ביטול</button></div></form></div></div>}
  </div>;
}
