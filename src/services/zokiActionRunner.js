import { calendarDateFields } from '../utils/calendarInteractions.js';
import { releaseActionWrite, reserveActionWrite, summarizeAttendance } from '../utils/zokiActions.js';

const denied = text => ({ saved: false, text });

async function defaultDeps() {
  const [{ collection, doc, getDoc, getDocs, query, where, addDoc }, { db }, attendance, classes, paths, tasks, teams] = await Promise.all([
    import('firebase/firestore'),
    import('../firebase.js'),
    import('./firestore/attendanceRepository.js'),
    import('./firestore/classStudentRepository.js'),
    import('./firestore/paths.js'),
    import('./firestore/taskRepository.js'),
    import('./firestore/teamRepository.js'),
  ]);
  const { saveAttendanceCell } = attendance;
  const { createClass, updateClass } = classes;
  const { schoolCollection, schoolDoc } = paths;
  const { createOrganizationTask, createPersonalTask, updateTask, updateTaskStatus, updateTaskAssignee } = tasks;
  const { addSchoolTeamMembers, createSchoolTeam } = teams;
  return {
    db,
    saveAttendanceCell,
    createClass,
    updateClass,
    createPersonalTask,
    createOrganizationTask,
    updateTask,
    updateTaskStatus,
    updateTaskAssignee,
    createSchoolTeam,
    addSchoolTeamMembers,
    addEvent: (schoolId, fields) => addDoc(collection(db, `events_${schoolId}`), fields),
    getTask: async (schoolId, taskId) => {
      const nested = await getDoc(schoolDoc(db, schoolId, 'tasks', taskId));
      if (nested.exists()) return { id: nested.id, ...nested.data(), _source: 'organization' };
      return null;
    },
    readAttendance: async ({ schoolId, studentId, classId, from, to }) => {
      const files = await getDocs(query(schoolCollection(db, schoolId, 'files', 'nested'), where('fileType', '==', 'attendance')));
      const sheets = files.docs.map(item => ({ id: item.id, ...item.data() })).filter(file => !classId || file.classId === classId);
      const records = [];
      const legend = [];
      for (const file of sheets) {
        const [legendSnap, recordSnap] = await Promise.all([
          getDocs(collection(db, 'schools', schoolId, 'files', file.id, 'attendanceLegend')),
          getDocs(collection(db, 'schools', schoolId, 'files', file.id, 'attendanceRecords')),
        ]);
        legend.push(...legendSnap.docs.map(item => ({ id: item.id, ...item.data() })));
        records.push(...recordSnap.docs.map(item => item.data()).filter(record => record.studentId === studentId && record.dateKey >= from && record.dateKey <= to));
      }
      return { records, legend };
    },
    getAttendanceRecord: async ({ schoolId, fileId, studentId, dateKey }) => {
      const snap = await getDoc(doc(db, 'schools', schoolId, 'files', fileId, 'attendanceRecords', `${studentId}__${dateKey}`));
      return snap.exists() ? { primaryStatusId: snap.data().primaryStatusId || '', actionIds: snap.data().actionIds || [], note: snap.data().note || '' } : { primaryStatusId: '', actionIds: [], note: '' };
    },
    readEvents: async ({ schoolId, from, to, grade }) => {
      const start = new Date(`${from}T12:00:00`);
      const snap = await getDocs(query(collection(db, `events_${schoolId}`), where('year', '==', start.getFullYear()), where('month', '==', start.getMonth())));
      return snap.docs.map(item => ({ id: item.id, ...item.data() })).filter(event => {
        const date = String(event.date || '').slice(0, 10);
        if (date < from || date > to) return false;
        return !grade || event.audience?.grade === grade || event.grade === grade;
      });
    },
  };
}

export async function runZokiAction(card, context, deps) {
  if (!card?.allowed) return denied(card?.reason || 'אין הרשאה לפעולה הזו.');
  const io = deps || await defaultDeps();
  const { schoolId, actor } = context;
  if (card.write) {
    const gate = reserveActionWrite(schoolId, actor.uid, card.requestId);
    if (!gate.ok) return denied(gate.reason === 'duplicate' ? 'הפעולה הזו כבר נשמרה.' : 'אפשר לאשר עוד פעולות בעוד כמה דקות.');
  }
  try {
    const outcome = await perform(card, context, io);
    return outcome;
  } catch (error) {
    if (card.write) releaseActionWrite(schoolId, actor.uid, card.requestId);
    const code = String(error?.code || error?.message || '');
    if (code.includes('CLASS_EXISTS')) return denied('כיתה בשם הזה כבר קיימת בשנת הלימודים. לא נשמר עותק נוסף.');
    if (/permission-denied|PERMISSION_DENIED/iu.test(code)) return denied('אין הרשאה לשמור את זה. לא נשמר דבר.');
    return denied('השמירה נדחתה. לא נשמר דבר.');
  }
}

