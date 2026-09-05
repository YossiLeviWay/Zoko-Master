import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Check, ChevronDown, Code2, Eye, GitCommitHorizontal, RefreshCw, Sparkles, Trash2, Users, X } from 'lucide-react';
import { listTaskPatternCandidates, reviewTaskPattern } from '../../services/adminUserService';
import {
  getInstitutionalBrain,
  isInstitutionalBrainConfigured,
  listBrainHistory,
  listBrainCandidates,
  previewBrainPattern,
  publishBrainPattern,
  rejectBrainPattern,
  restoreBrainVersion,
  syncInstitutionalBrain,
} from '../../services/taskAgentBrainService';
import './Tasks.css';

const emptyBrain = { markdown: '', sha: '' };

function editablePattern(pattern) {
  return {
    ...pattern,
    name: pattern.name || pattern.summary || '',
    keywords: pattern.keywords || [], roles: pattern.roles || [], people: pattern.people || [],
    steps: pattern.steps || [], documents: pattern.documents || [],
    contributors: pattern.contributors || pattern.sources?.map(source => source.actorName) || [],
  };
}

function CsvField({ label, value, onChange }) {
  return <label className="brain-field"><span>{label}</span><input value={(value || []).join(', ')} onChange={event => onChange(event.target.value.split(',').map(item => item.trim()).filter(Boolean))} /></label>;
}

