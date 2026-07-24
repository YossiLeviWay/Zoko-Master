import { useEffect, useMemo, useState } from 'react';
import { Calculator, Plus, Save, Trash2 } from 'lucide-react';
import { db } from '../../firebase';
import { subscribeStudents } from '../../services/firestore/classStudentRepository';
import {
  saveGradebookSubjects,
  saveStudentGrades,
  subscribeGradebook,
  subscribeGradebookGrades,
} from '../../services/firestore/gradebookRepository';
import { calculateGradebook, calculateSubjectGrade } from '../../utils/gradeFormula';
import './GradeMapping.css';

function createId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function newSubject() {
  return {
    id: createId('subject'),
    name: 'מקצוע חדש',
    formula: '',
    components: [{ id: createId('component'), name: 'ציון', weight: 100 }],
  };
}

function scoreKey(subjectId, componentId) {
  return `${subjectId}.${componentId}`;
}

export default function GradeMappingEditor({
  file,
  schoolId,
  actor,
  canEditScores = false,
  canManageConfig = false,
  studentOnly = null,
}) {
  const gradebookId = file?.gradebookId || file?.id?.replace(/^gradebook_/, '');
  const [gradebook, setGradebook] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [students, setStudents] = useState(studentOnly ? [studentOnly] : []);
  const [rows, setRows] = useState({});
  const [savingConfig, setSavingConfig] = useState(false);
  const [savingStudentId, setSavingStudentId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => subscribeGradebook({
    db, schoolId, gradebookId,
    onData: value => {
      setGradebook(value);
      setSubjects(value?.subjects || []);
    },
    onError: () => setError('לא ניתן לטעון את הגדרת מיפוי הציונים.'),
  }), [gradebookId, schoolId]);

  useEffect(() => subscribeGradebookGrades({
    db, schoolId, gradebookId,
    onData: items => setRows(Object.fromEntries(items.map(item => [item.studentId || item.id, item]))),
    onError: () => setError('לא ניתן לטעון את ציוני התלמידים.'),
  }), [gradebookId, schoolId]);

  useEffect(() => {
    if (studentOnly) {
      setStudents([studentOnly]);
      return undefined;
    }
    if (!file?.classId) return undefined;
    return subscribeStudents({
      db,
      schoolId,
      classIds: [file.classId],
      canViewAll: false,
      onData: items => setStudents(items.filter(item => item.classId === file.classId && item.status !== 'archived')),
      onError: () => setError('לא ניתן לטעון את תלמידי הכיתה.'),
    });
  }, [file?.classId, schoolId, studentOnly]);

  const orderedStudents = useMemo(() => [...students].sort((a, b) => (
    (a.fullName || '').localeCompare(b.fullName || '', 'he')
  )), [students]);

  function updateSubject(subjectId, patch) {
    setSubjects(previous => previous.map(subject => subject.id === subjectId ? { ...subject, ...patch } : subject));
  }

  function updateComponent(subjectId, componentId, patch) {
    setSubjects(previous => previous.map(subject => subject.id !== subjectId ? subject : {
      ...subject,
      components: subject.components.map(component => component.id === componentId ? { ...component, ...patch } : component),
    }));
  }

  function addComponent(subjectId) {
    setSubjects(previous => previous.map(subject => subject.id !== subjectId ? subject : {
      ...subject,
      components: [...subject.components, { id: createId('component'), name: 'רכיב חדש', weight: 0 }],
    }));
  }

  async function saveConfig() {
    const invalid = subjects.some(subject => !subject.name.trim() || subject.components.length === 0 || subject.components.some(component => !component.name.trim()));
    if (invalid) {
      setError('לכל מקצוע ורכיב חייב להיות שם, ולכל מקצוע חייב להיות לפחות רכיב אחד.');
      return;
    }
    setSavingConfig(true);
    setError('');
    try {
      await saveGradebookSubjects({ db, schoolId, gradebookId, actor, subjects });
      setMessage('מבנה המיפוי נשמר.');
      window.setTimeout(() => setMessage(''), 2500);
    } catch {
      setError('לא ניתן לשמור את מבנה המיפוי. בדקו הרשאות ותקינות הנוסחאות.');
    } finally {
      setSavingConfig(false);
    }
  }

  function setScore(studentId, subjectId, componentId, value) {
    if (value !== '' && (!/^\d{0,3}(?:\.\d{0,2})?$/.test(value) || Number(value) > 100)) return;
    setRows(previous => {
      const current = previous[studentId] || { studentId, scores: {} };
      return {
        ...previous,
        [studentId]: {
          ...current,
          scores: {
            ...(current.scores || {}),
            [subjectId]: {
              ...(current.scores?.[subjectId] || {}),
              [componentId]: value,
            },
          },
        },
      };
    });
  }

  async function persistStudent(student) {
    const scores = rows[student.id]?.scores || {};
    setSavingStudentId(student.id);
    setError('');
    try {
      await saveStudentGrades({
        db, schoolId, gradebookId, actor, student,
        scores,
        calculated: calculateGradebook(subjects, scores),
      });
    } catch {
      setError(`לא ניתן לשמור את הציונים של ${student.fullName}.`);
    } finally {
      setSavingStudentId('');
    }
  }

  if (!gradebook) return <div className="gradebook-empty">טוען מיפוי ציונים…</div>;

  return (
    <div className={`gradebook-editor ${studentOnly ? 'gradebook-editor--student' : ''}`} dir="rtl">
      <div className="gradebook-toolbar">
        <div><h3><Calculator size={18} /> מיפוי ציונים · {gradebook.className}</h3><p>{gradebook.academicYearLabel || gradebook.academicYearRange || 'שנת הלימודים הפעילה'}</p></div>
        {canManageConfig && <button className="btn btn-primary btn-sm" onClick={saveConfig} disabled={savingConfig}><Save size={14} /> {savingConfig ? 'שומר…' : 'שמירת מבנה'}</button>}
      </div>
      {message && <div className="students-feedback students-feedback--success" role="status">{message}</div>}
      {error && <div className="students-feedback students-feedback--error" role="alert">{error}</div>}

      {canManageConfig && !studentOnly && (
        <section className="gradebook-config" aria-label="הגדרת מקצועות וחישובים">
          {subjects.map(subject => {
            const totalWeight = subject.components.reduce((sum, component) => sum + (Number(component.weight) || 0), 0);
            return <article key={subject.id} className="gradebook-subject-config">
              <div className="gradebook-subject-heading"><input value={subject.name} maxLength={80} aria-label="שם מקצוע" onChange={event => updateSubject(subject.id, { name: event.target.value })} /><span className={totalWeight === 100 ? 'valid' : 'invalid'}>{totalWeight}%</span><button className="icon-btn icon-btn--danger" onClick={() => setSubjects(previous => previous.filter(item => item.id !== subject.id))} aria-label={`הסרת ${subject.name}`}><Trash2 size={14} /></button></div>
              <div className="gradebook-components-config">{subject.components.map((component, index) => <div key={component.id}><b>C{index + 1}</b><input value={component.name} maxLength={60} aria-label={`שם רכיב C${index + 1}`} onChange={event => updateComponent(subject.id, component.id, { name: event.target.value })} /><label><input type="number" min="0" max="100" step="0.01" value={component.weight} onChange={event => updateComponent(subject.id, component.id, { weight: event.target.value })} />%</label><button className="icon-btn" disabled={subject.components.length === 1} onClick={() => updateSubject(subject.id, { components: subject.components.filter(item => item.id !== component.id) })} aria-label={`הסרת ${component.name}`}><Trash2 size={13} /></button></div>)}</div>
              <div className="gradebook-formula-row"><button className="btn btn-secondary btn-sm" onClick={() => addComponent(subject.id)}><Plus size={13} /> רכיב</button><label>נוסחה אופציונלית<input dir="ltr" value={subject.formula || ''} placeholder="C1*30% + C2*70%" onChange={event => updateSubject(subject.id, { formula: event.target.value })} /></label><small>ניתן להשתמש ב־C1, C2 וכן הלאה, בסוגריים ובפעולות + − × ÷. ללא נוסחה יחושב ממוצע משוקלל לפי האחוזים.</small></div>
            </article>;
          })}
          <button className="btn btn-secondary btn-sm" onClick={() => setSubjects(previous => [...previous, newSubject()])}><Plus size={14} /> מקצוע נוסף</button>
        </section>
      )}

      {subjects.length === 0 ? <div className="gradebook-empty">עדיין לא הוגדרו מקצועות במיפוי.{canManageConfig ? ' הוסיפו מקצוע כדי להתחיל.' : ''}</div> : (
        <div className="gradebook-table-wrap"><table className="gradebook-table"><thead><tr><th rowSpan="2">שם התלמיד</th>{subjects.map(subject => <th key={subject.id} colSpan={subject.components.length + 1}>{subject.name}</th>)}</tr><tr>{subjects.flatMap(subject => [...subject.components.map((component, index) => <th key={scoreKey(subject.id, component.id)}>{component.name}<small>C{index + 1} · {component.weight || 0}%</small></th>), <th key={`${subject.id}_final`} className="gradebook-final">ציון סופי</th>])}</tr></thead><tbody>{orderedStudents.map(student => {
          const scores = rows[student.id]?.scores || {};
          return <tr key={student.id}><th>{student.fullName}{savingStudentId === student.id && <small>שומר…</small>}</th>{subjects.flatMap(subject => [...subject.components.map(component => <td key={scoreKey(subject.id, component.id)}><input aria-label={`${student.fullName} ${subject.name} ${component.name}`} inputMode="decimal" value={scores[subject.id]?.[component.id] ?? ''} readOnly={!canEditScores} onChange={event => setScore(student.id, subject.id, component.id, event.target.value)} onBlur={() => canEditScores && persistStudent(student)} /></td>), <td key={`${subject.id}_final`} className="gradebook-final">{(() => { try { return calculateSubjectGrade(subject, scores[subject.id] || {}) ?? '—'; } catch { return 'שגיאה'; } })()}</td>])}</tr>;
        })}</tbody></table></div>
      )}
    </div>
  );
}
