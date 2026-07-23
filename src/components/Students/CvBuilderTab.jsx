import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive, ArrowDown, ArrowUp, Check, Copy, Eye, EyeOff, FileDown,
  FilePlus2, LayoutTemplate, Plus, Save, ShieldCheck, Trash2, X,
} from 'lucide-react';
import { db, storage } from '../../firebase';
import { subscribePersonalFileKind } from '../../services/firestore/personalFileRepository';
import {
  archiveCv, auditCvView, createCv, createDefaultCvSnapshot, CV_SECTION_LABELS,
  downloadCvPdf, duplicateCv, finalizeCv, saveCv, subscribeCvDocuments, subscribeCvExports,
  uploadCvPdf,
} from '../../services/firestore/cvRepository';
import { createCvPdf, downloadPdfBlob } from '../../services/cvPdfService';
import { saveCvTemplate, subscribeCvTemplates } from '../../services/firestore/cvTemplateRepository';

const STATUS_LABELS = { draft: 'טיוטה', ready: 'מוכנה לבדיקה', final: 'סופית', archived: 'ארכיון' };
const EMPTY_ENTRY = {
  title: '', subtitle: '', organization: '', period: '', description: '', bullets: [],
  category: '', level: '', quote: '', contact: '', link: '',
};

function dateLabel(value) {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString('he-IL') : 'ממתין לסנכרון';
}

function normalizedEntry(item, kind) {
  if (kind === 'experiences') return {
    ...EMPTY_ENTRY, sourceId: item.id, title: item.roleTitle || item.title || '',
    organization: item.workplace || item.organization || '',
    period: [item.startDate, item.isCurrent ? 'היום' : item.endDate].filter(Boolean).join(' – '),
    description: item.description || '', bullets: [...(item.responsibilities || []), ...(item.achievements || [])],
  };
  if (kind === 'skills') return {
    ...EMPTY_ENTRY, sourceId: item.id, title: item.name || item.title || '',
    category: item.category || '', level: item.proficiency || '', description: item.description || '',
  };
  if (kind === 'credentials') return {
    ...EMPTY_ENTRY, sourceId: item.id, title: item.title || '', organization: item.issuer || '',
    period: item.issueDate || '', description: item.description || '',
  };
  return {
    ...EMPTY_ENTRY, sourceId: item.id, title: item.recommenderName || item.title || '',
    subtitle: item.recommenderRole || '', organization: item.organization || '',
    quote: item.shortQuote || '', description: item.cvVisibility === 'full' ? item.content || '' : '',
    contact: item.cvVisibility === 'full' ? item.contact || '' : '',
  };
}

function CvPreview({ snapshot }) {
  const hidden = new Set(snapshot.hiddenSections || []);
  const sidebar = new Set(snapshot.design.sidebarSections || []);
  const sections = (snapshot.sectionOrder || []).filter(id => !hidden.has(id));
  const renderSection = sectionId => {
    if (sectionId === 'summary') return snapshot.summary ? <section key={sectionId}><h4>{CV_SECTION_LABELS[sectionId]}</h4><p>{snapshot.summary}</p></section> : null;
    const entries = snapshot[sectionId] || [];
    if (entries.length === 0) return null;
    return <section key={sectionId}><h4>{CV_SECTION_LABELS[sectionId]}</h4>{entries.map((entry, index) => <article key={`${entry.sourceId || 'manual'}_${index}`}><strong>{entry.title}</strong>{entry.subtitle && <span>{entry.subtitle}</span>}{entry.organization && <span>{entry.organization}</span>}{entry.period && <small>{entry.period}</small>}{entry.description && <p>{entry.description}</p>}{entry.quote && <blockquote>“{entry.quote}”</blockquote>}{entry.bullets?.length > 0 && <ul>{entry.bullets.map((bullet, bulletIndex) => <li key={bulletIndex}>{bullet}</li>)}</ul>}</article>)}</section>;
  };
  return <div className="cv-paper" dir="rtl" style={{ '--cv-accent': snapshot.design.accentColor }}>
    <aside className="cv-paper-sidebar"><header><h2>{snapshot.personal.fullName || 'שם התלמיד'}</h2><h3>{snapshot.personal.professionalTitle || 'כותרת מקצועית'}</h3></header><div className="cv-contact">{snapshot.personal.phone && <span dir="ltr">{snapshot.personal.phone}</span>}{snapshot.personal.email && <a href={`mailto:${snapshot.personal.email}`}>{snapshot.personal.email}</a>}{snapshot.personal.city && <span>{snapshot.personal.city}</span>}{snapshot.personal.professionalLink && <a href={snapshot.personal.professionalLink}>{snapshot.personal.professionalLink}</a>}</div>{sections.filter(id => sidebar.has(id)).map(renderSection)}</aside>
    <main className="cv-paper-main">{sections.filter(id => !sidebar.has(id)).map(renderSection)}</main>
  </div>;
}

