// Turns the names in a Zoki proposal into record ids, in the browser, with the user's own read permissions.
// Zoki never sees ids and the user never has to type one: "הכיתה של יעקב" is enough.
import { NAME_FIELDS } from '../../worker/src/zokiActionTools.js';

const KIND = {
  classId: 'classes', taskId: 'tasks', assigneeId: 'staff', ownerId: 'staff', userId: 'staff', teacherId: 'staff',
  teamId: 'teams', studentId: 'students', memberIds: 'staff',
};
const KIND_LABEL = { classes: 'כיתה', tasks: 'משימה', staff: 'איש צוות', teams: 'צוות', students: 'תלמיד/ה' };

// Hebrew quote marks, punctuation and spacing differ between what people type and what is stored.
export function normalizeName(value) {
  return String(value || '').toLocaleLowerCase('he')
    .replace(/["'`׳״’‘“”.,:;()[\]-]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

// One record for a name: an exact match wins; otherwise a single partial match. Several matches are never guessed.
export function matchByName(list, name) {
  const wanted = normalizeName(name);
  if (!wanted) return { error: 'missing' };
  const rows = list.map(item => ({ item, key: normalizeName(item.label) })).filter(row => row.key);
  const exact = rows.filter(row => row.key === wanted);
  if (exact.length === 1) return { item: exact[0].item };
  const pool = exact.length > 1 ? exact : rows.filter(row => row.key.includes(wanted) || wanted.includes(row.key));
  if (pool.length === 1) return { item: pool[0].item };
  if (!pool.length) return { error: 'none' };
  return { error: 'many', options: pool.slice(0, 6).map(row => row.item.label) };
}

function explain(kind, name, result) {
  const what = KIND_LABEL[kind] || 'רשומה';
  if (result.error === 'many') return `יש כמה התאמות ל„${name}” (${what}): ${result.options.join(', ')}. כתבו את השם המלא ואנסה שוב.`;
  return `לא מצאתי ${what} בשם „${name}”. בדקו את השם ונסו שוב.`;
}

async function defaultLoaders(schoolId) {
  const [{ collection, getDocs, query, where }, { db }, paths] = await Promise.all([
    import('firebase/firestore'), import('../firebase.js'), import('./firestore/paths.js'),
  ]);
  const { schoolCollection } = paths;
  const rows = (snap, label) => snap.docs.map(item => ({ id: item.id, label: label(item.data()), data: item.data() }));
  const safe = promise => promise.catch(() => ({ docs: [] }));
  return {
    classes: async () => rows(await getDocs(schoolCollection(db, schoolId, 'classes')), data => data.name).filter(item => item.data.status !== 'archived'),
    students: async () => rows(await getDocs(schoolCollection(db, schoolId, 'students')), data => data.fullName || [data.firstName, data.lastName].filter(Boolean).join(' ')),
    tasks: async () => rows(await getDocs(schoolCollection(db, schoolId, 'tasks', 'nested')), data => data.title),
    teams: async () => {
      const [nested, legacy] = await Promise.all([safe(getDocs(schoolCollection(db, schoolId, 'teams', 'nested'))), safe(getDocs(collection(db, `teams_${schoolId}`)))]);
      return [...new Map([...rows(nested, data => data.name), ...rows(legacy, data => data.name)].map(item => [item.id, item])).values()].filter(item => item.data.status !== 'archived');
    },
    staff: async () => {
      const [one, many] = await Promise.all([
        safe(getDocs(query(collection(db, 'users'), where('schoolId', '==', schoolId)))),
        safe(getDocs(query(collection(db, 'users'), where('schoolIds', 'array-contains', schoolId)))),
      ]);
      return [...new Map([...rows(one, data => data.fullName), ...rows(many, data => data.fullName)].map(item => [item.id, item])).values()];
    },
    attendanceFiles: async () => rows(await getDocs(query(schoolCollection(db, schoolId, 'files', 'nested'), where('fileType', '==', 'attendance'))), data => data.className || data.name).filter(item => item.data.status !== 'archived' && !item.data.trashedAt),
    legend: async fileId => rows(await getDocs(collection(db, 'schools', schoolId, 'files', fileId, 'attendanceLegend')), data => data.label),
  };
}

// Returns { proposal, labels } with ids filled in, or { error } with a sentence the user can act on.
export async function resolveZokiProposal(proposal, { schoolId }, loaders) {
  const input = { ...(proposal?.input || {}) };
  const load = loaders || await defaultLoaders(schoolId);
  const cache = new Map();
  const list = kind => { if (!cache.has(kind)) cache.set(kind, load[kind]()); return cache.get(kind); };
  const labels = {};

  // "י״ב" may be a class name or a whole grade: when no class carries that name, list the grade.
  if (proposal?.tool === 'list_class_students' && !input.classId && input.className) {
    const gradeKey = value => String(value || '').replace(/[^\p{L}\p{N}]/gu, '');
    const records = await list('classes');
    if (matchByName(records, input.className).error && records.some(item => gradeKey(item.data.gradeLevel) === gradeKey(input.className))) {
      input.gradeLevel = input.className;
      delete input.className;
    }
  }

  for (const [idKey, kind] of Object.entries(KIND)) {
    const nameKey = NAME_FIELDS[idKey];
    if (idKey === 'memberIds') {
      const names = [...(Array.isArray(input.memberNames) ? input.memberNames : []), ...(Array.isArray(input.memberIds) ? input.memberIds : [])].filter(Boolean);
      if (!names.length) continue;
      const people = await list(kind);
      const found = [];
      for (const name of names) {
        const byId = people.find(item => item.id === name);
        const result = byId ? { item: byId } : matchByName(people, name);
        if (result.error) return { error: explain(kind, name, result) };
        found.push(result.item.id); labels[result.item.id] = result.item.label;
      }
      input.memberIds = [...new Set(found)];
      continue;
    }
    const given = String(input[idKey] || '').trim();
    const name = String(input[nameKey] || '').trim();
    if (!given && !name) continue;
    // A student name on a read is matched later by the reader itself.
    if (idKey === 'studentId' && proposal.tool === 'read_attendance' && !given) continue;
    const records = await list(kind);
    const byId = given && records.find(item => item.id === given);
    // The model sometimes puts the name in the id field: treat an unknown id as a name.
    const result = byId ? { item: byId } : matchByName(records, name || given);
    if (result.error) return { error: explain(kind, name || given, result) };
    input[idKey] = result.item.id;
    labels[result.item.id] = result.item.label;
  }

  // An attendance edit names a class, not a sheet file: find that class's sheet and the status by its label.
  if (['edit_attendance_cell', 'edit_attendance_note'].includes(proposal?.tool)) {
    const files = await list('attendanceFiles');
    let file = files.find(item => item.id === input.fileId);
    if (!file) {
      const student = input.studentId ? (await list('students')).find(item => item.id === input.studentId) : null;
      const classId = input.classId || student?.data.classId || '';
      const candidates = files.filter(item => item.data.classId === classId && (!input.dateKey || !item.data.dateRange?.start || (item.data.dateRange.start <= input.dateKey && input.dateKey <= item.data.dateRange.end)));
      if (candidates.length !== 1) return { error: candidates.length ? 'יש כמה גיליונות נוכחות לכיתה הזאת בתאריך הזה. פתחו את הגיליון הרצוי ועדכנו שם.' : 'לא מצאתי גיליון נוכחות לכיתה ולתאריך האלה.' };
      file = candidates[0];
    }
    input.fileId = file.id;
    input.classId = file.data.classId || input.classId || '';
    labels[file.id] = file.label;
    if (proposal.tool === 'edit_attendance_cell') {
      const legend = await load.legend(file.id);
      const wanted = String(input.statusLabel || input.statusId || '').trim();
      if (wanted) {
        const result = legend.find(item => item.id === wanted) ? { item: legend.find(item => item.id === wanted) } : matchByName(legend, wanted);
        if (result.error) return { error: `לא מצאתי במקרא של הגיליון סטטוס בשם „${wanted}”. הסטטוסים הקיימים: ${legend.map(item => item.label).join(', ') || 'אין'}.` };
        input.statusId = result.item.id; labels[result.item.id] = result.item.label;
      }
    }
  }
  return { proposal: { ...proposal, input }, labels };
}

// The confirm card shows names, never ids.
export function labelCard(card, labels = {}) {
  if (!card) return card;
  const ids = Object.keys(labels).sort((a, b) => b.length - a.length);
  const lines = (card.lines || []).map(line => ids.reduce((text, id) => String(text).split(id).join(labels[id]), line));
  return { ...card, lines };
}
