import { createStudent } from './classStudentRepository.js';

const normalizeIdentity = value => String(value || '').normalize('NFKC').replace(/[^0-9A-Za-z]/gu, '').toUpperCase();

export async function importStudentsDirect({ db, schoolId, actor, students, classes, existingStudents = [], requestId }) {
  const classById = new Map(classes.map(item => [item.id, item]));
  const existingIdentities = new Set(existingStudents.map(item => normalizeIdentity(item.idNumber)).filter(Boolean));
  const totals = { requested: students.length, created: 0, updated: 0, skipped: 0, failed: 0 };
  const errors = [];

  for (const row of students) {
    const identity = normalizeIdentity(row.idNumber);
    const classItem = classById.get(row.classId);
    if (!identity || !classItem) {
      totals.failed += 1;
      errors.push({ rowId: row.rowId, reason: classItem ? 'invalid-identifier' : 'class-not-found' });
      continue;
    }
    if (existingIdentities.has(identity)) {
      totals.skipped += 1;
      errors.push({ rowId: row.rowId, reason: 'duplicate-skipped' });
      continue;
    }
    try {
      await createStudent({
        db,
        schoolId,
        actor,
        classItem,
        input: {
          ...row,
          trackIds: Array.isArray(row.trackIds) ? row.trackIds : [],
          programTypes: Array.isArray(row.programTypes) ? row.programTypes : [],
        },
      });
      existingIdentities.add(identity);
      totals.created += 1;
    } catch (error) {
      totals.failed += 1;
      errors.push({ rowId: row.rowId, reason: String(error?.code || error?.message || 'write-failed') });
    }
  }
  return { requestId, idempotentReplay: false, totals, errors };
}
