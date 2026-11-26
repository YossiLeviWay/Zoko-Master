import { academicYearForDate } from './academicYears.js';
import { DASHBOARD_WIDGET_TYPES } from './dashboardWidgets.js';
import { subscribePrivateSession } from './browserPrivacy.js';
import { V1_TOOLS, guardProposals } from '../../worker/src/zokiActionTools.js';

const DAY = 600000;
const WRITE_CAP = 10;
const windows = new Map();
subscribePrivateSession(() => windows.clear());

const text = (value, max) => String(value || '').replace(/\s+/gu, ' ').trim().slice(0, max);
const day = value => (/^\d{4}-\d{2}-\d{2}$/u.test(value || '') ? value : '');
const id = value => (/^[\w-]{1,128}$/u.test(value || '') ? value : '');
const ids = values => [...new Set((Array.isArray(values) ? values : String(values || '').split(/[,\s]+/u)).map(id).filter(Boolean))].slice(0, 50);

const spec = (keys, write, sanitize, lines) => ({ keys, write, sanitize, lines });

const SPECS = {
  create_personal_task: spec(['tasks.create'], true, input => {
    const title = text(input.title, 180);
    if (title.length < 2) return { error: 'חסרה כותרת למשימה.' };
    return { value: { title, dueDate: day(input.dueDate), description: text(input.description, 2000) } };
  }, fields => [`משימה אישית: ${fields.title}`, fields.dueDate && `תאריך: ${fields.dueDate}`, fields.description && `תיאור: ${fields.description}`]),
  create_school_task: spec(['tasks.create'], true, input => {
    const title = text(input.title, 180);
    if (title.length < 2) return { error: 'חסרה כותרת למשימה.' };
    return { value: { title, dueDate: day(input.dueDate), description: text(input.description, 2000), assigneeId: id(input.assigneeId), teamId: id(input.teamId) } };
  }, fields => [`משימת מוסד: ${fields.title}`, fields.assigneeId && `אחראי: ${fields.assigneeId}`, fields.teamId && `צוות: ${fields.teamId}`, fields.dueDate && `תאריך: ${fields.dueDate}`]),
  update_task_fields: spec(['tasks.editAll', 'tasks.create'], true, input => {
    const taskId = id(input.taskId);
    if (!taskId) return { error: 'חסר מזהה משימה.' };
    const value = { taskId };
    if (input.title) value.title = text(input.title, 180);
    if (input.description) value.description = text(input.description, 2000);
    if (input.dueDate) value.dueDate = day(input.dueDate);
    if (!value.title && !value.description && !value.dueDate) return { error: 'לא נבחר שדה לעדכון.' };
    return { value };
  }, fields => [`עדכון משימה ${fields.taskId}`, fields.title && `כותרת: ${fields.title}`, fields.dueDate && `תאריך: ${fields.dueDate}`, fields.description && `תיאור: ${fields.description}`]),
  set_task_status: spec(['tasks.editAll', 'tasks.viewOwn'], true, input => {
    const taskId = id(input.taskId);
    if (!taskId || !['todo', 'in_progress', 'done'].includes(input.status)) return { error: 'סטטוס לא מוכר.' };
    return { value: { taskId, status: input.status } };
  }, fields => [`סטטוס משימה ${fields.taskId}: ${fields.status}`]),
  set_task_assignee: spec(['tasks.assign'], true, input => {
    const taskId = id(input.taskId);
    const assigneeId = id(input.assigneeId);
    if (!taskId || !assigneeId) return { error: 'חסר מזהה משימה או אחראי.' };
    return { value: { taskId, assigneeId, assigned: input.assigned !== false } };
  }, fields => [`שיוך ${fields.assigneeId} למשימה ${fields.taskId}`]),
  read_attendance: spec(['attendance_view', 'attendance_edit'], false, input => {
    const from = day(input.from);
    const to = day(input.to);
    if (!from || !to || from > to) return { error: 'טווח תאריכים לא תקין.' };
    if (!id(input.studentId) && text(input.studentName, 120).length < 2) return { error: 'חסר תלמיד.' };
    return { value: { studentId: id(input.studentId), studentName: text(input.studentName, 120), from, to, classId: id(input.classId) } };
  }, fields => [`קריאת נוכחות: ${fields.studentName || fields.studentId}`, `מ־${fields.from} עד ${fields.to}`]),
  edit_attendance_cell: spec(['attendance_edit'], true, input => {
    const fileId = id(input.fileId);
    const studentId = id(input.studentId);
    const dateKey = day(input.dateKey);
    if (!fileId || !studentId || !dateKey) return { error: 'חסרים גיליון, תלמיד או תאריך.' };
    return { value: { fileId, studentId, dateKey, statusId: id(input.statusId) } };
  }, fields => [`עדכון נוכחות ${fields.studentId} ב־${fields.dateKey}`, `סטטוס: ${fields.statusId || 'ללא סימון'}`]),
  edit_attendance_note: spec(['attendance_edit'], true, input => {
    const fileId = id(input.fileId);
    const studentId = id(input.studentId);
    const dateKey = day(input.dateKey);
    const note = text(input.note, 2000);
    if (!fileId || !studentId || !dateKey || note.length < 1) return { error: 'חסרים גיליון, תלמיד, תאריך או הערה.' };
    return { value: { fileId, studentId, dateKey, note } };
  }, fields => [`הערה בנוכחות ${fields.studentId} ב־${fields.dateKey}`, fields.note]),
  read_calendar: spec(['calendar.view', 'calendar_view'], false, input => {
    const from = day(input.from);
    const to = day(input.to);
    if (!from || !to || from > to) return { error: 'טווח תאריכים לא תקין.' };
    return { value: { from, to, grade: text(input.grade, 20) } };
  }, fields => [`קריאת אירועי גאנט ${fields.from}–${fields.to}`, fields.grade && `שכבה ${fields.grade}`]),
  create_calendar_event: spec(['calendar.create', 'calendar.edit', 'calendar_edit'], true, input => {
    const title = text(input.title, 120);
    const date = day(input.date);
    if (title.length < 2 || !date) return { error: 'חסרים כותרת או תאריך לאירוע.' };
    const certainty = input.certainty === 'tentative' ? 'tentative' : 'confirmed';
    return { value: { title, date, category: text(input.category, 40) || 'כללי', description: text(input.description, 500), grade: text(input.grade, 20), certainty } };
  }, fields => [`אירוע גאנט: ${fields.title}`, `תאריך: ${fields.date}`, fields.certainty === 'tentative' ? 'מצב: לא סגור' : 'מצב: סגור', fields.grade && `שכבה: ${fields.grade}`, fields.category && `קטגוריה: ${fields.category}`]),
  create_follow_up: spec(['tasks.create'], true, input => {
    const title = text(input.title, 180);
    const dueDate = day(input.dueDate);
    if (title.length < 2 || !dueDate) return { error: 'למעקב חסרים כותרת או תאריך.' };
    const status = ['todo', 'in_progress', 'done'].includes(input.status) ? input.status : 'todo';
    return { value: { title, dueDate, status, ownerId: id(input.ownerId), sourceType: input.sourceType === 'event' ? 'event' : 'task', sourceId: id(input.sourceId), nextStep: text(input.nextStep, 500), notes: text(input.notes, 2000) } };
  }, fields => [`מעקב: ${fields.title}`, `סטטוס: ${fields.status}`, fields.ownerId && `אחראי: ${fields.ownerId}`, `תאריך: ${fields.dueDate}`, fields.nextStep && `הצעד הבא: ${fields.nextStep}`, fields.notes && `הערות: ${fields.notes}`]),
  create_class: spec(['classes.create', 'classes_create'], true, input => {
    const name = text(input.name, 80);
    if (name.length < 2) return { error: 'חסר שם כיתה.' };
    const year = academicYearForDate(new Date());
    return { value: { name, gradeLevel: text(input.gradeLevel, 20), academicYear: text(input.academicYear, 40) || year.hebrewLabel || year.label || '' } };
  }, fields => [`כיתה חדשה: ${fields.name}`, fields.gradeLevel && `שכבה: ${fields.gradeLevel}`, `שנת לימודים: ${fields.academicYear}`]),
  update_class: spec(['classes.update', 'classes_update'], true, input => {
    const classId = id(input.classId);
    if (!classId) return { error: 'חסר מזהה כיתה.' };
    const value = { classId };
    if (input.name) value.name = text(input.name, 80);
    if (input.gradeLevel) value.gradeLevel = text(input.gradeLevel, 20);
    if (input.teacherId) value.teacherId = id(input.teacherId);
    if (!value.name && !value.gradeLevel && value.teacherId === undefined) return { error: 'לא נבחר שדה לעדכון.' };
    return { value };
  }, fields => [`עדכון כיתה ${fields.classId}`, fields.name && `שם: ${fields.name}`, fields.gradeLevel && `שכבה: ${fields.gradeLevel}`, fields.teacherId && `מחנך: ${fields.teacherId}`]),
  create_team: spec(['teams_edit'], true, input => {
    const name = text(input.name, 120);
    if (name.length < 2) return { error: 'חסר שם צוות.' };
    return { value: { name, description: text(input.description, 500) } };
  }, fields => [`צוות חדש: ${fields.name}`, fields.description && fields.description]),
  add_staff: spec(['staff_edit'], true, input => {
    const fullName = text(input.fullName, 120);
    const email = String(input.email || '').trim().toLowerCase().slice(0, 120);
    const role = input.role === 'editor' ? 'editor' : 'viewer';
    if (fullName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) return { error: 'חסרים שם או דוא״ל תקינים.' };
    return { value: { fullName, email, role } };
  }, fields => [`הוספת איש צוות: ${fields.fullName}`, fields.email, `תפקיד: ${fields.role}`, 'נשלחת הזמנה. לא נשמרת סיסמה.']),
  update_staff: spec(['staff_edit'], true, input => {
    const userId = id(input.userId);
    if (!userId) return { error: 'חסר איש צוות.' };
    const value = { userId };
    if (input.fullName) value.fullName = text(input.fullName, 120);
    if (input.phone) value.phone = text(input.phone, 32);
    if (input.jobTitle) value.jobTitle = text(input.jobTitle, 120);
    if (!value.fullName && !value.phone && !value.jobTitle) return { error: 'לא נבחר שדה לעדכון.' };
    return { value };
  }, fields => [`עדכון איש צוות ${fields.userId}`, fields.fullName && `שם: ${fields.fullName}`, fields.jobTitle && `תפקיד: ${fields.jobTitle}`, fields.phone && `טלפון: ${fields.phone}`]),
  set_staff_role: spec(['staff_edit'], true, input => {
    const userId = id(input.userId);
    const role = input.role === 'editor' ? 'editor' : input.role === 'viewer' ? 'viewer' : '';
    if (!userId || !role) return { error: 'אפשר לקבוע רק צופה או עורך.' };
    return { value: { userId, role } };
  }, fields => [`תפקיד ${fields.userId}: ${fields.role}`]),
  set_staff_permission: spec(['staff_edit'], true, input => {
    const userId = id(input.userId);
    const permission = text(input.permission, 64);
    if (!userId || !/^[a-z0-9._]{3,64}$/iu.test(permission)) return { error: 'חסרים איש צוות או הרשאה.' };
    return { value: { userId, permission, granted: input.granted !== false } };
  }, fields => [`${fields.granted ? 'מתן' : 'הסרת'} ${fields.permission} ל־${fields.userId}`]),
  deactivate_staff: spec(['staff_edit'], true, input => {
    const userId = id(input.userId);
    if (!userId) return { error: 'חסר איש צוות.' };
    return { value: { userId, active: input.active === true } };
  }, fields => [fields.active ? `הפעלה מחדש של ${fields.userId}` : `השבתת ${fields.userId}`, 'אין מחיקה.']),
  set_dashboard_layout: spec(['tasks.viewOwn'], true, input => {
    const op = ['add', 'remove', 'move', 'resize'].includes(input.op) ? input.op : '';
    if (!op) return { error: 'חסרה פעולה לדשבורד.' };
    const type = DASHBOARD_WIDGET_TYPES.includes(input.type) ? input.type : '';
    if (op === 'add' && !type) return { error: 'סוג התצוגה לא מוכר.' };
    const index = Number.isInteger(Number(input.index)) ? Number(input.index) : 0;
    return { value: { op, type, path: text(input.path, 80), title: text(input.title, 60), size: input.size === 'half' ? 'half' : 'full', index, direction: input.direction === 'up' ? 'up' : 'down' } };
  }, fields => [`דשבורד: ${fields.op}`, fields.type, fields.path].filter(Boolean)),
  add_team_members: spec(['teams_edit'], true, input => {
    const teamId = id(input.teamId);
    const memberIds = ids(input.memberIds);
    if (!teamId || !memberIds.length) return { error: 'חסרים צוות או חברים.' };
    return { value: { teamId, memberIds } };
  }, fields => [`הוספת חברים לצוות ${fields.teamId}`, fields.memberIds.join(', ')]),
};