function SectionEditor({ sectionId, snapshot, onChange }) {
  const entries = snapshot[sectionId] || [];
  if (sectionId === 'summary') return <textarea rows={6} value={snapshot.summary} onChange={event => onChange({ ...snapshot, summary: event.target.value })} placeholder="תקציר אישי מאושר בלבד" />;
  const update = (index, field, value) => onChange({
    ...snapshot,
    [sectionId]: entries.map((entry, entryIndex) => entryIndex === index ? { ...entry, [field]: value } : entry),
  });
  const remove = index => onChange({ ...snapshot, [sectionId]: entries.filter((_, entryIndex) => entryIndex !== index) });
  return <div className="cv-entry-editor-list">{entries.map((entry, index) => <div className="cv-entry-editor" key={`${entry.sourceId || 'manual'}_${index}`}>
    <div className="cv-entry-editor-head"><strong>פריט {index + 1}</strong><button type="button" className="icon-btn" onClick={() => remove(index)} aria-label="הסרת פריט מהגרסה"><Trash2 size={14} /></button></div>
    <input value={entry.title || ''} onChange={event => update(index, 'title', event.target.value)} placeholder="כותרת" />
    <input value={entry.subtitle || ''} onChange={event => update(index, 'subtitle', event.target.value)} placeholder="תפקיד או כותרת משנה" />
    <input value={entry.organization || ''} onChange={event => update(index, 'organization', event.target.value)} placeholder="ארגון" />
    <input value={entry.period || ''} onChange={event => update(index, 'period', event.target.value)} placeholder="תקופה" />
    <textarea rows={3} value={entry.description || ''} onChange={event => update(index, 'description', event.target.value)} placeholder="תיאור" />
    <textarea rows={2} value={(entry.bullets || []).join('\n')} onChange={event => update(index, 'bullets', event.target.value.split('\n').map(value => value.trim()).filter(Boolean))} placeholder="נקודות מרכזיות — שורה לכל נקודה" />
  </div>)}<button type="button" className="btn btn-secondary btn-sm" onClick={() => onChange({ ...snapshot, [sectionId]: [...entries, { ...EMPTY_ENTRY }] })}><Plus size={14} /> הוספת פריט</button></div>;
}

