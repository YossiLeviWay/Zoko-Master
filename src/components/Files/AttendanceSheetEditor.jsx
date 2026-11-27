import { useEffect, useMemo, useRef, useState } from 'react';
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
  addMissingClassStudentsToSheet,
  deleteAttendanceLegendItem,
  markAttendanceDate,
  saveAttendanceCell,
  subscribeAttendanceDays,
  subscribeAttendanceLegend,
  subscribeAttendanceMembers,
  subscribeAttendanceRecords,
} from '../../services/firestore/attendanceRepository';
import { attendanceRowStatus, calculateAttendanceSummary, todayDateKey } from '../../utils/attendance';
import { subscribeStudentEnrollments } from '../../services/firestore/studentLifecycleRepository';
import './Attendance.css';

const PAGE_SIZE = 14;
const EMPTY_CELL = { primaryStatusId: '', actionIds: [], note: '' };
const STATUS_LABELS = { active: 'פעיל', transferred: 'עבר/ה', graduated: 'בוגר/ת', withdrawn: 'עזב/ה', dropout: 'נשר/ה', archived: 'בארכיון' };

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
  const [enrollments, setEnrollments] = useState([]);
  const [brush, setBrush] = useState('');
  // Phones get a one-day view: a list of students with large status buttons instead of the wide grid.
  const [dayMode, setDayMode] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(max-width: 768px)').matches));
  const [dayKey, setDayKey] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ firstName: '', lastName: '', parentPhone: '' });
  const [adding, setAdding] = useState(false);
  const [orphans, setOrphans] = useState([]);
  const [repairing, setRepairing] = useState(false);
  // Sync must only compare the two lists after both arrived from the database.
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [studentsLoaded, setStudentsLoaded] = useState(false);
  const syncAttempted = useRef(new Set());
  const [legendForm, setLegendForm] = useState({ label: '', shortCode: '', color: '#8b5cf6', type: 'action', attendanceEffect: 'neutral' });

  const isTeacher = classItem?.teacherId === actor.uid;
  const canEdit = canManage || permissions.attendance_edit || isTeacher;
  const canManageLegend = canManage || permissions.attendance_manage_legend;
  // Adding a student is a student permission, not an attendance one. The database rules enforce it too.
  const canAddStudents = Boolean(canManage || permissions.students_create || permissions['students.create']);

  useEffect(() => {
    const common = { db, schoolId, fileId: file.id, mode: file._dataMode || 'nested', onError: () => setError('לא ניתן לטעון את נתוני הנוכחות.') };
    setMembersLoaded(false);
    syncAttempted.current = new Set();
    return [
      subscribeAttendanceLegend({ ...common, onData: setLegend }),
      subscribeAttendanceMembers({ ...common, onData: items => { setMembers(items); setMembersLoaded(true); } }),
      subscribeAttendanceDays({ ...common, onData: setDays }),
      subscribeAttendanceRecords({ ...common, onData: setRecords }),
    ].reduce((cleanup, unsubscribe) => () => { cleanup(); unsubscribe(); }, () => undefined);
  }, [file._dataMode, file.id, schoolId]);

  useEffect(() => {
    setStudentsLoaded(false);
    if (!classItem?.id) return undefined;
    return subscribeStudents({ db, schoolId, classIds: [classItem.id], canViewAll: false, onData: items => { setStudents(items); setStudentsLoaded(true); }, onError: () => setStudents([]) });
  }, [classItem?.id, schoolId]);

  useEffect(() => {
    if (!classItem?.id) return undefined;
    return subscribeStudentEnrollments({
      db, schoolId, academicYearId: file.academicYearId || classItem.academicYearId || '', classIds: [classItem.id], canViewAll: false,
      onData: setEnrollments, onError: () => setEnrollments([]),
    });
  }, [classItem?.academicYearId, classItem?.id, file.academicYearId, schoolId]);

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
  // The student card is the source of truth: a renamed or archived student shows correctly here at once.
  const studentCards = useMemo(() => new Map(students.map(item => [item.id, item])), [students]);
  const memberName = member => studentCards.get(member.studentId)?.fullName || member.displayName;
  const enrollmentFor = member => {
    const rows = enrollments.filter(item => item.studentId === member.studentId);
    const yearId = file.academicYearId || classItem?.academicYearId;
    return rows.find(item => yearId && item.academicYearId === yearId && item.classId === classItem?.id)
      || rows.find(item => item.classId === classItem?.id)
      || null;
  };
  // Until the class list has arrived, don't paint a stale sheet flag as "בארכיון".
  const memberStatus = member => (studentsLoaded || studentCards.has(member.studentId)
    ? attendanceRowStatus({ member, student: studentCards.get(member.studentId) || null, enrollment: enrollmentFor(member), classId: classItem?.id })
    : 'active');
  const visibleMembers = members.filter(member => member.included !== false && (!search.trim() || memberName(member)?.toLowerCase().includes(search.trim().toLowerCase())));
  const pageCount = Math.max(1, Math.ceil(days.length / PAGE_SIZE));
  const visibleDays = days.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const openDays = days.filter(day => !day.blocked);
  const dayIndex = Math.max(0, openDays.findIndex(day => day.dateKey === dayKey));
  const currentDay = openDays[dayIndex] || null;
  useEffect(() => {
    if (dayKey || !days.length) return;
    const open = days.filter(day => !day.blocked);
    const today = todayDateKey();
    // Today's column, or the nearest earlier school day (on a weekend: the last day that was taught).
    const target = open.find(day => day.dateKey === today) || [...open].reverse().find(day => day.dateKey < today) || open[0];
    if (target) setDayKey(target.dateKey);
  }, [days, dayKey]);

  async function markStatus(member, day, statusId) {
    if (!canEdit || !day) return;
    const record = recordByCell.get(`${member.studentId}:${day.dateKey}`);
    setSaveState('saving');
    setError('');
    try {
      await saveAttendanceCell({
        db, schoolId, file, actor, studentId: member.studentId, dateKey: day.dateKey,
        value: { primaryStatusId: record?.primaryStatusId === statusId ? '' : statusId, actionIds: record?.actionIds || [], note: record?.note || '' },
      });
      setSaveState('saved');
    } catch {
      setSaveState('error');
      setError('השינוי לא נשמר. בדקו את החיבור וההרשאות ונסו שוב.');
    }
  }

  function openDetails(member, day) {
    const record = recordByCell.get(`${member.studentId}:${day.dateKey}`);
    setActiveCell({ member, day, record });
    setDraft({ primaryStatusId: record?.primaryStatusId || '', actionIds: record?.actionIds || [], note: record?.note || '' });
  }

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
    if (!classItem?.id || !membersLoaded || !studentsLoaded || members.length === 0) { setOrphans([]); return undefined; }
    const known = new Set(students.map(item => item.id));
    const candidates = members.filter(member => member.included !== false && !known.has(member.studentId));
    if (candidates.length === 0) { setOrphans([]); return undefined; }
    let cancelled = false;
    Promise.all(candidates.map(member => getDoc(schoolDoc(db, schoolId, 'students', member.studentId)).then(snapshot => (snapshot.exists() ? null : member), () => null)))
      .then(result => { if (!cancelled) setOrphans(result.filter(Boolean)); });
    return () => { cancelled = true; };
  }, [members, students, membersLoaded, studentsLoaded, classItem?.id, schoolId]);

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

  // Full sync, sheet -> database: a row without a student card gets its card created automatically.
  // Each row is tried once per visit; when that fails the banner below offers a manual retry.
  useEffect(() => {
    if (!canAddStudents || repairing || orphans.length === 0) return;
    if (orphans.every(member => syncAttempted.current.has(`card:${member.studentId}`))) return;
    orphans.forEach(member => syncAttempted.current.add(`card:${member.studentId}`));
    repairOrphans();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orphans, canAddStudents, repairing]);

  // Full sync, database -> sheet: once per opening, active students of this class who are missing
  // from the sheet are added to it. (A student created while the sheet is open is added on creation.)
  useEffect(() => {
    if (!canEdit || !classItem?.id || file.status === 'archived') return undefined;
    let cancelled = false;
    addMissingClassStudentsToSheet({ db, schoolId, file, actor, classId: classItem.id })
      .then(result => { if (!cancelled && result.failed > 0) setError(`${result.failed} מתלמידי הכיתה לא נוספו לגיליון. בדקו הרשאות ורעננו את הדף.`); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, classItem?.id, file.id, file.status, schoolId]);

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
      setAddForm({ firstName: '', lastName: '', parentPhone: '' });
      setAddOpen(false);
    } catch {
      setError('לא ניתן להוסיף את התלמיד. בדקו הרשאות ונסו שוב.');
    } finally {
      setAdding(false);
    }
  }

  const todayDay = days.find(day => day.dateKey === todayDateKey() && !day.blocked);
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
          {canAddStudents && classItem?.id && <button className="btn btn-secondary btn-sm" onClick={() => setAddOpen(true)}><UserPlus size={14} /> הוספת תלמיד</button>}
          <button className="btn btn-secondary btn-sm" onClick={() => setShowLegend(previous => !previous)}><Settings2 size={14} /> מקראה</button>
          <span className={`attendance-save-state attendance-save-state--${saveState}`}><Save size={13} /> {saveState === 'saving' ? 'שומר…' : saveState === 'error' ? 'שגיאה' : 'נשמר'}</span>
        </div>
      </div>

      {error && <div className="attendance-feedback attendance-feedback--error" role="alert">{error}</div>}
      {orphans.length > 0 && (canAddStudents
        ? <div className="attendance-feedback attendance-feedback--warning" role="status">{repairing ? `יוצר כרטיסי תלמיד ל־${orphans.length} תלמידים…` : <>ל־{orphans.length} תלמידים בגיליון אין עדיין כרטיס תלמיד. <button type="button" className="btn btn-secondary btn-sm" onClick={repairOrphans}>ניסיון חוזר</button></>}</div>
        : <div className="attendance-feedback attendance-feedback--warning" role="status">ל־{orphans.length} תלמידים בגיליון אין עדיין כרטיס תלמיד. פתיחת הגיליון על ידי מנהל/ת תיצור אותם אוטומטית.</div>)}
      {showLegend && (
        <aside className="attendance-legend-panel">
          <div className="attendance-legend-list">{legend.map(item => <span key={item.id} style={{ '--legend-color': item.color }}><b>{item.shortCode}</b>{item.label}{canManageLegend && <button className="icon-btn icon-btn--danger" onClick={() => deleteLegendItem(item)} aria-label={`מחיקה לצמיתות של ${item.label}`} title="מחיקה לצמיתות"><Trash2 size={12} /></button>}</span>)}</div>
          {canManageLegend && <form onSubmit={addLegend} className="attendance-legend-form"><input value={legendForm.label} onChange={event => setLegendForm(previous => ({ ...previous, label: event.target.value }))} placeholder="שם הפריט" maxLength={80} /><input value={legendForm.shortCode} onChange={event => setLegendForm(previous => ({ ...previous, shortCode: event.target.value }))} placeholder="קוד" maxLength={4} /><input type="color" value={legendForm.color} onChange={event => setLegendForm(previous => ({ ...previous, color: event.target.value }))} aria-label="צבע" /><select value={legendForm.type} onChange={event => setLegendForm(previous => ({ ...previous, type: event.target.value }))}><option value="status">סטטוס נוכחות</option><option value="action">פעולת מעקב</option><option value="event">אירוע או הערה</option></select><select value={legendForm.attendanceEffect} onChange={event => setLegendForm(previous => ({ ...previous, attendanceEffect: event.target.value }))}><option value="neutral">ללא השפעה</option><option value="present">נוכחות</option><option value="absent">היעדרות</option><option value="excused_absence">היעדרות מוצדקת</option><option value="approved_activity">פעילות מאושרת</option></select><button className="btn btn-primary btn-sm"><CirclePlus size={14} /> הוספה</button></form>}
        </aside>
      )}

      <div className="attendance-view-switch" role="group" aria-label="אופן הצגה">
        <button type="button" className={`btn btn-sm ${dayMode ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={dayMode} onClick={() => setDayMode(true)}>יום אחד</button>
        <button type="button" className={`btn btn-sm ${!dayMode ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={!dayMode} onClick={() => setDayMode(false)}>טבלה מלאה</button>
      </div>
      {dayMode ? (
        <section className="attendance-day" aria-label="נוכחות ליום אחד">
          {currentDay ? <>
            <header className="attendance-day-head">
              <button type="button" className="icon-btn" disabled={dayIndex <= 0} onClick={() => setDayKey(openDays[dayIndex - 1].dateKey)} aria-label="היום הקודם"><ChevronRight size={18} /></button>
              <div><strong>{new Intl.DateTimeFormat('he-IL', { weekday: 'long' }).format(new Date(`${currentDay.dateKey}T12:00:00`))} {formatDate(currentDay.dateKey).short}</strong>{currentDay.dateKey === todayDateKey() && <span>היום</span>}</div>
              <button type="button" className="icon-btn" disabled={dayIndex >= openDays.length - 1} onClick={() => setDayKey(openDays[dayIndex + 1].dateKey)} aria-label="היום הבא"><ChevronLeft size={18} /></button>
            </header>
            {canEdit && presentStatus && <button type="button" className="btn btn-secondary attendance-day-all" onClick={() => markAllPresent(currentDay)}><Check size={16} /> כולם נוכחים</button>}
            <ul className="attendance-day-list">{visibleMembers.map(member => {
              const record = recordByCell.get(`${member.studentId}:${currentDay.dateKey}`);
              const status = memberStatus(member);
              return <li key={member.studentId} className={status !== 'active' ? 'is-inactive' : ''}>
                <button type="button" className="attendance-day-name" onClick={() => openDetails(member, currentDay)} title="הערה ופעולות נוספות"><strong>{memberName(member)}</strong>{status !== 'active' && <small>{STATUS_LABELS[status] || ''}</small>}{(record?.note || record?.actionIds?.length > 0) && <small>יש הערה</small>}</button>
                <div className="attendance-day-statuses">{statusItems.map(item => <button key={item.id} type="button" disabled={!canEdit} aria-pressed={record?.primaryStatusId === item.id} style={{ '--legend-color': item.color }} className={record?.primaryStatusId === item.id ? 'is-on' : ''} onClick={() => markStatus(member, currentDay, item.id)}>{item.label}</button>)}</div>
              </li>;
            })}</ul>
            {visibleMembers.length === 0 && <div className="attendance-empty">אין תלמידים להצגה.</div>}
          </> : <div className="attendance-empty">אין ימי לימוד בגיליון הזה.</div>}
        </section>
      ) : <>
      <div className="attendance-grid-wrap">
        <table className="attendance-grid">
          <thead><tr><th className="attendance-student-column">תלמיד</th>{visibleDays.map(day => { const formatted = formatDate(day.dateKey); return <th key={day.id} className={`${day.dateKey === todayDateKey() ? 'today' : ''} ${day.blocked ? 'blocked' : ''}`}><span>{formatted.weekday}</span><strong>{formatted.short}</strong>{canEdit && !day.blocked && <button onClick={() => markAllPresent(day)} title="סימון כל הכיתה כנוכחת" aria-label={`סימון כל הכיתה כנוכחת ב-${day.dateKey}`}><Check size={11} /></button>}</th>; })}<th className="attendance-summary-column">סיכום</th></tr></thead>
          <tbody>{visibleMembers.map((member, rowIndex) => {
            const memberRecords = records.filter(record => record.studentId === member.studentId);
            const summary = calculateAttendanceSummary({ days: visibleDays, records: memberRecords, legend, member });
            return <tr key={member.studentId}><th className="attendance-student-column"><button type="button" className="attendance-student-link" onClick={() => navigate(`/students?student=${member.studentId}`)} title="פתיחת כרטיס התלמיד"><strong>{memberName(member)}</strong></button>{studentCards.has(member.studentId) ? <MissingInfoMark student={studentCards.get(member.studentId)} /> : null}{memberStatus(member) !== 'active' && <small>{STATUS_LABELS[memberStatus(member)] || memberStatus(member)}</small>}</th>{visibleDays.map((day, columnIndex) => { const record = recordByCell.get(`${member.studentId}:${day.dateKey}`); const status = legendById.get(record?.primaryStatusId); const actions = (record?.actionIds || []).map(id => legendById.get(id)).filter(Boolean); const title = [status?.label, ...actions.map(item => item.label), record?.note, record?.updatedBy ? `עודכן: ${formatUpdatedAt(record.updatedAt)}` : ''].filter(Boolean).join('\n'); return <td key={day.id} className={day.blocked ? 'blocked' : ''}><button data-att-cell={`${rowIndex}:${columnIndex}`} onKeyDown={event => moveFocus(event, rowIndex, columnIndex)} onClick={() => openCell(member, day)} disabled={day.blocked || (!canEdit && !record)} style={status ? { '--status-color': status.color } : undefined} title={title || 'ללא סימון'} aria-label={`${memberName(member)}, ${day.dateKey}: ${status?.label || 'ללא סימון'}`}><span>{status?.shortCode || ''}</span>{actions.length > 0 && <small>+{actions.length}</small>}{record?.note && <i aria-label="קיימת הערה">•</i>}</button></td>; })}<td className="attendance-summary-column"><strong>{summary.attendancePercent}%</strong><span>{summary.present}/{summary.scheduled}</span><small>{summary.missing} ללא נתון</small></td></tr>;
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
      </>}

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
            <div className="attendance-cell-header"><div><strong>{memberName(activeCell.member)}</strong><span>{activeCell.day.dateKey}</span></div><button className="icon-btn" onClick={() => setActiveCell(null)} aria-label="סגירה"><X size={17} /></button></div>
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