export function requestKey(tool, fields) {
  const body = JSON.stringify(fields);
  let hash = 0;
  for (let index = 0; index < body.length; index += 1) hash = (hash * 33 + body.charCodeAt(index)) >>> 0;
  return `zoki_${tool}_${hash.toString(16)}`;
}

const STAFF_TOOLS = new Set(['add_staff', 'update_staff', 'set_staff_role', 'set_staff_permission', 'deactivate_staff']);

export function prepareZokiAction(proposal, { permissions = {}, manager = false, actorId = '' } = {}) {
  const tool = proposal?.tool;
  const entry = SPECS[tool];
  if (!entry || !V1_TOOLS[tool]) return null;
  const parsed = entry.sanitize(proposal.input || {});
  if (parsed.error) return { tool, allowed: false, write: entry.write, reason: parsed.error, lines: [parsed.error], fields: {}, requestId: '' };
  const teacherChange = tool === 'update_class' && parsed.value.teacherId;
  const assignsSomeone = (tool === 'create_follow_up' && parsed.value.ownerId) || (tool === 'create_school_task' && parsed.value.assigneeId);
  const canAssign = manager || permissions['tasks.assign'] === true || permissions.tasks_assign === true;
  const staffChange = STAFF_TOOLS.has(tool);
  const selfLock = staffChange && parsed.value.userId && parsed.value.userId === actorId && tool !== 'update_staff';
  const allowed = (manager || entry.keys.some(key => permissions[key] === true))
    && (!staffChange || manager)
    && !selfLock
    && (!teacherChange || manager || permissions['classes.assignTeacher'] === true || permissions.classes_assign_teacher === true)
    && (!assignsSomeone || canAssign);
  return {
    tool,
    allowed,
    write: entry.write,
    reason: selfLock ? 'אי אפשר לנעול את עצמך.' : (allowed ? '' : 'אין הרשאה לפעולה הזו.'),
    lines: [...entry.lines(parsed.value), !allowed && 'אין הרשאה לפעולה הזו.'].filter(Boolean),
    fields: parsed.value,
    requestId: requestKey(tool, parsed.value),
  };
}

