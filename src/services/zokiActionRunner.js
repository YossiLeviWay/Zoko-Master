import { calendarDateFields } from '../utils/calendarInteractions.js';
import { releaseActionWrite, reserveActionWrite, summarizeAttendance } from '../utils/zokiActions.js';

const denied = text => ({ saved: false, text });
const undoOf = (card, tool, fields) => ({ tool, allowed: true, write: true, fields, lines: ['ביטול הפעולה'], requestId: `${card.requestId}_undo` });
const undoCreated = (card, kind, id) => (id ? undoOf(card, 'undo_created', { kind, id }) : null);

async function defaultDeps() {
  const [{ collection, doc, getDoc, getDocs, query, where, addDoc, deleteDoc, updateDoc, arrayRemove }, { db }, attendance, classes, paths, tasks, teams, staffApi] = await Promise.all([
    import('firebase/firestore'),
    import('../firebase.js'),
    import('./firestore/attendanceRepository.js'),
    import('./firestore/classStudentRepository.js'),
    import('./firestore/paths.js'),
    import('./firestore/taskRepository.js'),
    import('./firestore/teamRepository.js'),
    import('./adminUserService.js'),
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
    createStaff: input => staffApi.createStaffUser(input),
    updateStaff: input => staffApi.updateStaffUser(input),
    setStaffRole: input => staffApi.setUserRole(input),
    deleteTask: input => tasks.deleteTask(input),
    deleteEvent: (schoolId, id) => deleteDoc(doc(db, `events_${schoolId}`, id)),
    archiveClass: input => classes.setClassArchived(input),
    deleteTeam: (schoolId, id) => deleteDoc(schoolDoc(db, schoolId, 'teams', id)),
    removeTeamMembers: (schoolId, teamId, memberIds) => updateDoc(schoolDoc(db, schoolId, 'teams', teamId), { memberIds: arrayRemove(...memberIds) }),
    revokeStaff: input => staffApi.manageStaffInvitation(input),
    getStaff: async userId => {
      const snap = await getDoc(doc(db, 'users', userId));
      return snap.exists() ? snap.data() : null;
    },
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
    const created = await io.createPersonalTask({ db: io.db, schoolId, user: actor, input: fields, requestId: card.requestId });
    return { saved: true, text: 'המשימה האישית נשמרה.', undo: undoCreated(card, 'personal_task', created?.id || `quick_${card.requestId}`) };
  }
  if (card.tool === 'create_school_task' || card.tool === 'create_follow_up') {
    const input = card.tool === 'create_follow_up' ? {
      title: fields.title, dueDate: fields.dueDate, status: fields.status, tags: ['מעקב'],
      description: [`מקור: ${fields.sourceType} ${fields.sourceId}`, fields.nextStep && `הצעד הבא: ${fields.nextStep}`, fields.notes].filter(Boolean).join('\n'),
      assigneeIds: fields.ownerId ? [fields.ownerId] : [], scope: fields.ownerId ? 'assigned' : 'personal',
    } : { title: fields.title, dueDate: fields.dueDate, description: fields.description, assigneeIds: fields.assigneeId ? [fields.assigneeId] : [], teamId: fields.teamId, scope: fields.assigneeId ? 'assigned' : 'team' };
    const created = fields.ownerId || fields.assigneeId
      ? await io.createOrganizationTask({ db: io.db, schoolId, user: actor, input })
      : await io.createPersonalTask({ db: io.db, schoolId, user: actor, input: { ...input, description: input.description }, requestId: card.requestId });
    const kind = fields.ownerId || fields.assigneeId ? 'organization_task' : 'personal_task';
    return { saved: true, text: card.tool === 'create_follow_up' ? 'המעקב נשמר.' : 'המשימה נשמרה.', undo: undoCreated(card, kind, created?.id || (kind === 'personal_task' ? `quick_${card.requestId}` : '')) };
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
    return { saved: true, text: 'השיוך נשמר.', undo: undoOf(card, 'set_task_assignee', { ...fields, assigned: !fields.assigned }) };
  }
  if (card.tool === 'create_class') {
    const classId = await io.createClass({ db: io.db, schoolId, actor, input: fields });
    return { saved: true, text: 'הכיתה נשמרה.', undo: undoCreated(card, 'class', classId) };
  }
  if (card.tool === 'update_class') {
    const current = { id: fields.classId, name: card.previous?.name || fields.name, academicYear: card.previous?.academicYear || '' };
    await io.updateClass({ db: io.db, schoolId, actor, current, input: { ...current, ...fields } });
    return { saved: true, text: 'הכיתה עודכנה.', undo: card.previous ? undoOf(card, 'update_class', { classId: fields.classId, ...card.previous }) : null };
  }
  if (card.tool === 'create_team') {
    const team = await io.createSchoolTeam({ db: io.db, schoolId, actor, name: fields.name, description: fields.description });
    return { saved: true, text: 'הצוות נשמר.', undo: undoCreated(card, 'team', team?.id) };
  }
  if (card.tool === 'add_team_members') {
    await io.addSchoolTeamMembers({ db: io.db, schoolId, teamId: fields.teamId, memberIds: fields.memberIds });
    return { saved: true, text: 'החברים נוספו.', undo: undoOf(card, 'remove_team_members', fields) };
  }
  if (['add_staff', 'update_staff', 'set_staff_role', 'set_staff_permission', 'deactivate_staff'].includes(card.tool)) {
    if (!context.manager) return denied('אין הרשאה לנהל סגל. לא נשמר דבר.');
    if (fields.userId && fields.userId === actor.uid && card.tool !== 'update_staff') return denied('אי אפשר לנעול את עצמך. לא נשמר דבר.');
    if (card.tool === 'add_staff') {
      const invite = await io.createStaff({ schoolId, fullName: fields.fullName, email: fields.email, role: fields.role });
      return { saved: true, text: 'ההזמנה נשמרה. לא נשמרה סיסמה.', undo: undoCreated(card, 'staff_invite', invite?.invitationId) };
    }
    if (card.tool === 'update_staff') {
      const previous = card.previous || await io.getStaff?.(fields.userId);
      await io.updateStaff({ schoolId, ...fields });
      return { saved: true, text: 'פרטי איש הצוות נשמרו.', undo: previous ? undoOf(card, 'update_staff', { userId: fields.userId, fullName: previous.fullName, phone: previous.phone, jobTitle: previous.jobTitle, previous }) : null };
    }
    if (card.tool === 'set_staff_role') {
      const previous = card.previousRole || (await io.getStaff?.(fields.userId))?.role;
      await io.setStaffRole({ schoolId, userId: fields.userId, role: fields.role });
      return { saved: true, text: 'התפקיד נשמר.', undo: previous && previous !== fields.role ? undoOf(card, 'set_staff_role', { userId: fields.userId, role: previous, previousRole: fields.role }) : null };
    }
    if (card.tool === 'set_staff_permission') {
      await io.updateStaff({ schoolId, userId: fields.userId, permissions: { [fields.permission]: fields.granted } });
      return { saved: true, text: 'ההרשאה נשמרה.', undo: { ...card, fields: { ...fields, granted: !fields.granted }, requestId: `${card.requestId}_undo` } };
    }
    await io.updateStaff({ schoolId, userId: fields.userId, accountStatus: fields.active ? 'active' : 'disabled' });
    return { saved: true, text: fields.active ? 'איש הצוות הופעל.' : 'איש הצוות הושבת. החשבון לא נמחק.', undo: { ...card, fields: { ...fields, active: !fields.active }, requestId: `${card.requestId}_undo` } };
  }
  if (card.tool === 'create_calendar_event') {
    const dated = calendarDateFields(fields.date);
    const event = await io.addEvent(schoolId, { ...dated, title: fields.title, category: fields.category, description: fields.description, certainty: fields.certainty === 'tentative' ? 'tentative' : 'confirmed', visibleTo: 'all', audience: fields.grade ? { kind: 'activity', grade: fields.grade, subject: '', roleIds: [] } : null, createdBy: actor.uid });
    return { saved: true, text: 'האירוע נשמר.', undo: undoCreated(card, 'event', event?.id) };
  }
  if (card.tool === 'remove_team_members') {
    await io.removeTeamMembers(schoolId, fields.teamId, fields.memberIds);
    return { saved: true, text: 'הפעולה בוטלה.' };
  }
  if (card.tool === 'undo_created') {
    if (fields.kind === 'personal_task') await io.deleteTask({ db: io.db, schoolId, uid: actor.uid, task: { id: fields.id, _source: 'personal' } });
    else if (fields.kind === 'organization_task') await io.deleteTask({ db: io.db, schoolId, uid: actor.uid, task: { id: fields.id, _source: 'organization' } });
    else if (fields.kind === 'event') await io.deleteEvent(schoolId, fields.id);
    else if (fields.kind === 'class') await io.archiveClass({ db: io.db, schoolId, actor, classItem: { id: fields.id }, archived: true });
    else if (fields.kind === 'team') await io.deleteTeam(schoolId, fields.id);
    else if (fields.kind === 'staff_invite') await io.revokeStaff({ schoolId, invitationId: fields.id, action: 'revoke' });
    else return denied('אי אפשר לבטל את הפעולה הזו.');
    return { saved: true, text: 'הפעולה בוטלה.' };
  }
  return denied('הפעולה הזו אינה זמינה. לא נשמר דבר.');
}
