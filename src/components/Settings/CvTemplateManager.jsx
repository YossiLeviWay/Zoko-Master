import { useEffect, useState } from 'react';
import { Archive, Copy, FileText, LayoutTemplate, Plus, Save, X } from 'lucide-react';
import { db } from '../../firebase';
import {
  archiveCvTemplate, cloneCvTemplate, saveCvTemplate, sharedTemplatePrivacyIssues,
  subscribeCvTemplates, TEMPLATE_PLACEHOLDERS,
} from '../../services/firestore/cvTemplateRepository';
import { CV_SECTION_LABELS, CV_SECTION_ORDER } from '../../services/firestore/cvRepository';

const emptyForm = () => ({
  id: '', name: '', description: '', type: 'design', scope: 'personal', isDefault: false,
  design: { accentColor: '#607D8B', sectionOrder: [...CV_SECTION_ORDER], sidebarSections: ['skills', 'credentials', 'education', 'languages'], showPhotoDefault: false },
  content: { summaryTemplate: '', educationText: '', experienceText: '', suggestedSkills: [] },
});

export default function CvTemplateManager({ schoolId, actorUid, access, onClose }) {
  const [templates, setTemplates] = useState([]);
  const [form, setForm] = useState(emptyForm());
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => subscribeCvTemplates({ db, schoolId, actorUid, onData: setTemplates, onError: () => setError('לא ניתן לטעון תבניות.') }), [actorUid, schoolId]);
  const privacyIssues = sharedTemplatePrivacyIssues(form);
  function edit(template) {
    setForm({ ...emptyForm(), ...template, id: template.id, design: { ...emptyForm().design, ...(template.design || {}) }, content: { ...emptyForm().content, ...(template.content || {}) } });
    setEditing(true); setError(''); setMessage('');
  }
  async function save(event) {
    event.preventDefault();
    if (privacyIssues.length > 0) { setError(`בתבנית מוסדית נמצאו: ${privacyIssues.join(', ')}. החליפו אותם בשדות דינמיים.`); return; }
    setBusy(true); setError('');
    try {
      const payload = {
        schoolId, ...(form.id ? { templateId: form.id } : {}), name: form.name,
        description: form.description, type: form.type, scope: form.scope, isDefault: form.isDefault,
        ...(form.type === 'design' ? { design: form.design } : { content: form.content }),
      };
      await saveCvTemplate(payload);
      setMessage('התבנית נשמרה'); setForm(emptyForm()); setEditing(false);
    } catch { setError('לא ניתן לשמור את התבנית. בדקו הרשאה ונתונים אישיים.'); }
    finally { setBusy(false); }
  }
  async function clone(template) {
    setBusy(true); setError('');
    try { await cloneCvTemplate({ schoolId, templateId: template.id, name: `${template.name} — עותק` }); setMessage('נוצר עותק אישי'); }
    catch { setError('לא ניתן לשכפל את התבנית.'); } finally { setBusy(false); }
  }
  async function archive(template) {
    if (!window.confirm('להעביר את התבנית לארכיון? קורות חיים קיימים לא ישתנו.')) return;
    setBusy(true); setError('');
    try { await archiveCvTemplate({ schoolId, templateId: template.id }); setMessage('התבנית הועברה לארכיון'); }
    catch { setError('לא ניתן לארכב את התבנית.'); } finally { setBusy(false); }
  }
  function insertPlaceholder(value) {
    setForm(previous => ({ ...previous, content: { ...previous.content, summaryTemplate: `${previous.content.summaryTemplate}${previous.content.summaryTemplate ? ' ' : ''}${value}` } }));
  }
  return <div className="modal-overlay" onClick={onClose}><div className="modal-content modal-content--wide cv-template-manager" role="dialog" aria-modal="true" aria-label="תבניות קורות חיים" onClick={event => event.stopPropagation()}><div className="modal-header"><div><h3>תבניות קורות חיים</h3><p>תבניות עיצוב ותוכן נשמרות בנפרד ואינן משנות גרסאות קיימות.</p></div><button className="modal-close" onClick={onClose} aria-label="סגירה"><X size={18} /></button></div><div className="modal-form">
    {error && <div className="students-feedback students-feedback--error" role="alert">{error}</div>}{message && <div className="students-feedback students-feedback--success">{message}</div>}
    {!editing ? <><div className="cv-template-toolbar">{access.create && <button className="btn btn-primary btn-sm" onClick={() => { setForm(emptyForm()); setEditing(true); }}><Plus size={14} /> תבנית חדשה</button>}</div><div className="cv-template-list"><article className="cv-template-card"><div><LayoutTemplate size={18} /><strong>קלאסי מקצועי</strong><span>תבנית עיצוב מובנית · שתי עמודות · RTL</span></div><small>ברירת המחדל הבטוחה</small></article>{templates.map(template => <article className="cv-template-card" key={template.id}><div>{template.type === 'design' ? <LayoutTemplate size={18} /> : <FileText size={18} />}<strong>{template.name}</strong><span>{template.type === 'design' ? 'עיצוב' : 'תוכן'} · {template.scope === 'school' ? 'מוסדית' : 'אישית'}{template.isDefault ? ' · ברירת מחדל' : ''}</span></div><div>{access.update && <button className="btn btn-secondary btn-sm" onClick={() => edit(template)}>עריכה</button>}{access.create && <button className="icon-btn" onClick={() => clone(template)} aria-label="שכפול"><Copy size={14} /></button>}{access.archive && <button className="icon-btn" onClick={() => archive(template)} aria-label="ארכוב"><Archive size={14} /></button>}</div></article>)}</div></> : <form onSubmit={save} className="cv-template-form"><div className="student-form-grid"><label>שם<input value={form.name} maxLength={120} required onChange={event => setForm(previous => ({ ...previous, name: event.target.value }))} /></label><label>סוג<select value={form.type} disabled={Boolean(form.id)} onChange={event => setForm(previous => ({ ...previous, type: event.target.value }))}><option value="design">תבנית עיצוב</option><option value="content">תבנית תוכן</option></select></label><label>היקף<select value={form.scope} onChange={event => setForm(previous => ({ ...previous, scope: event.target.value }))}><option value="personal">אישית</option>{access.manageSchool && <option value="school">מוסדית</option>}</select></label><label>תיאור<input value={form.description} maxLength={1000} onChange={event => setForm(previous => ({ ...previous, description: event.target.value }))} /></label></div><label className="checkbox-label"><input type="checkbox" checked={form.isDefault} onChange={event => setForm(previous => ({ ...previous, isDefault: event.target.checked }))} /> ברירת מחדל</label>
      {form.type === 'design' ? <div className="cv-template-design"><label>צבע<input type="color" value={form.design.accentColor} onChange={event => setForm(previous => ({ ...previous, design: { ...previous.design, accentColor: event.target.value } }))} /></label><fieldset><legend>סעיפים בעמודה הימנית</legend>{CV_SECTION_ORDER.map(sectionId => <label className="checkbox-label" key={sectionId}><input type="checkbox" checked={form.design.sidebarSections.includes(sectionId)} onChange={event => setForm(previous => ({ ...previous, design: { ...previous.design, sidebarSections: event.target.checked ? [...previous.design.sidebarSections, sectionId] : previous.design.sidebarSections.filter(id => id !== sectionId) } }))} />{CV_SECTION_LABELS[sectionId]}</label>)}</fieldset></div> : <><div className="cv-placeholder-list"><strong>שדות דינמיים מותרים:</strong>{TEMPLATE_PLACEHOLDERS.map(value => <button type="button" key={value} onClick={() => insertPlaceholder(value)}>{value}</button>)}</div><label>תקציר בסיסי<textarea rows={4} value={form.content.summaryTemplate} onChange={event => setForm(previous => ({ ...previous, content: { ...previous.content, summaryTemplate: event.target.value } }))} /></label><label>תיאור לימודים<textarea rows={3} value={form.content.educationText} onChange={event => setForm(previous => ({ ...previous, content: { ...previous.content, educationText: event.target.value } }))} /></label><label>תיאור ניסיון קבוע<textarea rows={3} value={form.content.experienceText} onChange={event => setForm(previous => ({ ...previous, content: { ...previous.content, experienceText: event.target.value } }))} /></label><label>מיומנויות מוצעות, שורה לכל מיומנות<textarea rows={3} value={form.content.suggestedSkills.join('\n')} onChange={event => setForm(previous => ({ ...previous, content: { ...previous.content, suggestedSkills: event.target.value.split('\n').map(value => value.trim()).filter(Boolean) } }))} /></label>{privacyIssues.length > 0 && <div className="students-feedback students-feedback--error">נמצאו פרטים שאסור לשמור בתבנית משותפת: {privacyIssues.join(', ')}. השתמשו בשדות הדינמיים.</div>}</>}
      <div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setEditing(false)}>ביטול</button><button className="btn btn-primary" disabled={busy || privacyIssues.length > 0}><Save size={14} /> שמירה</button></div></form>}
  </div></div></div>;
}