function CvEditor({ document, student, schoolId, access, sources, templates, onClose }) {
  const [title, setTitle] = useState(document.title);
  const [purpose, setPurpose] = useState(document.purpose || '');
  const [status, setStatus] = useState(document.status === 'ready' ? 'ready' : 'draft');
  const [snapshot, setSnapshot] = useState(document.snapshot);
  const [activeSection, setActiveSection] = useState('summary');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [pdfExports, setPdfExports] = useState([]);
  const [applyTemplateId, setApplyTemplateId] = useState('');
  const dirty = useRef(false);
  const editable = access.edit && ['draft', 'ready'].includes(document.status);

  useEffect(() => { auditCvView({ schoolId, studentId: student.id, documentId: document.id }).catch(() => {}); }, [document.id, schoolId, student.id]);
  useEffect(() => {
    if (document.status !== 'final' || !document.versionNumber) return undefined;
    const versionId = `v${String(document.versionNumber).padStart(3, '0')}`;
    return subscribeCvExports({ db, schoolId, studentId: student.id, documentId: document.id, versionId, onData: setPdfExports, onError: () => setPdfExports([]) });
  }, [document.id, document.status, document.versionNumber, schoolId, student.id]);
  useEffect(() => {
    if (!editable || !dirty.current) return undefined;
    const timer = window.setTimeout(async () => {
      try {
        await saveCv({ schoolId, studentId: student.id, documentId: document.id, title, purpose, status, snapshot });
        dirty.current = false;
        setMessage('הטיוטה נשמרה אוטומטית');
      } catch { setError('השמירה האוטומטית נכשלה. השינויים נשארו במסך.'); }
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [document.id, editable, purpose, schoolId, snapshot, status, student.id, title]);

  const changeSnapshot = value => { dirty.current = true; setSnapshot(value); setMessage('שינויים ממתינים לשמירה'); };
  const changeMeta = setter => value => { dirty.current = true; setter(value); setMessage('שינויים ממתינים לשמירה'); };
  async function persistDraft() {
    await saveCv({ schoolId, studentId: student.id, documentId: document.id, title, purpose, status, snapshot });
    dirty.current = false;
  }
  async function saveNow() {
    setSaving(true); setError('');
    try { await persistDraft(); setMessage('הטיוטה נשמרה'); }
    catch { setError('לא ניתן לשמור את הטיוטה.'); }
    finally { setSaving(false); }
  }
  async function makeFinal() {
    if (!window.confirm('הגרסה תהפוך לסופית ולא תשתנה בשקט. להמשיך?')) return;
    setSaving(true); setError('');
    try {
      if (dirty.current) await persistDraft();
      await finalizeCv({ schoolId, studentId: student.id, documentId: document.id });
      setMessage('הגרסה נשמרה כסופית. עריכה עתידית תיצור עותק עבודה.');
      window.setTimeout(onClose, 800);
    } catch { setError('לא ניתן לסמן את הגרסה כסופית.'); } finally { setSaving(false); }
  }
  async function exportPdf() {
    if (document.status !== 'final' || !document.versionNumber) return;
    setSaving(true); setError(''); setMessage('מפיק PDF עברי…');
    try {
      const pdf = await createCvPdf(snapshot);
      const versionId = `v${String(document.versionNumber).padStart(3, '0')}`;
      const exportId = globalThis.crypto.randomUUID().replaceAll('-', '');
      await uploadCvPdf({
        storage, schoolId, studentId: student.id, documentId: document.id,
        versionId, exportId, filename: pdf.filename, blob: pdf.blob,
      });
      downloadPdfBlob(pdf.blob, pdf.filename);
      setMessage(`PDF נשמר בתיק האישי והורד (${pdf.pageCount} עמודים)`);
    } catch { setError('הפקת ה-PDF או שמירתו נכשלה. לא נוצר קישור ציבורי.'); }
    finally { setSaving(false); }
  }
  async function saveAsTemplate() {
    const name = window.prompt('שם תבנית העיצוב האישית', `${title} — תבנית`);
    if (!name?.trim()) return;
    setSaving(true); setError('');
    try {
      await saveCvTemplate({
        schoolId, name: name.trim(), description: `נשמרה מתוך ${title}`,
        type: 'design', scope: 'personal', isDefault: false,
        design: {
          accentColor: snapshot.design.accentColor,
          sectionOrder: snapshot.sectionOrder,
          sidebarSections: snapshot.design.sidebarSections,
          showPhotoDefault: snapshot.design.showPhoto,
        },
      });
      setMessage('העיצוב נשמר כתבנית אישית ללא פרטי התלמיד');
    } catch { setError('לא ניתן לשמור את העיצוב כתבנית.'); } finally { setSaving(false); }
  }
  function moveSection(sectionId, direction) {
    const order = [...snapshot.sectionOrder];
    const index = order.indexOf(sectionId); const next = index + direction;
    if (next < 0 || next >= order.length) return;
    [order[index], order[next]] = [order[next], order[index]];
    changeSnapshot({ ...snapshot, sectionOrder: order });
  }
  function toggleSection(sectionId) {
    const hidden = new Set(snapshot.hiddenSections || []);
    if (hidden.has(sectionId)) hidden.delete(sectionId); else hidden.add(sectionId);
    changeSnapshot({ ...snapshot, hiddenSections: [...hidden] });
  }
  function importSources(kind, sectionId) {
    const current = snapshot[sectionId] || [];
    const ids = new Set(current.map(item => item.sourceId).filter(Boolean));
    const eligible = (sources[kind] || []).filter(item => item.status !== 'archived' && (item.showInCv || item.cvVisibility !== 'hidden'));
    changeSnapshot({ ...snapshot, [sectionId]: [...current, ...eligible.filter(item => !ids.has(item.id)).map(item => normalizedEntry(item, kind))] });
  }
  function applyTemplate() {
    const template = templates.find(item => item.id === applyTemplateId);
    if (!template || !window.confirm('להחיל את התבנית על טיוטה זו בתצוגה המקדימה? גרסאות קודמות לא ישתנו.')) return;
    if (template.type === 'design') {
      changeSnapshot({ ...snapshot, sectionOrder: template.design.sectionOrder, design: { ...snapshot.design, ...template.design, templateId: template.id, templateName: template.name, showPhoto: template.design.showPhotoDefault } });
      return;
    }
    const replace = value => String(value || '').replaceAll('{{student.fullName}}', student.fullName || '').replaceAll('{{student.phone}}', student.phone || '').replaceAll('{{student.email}}', student.email || '').replaceAll('{{student.city}}', student.city || '').replaceAll('{{student.major}}', student.trackName || '').replaceAll('{{student.graduationYear}}', student.graduationYear || '').replaceAll('{{school.name}}', student.schoolName || '').replaceAll('{{class.name}}', student.className || '');
    const existingSkills = new Set(snapshot.skills.map(item => item.title));
    changeSnapshot({
      ...snapshot,
      summary: replace(template.content.summaryTemplate) || snapshot.summary,
      education: snapshot.education.map((item, index) => index === 0 && template.content.educationText ? { ...item, description: replace(template.content.educationText) } : item),
      practicalExperience: template.content.experienceText ? [{ ...EMPTY_ENTRY, description: replace(template.content.experienceText) }] : snapshot.practicalExperience,
      skills: [...snapshot.skills, ...(template.content.suggestedSkills || []).filter(name => !existingSkills.has(name)).map(name => ({ ...EMPTY_ENTRY, title: name, category: 'suggested', level: 'הצעה לאימות' }))],
      design: { ...snapshot.design, templateId: template.id, templateName: template.name },
    });
  }

  return <div className="cv-editor-shell"><div className="cv-editor-toolbar"><div><button type="button" className="icon-btn" onClick={onClose} aria-label="סגירת עורך"><X size={17} /></button><strong>{document.status === 'final' ? 'גרסה סופית' : 'עריכת קורות חיים'}</strong></div><div>{message && <span className="cv-save-state"><Check size={13} />{message}</span>}{editable && <button className="btn btn-secondary btn-sm" onClick={saveNow} disabled={saving}><Save size={14} /> שמירה</button>}{access.templatesCreate && <button className="btn btn-secondary btn-sm" onClick={saveAsTemplate} disabled={saving}><LayoutTemplate size={14} /> שמירה כתבנית</button>}{editable && access.finalize && <button className="btn btn-primary btn-sm" onClick={makeFinal} disabled={saving}><ShieldCheck size={14} /> גרסה סופית</button>}{document.status === 'final' && access.exportPdf && <button className="btn btn-primary btn-sm" onClick={exportPdf} disabled={saving}><FileDown size={14} /> הפקת PDF</button>}</div></div>{error && <div className="students-feedback students-feedback--error" role="alert">{error}</div>}
    <div className="cv-editor-grid"><div className="cv-editor-form"><div className="cv-editor-meta"><label>שם המסמך<input value={title} disabled={!editable} onChange={event => changeMeta(setTitle)(event.target.value)} /></label><label>מטרת הגרסה<input value={purpose} disabled={!editable} onChange={event => changeMeta(setPurpose)(event.target.value)} placeholder="למשל: משרה טכנית" /></label><label>מצב<select value={status} disabled={!editable} onChange={event => changeMeta(setStatus)(event.target.value)}><option value="draft">טיוטה</option><option value="ready">מוכנה לבדיקה</option></select></label></div>
      {editable && templates.length > 0 && <div className="cv-apply-template"><select value={applyTemplateId} onChange={event => setApplyTemplateId(event.target.value)}><option value="">החלת עדכון מתבנית…</option>{templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select><button type="button" className="btn btn-secondary btn-sm" disabled={!applyTemplateId} onClick={applyTemplate}>החלה לתצוגה מקדימה</button></div>}
      {document.status === 'final' && <div className="cv-export-list"><strong>קובצי PDF שהופקו</strong>{pdfExports.length === 0 ? <span>עדיין לא הופק PDF לגרסה זו.</span> : pdfExports.map(item => <button type="button" key={item.id} onClick={() => downloadCvPdf({ storage, schoolId, studentId: student.id, documentId: document.id, attachment: item.attachment })}><FileDown size={14} />{item.attachment?.originalName || 'קובץ PDF'}</button>)}</div>}
      <fieldset disabled={!editable}><legend>פרטים אישיים בגרסה</legend><div className="cv-personal-grid">{[['fullName', 'שם מלא'], ['professionalTitle', 'כותרת מקצועית'], ['phone', 'טלפון'], ['email', 'דוא״ל'], ['city', 'עיר'], ['birthDate', 'תאריך לידה'], ['professionalLink', 'קישור מקצועי']].map(([field, label]) => <label key={field}>{label}<input value={snapshot.personal[field] || ''} onChange={event => changeSnapshot({ ...snapshot, personal: { ...snapshot.personal, [field]: event.target.value } })} /></label>)}</div><label className="cv-color-field">צבע תבנית<input type="color" value={snapshot.design.accentColor} onChange={event => changeSnapshot({ ...snapshot, design: { ...snapshot.design, accentColor: event.target.value } })} /></label><label className="checkbox-label"><input type="checkbox" checked={snapshot.design.showPhoto} onChange={event => changeSnapshot({ ...snapshot, design: { ...snapshot.design, showPhoto: event.target.checked } })} /> הצגת תמונה, אם קיימת ומאושרת</label></fieldset>
      <div className="cv-section-order">{snapshot.sectionOrder.map((sectionId, index) => <div key={sectionId} className={activeSection === sectionId ? 'active' : ''}><button type="button" onClick={() => setActiveSection(sectionId)}>{CV_SECTION_LABELS[sectionId]}</button><button type="button" onClick={() => toggleSection(sectionId)} aria-label={`${(snapshot.hiddenSections || []).includes(sectionId) ? 'הצגת' : 'הסתרת'} ${CV_SECTION_LABELS[sectionId]}`}>{(snapshot.hiddenSections || []).includes(sectionId) ? <EyeOff size={13} /> : <Eye size={13} />}</button><button type="button" disabled={index === 0} onClick={() => moveSection(sectionId, -1)} aria-label="הזזה למעלה"><ArrowUp size={13} /></button><button type="button" disabled={index === snapshot.sectionOrder.length - 1} onClick={() => moveSection(sectionId, 1)} aria-label="הזזה למטה"><ArrowDown size={13} /></button></div>)}</div>
      {editable && access.personalView && <div className="cv-import-row">{activeSection === 'experiences' && <button className="btn btn-secondary btn-sm" onClick={() => importSources('experiences', 'experiences')}>בחירת ניסיון מהתיק</button>}{activeSection === 'skills' && <button className="btn btn-secondary btn-sm" onClick={() => importSources('skills', 'skills')}>בחירת מיומנויות מהתיק</button>}{activeSection === 'credentials' && <button className="btn btn-secondary btn-sm" onClick={() => importSources('credentials', 'credentials')}>בחירת הסמכות מהתיק</button>}{activeSection === 'recommendations' && <button className="btn btn-secondary btn-sm" onClick={() => importSources('recommendations', 'recommendations')}>בחירת המלצות מהתיק</button>}</div>}
      <fieldset disabled={!editable}><legend>{CV_SECTION_LABELS[activeSection]}</legend><SectionEditor sectionId={activeSection} snapshot={snapshot} onChange={changeSnapshot} /></fieldset>
    </div><div className="cv-preview-panel"><div className="cv-preview-label">תצוגה מקדימה חיה · A4</div><CvPreview snapshot={snapshot} /></div></div>
  </div>;
}

export default function CvBuilderTab({ student, schoolId, actorUid, access }) {
  const [documents, setDocuments] = useState([]);
  const [activeDocument, setActiveDocument] = useState(null);
  const [sources, setSources] = useState({ credentials: [], experiences: [], skills: [], recommendations: [] });
  const [templates, setTemplates] = useState([]);
  const [newTemplateId, setNewTemplateId] = useState('classic_professional');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => subscribeCvDocuments({ db, schoolId, studentId: student.id, onData: setDocuments, onError: () => setError('לא ניתן לטעון את קורות החיים.') }), [schoolId, student.id]);
  useEffect(() => {
    if (!access.templatesView) return undefined;
    return subscribeCvTemplates({ db, schoolId, actorUid, onData: setTemplates, onError: () => {} });
  }, [access.templatesView, actorUid, schoolId]);
  useEffect(() => {
    if (!access.personalView) return undefined;
    return ['credentials', 'experiences', 'skills', 'recommendations'].map(kind => subscribePersonalFileKind({
      db, schoolId, studentId: student.id, kind,
      onData: items => setSources(previous => ({ ...previous, [kind]: items })), onError: () => {},
    })).reduce((unsubscribeAll, unsubscribe) => () => { unsubscribeAll(); unsubscribe(); }, () => {});
  }, [access.personalView, schoolId, student.id]);
  const visible = useMemo(() => documents.filter(document => document.status !== 'archived'), [documents]);

  async function createNew() {
    const title = window.prompt('שם גרסת קורות החיים', 'קורות חיים כלליים');
    if (!title?.trim()) return;
    setBusy(true); setError('');
    try {
      let snapshot = createDefaultCvSnapshot(student);
      const template = templates.find(item => item.id === newTemplateId);
      if (template?.type === 'design') snapshot = { ...snapshot, sectionOrder: template.design.sectionOrder, design: { ...snapshot.design, ...template.design, templateId: template.id, templateName: template.name, showPhoto: template.design.showPhotoDefault } };
      if (template?.type === 'content') {
        const replace = value => String(value || '').replaceAll('{{student.fullName}}', student.fullName || '').replaceAll('{{student.phone}}', student.phone || '').replaceAll('{{student.email}}', student.email || '').replaceAll('{{student.city}}', student.city || '').replaceAll('{{student.major}}', student.trackName || '').replaceAll('{{student.graduationYear}}', student.graduationYear || '').replaceAll('{{school.name}}', student.schoolName || '').replaceAll('{{class.name}}', student.className || '');
        snapshot = { ...snapshot, summary: replace(template.content.summaryTemplate), practicalExperience: template.content.experienceText ? [{ ...EMPTY_ENTRY, description: replace(template.content.experienceText) }] : [], skills: (template.content.suggestedSkills || []).map(name => ({ ...EMPTY_ENTRY, title: name, category: 'suggested', level: 'הצעה לאימות' })), design: { ...snapshot.design, templateId: template.id, templateName: template.name } };
      }
      const result = await createCv({ schoolId, studentId: student.id, title: title.trim(), purpose: '', templateId: template?.id || 'classic_professional', snapshot });
      setActiveDocument({ id: result.documentId, title: title.trim(), purpose: '', status: 'draft', versionNumber: 0, snapshot });
    } catch { setError('לא ניתן ליצור קורות חיים חדשים.'); } finally { setBusy(false); }
  }
  async function duplicate(document) {
    setBusy(true); setError('');
    try {
      const result = await duplicateCv({ schoolId, studentId: student.id, documentId: document.id, title: `${document.title} — עותק עבודה` });
      setActiveDocument({ ...document, id: result.documentId, title: `${document.title} — עותק עבודה`, status: 'draft' });
    } catch { setError('לא ניתן לשכפל את הגרסה.'); } finally { setBusy(false); }
  }
  async function archive(document) {
    if (!window.confirm('להעביר את הטיוטה לארכיון? המידע לא יימחק.')) return;
    setBusy(true); setError('');
    try { await archiveCv({ schoolId, studentId: student.id, documentId: document.id }); }
    catch { setError('לא ניתן להעביר את הטיוטה לארכיון.'); } finally { setBusy(false); }
  }

  if (activeDocument) return <CvEditor document={activeDocument} student={student} schoolId={schoolId} access={access} sources={sources} templates={templates} onClose={() => setActiveDocument(null)} />;
  return <section className="personal-file-tab cv-builder-tab"><div className="personal-file-heading"><div><h4>קורות חיים</h4><p>כל גרסה שומרת snapshot עצמאי ואינה משנה את נתוני המקור בתיק האישי.</p></div>{access.create && <div className="cv-new-actions"><select value={newTemplateId} onChange={event => setNewTemplateId(event.target.value)} aria-label="תבנית לגרסה חדשה"><option value="classic_professional">קלאסי מקצועי</option>{templates.map(template => <option value={template.id} key={template.id}>{template.name}</option>)}</select><button className="btn btn-primary btn-sm" onClick={createNew} disabled={busy}><FilePlus2 size={15} /> קורות חיים חדשים</button></div>}</div>{error && <div className="students-feedback students-feedback--error" role="alert">{error}</div>}
    {visible.length === 0 ? <div className="student-empty-state"><FileDown size={28} /><strong>עדיין לא נוצרו קורות חיים</strong><p>התחילו בגרסת ״קלאסי מקצועי״, ערכו את הנוסח ושמרו טיוטה.</p>{access.create && <button className="btn btn-primary btn-sm" onClick={createNew}>יצירת גרסה ראשונה</button>}</div> : <div className="cv-document-list">{visible.map(document => <article className="cv-document-card" key={document.id}><div><span className={`cv-status cv-status--${document.status}`}>{STATUS_LABELS[document.status] || document.status}</span><h5>{document.title}</h5><p>{document.purpose || 'ללא מטרה מוגדרת'}</p><small>עודכן: {dateLabel(document.updatedAt)}{document.versionNumber ? ` · גרסה ${document.versionNumber}` : ''}</small></div><div className="cv-document-actions"><button className="btn btn-secondary btn-sm" onClick={() => setActiveDocument(document)}><Eye size={14} /> {document.status === 'final' ? 'צפייה' : 'פתיחה'}</button>{access.create && <button className="icon-btn" onClick={() => duplicate(document)} aria-label="שכפול גרסה"><Copy size={15} /></button>}{access.deleteDraft && ['draft', 'ready'].includes(document.status) && <button className="icon-btn" onClick={() => archive(document)} aria-label="העברה לארכיון"><Archive size={15} /></button>}</div></article>)}</div>}
  </section>;
}

export { CvPreview };
