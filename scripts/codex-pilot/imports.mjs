import { createHash, randomUUID } from 'node:crypto';
import { PilotError } from './client.mjs';
import { DEFAULT_ATTENDANCE_LEGEND, attendanceRecordId } from '../../src/utils/attendance.js';
import { initializeAssignments, progressSummary, uniqueIds } from '../../functions/src/domain/taskWorkspace.js';
import { calculateGradebook } from '../../src/utils/gradeFormula.js';
import { safeId } from './firestore.mjs';
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const digest = value => createHash('sha256').update(JSON.stringify(canonical(value)) ?? 'undefined').digest('hex');
const clean = (value, max = 2000) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const requireId = value => { if (!safeId(value)) throw new PilotError('unresolved-target'); return value; };
export function expandDates(start, end = start, skipWeekends = false) {
  if (![start, end].every(value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value)) throw new PilotError('invalid-date');
  if (start > end) throw new PilotError('invalid-date-range');
  const dates = [];
  for (let date = new Date(`${start}T00:00:00Z`); date <= new Date(`${end}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1)) {
    if (!skipWeekends || ![5, 6].includes(date.getUTCDay())) dates.push(date.toISOString().slice(0, 10));
    if (dates.length > 366) throw new PilotError('date-range-too-large');
  }
  return dates;
}
export const normalizeName = name => clean(name).normalize('NFKC').replace(/[׳״"'־-]/g, '').replace(/\s+/g, ' ').toLocaleLowerCase('he');
export function matchCandidates({ name, classId, gradeLevel, teacherName, academicYearId }, records, staff = []) {
  const wanted = normalizeName(name);
  return records.map(record => {
    const data = record.data || record;
    const label = normalizeName(data.fullName || data.name);
    let score = wanted && label === wanted ? 100 : wanted && wanted.split(' ').sort().join(' ') === label.split(' ').sort().join(' ') ? 80 : 0;
    if (classId && data.classId === classId) score += 20;
    if (gradeLevel && normalizeName(data.gradeLevel) === normalizeName(gradeLevel)) score += 25;
    const teacher = staff.find(item => item.id === data.teacherId)?.data;
    if (teacherName && teacher && normalizeName(teacher.fullName).split(' ').includes(normalizeName(teacherName))) score += 45;
    if (academicYearId && data.academicYearId !== academicYearId) score = 0;
    return { id: record.id, label: data.fullName || data.name, score, exact: score >= 100 && wanted === label };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
}
const fieldsByKind = {
  event: ['title', 'description', 'date', 'endDate', 'skipWeekends', 'category', 'visibleTo', 'editableBy'],
  class: ['name', 'gradeLevel', 'academicYear', 'academicYearId', 'teacherId'],
  student: ['fullName', 'firstName', 'lastName', 'classId', 'idNumber'],
  gradebook: ['classId', 'subjects'],
  grade: ['gradebookId', 'studentId', 'subjectId', 'componentId', 'value', 'clear'],
  attendanceSheet: ['name', 'classId', 'startDate', 'endDate'],
  attendance: ['fileId', 'studentId', 'dateKey', 'primaryStatusId', 'note'],
  mapping: ['name', 'classId', 'columns'],
  mappingRow: ['mappingId', 'studentId', 'values', 'clearColumns'],
  task: ['title', 'description', 'dueDate', 'assigneeIds', 'teamId', 'priority'],
};
export function normalizeProposal(value) {
  if (!value || typeof value.answer !== 'string' || !Array.isArray(value.actions) || value.actions.length > 10000) throw new PilotError('invalid-proposal');
  const keys = new Set();
  const actions = value.actions.map((action, index) => {
    if (!fieldsByKind[action.kind] || !['create', 'update', 'archive', 'restore'].includes(action.intent) || !action.fields || typeof action.fields !== 'object' || Array.isArray(action.fields)) throw new PilotError('invalid-action');
    const key = action.key || `row_${index}`;
    if (!safeId(key) || keys.has(key)) throw new PilotError('invalid-action'); keys.add(key);
    if (Object.keys(action.fields).some(field => !fieldsByKind[action.kind].includes(field))) throw new PilotError('invalid-action-field');
    if (action.intent !== 'create') requireId(action.id);
    return { sources: Array.isArray(action.sources) ? action.sources.filter(value => typeof value === 'string').slice(0, 10000) : [], key, kind: action.kind, intent: action.intent, matchAliases: Array.isArray(action.matchAliases) ? action.matchAliases : [], id: action.id || '', label: clean(action.label, 200), source: clean(action.source, 300), reason: clean(action.reason, 800), fields: action.fields, enabled: action.enabled !== false, needsReview: action.needsReview === true };
  });
  return { answer: value.answer.slice(0, 12000), actions, excludedSources: Array.isArray(value.excludedSources) ? value.excludedSources : [] };
}
const resources = { class: 'classes', student: 'students', event: 'events', task: 'tasks', gradebook: 'gradebooks', mapping: 'pedagogicalMappings', attendanceSheet: 'files' };
export async function loadContext(db, actor) {
  const result = { coverage: [], records: [] };
  for (const type of ['classes', 'students', 'events', 'tasks', 'teams', 'categories', 'academicYears', 'gradebooks', 'files', 'folders', 'pedagogicalMappings']) {
    const legacy = { academicYears: 'academic_years' }[type] || type;
    const modes = ['gradebooks', 'pedagogicalMappings'].includes(type) ? [`schools/${actor.schoolId}/${type}`] : [`${legacy}_${actor.schoolId}`, `schools/${actor.schoolId}/${type}`];
    for (const path of modes) {
      try { result.records.push(...(await db.list(path)).map(record => ({ ...record, kind: type }))); result.coverage.push({ path, available: true }); }
      catch (error) { if (error.code !== 'permission-denied') throw error; result.coverage.push({ path, available: false }); }
    }
  }
  const users = new Map();
  for (const filter of [{ field: 'schoolIds', op: 'ARRAY_CONTAINS', value: actor.schoolId }, { field: 'schoolId', op: 'EQUAL', value: actor.schoolId }]) {
    for (const item of await db.list('users', filter)) users.set(item.id, { ...item, kind: 'staff', data: { fullName: item.data.fullName, jobTitle: item.data.jobTitlesBySchool?.[actor.schoolId] || item.data.jobTitle || '', active: !item.data.accountStatus || item.data.accountStatus === 'active' } });
  }
  result.records.push(...users.values());
  result.records.push(...(await db.list(`users/${actor.uid}/zokiPilot/${actor.schoolId}/aliases`)).map(record => ({ ...record, kind: 'aliases' })));
  return result;
}
export function sourceCatalog(context) {
  const allowed = ['name', 'fullName', 'idNumber', 'jobTitle', 'classId', 'className', 'gradeLevel', 'teacherId', 'academicYear', 'academicYearId', 'title', 'date', 'description', 'dueDate', 'status', 'memberIds', 'assigneeIds', 'teamId', 'subjects', 'columns', 'fileType', 'label', 'hebrewLabel', 'startDate', 'endDate', 'entityType', 'targetId', 'dateRange'];
  return context.records.map(record => ({ id: record.id, kind: record.kind, fields: Object.fromEntries(allowed.filter(key => record.data[key] !== undefined).map(key => [key, record.data[key]])) }));
}
export async function prepareProposal(db, actor, input, context, revision = 1, proposalId = randomUUID()) {
  const normalized = normalizeProposal(input);
  const root = `users/${actor.uid}/zokiPilot/${actor.schoolId}/proposals/${proposalId}`;
  const virtual = new Map(context.records.map(record => [record.path, record]));
  const named = new Map(); const prepared = []; const seenWrites = new Set(); const seenCells = new Set();
  const scope = actor.schoolId;
  const find = (kind, id) => [...virtual.values()].find(item => item.kind === kind && item.id === id);
  const pathOf = (kind, id) => find(resources[kind], id)?.path || (['gradebook', 'mapping', 'attendanceSheet'].includes(kind) ? `schools/${scope}/${resources[kind]}/${id}` : `${resources[kind]}_${scope}/${id}`);
  for (const action of normalized.actions) {
    const id = action.intent === 'create' ? `zi_${digest([proposalId, action.key]).slice(0, 24)}` : action.id;
    if (action.intent === 'create') named.set(action.key, id);
  }
  const resolve = value => typeof value === 'string' && value.startsWith('$') ? named.get(value.slice(1)) || requireId('') : value;
  for (const action of normalized.actions) {
    const item = { ...action, changes: [], reads: [], targets: [], errors: [], route: '/zoki', id: action.id || named.get(action.key) };
    if (!action.enabled) { prepared.push(item); continue; }
    try {
      const prior = action.intent === 'create' ? {} : find(resources[action.kind], item.id)?.data || {};
      const f = { ...Object.fromEntries(fieldsByKind[action.kind].filter(key => prior[key] !== undefined).map(key => [key, prior[key]])), ...Object.fromEntries(Object.entries(action.fields).map(([key, value]) => [key, resolve(value)])) };
      let id = requireId(item.id); const nowFields = { schoolId: scope, updatedBy: actor.uid };
      const getRecord = (kind, recordId) => { const record = find(kind, requireId(recordId)); if (!record) throw new PilotError('unresolved-target'); if (record.data.schoolId && record.data.schoolId !== scope) throw new PilotError('permission-denied'); if (!item.targets.some(target => target.id === record.id && target.kind === kind)) item.targets.push({ id: record.id, kind, name: record.data.fullName || record.data.name || record.data.title || '', academicYear: record.data.academicYear || record.data.academicYearId || '' }); item.reads.push({ path: record.path, version: record.planned ? null : record.version || null, ...(record.planned ? { expected: Object.fromEntries(Object.entries(record.data).filter(([key]) => !['updatedAt', 'createdAt'].includes(key))) } : {}) }); return record; };
      const add = async (path, data, kind) => {
        const plannedParent = [...virtual.values()].some(record => record.planned && path.startsWith(record.path + '/'));
        const old = virtual.get(path) || (plannedParent || action.intent === 'create' && !['grade', 'mappingRow', 'attendance'].includes(action.kind) ? null : await db.get(path));
        if (action.intent === 'create' && old && kind !== 'child') throw new PilotError('duplicate-target');
        if (seenWrites.has(path) && !(kind === 'child' && ['grade', 'mappingRow'].includes(action.kind))) throw new PilotError('repeated-target-in-proposal');
        const change = { path, data: { ...(old?.data || {}), ...data, ...nowFields }, before: old?.data || null, patch: { ...data, ...nowFields }, version: old?.planned ? null : old?.version || null, ...(old?.planned ? { expected: Object.fromEntries(Object.entries(old.data).filter(([key]) => !['updatedAt','createdAt'].includes(key))) } : {}), timestamps: ['updatedAt', ...(old ? [] : ['createdAt'])] };
        if (!old) { change.data.createdBy = actor.uid; change.patch.createdBy = actor.uid; }
        item.changes.push(change);
      };
      if (['archive','restore'].includes(action.intent) && action.kind === 'mappingRow') {
        const parent = getRecord('pedagogicalMappings', f.mappingId);
        const student = getRecord('students', f.studentId);
        if (student.data.classId !== parent.data.classId) throw new PilotError('student-class-mismatch');
        const path = `${parent.path}/rows/${student.id}`;
        if (!await db.get(path)) throw new PilotError('unresolved-target');
        await add(path, { status: action.intent === 'archive' ? 'archived' : 'active' }, 'child');
        item.route = `/mappings?mapping=${parent.id}`;
      } else if (['archive','restore'].includes(action.intent)) {
        if (!['event', 'task', 'mapping', 'class', 'student'].includes(action.kind)) throw new PilotError('archive-not-supported');
        const record = getRecord(resources[action.kind], id);
        await add(record.path, { status: action.intent === 'archive' ? 'archived' : action.kind === 'task' ? progressSummary(initializeAssignments(record.data)).status : 'active' });
        if (action.kind === 'student') {
          const enrollmentId = record.data.currentEnrollmentId;
          if (!safeId(enrollmentId)) throw new PilotError('student-enrollment-required');
          const path = `student_enrollments_${scope}/${enrollmentId}`;
          const enrollment = await db.get(path);
          if (!enrollment || enrollment.data.studentId !== record.id) throw new PilotError('student-enrollment-required');
          await add(path, { enrollmentStatus: action.intent === 'archive' ? 'archived' : 'active' }, 'child');
        }
      } else if (action.kind === 'event') {
        if (!clean(f.title, 160)) throw new PilotError('title-required');
        if (f.category && !context.records.some(r => r.kind === 'categories' && r.data.name === f.category)) throw new PilotError('unknown-category');
        if (f.visibleTo !== undefined && f.visibleTo !== 'all' && !Array.isArray(f.visibleTo)) throw new PilotError('invalid-event-audience');
        if (f.editableBy !== undefined && !Array.isArray(f.editableBy)) throw new PilotError('invalid-event-audience');
        for (const teamId of [...(Array.isArray(f.visibleTo) ? f.visibleTo : []), ...(f.editableBy || [])]) getRecord('teams', teamId);
        const dates = expandDates(f.date, f.endDate || f.date, f.skipWeekends === true);
        if (action.intent === 'update' && dates.length !== 1) throw new PilotError('edit-range-as-separate-events');
        for (const [i, date] of dates.entries()) {
          const eventId = dates.length === 1 ? id : `${id}_${i}`;
          const path = pathOf('event', eventId);
          await add(path, { title: clean(f.title, 160), description: clean(f.description), date, ...(action.intent === 'create' ? { time: '', color: '#bae6fd' } : {}), year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) - 1, category: f.category || 'כללי', visibleTo: f.visibleTo || 'all', editableBy: f.editableBy || [], importGroupId: proposalId, source: 'zoki' });
        }
        item.route = `/calendar?date=${dates[0] || f.date}`;
      } else if (action.kind === 'class') {
        if (!clean(f.name) || !clean(f.academicYear) || !safeId(f.academicYearId)) throw new PilotError('class-year-required');
        if (action.intent === 'create') {
          const year = context.records.find(record => record.kind === 'academicYears' && record.id === f.academicYearId || record.kind === 'classes' && record.data.academicYearId === f.academicYearId);
          if (!year) throw new PilotError('unknown-school-year');
          item.reads.push({ path: year.path, version: year.version || null });
          if (context.records.some(record => record.kind === 'classes' && record.data.academicYearId === f.academicYearId && normalizeName(record.data.name) === normalizeName(f.name))) throw new PilotError('duplicate-target');
        }
        if (f.teacherId) getRecord('staff', f.teacherId);
        await add(pathOf('class', id), { name: clean(f.name, 140), normalizedName: normalizeName(f.name), academicYear: f.academicYear, academicYearId: f.academicYearId, gradeLevel: f.gradeLevel || '', teacherId: f.teacherId || '', ...(action.intent === 'create' ? { staffIds: [], status: 'active' } : {}) });
        item.route = '/students';
      } else if (action.kind === 'student') {
        const classRecord = getRecord('classes', f.classId); const cls = classRecord.data;
        if (!clean(f.fullName) || !safeId(cls.academicYearId)) throw new PilotError('student-name-class-required');
        if (action.intent === 'create' && f.idNumber && context.records.some(record => record.kind === 'students' && record.data.idNumber === f.idNumber)) throw new PilotError('duplicate-target');
        if (action.intent === 'update' && getRecord('students', id).data.classId !== classRecord.id) throw new PilotError('student-transfer-requires-existing-workflow');
        await add(pathOf('student', id), { fullName: clean(f.fullName, 140), firstName: clean(f.firstName, 80), lastName: clean(f.lastName, 80), ...(f.idNumber ? { idNumber: clean(f.idNumber, 20) } : {}), classId: classRecord.id, className: cls.name, gradeLevel: cls.gradeLevel || '', academicYear: cls.academicYear, ...(action.intent === 'create' ? { trackIds: [], programTypes: [], status: 'active', currentEnrollmentId: `${id}__${cls.academicYearId}`, requirementStatus: {} } : {}) });
        if (action.intent === 'create') {
          await add(`${pathOf('student', id)}/history/${id}`, { type: 'student_created', studentId: id, nextClassId: cls.id || classRecord.id, effectiveDate: '' }, 'child');
          await add(`student_enrollments_${scope}/${id}__${cls.academicYearId}`, { studentId: id, academicYearId: cls.academicYearId, academicYearLabel: cls.academicYear, classId: classRecord.id, className: cls.name, grade: cls.gradeLevel || '', majorIds: [], studyProgramIds: [], enrollmentStatus: 'active', startDate: '', endDate: '', exitReason: '', displayName: f.fullName });
          await add(`personal_files_${scope}/${id}`, { studentId: id, status: 'active' });
          item.changes.forEach((change, index) => { change.batchGroup = index; });
        }
        item.route = `/students?student=${id}`;
      } else if (action.kind === 'mapping' || action.kind === 'gradebook') {
        const cls = getRecord('classes', f.classId);
        if (action.kind === 'gradebook' && action.intent === 'create') { id = `grades_${cls.id}_${cls.data.academicYearId || 'current'}`; requireId(id); item.id = id; named.set(action.key, id); }
        const columns = action.kind === 'mapping' ? f.columns : f.subjects;
        if (!Array.isArray(columns) || !columns.length || columns.length > 100 || new Set(columns.map(c => c.id)).size !== columns.length) throw new PilotError('invalid-columns');
        for (const col of columns) if (!safeId(col.id) || !clean(col.name || col.label) || (action.kind === 'mapping' && !['text', 'number', 'date', 'choice'].includes(col.type))) throw new PilotError('invalid-columns');
        if (action.kind === 'gradebook' && action.intent === 'create' && context.records.some(record => record.kind === 'gradebooks' && record.data.classId === cls.id && record.data.academicYearId === cls.data.academicYearId)) throw new PilotError('duplicate-target');
        await add(pathOf(action.kind, id), { ...(action.kind === 'mapping' ? { name: clean(f.name || `מיפוי ${cls.data.name}`, 140) } : {}), classId: cls.id, className: cls.data.name, academicYearId: cls.data.academicYearId, status: 'active', [action.kind === 'mapping' ? 'columns' : 'subjects']: columns });
        if (action.kind === 'gradebook' && action.intent === 'create') {
          item.changes.at(-1).batchGroup = 1;
          const folderId = `class_${cls.id}`; const folderPath = `schools/${scope}/folders/${folderId}`;
          if (!virtual.has(folderPath)) await add(folderPath, { name: `כיתה ${cls.data.name}`, classId: cls.id, className: cls.data.name, academicYearId: cls.data.academicYearId || '', visibility: 'class_restricted', specialFolder: true }, 'child');
          await add(`schools/${scope}/files/gradebook_${id}`, { name: `מיפוי ציונים - ${cls.data.name}`, fileType: 'gradebook', type: 'application/x-zoko-gradebook', folderId, classId: cls.id, className: cls.data.name, gradebookId: id, academicYearId: cls.data.academicYearId || '', academicYear: cls.data.academicYear || '', status: 'active', uploadedBy: actor.fullName }, 'child');
          item.changes.at(-1).batchGroup = 2;
          item.changes.sort((a,b) => (a.batchGroup || 0) - (b.batchGroup || 0));
        }
        item.route = action.kind === 'mapping' ? `/mappings?mapping=${id}` : `/files?openFile=gradebook_${id}`;
      } else if (action.kind === 'mappingRow' || action.kind === 'grade') {
        const parent = getRecord(action.kind === 'grade' ? 'gradebooks' : 'pedagogicalMappings', f.gradebookId || f.mappingId);
        const student = getRecord('students', f.studentId);
        if (student.data.classId !== parent.data.classId) throw new PilotError('student-class-mismatch');
        const path = `${parent.path}/${action.kind === 'grade' ? 'grades' : 'rows'}/${student.id}`;
        const old = virtual.get(path) || (parent.planned ? null : await db.get(path));
        let values;
        if (action.kind === 'grade') {
          if ((f.value == null || f.value === '') && f.clear !== true) { item.enabled = false; prepared.push(item); continue; }
          if (f.clear === true) f.value = null;
          const cell = `${path}/${f.subjectId}/${f.componentId}`;
          if (seenCells.has(cell)) throw new PilotError('conflicting-source-cells'); seenCells.add(cell);
          const subject = parent.data.subjects.find(s => s.id === f.subjectId);
          if (!subject || !(subject.components || []).some(c => c.id === f.componentId) || (f.value !== null && (!Number.isFinite(f.value) || f.value < 0 || f.value > 100))) throw new PilotError('invalid-grade-cell');
          values = { gradebookId: parent.id, scores: { ...old?.data.scores, [f.subjectId]: { ...old?.data.scores?.[f.subjectId], [f.componentId]: f.value } }, calculated: { ...old?.data.calculated } };
          values.calculated = calculateGradebook(parent.data.subjects, values.scores);
        } else {
          if (!f.values || typeof f.values !== 'object' || Array.isArray(f.values)) throw new PilotError('invalid-mapping-values');
          const incoming = Object.fromEntries(Object.entries(f.values).filter(([, v]) => v !== '' && v != null));
          for (const [key, value] of Object.entries(incoming)) {
            const cell = `${path}/${key}`; if (seenCells.has(cell)) throw new PilotError('conflicting-source-cells'); seenCells.add(cell);
            const col = parent.data.columns.find(c => c.id === key);
            if (!col || (col.type === 'number' && !Number.isFinite(value)) || (col.type === 'choice' && !(col.options || []).includes(value)) || (col.type === 'text' && typeof value !== 'string')) throw new PilotError('invalid-mapping-cell');
            if (col.type === 'date') expandDates(value);
          }
          const cleared = f.clearColumns || [];
          if (!Array.isArray(cleared) || cleared.some(key => !parent.data.columns.some(col => col.id === key))) throw new PilotError('invalid-mapping-cell');
          const merged = { ...old?.data.values, ...incoming };
          for (const key of cleared) delete merged[key];
          values = { mappingId: parent.id, values: merged };
        }
        await add(path, { ...values, classId: student.data.classId, studentId: student.id, displayName: student.data.fullName }, 'child');
      } else if (action.kind === 'attendanceSheet') {
        if (action.intent !== 'create') throw new PilotError('edit-attendance-through-existing-sheet');
        const cls = getRecord('classes', f.classId);
        const dates = expandDates(f.startDate, f.endDate);
        if (!clean(f.name) || !cls.data.academicYearId) throw new PilotError('class-year-required');
        if (context.records.some(record => record.kind === 'files' && record.data.fileType === 'attendance' && record.data.classId === cls.id && record.data.academicYearId === cls.data.academicYearId && record.data.status !== 'archived')) throw new PilotError('existing-attendance-sheet');
        const students = [...virtual.values()].filter(record => record.kind === 'students' && record.data.classId === cls.id && record.data.status !== 'archived');
        const filePath = pathOf('attendanceSheet', id); const folderId = `class_${cls.id}`;
        const folderPath = `schools/${scope}/folders/${folderId}`;
        if (!virtual.has(folderPath)) await add(folderPath, { name: `כיתה ${cls.data.name}`, classId: cls.id, className: cls.data.name, academicYearId: cls.data.academicYearId, visibility: 'class_restricted', specialFolder: true }, 'child');
        await add(filePath, { name: clean(f.name, 140), fileType: 'attendance', type: 'application/x-attendance-sheet', folderId, classId: cls.id, className: cls.data.name, academicYearId: cls.data.academicYearId, academicYear: cls.data.academicYear || '', dateRange: { start: f.startDate, end: f.endDate }, timezone: 'Asia/Jerusalem', status: 'active', setupStatus: 'creating', studentCount: students.length, scheduledDayCount: dates.length, size: 0, uploadedBy: actor.fullName });
        const initial = item.changes.at(-1); initial.batchGroup = 1;
        const firstPhase = item.changes.length;
        for (const legend of DEFAULT_ATTENDANCE_LEGEND) await add(`${filePath}/attendanceLegend/${legend.id}`, { ...legend, fileId: id }, 'child');
        for (const [order, student] of students.entries()) await add(`${filePath}/attendanceMembers/${student.id}`, { fileId: id, classId: cls.id, studentId: student.id, displayName: student.data.fullName, joinedAt: '', endDate: '', status: 'active', included: true, order }, 'child');
        for (const dateKey of dates) await add(`${filePath}/attendanceDays/${dateKey}`, { fileId: id, dateKey, scheduled: true, blocked: false, blockedReason: '', source: 'manual' }, 'child');
        for (const change of item.changes.slice(firstPhase)) change.batchGroup = 2;
        item.changes.push({ path: filePath, data: { ...initial.data, setupStatus: 'ready' }, patch: { setupStatus: 'ready', updatedBy: actor.uid }, expected: initial.data, version: null, timestamps: ['updatedAt'], batchGroup: 3 });
        item.route = `/files?openFile=${id}`;
      } else if (action.kind === 'attendance') {
        const file = getRecord('files', f.fileId); const student = getRecord('students', f.studentId);
        if (file.data.fileType !== 'attendance' || file.data.classId !== student.data.classId) throw new PilotError('student-class-mismatch');
        expandDates(f.dateKey); requireId(f.primaryStatusId);
        const legend = virtual.get(`${file.path}/attendanceLegend/${f.primaryStatusId}`) || await db.get(`${file.path}/attendanceLegend/${f.primaryStatusId}`);
        if (!legend || legend.data.active === false) throw new PilotError('unknown-attendance-status');
        item.reads.push({ path: legend.path, version: legend.planned ? null : legend.version || null });
        const recordId = attendanceRecordId(student.id, f.dateKey);
        const recordPath = `${file.path}/attendanceRecords/${recordId}`;
        const previous = file.planned ? null : await db.get(recordPath);
        const next = { primaryStatusId: f.primaryStatusId, actionIds: previous?.data.actionIds || [], note: f.note === undefined ? previous?.data.note || '' : clean(f.note) };
        await add(recordPath, { fileId: file.id, studentId: student.id, classId: student.data.classId, dateKey: f.dateKey, ...next }, 'child');
        await add(`${file.path}/attendanceHistory/${id}`, { fileId: file.id, classId: student.data.classId, recordId, studentId: student.id, dateKey: f.dateKey, type: previous ? 'cell_updated' : 'cell_created', previous: previous ? { primaryStatusId: previous.data.primaryStatusId, actionIds: previous.data.actionIds || [], note: previous.data.note || '' } : null, next }, 'history');
        item.route = '/files';
      } else if (action.kind === 'task') {
        if (!clean(f.title)) throw new PilotError('title-required');
        const requestedRecipients = f.teamId ? getRecord('teams', f.teamId).data.memberIds || [] : f.assigneeIds;
        if (!Array.isArray(requestedRecipients)) throw new PilotError('task-recipients-required');
        const recipients = [...new Set(requestedRecipients)];
        if (!Array.isArray(recipients) || !recipients.length || recipients.length > 50) throw new PilotError('task-recipients-required');
        recipients.forEach(uid => getRecord('staff', uid));
        if (f.dueDate) expandDates(f.dueDate);
        if (recipients.some(uid => getRecord('staff', uid).data.active === false)) throw new PilotError('inactive-recipient');
        const old = action.intent === 'create' ? null : getRecord('tasks', id);
        if (old?.path.startsWith(`tasks_${scope}/`)) {
          if (old.data.assignmentVersion === 2) throw new PilotError('legacy-task-server-required');
          const newRecipients = recipients.filter(uid => !(old.data.assigneeIds || []).includes(uid));
          const updates = { title: clean(f.title, 180), description: clean(f.description, 8000), dueDate: f.dueDate || '', priority: f.priority || 'medium' };
          if (f.teamId) Object.assign(updates, { teamId: f.teamId, assigneeTeamId: f.teamId, scope: 'team', assigneeType: 'team' });
          let previous = old;
          for (const [index, uid] of (newRecipients.length ? newRecipients : [null]).entries()) {
            const patch = { ...updates, updatedBy: actor.uid, ...(uid ? { assigneeIds: uniqueIds([...(previous.data.assigneeIds || []), uid]), participantIds: uniqueIds([...(previous.data.participantIds || []), uid]), lastAssignedStaffId: uid } : {}) };
            const change = { path: old.path, before: previous.data, patch, data: { ...previous.data, ...patch }, version: index ? null : old.version, timestamps: ['updatedAt'], batchGroup: index };
            if (index) change.expected = Object.fromEntries(Object.entries(previous.data).filter(([key]) => !['updatedAt', 'createdAt'].includes(key)));
            item.changes.push(change); previous = { ...old, data: change.data };
          }
          item.route = `/tasks?task=${id}`;
        } else {
        const task = initializeAssignments(old?.data || { assigneeIds: [], status: 'todo' });
        const sources = { ...task.assignmentSources };
        const progressBy = { ...task.progressBy };
        for (const uid of recipients) {
          sources[uid] = uniqueIds([...(sources[uid] || []), f.teamId ? `team:${f.teamId}` : 'direct']);
          progressBy[uid] ||= { status: 'todo' };
        }
        const assigneeIds = Object.keys(sources).filter(uid => sources[uid].length);
        const status = progressSummary({ ...task, assignmentVersion: 2, assignmentSources: sources, progressBy });
        const taskPath = old?.path || `schools/${scope}/tasks/${id}`;
        await add(taskPath, { title: clean(f.title, 180), description: clean(f.description, 8000), dueDate: f.dueDate || '', priority: f.priority || 'medium', scope: f.teamId ? 'team' : 'assigned', ownerId: '', assigneeType: f.teamId ? 'team' : 'individual', teamId: f.teamId || '', assigneeTeamId: f.teamId || '', assigneeIds, participantIds: uniqueIds([...(task.participantIds || []), ...assigneeIds]), assignmentVersion: 2, assignmentSources: sources, progressBy, status: status.status, completionCount: status.done, startedCount: assigneeIds.filter(uid => progressBy[uid].status !== 'todo').length, localPilot: true, ...(old ? {} : { createdByName: actor.fullName, listId: '' }) });
        item.route = `/tasks?task=${id}`;
        for (const uid of recipients) await add(`notifications/zi_${digest([proposalId, action.key, uid]).slice(0, 28)}`, { userId: uid, schoolId: scope, title: old ? 'עדכון משימה' : 'משימה חדשה', body: clean(f.title, 180), link: item.route, taskId: id, type: 'task', read: false, localPilot: true }, 'notification');
        }
      }
      if (action.matchAliases.length > 100) throw new PilotError('too-many-aliases');
      for (const alias of action.matchAliases) {
        if (!['classes', 'students'].includes(alias.entityType) || !clean(alias.name, 140)) throw new PilotError('invalid-alias');
        const target = getRecord(alias.entityType, alias.targetId);
        const cls = alias.entityType === 'classes' ? target : getRecord('classes', target.data.classId);
        if (!safeId(cls.data.academicYearId) || alias.academicYearId !== cls.data.academicYearId) throw new PilotError('alias-year-mismatch');
        const aliasPath = `users/${actor.uid}/zokiPilot/${scope}/aliases/${digest([alias.entityType, normalizeName(alias.name), alias.academicYearId])}`;
        const oldAlias = virtual.get(aliasPath) || await db.get(aliasPath);
        if (oldAlias?.data.targetId === target.id) continue;
        if (seenWrites.has(aliasPath)) throw new PilotError('conflicting-alias');
        const data = { name: clean(alias.name, 140), entityType: alias.entityType, academicYearId: alias.academicYearId, targetId: target.id, schoolId: scope, updatedBy: actor.uid };
        item.changes.push({ path: aliasPath, before: oldAlias?.data || null, data, patch: data, version: oldAlias?.version || null, timestamps: ['updatedAt'] });
      }
      item.notificationCount = item.changes.filter(change => change.path.startsWith('notifications/')).length;
      if (item.changes.length > 10000) throw new PilotError('action-too-large');
      if (action.intent !== 'create' && action.kind in resources && !find(resources[action.kind], id)) throw new PilotError('unresolved-target');
      for (const change of item.changes) { seenWrites.add(change.path); virtual.set(change.path, { ...change, planned: true, id: change.path.split('/').pop(), kind: change.path === pathOf(action.kind, item.id) || action.kind === 'task' && change.path.includes('/tasks/') ? resources[action.kind] : 'child' }); }
    } catch (error) { item.errors.push(error.code || 'invalid-action'); item.changes = []; }
    prepared.push(item);
  }
  const proposal = { id: proposalId, revision, schoolId: scope, actorId: actor.uid, answer: normalized.answer, excludedSources: normalized.excludedSources, items: prepared };
  proposal.hash = digest(proposal);
  proposal.root = root;
  return proposal;
}
export async function executeProposal(db, actor, proposal, approvedHash, onProgress = () => {}, ensureActive = () => {}) {
  if (actor.uid !== proposal.actorId || actor.schoolId !== proposal.schoolId || proposal.hash !== approvedHash) throw new PilotError('approval-changed');
  const active = proposal.items.filter(item => item.enabled);
  if (active.some(item => item.errors.length || item.needsReview)) throw new PilotError('unresolved-proposal');
  const results = [];
  for (const item of active) {
    let committedWrites = 0; let pendingCheckpoint = null; let pendingCount = 0;
    try {
      ensureActive(); await db.actor(actor.schoolId);
      const receiptPath = `${proposal.root}/receipts/${item.key}`;
      const existing = await db.get(receiptPath);
      if (existing) { if (existing.data.hash !== proposal.hash) throw new PilotError('approval-changed'); results.push(existing.data); continue; }
      const resumed = new Map();
      for (let offset = 0; offset < item.changes.length;) {
        const group = item.changes[offset].batchGroup || 0;
        let end = offset;
        while (end < Math.min(offset + 6, item.changes.length) && (item.changes[end].batchGroup || 0) === group) end++;
        const checkpoint = await db.get(`${proposal.root}/checkpoints/${item.key}_${offset}`);
        if (!checkpoint) break;
        if (checkpoint.data.hash !== proposal.hash) throw new PilotError('approval-changed');
        for (const change of item.changes.slice(offset, end)) resumed.set(change.path, change.data);
        offset = end;
      }
      for (const read of item.reads) {
        const current = await db.get(read.path);
        const ownWrite = resumed.get(read.path);
        const expected = ownWrite ? Object.fromEntries(Object.entries(ownWrite).filter(([key]) => !['updatedAt', 'createdAt'].includes(key))) : read.expected;
        if (!current || (!ownWrite && read.version && current.version !== read.version) || (expected && Object.entries(expected).some(([key, value]) => digest(current.data[key]) !== digest(value)))) throw new PilotError('data-changed');
      }
      // A small batch also respects Firestore's per-request rule lookup budget.
      // Each checkpoint and its target writes commit together, so a dropped
      // response can be retried without repeating already committed operations.
      for (let start = 0; start < item.changes.length;) {
        ensureActive(); await db.actor(actor.schoolId);
        const group = item.changes[start].batchGroup || 0;
        const chunk = [];
        for (let index = start; index < Math.min(start + 6, item.changes.length) && (item.changes[index].batchGroup || 0) === group; index++) chunk.push({ ...item.changes[index] });
        const checkpoint = `${proposal.root}/checkpoints/${item.key}_${start}`;
        const saved = await db.get(checkpoint);
        if (saved) { if (saved.data.hash !== proposal.hash) throw new PilotError('approval-changed'); committedWrites += chunk.length; start += chunk.length; continue; }
        for (const change of chunk) if (change.expected) {
          const current = await db.get(change.path);
          if (!current || Object.entries(change.expected).some(([key, value]) => digest(current.data[key]) !== digest(value))) throw new PilotError('data-changed');
          change.version = current.version;
        }
        ensureActive();
        pendingCheckpoint = checkpoint; pendingCount = chunk.length;
        await db.commit([...chunk, { path: checkpoint, data: { hash: proposal.hash, count: chunk.length }, timestamps: ['createdAt'] }]);
        committedWrites += chunk.length; start += chunk.length; pendingCheckpoint = null;
      }
      ensureActive();
      const receipt = { actorId: actor.uid, schoolId: actor.schoolId, hash: proposal.hash, itemId: item.key, route: item.route, status: 'done', committedWrites };
      await db.commit([{ path: receiptPath, data: receipt, timestamps: ['createdAt'] }]);
      results.push(receipt); onProgress(results);
    } catch (error) {
      let confirmationPending = Boolean(pendingCheckpoint) && !['permission-denied','session-expired','data-changed','invalid-value'].includes(error.code);
      if (confirmationPending) {
        try { const saved = await db.get(pendingCheckpoint); if (saved?.data.hash === proposal.hash) committedWrites += pendingCount; confirmationPending = false; } catch { /* A network outage cannot be reported as proof of rollback. */ }
      }
      results.push({ itemId: item.key, status: 'failed', committedWrites, confirmationPending, code: error.code || 'save-failed' }); break;
    }
  }
  return results;
}
