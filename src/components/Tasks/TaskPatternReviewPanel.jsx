import { useEffect, useState } from 'react';
import { Check, Sparkles, X } from 'lucide-react';
import { listTaskPatternCandidates, reviewTaskPattern } from '../../services/adminUserService';

export default function TaskPatternReviewPanel({ schoolId, onClose }) {
  const [patterns, setPatterns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    listTaskPatternCandidates({ schoolId, limit: 25 })
      .then(result => { if (active) setPatterns(result.patterns || []); })
      .catch(() => { if (active) setError('לא ניתן לטעון את הצעות הלמידה.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [schoolId]);

  async function review(pattern, decision) {
    try {
      await reviewTaskPattern({ schoolId, patternId: pattern.id, decision, ...(pattern.name?.trim() ? { name: pattern.name.trim() } : {}) });
      setPatterns(items => items.filter(item => item.id !== pattern.id));
    } catch {
      setError('לא ניתן לעדכן את הדפוס כרגע.');
    }
  }

  return <div className="task-edit-overlay" onClick={onClose}>
    <section className="task-pattern-review" role="dialog" aria-modal="true" aria-labelledby="task-pattern-title" onClick={event => event.stopPropagation()}>
      <header><div><span><Sparkles size={15} /> למידת הסוכן</span><h2 id="task-pattern-title">דפוסים שממתינים לאישור</h2></div><button type="button" className="icon-btn" onClick={onClose} aria-label="סגירה"><X size={18} /></button></header>
      {error && <p className="task-feedback task-feedback--error" role="alert">{error}</p>}
      {loading ? <p>טוען…</p> : patterns.length === 0 ? <div className="empty-state"><p>אין דפוסים שממתינים לאישור.</p></div> : <div className="task-pattern-list">{patterns.map(pattern => <article key={pattern.id}><div><label><span className="sr-only">שם הדפוס</span><input value={pattern.name} maxLength={120} onChange={event => setPatterns(items => items.map(item => item.id === pattern.id ? { ...item, name: event.target.value } : item))} /></label><p>{pattern.normalizedIntent}</p><span>{pattern.evidenceCount} מופעים · {pattern.steps.length} שלבים</span></div><div><button type="button" className="btn btn-primary btn-sm" onClick={() => review(pattern, 'approve')}><Check size={14} /> אישור</button><button type="button" className="btn btn-secondary btn-sm" onClick={() => review(pattern, 'reject')}><X size={14} /> דחייה</button></div></article>)}</div>}
    </section>
  </div>;
}