export default function TaskPatternReviewPanel({ schoolId, knowledgeSnapshot, onClose }) {
  const [tab, setTab] = useState('candidates');
  const [patterns, setPatterns] = useState([]);
  const [brain, setBrain] = useState(emptyBrain);
  const [history, setHistory] = useState([]);
  const [expandedSource, setExpandedSource] = useState('');
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      if (isInstitutionalBrainConfigured) {
        const [candidateResult, brainResult, historyResult] = await Promise.all([listBrainCandidates(schoolId), getInstitutionalBrain(schoolId), listBrainHistory(schoolId)]);
        setPatterns((candidateResult.patterns || []).map(editablePattern));
        setBrain(brainResult || emptyBrain);
        setHistory(historyResult.versions || []);
      } else {
        const result = await listTaskPatternCandidates({ schoolId, limit: 25 });
        setPatterns((result.patterns || []).map(editablePattern));
      }
    } catch { setError('לא ניתן לטעון את מוח הסוכן כרגע. בדקו את הגדרת השירות הפרטי.'); }
    finally { setLoading(false); }
  }, [schoolId]);

  useEffect(() => { load(); }, [load]);
  const sourceCount = useMemo(() => patterns.reduce((sum, pattern) => sum + (pattern.sources?.length || pattern.evidenceCount || 0), 0), [patterns]);
  const updatePattern = (id, patch) => setPatterns(items => items.map(item => item.id === id ? { ...item, ...patch } : item));

  async function beginPreview(pattern) {
    setSaving(true); setError('');
    try {
      if (!isInstitutionalBrainConfigured) {
        await reviewTaskPattern({ schoolId, patternId: pattern.id, decision: 'approve', ...(pattern.name?.trim() ? { name: pattern.name.trim() } : {}) });
        setPatterns(items => items.filter(item => item.id !== pattern.id));
        setMessage('הדפוס אושר. חיבור המאגר הפרטי יפעיל Markdown וגרסאות.');
      } else {
        const result = await previewBrainPattern(schoolId, pattern);
        setPreview({ pattern, markdown: result.markdown });
      }
    } catch { setError('לא ניתן להכין תצוגה מקדימה.'); }
    finally { setSaving(false); }
  }

  async function publish() {
    if (!preview) return;
    setSaving(true); setError('');
    try {
      await publishBrainPattern(schoolId, preview.pattern, preview.pattern.sources?.map(source => source.id) || []);
      setPatterns(items => items.filter(item => item.id !== preview.pattern.id));
      setBrain({ markdown: preview.markdown, sha: '' }); setPreview(null); setTab('brain');
      setMessage('הידע פורסם בהצלחה למוח המוסדי הפרטי.');
    } catch { setError('הפרסום לא הושלם. ייתכן שקובץ המוח השתנה במקביל.'); }
    finally { setSaving(false); }
  }

  async function reject(pattern) {
    setSaving(true); setError('');
    try {
      if (isInstitutionalBrainConfigured) await rejectBrainPattern(schoolId, pattern.sources?.map(source => source.id) || []);
      else await reviewTaskPattern({ schoolId, patternId: pattern.id, decision: 'reject' });
      setPatterns(items => items.filter(item => item.id !== pattern.id)); setMessage('ההצעה ומקורותיה נמחקו.');
    } catch { setError('לא ניתן למחוק את ההצעה כרגע.'); }
    finally { setSaving(false); }
  }

  async function syncBrain() {
    if (!knowledgeSnapshot || !isInstitutionalBrainConfigured) return;
    setSaving(true); setError('');
    try {
      await syncInstitutionalBrain(schoolId, knowledgeSnapshot);
      setBrain(await getInstitutionalBrain(schoolId));
      setMessage('הסגל, התכניות והמסמכים סונכרנו למוח המוסדי.');
    } catch { setError('הסנכרון לא הושלם.'); }
    finally { setSaving(false); }
  }

  async function restoreVersion(version) {
    if (!window.confirm('לשחזר גרסה זו של המוח המוסדי? הגרסה הנוכחית תישמר בהיסטוריה.')) return;
    setSaving(true); setError('');
    try {
      await restoreBrainVersion(schoolId, version.sha);
      const [brainResult, historyResult] = await Promise.all([getInstitutionalBrain(schoolId), listBrainHistory(schoolId)]);
      setBrain(brainResult); setHistory(historyResult.versions || []); setTab('brain');
      setMessage('הגרסה שוחזרה ונשמרה כגרסה חדשה.');
    } catch { setError('לא ניתן לשחזר את הגרסה.'); }
    finally { setSaving(false); }
  }

  return <div className="task-edit-overlay" onClick={onClose}>
    <section className="task-pattern-review brain-manager" role="dialog" aria-modal="true" aria-labelledby="task-pattern-title" onClick={event => event.stopPropagation()}>
      <header className="brain-manager-head"><div><span><Sparkles size={15} /> ניהול ידע מוסדי</span><h2 id="task-pattern-title">מוח סוכן המשימות</h2><p>המנהל רואה את מקורות הלמידה ומחליט מה ייכנס לידע המשותף.</p></div><button type="button" className="icon-btn" onClick={onClose} aria-label="סגירה"><X size={18} /></button></header>
      <nav className="brain-tabs" aria-label="חלקי מוח הסוכן"><button className={tab === 'candidates' ? 'active' : ''} onClick={() => setTab('candidates')}><Users size={15} /> ממתין לאישור <span>{patterns.length}</span></button><button className={tab === 'brain' ? 'active' : ''} onClick={() => setTab('brain')}><BookOpen size={15} /> המוח</button><button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}><GitCommitHorizontal size={15} /> גרסאות</button></nav>
      {message && <p className="task-feedback task-feedback--success" role="status">{message}</p>}{error && <p className="task-feedback task-feedback--error" role="alert">{error}</p>}
      {!isInstitutionalBrainConfigured && <div className="brain-setup-note"><strong>למידה אישית</strong><span>הזיכרון האישי מנוהל מתוך ״הזיכרון שלי״ בזוקי. הסיוע החכם מופעל באמצעות Firebase ו‑Gemini.</span></div>}
      {loading ? <div className="brain-loading">טוען את הידע…</div> : tab === 'candidates' ? <div className="brain-candidate-view">
        <div className="brain-summary-strip"><span>{patterns.length} דפוסים</span><span>{sourceCount} מקורות</span><button type="button" className="btn btn-secondary btn-sm" onClick={load}><RefreshCw size={14} /> רענון</button></div>
        {patterns.length === 0 ? <div className="empty-state"><Sparkles size={28} /><p>אין הצעות שממתינות לאישור.</p></div> : <div className="task-pattern-list">{patterns.map(pattern => <article key={pattern.id} className="brain-candidate-card"><div className="brain-candidate-main"><label className="brain-title-field"><span>שם הדפוס</span><input value={pattern.name} maxLength={120} onChange={event => updatePattern(pattern.id, { name: event.target.value })} /></label><p>{pattern.canonicalIntent || pattern.normalizedIntent}</p><div className="brain-contributors"><Users size={14} /><strong>{pattern.contributors?.join(', ') || 'מקור מוסדי'}</strong><span>{pattern.sources?.length || pattern.evidenceCount || 0} מופעים</span></div><div className="brain-editor-grid"><CsvField label="מילות זיהוי" value={pattern.keywords} onChange={value => updatePattern(pattern.id, { keywords: value })} /><CsvField label="תפקידים" value={pattern.roles} onChange={value => updatePattern(pattern.id, { roles: value })} /><CsvField label="אנשי צוות" value={pattern.people} onChange={value => updatePattern(pattern.id, { people: value })} /><CsvField label="מסמכים" value={pattern.documents} onChange={value => updatePattern(pattern.id, { documents: value })} /><CsvField label="שלבים" value={pattern.steps} onChange={value => updatePattern(pattern.id, { steps: value })} /><label className="brain-field"><span>תזמון</span><input value={pattern.timing || ''} onChange={event => updatePattern(pattern.id, { timing: event.target.value })} /></label></div>
          {pattern.sources?.length > 0 && <div className="brain-sources"><h4>מקורות</h4>{pattern.sources.map(source => <div key={source.id}><button type="button" onClick={() => setExpandedSource(expandedSource === source.id ? '' : source.id)}><span>{source.actorName}</span><small>{source.createdAt ? new Date(source.createdAt).toLocaleDateString('he-IL') : ''}</small><ChevronDown size={14} /></button>{expandedSource === source.id && <div className="brain-source-text"><strong>הטקסט שנכתב</strong><p>{source.originalText}</p><strong>מה נשמר בפועל</strong><p>{source.savedTask?.title || 'משימה ללא כותרת'}{source.savedTask?.description ? ` — ${source.savedTask.description}` : ''}</p></div>}</div>)}</div>}
          </div><div className="brain-candidate-actions"><button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={() => beginPreview(pattern)}><Eye size={14} /> תצוגה ופרסום</button><button type="button" className="btn btn-danger btn-sm" disabled={saving} onClick={() => reject(pattern)}><Trash2 size={14} /> דחייה ומחיקה</button></div></article>)}</div>}
      </div> : tab === 'brain' ? <div className="brain-file-view"><div className="brain-file-toolbar"><div><Code2 size={16} /><strong>school-brain.md</strong><span>{brain.markdown.length.toLocaleString('he-IL')} תווים</span></div><button type="button" className="btn btn-secondary btn-sm" disabled={saving || !isInstitutionalBrainConfigured} onClick={syncBrain}><RefreshCw size={14} /> סנכרון המוסד</button></div><pre dir="rtl">{brain.markdown || 'קובץ המוח יופיע כאן לאחר חיבור המאגר הפרטי.'}</pre></div> : <div className="brain-history-view"><GitCommitHorizontal size={34} /><h3>היסטוריית הידע</h3>{history.length === 0 ? <p>גרסאות יופיעו כאן לאחר הפרסום הראשון.</p> : <div className="brain-history-list">{history.map(version => <article key={version.sha}><div><strong>{version.message || 'עדכון ידע מוסדי'}</strong><span>{version.author}{version.date ? ` · ${new Date(version.date).toLocaleString('he-IL')}` : ''}</span></div><button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={() => restoreVersion(version)}>שחזור</button></article>)}</div>}</div>}
      {preview && <div className="brain-preview-overlay"><section role="dialog" aria-modal="true" aria-label="תצוגה מקדימה של מוח הסוכן"><header><div><span><Eye size={15} /> לפני פרסום</span><h3>תצוגת school-brain.md</h3></div><button className="icon-btn" onClick={() => setPreview(null)} aria-label="סגירה"><X size={17} /></button></header><pre dir="rtl">{preview.markdown}</pre><footer><button type="button" className="btn btn-secondary" onClick={() => setPreview(null)}>חזרה לעריכה</button><button type="button" className="btn btn-primary" disabled={saving} onClick={publish}><Check size={15} /> פרסום גרסה</button></footer></section></div>}
    </section>
  </div>;
}
