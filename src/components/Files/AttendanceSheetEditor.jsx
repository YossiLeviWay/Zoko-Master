import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronLeft, ChevronRight, CirclePlus, Eraser, Save, Settings2, Trash2, UserPlus, X, Zap } from 'lucide-react';
import { getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { schoolDoc } from '../../services/firestore/paths';
import MissingInfoMark from '../Students/MissingInfoMark';
import { createStudent, subscribeStudents } from '../../services/firestore/classStudentRepository';
import {
  addAttendanceLegendItem,
  addAttendanceMember,
  addStudentToClassSheets,
  deleteAttendanceLegendItem,
  markAttendanceDate,
  saveAttendanceCell,
  subscribeAttendanceDays,
  subscribeAttendanceLegend,
  subscribeAttendanceMembers,
  subscribeAttendanceRecords,
} from '../../services/firestore/attendanceRepository';
import { calculateAttendanceSummary, todayDateKey } from '../../utils/attendance';
import './Attendance.css';

const PAGE_SIZE = 14;
const EMPTY_CELL = { primaryStatusId: '', actionIds: [], note: '' };

function formatDate(dateKey) {
  const [, month, day] = dateKey.split('-');
  const date = new Date(`${dateKey}T12:00:00`);
  return {
    short: `${day}/${month}`,
    weekday: new Intl.DateTimeFormat('he-IL', { weekday: 'short' }).format(date),
  };
}

function formatUpdatedAt(value) {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString('he-IL') : '';
}

export default function AttendanceSheetEditor({ file, schoolId, actor, permissions, canManage, classItem }) {
  const [legend, setLegend] = useState([]);
  const [members, setMembers] = useState([]);
  const [days, setDays] = useState([]);
  const [records, setRecords] = useState([]);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [activeCell, setActiveCell] = useState(null);
  const [draft, setDraft] = useState(EMPTY_CELL);
  const [saveState, setSaveState] = useState('saved');
  const [error, setError] = useState('');
  const [showLegend, setShowLegend] = useState(false);
  const navigate = useNavigate();
  const [students, setStudents] = useState([]);
  const [brush, setBrush] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ firstName: '', lastName: '', parentPhone: '' });
  const [adding, setAdding] = useState(false);
  const [orphans, setOrphans] = useState([]);
  const [repairing, setRepairing] = useState(false);
  const [legendForm, setLegendForm] = useState({ label: '', shortCode: '', color: '#8b5cf6', type: 'action', attendanceEffect: 'neutral' });

  const isTeacher = classItem?.teacherId === actor.uid;
  const canEdit = canManage || permissions.attendance_edit || isTeacher;
  const canManageLegend = canManage || permissions.attendance_manage_legend;

  useEffect(() => {
    const common = { db, schoolId, fileId: file.id, mode: file._dataMode || 'nested', onError: () => setError('לא ניתן לטעון את נתוני הנוכחות.') };
    return [
      subscribeAttendanceLegend({ ...common, onData: setLegend }),
      subscribeAttendanceMembers({ ...common, onData: setMembers }),
      subscribeAttendanceDays({ ...common, onData: setDays }),
      subscribeAttendanceRecords({ ...common, onData: setRecords }),
    ].reduce((cleanup, unsubscribe) => () => { cleanup(); unsubscribe(); }, () => undefined);
  }, [file._dataMode, file.id, schoolId]);

  useEffect(() => {
    if (!classItem?.id) return undefined;
    return subscribeStudents({ db, schoolId, classIds: [classItem.id], canViewAll: false, onData: setStudents, onError: () => setStudents([]) });
  }, [classItem?.id, schoolId]);

  useEffect(() => {
    if (!days.length) return;
    const todayIndex = days.findIndex(day => day.dateKey >= todayDateKey());
    if (todayIndex >= 0) setPage(Math.floor(todayIndex / PAGE_SIZE));
  }, [days]);

  const activeLegend = legend.filter(item => item.active !== false);
  const statusItems = activeLegend.filter(item => item.type === 'status');
  const actionItems = activeLegend.filter(item => item.type !== 'status');
  const presentStatus = statusItems.find(item => item.attendanceEffect === 'present');
  const legendById = useMemo(() => new Map(legend.map(item => [item.id, item])), [legend]);
  const recordByCell = useMemo(() => new Map(records.map(item => [`${item.studentId}:${item.dateKey}`, item])), [records]);
  const visibleMembers = members.filter(member => member.included !== false && (!search.trim() || member.displayName?.toLowerCase().includes(search.trim().toLowerCase())));
  const pageCount = Math.max(1, Math.ceil(days.length / PAGE_SIZE));
  const visibleDays = days.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  async function quickMark(member, day, record) {
    setSaveState('saving');
    setError('');
    try {
      await saveAttendanceCell({
        db, schoolId, file, actor, studentId: member.studentId, dateKey: day.dateKey,
        value: { primaryStatusId: brush === '__clear' ? '' : brush, actionIds: record?.actionIds || [], note: record?.note || '' },
      });
      setSaveState('saved');
    } catch {
      setSaveState('error');
      setError('השינוי לא נשמר. בדקו את החיבור וההרשאות ונסו שוב.');
    }
  }

  function openCell(member, day) {
    if (day.blocked) return;
    const record = recordByCell.get(`${member.studentId}:${day.dateKey}`);
    // With a status selected in the quick bar, one tap marks the cell: no dialog.
    if (brush && canEdit) { quickMark(member, day, record); return; }
    setActiveCell({ member, day, record });
    setDraft({
      primaryStatusId: record?.primaryStatusId || '',
      actionIds: record?.actionIds || [],
      note: record?.note || '',
    });
  }

  function toggleAction(itemId) {
    setDraft(previous => ({
      ...previous,
      actionIds: previous.actionIds.includes(itemId)
        ? previous.actionIds.filter(id => id !== itemId)
        : [...previous.actionIds, itemId],
    }));
  }

  async function saveCell() {
    if (!activeCell || !canEdit) return;
    setSaveState('saving');
    setError('');
    try {
      await saveAttendanceCell({
        db,
        schoolId,
        file,
        actor,
        studentId: activeCell.member.studentId,
        dateKey: activeCell.day.dateKey,
        value: draft,
      });
      setSaveState('saved');
      setActiveCell(null);
    } catch {
      setSaveState('error');
      setError('השינוי לא נשמר. בדקו את החיבור וההרשאות ונסו שוב.');
    }
  }

  async function markAllPresent(day) {
    if (!canEdit || day.blocked) return;
    if (!presentStatus) {
      setError('כדי לסמן נוכחות קבוצתית יש להוסיף למקרא סטטוס שהשפעתו "נוכחות".');
      return;
    }
    if (!window.confirm(`לסמן את כל הכיתה כנוכחת בתאריך ${day.dateKey}?`)) return;
    setSaveState('saving');
    try {
      await markAttendanceDate({ db, schoolId, file, actor, members: visibleMembers, dateKey: day.dateKey, statusId: presentStatus.id });
      setSaveState('saved');
    } catch {
      setSaveState('error');
      setError('הסימון הקבוצתי לא נשמר.');
    }
  }

  // Sheet rows whose student card does not exist (e.g. sheets created from an older import).
  useEffect(() => {
    if (!classItem?.id || members.length === 0) { setOrphans([]); return undefined; }
    const known = new Set(students.map(item => item.id));
    const candidates = members.filter(member => member.included !== false && !known.has(member.studentId));
    if (candidates.length === 0) { setOrphans([]); return undefined; }
    let cancelled = false;
    Promise.all(candidates.map(member => getDoc(schoolDoc(db, schoolId, 'students', member.studentId)).then(snapshot => (snapshot.exists() ? null : member), () => null)))
      .then(result => { if (!cancelled) setOrphans(result.filter(Boolean)); });
    return () => { cancelled = true; };
  }, [members, students, classItem?.id, schoolId]);

  async function repairOrphans() {
    if (!orphans.length || !classItem?.id) return;
    setRepairing(true);
    setError('');
    try {
      for (const member of orphans) {
        const name = (member.displayName || '').trim();
        const [firstName, ...rest] = name.split(/\s+/);
        await createStudent({ db, schoolId, actor, studentId: member.studentId, classItem, input: { firstName: firstName || name, lastName: rest.join(' '), fullName: name, idNumber: '', phone: '', parentPhone: '', classId: classItem.id, trackIds: [], programTypes: [], additionalSubjects: [], joinedAt: member.joinedAt || todayDateKey(), endDate: '', status: 'active' } });
      }
      setOrphans([]);
    } catch {
      setError('לא ניתן ליצור את כל הכרטיסים. בדקו הרשאות ונסו שוב.');
    } finally {
      setRepairing(false);
    }
  }

  async function addStudent(event) {
    event.preventDefault();
    const fullName = `${addForm.firstName.trim()} ${addForm.lastName.trim()}`.trim();
    if (!fullName || !classItem?.id) { setError('יש להזין שם. הכיתה של הגיליון לא זוהתה.'); return; }
    setAdding(true);
    setError('');
    try {
      const input = { firstName: addForm.firstName.trim(), lastName: addForm.lastName.trim(), fullName, parentPhone: addForm.parentPhone.trim(), phone: '', idNumber: '', classId: classItem.id, trackIds: [], programTypes: [], additionalSubjects: [], joinedAt: todayDateKey(), endDate: '', status: 'active' };
      // One call creates the student card, its yearly enrolment and personal file.
      const studentId = await createStudent({ db, schoolId, actor, input, classItem });
      const student = { ...input, id: studentId };
      await addAttendanceMember({ db, schoolId, file, actor, student, classId: classItem.id });
      addStudentToClassSheets({ db, schoolId, actor, studentId, student, classItem }).catch(() => undefined); // other sheets of the same class
      setAddForm({ firstName: '', lastName: '', parentPhone: '' });
      setAddOpen(false);
    } catch {
      setError('לא ניתן להוסיף את התלמיד. בדקו הרשאות ונסו שוב.');
    } finally {
      setAdding(false);
    }
  }

  const todayDay = days.find(day => day.dateKey === todayDateKey() && !day.blocked);
  const studentCards = useMemo(() => new Map(students.map(item => [item.id, item])), [students]);

  async function addLegend(event) {
    event.preventDefault();
    if (!legendForm.label.trim() || !legendForm.shortCode.trim()) return;
    try {
      await addAttendanceLegendItem({ db, schoolId, file, actor, input: legendForm, order: legend.length });
      setLegendForm({ label: '', shortCode: '', color: '#8b5cf6', type: 'action', attendanceEffect: 'neutral' });
    } catch {
      setError('לא ניתן להוסיף פריט למקראה.');
    }
  }

  async function deleteLegendItem(item) {
    if (!canManageLegend) return;
    if (!window.confirm(`למחוק לצמיתות את "${item.label}"? לא ניתן לשחזר את הפריט לאחר המחיקה.`)) return;
    try {
      await deleteAttendanceLegendItem({ db, schoolId, fileId: file.id, itemId: item.id, mode: file._dataMode || 'nested' });
      setDraft(previous => ({
        ...previous,
        primaryStatusId: previous.primaryStatusId === item.id ? '' : previous.primaryStatusId,
        actionIds: previous.actionIds.filter(id => id !== item.id),
      }));
    } catch {
      setError('לא ניתן למחוק את פריט המקרא. בדקו את ההרשאות ונסו שוב.');
    }
  }

  function moveFocus(event, rowIndex, columnIndex) {
    const offsets = { ArrowRight: [0, -1], ArrowLeft: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
    if (!offsets[event.key]) return;
    event.preventDefault();
    const [rowOffset, columnOffset] = offsets[event.key];
    document.querySelector(`[data-att-cell="${rowIndex + rowOffset}:${columnIndex + columnOffset}"]`)?.focus();
  }

  return (
    <div className="attendance-editor" dir="rtl">
      <div className="attendance-toolbar">
        <div><strong>{file.className}</strong><span>{file.academicYear}{file.academicYearRange ? ` (${file.academicYearRange})` : ''} · {file.dateRange?.start}–{file.dateRange?.end}</span></div>
        <div className="attendance-toolbar-actions">
          <label className="attendance-search">חיפוש תלמיד<input value={search} onChange={event => setSearch(event.target.value)} /></label>
          {canEdit && classItem?.id && <button className="btn btn-secondary btn-sm" onClick={() => setAddOpen(true)}><UserPlus size={14} /> הוספת תלמיד</button>}
          <button className="btn btn-secondary btn-sm" onClick={() => setShowLegend(previous => !previous)}><Settings2 size={14} /> מקראה</button>
          <span className={`attendance-save-state attendance-save-state--${saveState}`}><Save size={13} /> {saveState === 'saving' ? 'שומר…' : saveState === 'error' ? 'שגיאה' : 'נשמר'}</span>
        </div>
      </div>

      {error && <div className="attendance-feedback attendance-feedback--error" role="alert">{error}</div>}
      {canEdit && orphans.length > 0 && <div className="attendance-feedback attendance-feedback--warning" role="status">ל־{orphans.length} תלמידים בגיליון אין עדיין כרטיס תלמיד. <button type="button" className="btn btn-secondary btn-sm" disabled={repairing} onClick={repairOrphans}>{repairing ? 'יוצר…' : 'יצירת כרטיסים'}</button></div>}
      {showLegend && (
        <aside className="attendance-legend-panel">
          <div className="attendance-legend-list">{legend.map(item => <span key={item.id} style={{ '--legend-color': item.color }}><b>{item.shortCode}</b>{item.label}{canManageLegend && <button className="icon-btn icon-btn--danger" onClick={() => deleteLegendItem(item)} aria-label={`מחיקה לצמיתות של ${item.label}`} title="מחיקה לצמיתות"><Trash2 size={12} /></button>}</span>)}</div>
          {canManageLegend && <form onSubmit={addLegend} className="attendance-legend-form"><input value={legendForm.label} onChange={event => setLegendForm(previous => ({ ...previous, label: event.target.value }))} placeholder="שם הפריט" maxLength={80} /><input value={legendForm.shortCode} onChange={event => setLegendForm(previous => ({ ...previous, shortCode: event.target.value }))} placeholder="קוד" maxLength={4} /><input type="color" value={legendForm.color} onChange={event => setLegendForm(previous => ({ ...previous, color: event.target.value }))} aria-label="צבע" /><select value={legendForm.type} onChange={event => setLegendForm(previous => ({ ...previous, type: event.target.value }))}><option value="status">סטטוס נוכחות</option><option value="action">פעולת מעקב</option><option value="event">אירוע או הערה</option></select><select value={legendForm.attendanceEffect} onChange={event => setLegendForm(previous => ({ ...previous, attendanceEffect: event.target.value }))}><option value="neutral">ללא השפעה</option><option value="present">נוכחות</option><option value="absent">היעדרות</option><option value="excused_absence">היעדרות מוצדקת</option><option value="approved_activity">פעילות מאושרת</option></select><button className="btn btn-primary btn-sm"><CirclePlus size={14} /> הוספה</button></form>}
        </aside>
      )}

      <div className="attendance-grid-wrap">
        <table className="attendance-grid">
          <thead><tr><th className="attendance-student-column">תלמיד</th>{visibleDays.map(day => { const formatted = formatDate(day.dateKey); return <th key={day.id} className={`${day.dateKey === todayDateKey() ? 'today' : ''} ${day.blocked ? 'blocked' : ''}`}><span>{formatted.weekday}</span><strong>{formatted.short}</strong>{canEdit && !day.blocked && <button onClick={() => markAllPresent(day)} title="סימון כל הכיתה כנוכחת" aria-label={`סימון כל הכיתה כנוכחת ב-${day.dateKey}`}><Check size={11} /></button>}</th>; })}<th className="attendance-summary-column">סיכום</th></tr></thead>
          <tbody>{visibleMembers.map((member, rowIndex) => {
            const memberRecords = records.filter(record => record.studentId === member.studentId);
            const summary = calculateAttendanceSummary({ days: visibleDays, records: memberRecords, legend, member });
            return <tr key={member.studentId}><th className="attendance-student-column"><button type="button" className="attendance-student-link" onClick={() => navigate(`/students?student=${member.studentId}`)} title="פתיחת כרטיס התלמיד"><strong>{member.displayName}</strong></button>{studentCards.has(member.studentId) ? <MissingInfoMark student={studentCards.get(member.studentId)} /> : null}{member.status !== 'active' && <small>{member.status}</small>}</th>{visibleDays.map((day, columnIndex) => { const record = recordByCell.get(`${member.studentId}:${day.dateKey}`); const status = legendById.get(record?.primaryStatusId); const actions = (record?.actionIds || []).map(id => legendById.get(id)).filter(Boolean); const title = [status?.label, ...actions.map(item => item.label), record?.note, record?.updatedBy ? `עודכן: ${formatUpdatedAt(record.updatedAt)}` : ''].filter(Boolean).join('\n'); return <td key={day.id} className={day.blocked ? 'blocked' : ''}><button data-att-cell={`${rowIndex}:${columnIndex}`} onKeyDown={event => moveFocus(event, rowIndex, columnIndex)} onClick={() => openCell(member, day)} disabled={day.blocked || (!canEdit && !record)} style={status ? { '--status-color': status.color } : undefined} title={title || 'ללא סימון'} aria-label={`${member.displayName}, ${day.dateKey}: ${status?.label || 'ללא סימון'}`}><span>{status?.shortCode || ''}</span>{actions.length > 0 && <small>+{actions.length}</small>}{record?.note && <i aria-label="קיימת הערה">•</i>}</button></td>; })}<td className="attendance-summary-column"><strong>{summary.attendancePercent}%</strong><span>{summary.present}/{summary.scheduled}</span><small>{summary.missing} ללא נתון</small></td></tr>;
          })}</tbody>
        </table>
        {visibleMembers.length === 0 && <div className="attendance-empty">אין תלמידים להצגה.</div>}
      </div>

      <div className="attendance-pagination"><button className="icon-btn" onClick={() => setPage(previous => Math.max(0, previous - 1))} disabled={page === 0} aria-label="טווח תאריכים קודם"><ChevronRight size={17} /></button><span>טווח {page + 1} מתוך {pageCount}</span><button className="icon-btn" onClick={() => setPage(previous => Math.min(pageCount - 1, previous + 1))} disabled={page >= pageCount - 1} aria-label="טווח תאריכים הבא"><ChevronLeft size={17} /></button></div>

      {canEdit && statusItems.length > 0 && <div className="attendance-quickbar" role="toolbar" aria-label="סימון מהיר">
        <span><Zap size={14} aria-hidden="true" /> סימון מהיר</span>
        {statusItems.map(item => <button type="button" key={item.id} aria-pressed={brush === item.id} className={brush === item.id ? 'is-active' : ''} style={{ '--legend-color': item.color }} onClick={() => setBrush(brush === item.id ? '' : item.id)}><b>{item.shortCode}</b> {item.label}</button>)}
        <button type="button" aria-pressed={brush === '__clear'} className={brush === '__clear' ? 'is-active' : ''} onClick={() => setBrush(brush === '__clear' ? '' : '__clear')}><Eraser size={14} aria-hidden="true" /> ניקוי</button>
        {presentStatus && todayDay && <button type="button" className="attendance-quickbar-all" onClick={() => markAllPresent(todayDay)}>כולם נוכחים היום</button>}
        {brush && <small>לחצו על תא כדי לסמן. לחצו שוב על הסטטוס לסיום.</small>}
      </div>}

      {addOpen && <div className="attendance-cell-overlay" onClick={() => setAddOpen(false)}>
        <form className="attendance-cell-dialog" role="dialog" aria-modal="true" aria-label="הוספת תלמיד" onClick={event => event.stopPropagation()} onSubmit={addStudent}>
          <div className="attendance-cell-header"><div><strong>הוספת תלמיד</strong><span>נוצר גם כרטיס תלמיד ושיוך לכיתה {file.className}</span></div><button type="button" className="icon-btn" onClick={() => setAddOpen(false)} aria-label="סגירה"><X size={16} /></button></div>
          <label className="attendance-note-field">שם פרטי<input required autoFocus value={addForm.firstName} onChange={event => setAddForm(previous => ({ ...previous, firstName: event.target.value }))} /></label>
          <label className="attendance-note-field">שם משפחה<input value={addForm.lastName} onChange={event => setAddForm(previous => ({ ...previous, lastName: event.target.value }))} /></label>
          <label className="attendance-note-field">טלפון הורה (אפשר להשלים אחר כך)<input type="tel" dir="ltr" value={addForm.parentPhone} onChange={event => setAddForm(previous => ({ ...previous, parentPhone: event.target.value }))} /></label>
          <div className="attendance-cell-actions"><button className="btn btn-primary" disabled={adding}>{adding ? 'מוסיף…' : 'הוספה'}</button><button type="button" className="btn btn-secondary" onClick={() => setAddOpen(false)}>ביטול</button></div>
        </form>
      </div>}

      {activeCell && (
        <div className="attendance-cell-overlay" onClick={() => setActiveCell(null)}>
          <div className="attendance-cell-dialog" role="dialog" aria-modal="true" aria-label="פרטי תא נוכחות" onClick={event => event.stopPropagation()}>
            <div className="attendance-cell-header"><div><strong>{activeCell.member.displayName}</strong><span>{activeCell.day.dateKey}</span></div><button className="icon-btn" onClick={() => setActiveCell(null)} aria-label="סגירה"><X size={17} /></button></div>
            <fieldset disabled={!canEdit}><legend>סטטוס ראשי</legend><div className="attendance-status-options"><button type="button" className={!draft.primaryStatusId ? 'selected' : ''} onClick={() => setDraft(previous => ({ ...previous, primaryStatusId: '' }))}>ללא סימון</button>{statusItems.map(item => <button type="button" key={item.id} className={draft.primaryStatusId === item.id ? 'selected' : ''} onClick={() => setDraft(previous => ({ ...previous, primaryStatusId: item.id }))} style={{ '--status-color': item.color }}><b>{item.shortCode}</b>{item.label}</button>)}</div></fieldset>
            {actionItems.length > 0 && <fieldset disabled={!canEdit}><legend>פעולות מעקב ואירועים</legend><div className="attendance-action-options">{actionItems.map(item => <label key={item.id}><input type="checkbox" checked={draft.actionIds.includes(item.id)} onChange={() => toggleAction(item.id)} /><b style={{ '--status-color': item.color }}>{item.shortCode}</b>{item.label}</label>)}</div></fieldset>}
            <label className="attendance-note-field">הערה<textarea value={draft.note} onChange={event => setDraft(previous => ({ ...previous, note: event.target.value }))} disabled={!canEdit} maxLength={2000} rows={4} /></label>
            {activeCell.record?.updatedBy && <small className="attendance-audit">עודכן לאחרונה {formatUpdatedAt(activeCell.record.updatedAt)}</small>}
            <div className="attendance-cell-actions">{canEdit && <button className="btn btn-primary" onClick={saveCell} disabled={saveState === 'saving'}>שמירה</button>}<button className="btn btn-secondary" onClick={() => setActiveCell(null)}>סגירה</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