async function perform(card, context, io) {
  const { schoolId, actor } = context;
  const fields = card.fields;
  if (card.tool === 'read_attendance') {
    const data = await io.readAttendance({ schoolId, ...fields });
    return { saved: false, text: summarizeAttendance({ studentName: fields.studentName, from: fields.from, to: fields.to, ...data }) };
  }
  if (card.tool === 'read_calendar') {
    const events = await io.readEvents({ schoolId, ...fields });
    const lines = events.map(event => `${event.date} ${event.title}${event.audience?.grade ? ` (שכבה ${event.audience.grade})` : ''}`);
    return { saved: false, text: lines.length ? lines.join('\n') : 'אין אירועים בטווח.' };
  }
  if (card.tool === 'edit_attendance_cell' || card.tool === 'edit_attendance_note') {
    const file = { id: fields.fileId, classId: fields.classId || '', _dataMode: 'nested' };
    const previous = card.previous || await io.getAttendanceRecord({ schoolId, ...fields });
    const value = card.tool === 'edit_attendance_note'
      ? { ...previous, note: fields.note }
      : { ...previous, primaryStatusId: fields.statusId, note: previous.note || '' };
    await io.saveAttendanceCell({ db: io.db, schoolId, file, actor, studentId: fields.studentId, dateKey: fields.dateKey, value });
    return { saved: true, text: 'התא נשמר.', undo: { ...card, fields: { ...fields, statusId: previous.primaryStatusId, note: previous.note }, previous: value, requestId: `${card.requestId}_undo` } };
  }
  if (card.tool === 'create_personal_task') {
    await io.createPersonalTask({ db: io.db, schoolId, user: actor, input: fields, requestId: card.requestId });
    return { saved: true, text: 'המשימה האישית נשמרה.' };
  }
  if (card.tool === 'create_school_task' || card.tool === 'create_follow_up') {
    const input = card.tool === 'create_follow_up' ? {
      title: fields.title, dueDate: fields.dueDate, status: fields.status, tags: ['מעקב'],
      description: [`מקור: ${fields.sourceType} ${fields.sourceId}`, fields.nextStep && `הצעד הבא: ${fields.nextStep}`, fields.notes].filter(Boolean).join('\n'),
      assigneeIds: fields.ownerId ? [fields.ownerId] : [], scope: fields.ownerId ? 'assigned' : 'personal',
    } : { title: fields.title, dueDate: fields.dueDate, description: fields.description, assigneeIds: fields.assigneeId ? [fields.assigneeId] : [], teamId: fields.teamId, scope: fields.assigneeId ? 'assigned' : 'team' };
    if (fields.ownerId || fields.assigneeId) await io.createOrganizationTask({ db: io.db, schoolId, user: actor, input });
    else await io.createPersonalTask({ db: io.db, schoolId, user: actor, input: { ...input, description: input.description }, requestId: card.requestId });
    return { saved: true, text: card.tool === 'create_follow_up' ? 'המעקב נשמר.' : 'המשימה נשמרה.' };
  }
  if (card.tool === 'update_task_fields') {
    const task = await io.getTask(schoolId, fields.taskId);
    if (!task) return denied('המשימה לא נמצאה. לא נשמר דבר.');
    await io.updateTask({ db: io.db, schoolId, uid: actor.uid, task, input: fields });
    return { saved: true, text: 'המשימה עודכנה.', undo: { ...card, fields: { taskId: fields.taskId, title: task.title, description: task.description, dueDate: task.dueDate }, requestId: `${card.requestId}_undo` } };
  }
  if (card.tool === 'set_task_status') {
    const task = await io.getTask(schoolId, fields.taskId);
    if (!task) return denied('המשימה לא נמצאה. לא נשמר דבר.');
    await io.updateTaskStatus({ db: io.db, schoolId, uid: actor.uid, task, status: fields.status });
    return { saved: true, text: 'הסטטוס נשמר.', undo: { ...card, fields: { taskId: fields.taskId, status: task.status }, requestId: `${card.requestId}_undo` } };
  }
  if (card.tool === 'set_task_assignee') {
    const task = await io.getTask(schoolId, fields.taskId);
    if (!task) return denied('המשימה לא נמצאה. לא נשמר דבר.');
    await io.updateTaskAssignee({ db: io.db, schoolId, task, staffId: fields.assigneeId, assigned: fields.assigned, actorId: actor.uid });
    return { saved: true, text: 'השיוך נשמר.' };
  }
  if (card.tool === 'create_class') {
    await io.createClass({ db: io.db, schoolId, actor, input: fields });
    return { saved: true, text: 'הכיתה נשמרה.' };
  }
  if (card.tool === 'update_class') {
    const current = { id: fields.classId, name: card.previous?.name || fields.name, academicYear: card.previous?.academicYear || '' };
    await io.updateClass({ db: io.db, schoolId, actor, current, input: { ...current, ...fields } });
    return { saved: true, text: 'הכיתה עודכנה.' };
  }
  if (card.tool === 'create_team') {
    await io.createSchoolTeam({ db: io.db, schoolId, actor, name: fields.name, description: fields.description });
    return { saved: true, text: 'הצוות נשמר.' };
  }
  if (card.tool === 'add_team_members') {
    await io.addSchoolTeamMembers({ db: io.db, schoolId, teamId: fields.teamId, memberIds: fields.memberIds });
    return { saved: true, text: 'החברים נוספו.' };
  }
  if (card.tool === 'create_calendar_event') {
    const dated = calendarDateFields(fields.date);
    await io.addEvent(schoolId, { ...dated, title: fields.title, category: fields.category, description: fields.description, visibleTo: 'all', audience: fields.grade ? { kind: 'activity', grade: fields.grade, subject: '', roleIds: [] } : null, createdBy: actor.uid });
    return { saved: true, text: 'האירוע נשמר.' };
  }
  return denied('הפעולה הזו אינה זמינה. לא נשמר דבר.');
}