export function proposalFromReply(userText, proposals = []) {
  const [proposal] = guardProposals(userText, proposals);
  return proposal || null;
}

export function reserveActionWrite(schoolId, uid, requestId) {
  const key = `${uid}:${schoolId}`;
  const now = Date.now();
  const recent = (windows.get(key) || []).filter(item => item.at > now - DAY);
  if (recent.some(item => item.id === requestId)) return { ok: false, reason: 'duplicate' };
  if (recent.length >= WRITE_CAP) return { ok: false, reason: 'rate' };
  recent.push({ id: requestId, at: now });
  windows.set(key, recent);
  return { ok: true };
}

export function releaseActionWrite(schoolId, uid, requestId) {
  const key = `${uid}:${schoolId}`;
  windows.set(key, (windows.get(key) || []).filter(item => item.id !== requestId));
}

export function summarizeAttendance({ studentName = '', from, to, records = [], legend = [] }) {
  const byId = new Map(legend.map(item => [item.id, item]));
  const rows = records.filter(record => record.dateKey >= from && record.dateKey <= to)
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  const counts = new Map();
  const notes = [];
  for (const record of rows) {
    const status = byId.get(record.primaryStatusId);
    const label = status ? `${status.shortCode} ${status.label}` : (record.primaryStatusId || 'ללא סימון');
    counts.set(label, (counts.get(label) || 0) + 1);
    if (record.note) notes.push(`${record.dateKey}: ${record.note}`);
  }
  const tally = [...counts.entries()].map(([label, count]) => `${label} × ${count}`).join(', ') || 'אין סימונים';
  return [`נוכחות ${studentName || 'התלמיד'} ${from}–${to}: ${tally}.`, notes.length ? `הערות:\n${notes.join('\n')}` : ''].filter(Boolean).join('\n');
}

export { ids };
