import { useMemo, useState } from 'react';
import { BookOpen, Plus, Save, Trash2, X } from 'lucide-react';
import { DEFAULT_TASK_PLAYBOOKS, normalizeTaskPlaybook, resolveTaskPlaybooks } from '../../config/taskPlaybooks';
import { db } from '../../firebase';
import { saveInstitutionalTaskPlaybook } from '../../services/firestore/taskAgentSettingsRepository';

const lines = value => (Array.isArray(value) ? value : []).join('\n');
const fromLines = value => [...new Set(String(value || '').split(/\n|,/u).map(item => item.trim()).filter(Boolean))];

export default function TaskPlaybookManager({ schoolId, actorId, canManage, playbooks = [], approvedRules = [], onClose, onSaved }) {
  const initial = useMemo(() => resolveTaskPlaybooks(playbooks)[0] || DEFAULT_TASK_PLAYBOOKS[0], [playbooks]);
  const [form, setForm] = useState(() => ({
    ...initial,
    domainLabelsText: lines(initial.domainLabels),
    teamAliasesText: lines(initial.primaryTeamAliases),
    supportingRolesText: lines(initial.supportingRoles),
    commonDocumentsText: lines(initial.commonDocuments),
    steps: initial.steps.map(step => ({ ...step })),
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [approvedRulesText, setApprovedRulesText] = useState(() => lines(approvedRules));

  async function save() {
    if (!canManage) return setError('אין הרשאה לשמור תבנית מוסדית.');
    setSaving(true); setError('');
    try {
      const saved = await saveInstitutionalTaskPlaybook({
        db,
        schoolId,
        actorId,
        authorized: canManage,
        currentPlaybooks: playbooks,
        approvedRules: fromLines(approvedRulesText),
        playbook: normalizeTaskPlaybook({
          ...form,
          domainLabels: fromLines(form.domainLabelsText),
          primaryTeamAliases: fromLines(form.teamAliasesText),
          supportingRoles: fromLines(form.supportingRolesText),
          commonDocuments: fromLines(form.commonDocumentsText),
        }),
      });
      onSaved?.(saved);
      onClose();
    } catch {
      setError('התבנית לא נשמרה. ודאו שיש הרשאת ניהול מוסד ונסו שוב.');
    } finally { setSaving(false); }
  }

  return <div className="modal-overlay" onClick={onClose}>
    <section className="modal-content task-playbook-manager" role="dialog" aria-modal="true" aria-labelledby="task-playbook-title" onClick={event => event.stopPropagation()}>
      <header className="modal-header"><div><span>תבנית עבודה מוסדית</span><h3 id="task-playbook-title">{form.name}</h3></div><button type="button" className="modal-close" onClick={onClose} aria-label="סגירה"><X size={18} /></button></header>
      <div className="modal-form">
        {error && <div className="task-feedback task-feedback--error" role="alert">{error}</div>}
        <div className="form-row"><label className="form-group">שם התבנית<input value={form.name} maxLength={120} onChange={event => setForm(previous => ({ ...previous, name: event.target.value }))} /></label><label className="form-group">תחום מערכת<input value={form.domain} disabled /></label></div>
        <div className="form-row"><label className="form-group">מילות זיהוי<textarea rows={4} value={form.domainLabelsText} onChange={event => setForm(previous => ({ ...previous, domainLabelsText: event.target.value }))} /></label><label className="form-group">שמות הצוות המוביל<textarea rows={4} value={form.teamAliasesText} onChange={event => setForm(previous => ({ ...previous, teamAliasesText: event.target.value }))} /></label></div>
        <div className="form-row"><label className="form-group">תפקידים תומכים<textarea rows={4} value={form.supportingRolesText} onChange={event => setForm(previous => ({ ...previous, supportingRolesText: event.target.value }))} /></label><label className="form-group">מסמכים שכיחים<textarea rows={4} value={form.commonDocumentsText} onChange={event => setForm(previous => ({ ...previous, commonDocumentsText: event.target.value }))} /></label></div>
        <label className="form-group">תנאי השלמה<input value={form.completionCriteria} maxLength={800} onChange={event => setForm(previous => ({ ...previous, completionCriteria: event.target.value }))} /></label>
        <label className="form-group">כללי עבודה מוסדיים מאושרים<textarea rows={4} value={approvedRulesText} onChange={event => setApprovedRulesText(event.target.value)} placeholder="כלל אחד בכל שורה. הכללים נשמרים רק לאחר אישור מפורש." /><small>הסוכן ייעזר רק בכללים שאושרו כאן; הוא לא ילמד מהם או ישנה אותם בעצמו.</small></label>
        <section className="task-playbook-steps"><div><h4><BookOpen size={16} /> סדר עבודה</h4><button type="button" className="btn btn-secondary btn-sm" onClick={() => setForm(previous => ({ ...previous, steps: [...previous.steps, { id: `step_${Date.now()}`, phase: 'ביצוע', title: '', party: 'team', relativeDays: 0, condition: '' }] }))}><Plus size={13} /> שלב</button></div>{form.steps.map((step, index) => <div className="task-playbook-step" key={step.id}><input aria-label="שם השלב" value={step.title} maxLength={180} onChange={event => setForm(previous => ({ ...previous, steps: previous.steps.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item) }))} /><input aria-label="שלב בתהליך" value={step.phase} maxLength={80} onChange={event => setForm(previous => ({ ...previous, steps: previous.steps.map((item, itemIndex) => itemIndex === index ? { ...item, phase: event.target.value } : item) }))} /><select aria-label="גורם מוצע" value={step.party} onChange={event => setForm(previous => ({ ...previous, steps: previous.steps.map((item, itemIndex) => itemIndex === index ? { ...item, party: event.target.value } : item) }))}><option value="team">צוות מוביל</option><option value="team_leader">ראש צוות</option><option value="homeroom">מחנכים</option><option value="administration">מנהלה ומזכירות</option><option value="homeroom_secretary">מחנכים ומזכירות</option><option value="counselor_homeroom">ייעוץ ומחנכים</option></select><button type="button" className="icon-btn icon-btn--danger" onClick={() => setForm(previous => ({ ...previous, steps: previous.steps.filter((_, itemIndex) => itemIndex !== index) }))} aria-label="מחיקת שלב"><Trash2 size={14} /></button></div>)}</section>
      </div>
      <footer className="modal-actions"><button type="button" className="btn btn-primary" onClick={save} disabled={saving}><Save size={15} /> {saving ? 'שומר…' : 'שמירת תבנית מוסדית'}</button><button type="button" className="btn btn-secondary" onClick={onClose}>ביטול</button></footer>
    </section>
  </div>;
}
