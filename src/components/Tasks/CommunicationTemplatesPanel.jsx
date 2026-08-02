import { useEffect, useMemo, useState } from 'react';
import { Archive, BookOpen, Pencil, Plus, Save } from 'lucide-react';
import {
  archiveCommunicationTemplate,
  COMMUNICATION_TEMPLATE_SCOPE,
  renderCommunicationTemplate,
  saveCommunicationTemplate,
  subscribeCommunicationTemplates,
} from '../../services/firestore/communicationTemplateRepository';

const EMPTY_TEMPLATE = { name: '', category: '', subjectTemplate: '', bodyTemplate: '', tone: 'respectful', scope: 'private' };

export default function CommunicationTemplatesPanel({
  db,
  schoolId,
  userId,
  currentForm,
  canManageInstitutional,
  onApply,
  onSuccess,
  onError,
}) {
  const [templates, setTemplates] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [editingId, setEditingId] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editor, setEditor] = useState(EMPTY_TEMPLATE);
  const [saving, setSaving] = useState(false);
  const selected = useMemo(() => templates.find(item => item.id === selectedId), [selectedId, templates]);

  useEffect(() => subscribeCommunicationTemplates({
    db,
    schoolId,
    userId,
    includeInstitutional: true,
    onData: setTemplates,
    onError: () => onError('לא ניתן לטעון את תבניות המייל.'),
  }), [db, onError, schoolId, userId]);

  function applySelected() {
    if (!selected) return;
    onApply(renderCommunicationTemplate(selected, {
      subject: currentForm.subject,
      context: currentForm.summary || currentForm.subject,
    }));
  }

  function beginEdit(template) {
    setEditorOpen(true);
    if (!template || template.builtin) {
      setEditingId('');
      setEditor({ ...EMPTY_TEMPLATE, subjectTemplate: currentForm.subject, bodyTemplate: currentForm.body });
      return;
    }
    setEditingId(template.id);
    setEditor({
      name: template.name || '',
      category: template.category || '',
      subjectTemplate: template.subjectTemplate || '',
      bodyTemplate: template.bodyTemplate || '',
      tone: template.tone || 'respectful',
      scope: template.scope,
    });
  }

  async function save() {
    setSaving(true);
    try {
      await saveCommunicationTemplate({
        db,
        schoolId,
        userId,
        templateId: editingId,
        scope: editor.scope,
        input: editor,
        canManageInstitutional,
      });
      setEditingId('');
      setEditorOpen(false);
      setEditor(EMPTY_TEMPLATE);
      onSuccess('התבנית נשמרה.');
    } catch {
      onError('לא ניתן לשמור את התבנית או שאין הרשאה לתבנית מוסדית.');
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!selected || selected.builtin) return;
    setSaving(true);
    try {
      await archiveCommunicationTemplate({ db, schoolId, userId, template: selected, canManageInstitutional });
      setSelectedId('');
      onSuccess('התבנית הועברה לארכיון.');
    } catch {
      onError('לא ניתן לארכב את התבנית.');
    } finally {
      setSaving(false);
    }
  }

  return <details className="communication-templates">
    <summary><BookOpen size={15} /> תבניות מייל</summary>
    <div className="communication-template-picker"><select value={selectedId} onChange={event => setSelectedId(event.target.value)}><option value="">בחירת תבנית...</option><optgroup label="תבניות מובנות">{templates.filter(item => item.builtin).map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</optgroup><optgroup label="התבניות שלי">{templates.filter(item => item.scope === COMMUNICATION_TEMPLATE_SCOPE.PRIVATE).map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</optgroup><optgroup label="תבניות מוסדיות">{templates.filter(item => item.scope === COMMUNICATION_TEMPLATE_SCOPE.INSTITUTIONAL).map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</optgroup></select><button type="button" className="btn btn-secondary btn-sm" onClick={applySelected} disabled={!selected}>החלה</button>{selected && !selected.builtin && <button type="button" className="btn btn-secondary btn-sm" onClick={() => beginEdit(selected)}><Pencil size={13} /> עריכה</button>}{selected && !selected.builtin && <button type="button" className="btn btn-secondary btn-sm" onClick={archive} disabled={saving}><Archive size={13} /> ארכוב</button>}</div>
    <button type="button" className="communication-template-new" onClick={() => beginEdit(null)}><Plus size={14} /> שמירת הטיוטה כתבנית חדשה</button>
    {editorOpen && <div className="communication-template-editor"><input value={editor.name} onChange={event => setEditor(previous => ({ ...previous, name: event.target.value }))} placeholder="שם התבנית" maxLength={120} /><input value={editor.category} onChange={event => setEditor(previous => ({ ...previous, category: event.target.value }))} placeholder="קטגוריה" maxLength={80} /><select value={editor.scope} onChange={event => setEditor(previous => ({ ...previous, scope: event.target.value }))} disabled={Boolean(editingId)}><option value="private">פרטית שלי</option>{canManageInstitutional && <option value="institutional">מוסדית</option>}</select><input value={editor.subjectTemplate} onChange={event => setEditor(previous => ({ ...previous, subjectTemplate: event.target.value }))} placeholder="נושא" maxLength={300} /><textarea value={editor.bodyTemplate} onChange={event => setEditor(previous => ({ ...previous, bodyTemplate: event.target.value }))} placeholder="תוכן התבנית" maxLength={10000} /><div><small>אפשר להשתמש במשתנים: {'{{context}}'}, {'{{subject}}'}, {'{{name}}'}, {'{{organization}}'}</small><button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={saving || !editor.name.trim() || !editor.bodyTemplate.trim()}><Save size={14} /> {saving ? 'שומר...' : 'שמירה'}</button></div></div>}
  </details>;
}
