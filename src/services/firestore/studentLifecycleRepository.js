import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { academicYearIdFromLegacy } from './academicYearRepository';
import { schoolCollection, schoolDoc } from './paths';

export const ENROLLMENT_STATUS = Object.freeze({
  ACTIVE: 'active',
  COMPLETED: 'completed',
  GRADUATED: 'graduated',
  WITHDRAWN: 'withdrawn',
  DROPOUT: 'dropout',
  TRANSFERRED: 'transferred',
});

const WRITE_GROUP_SIZE = 100;

export function studentEnrollmentId(studentId, academicYearId) {
  return `${studentId}__${academicYearId}`;
}

export function enrollmentFromStudent({ student, classItem, academicYearId }) {
  return {
    id: studentEnrollmentId(student.id, academicYearId),
    studentId: student.id,
    schoolId: student.schoolId,
    academicYearId,
    academicYearLabel: classItem?.academicYear || student.academicYear || '',
    classId: classItem?.id || student.classId || '',
    className: classItem?.name || student.className || '',
    grade: classItem?.gradeLevel || student.gradeLevel || '',
    majorIds: student.trackIds || [],
    studyProgramIds: student.programTypes || [],
    enrollmentStatus: student.status === 'graduated' ? ENROLLMENT_STATUS.GRADUATED : ENROLLMENT_STATUS.ACTIVE,
    startDate: student.joinedAt || '',
    endDate: student.endDate || '',
    exitReason: '',
    displayName: student.fullName || '',
    legacy: true,
  };
}

export function enrollmentFields({ student, classItem, academicYear, status = ENROLLMENT_STATUS.ACTIVE, startDate = '' }) {
  return {
    studentId: student.id,
    schoolId: student.schoolId,
    academicYearId: academicYear.id,
    academicYearLabel: academicYear.label,
    classId: classItem.id,
    className: classItem.name,
    grade: classItem.gradeLevel || '',
    majorIds: student.trackIds || [],
    studyProgramIds: student.programTypes || [],
    enrollmentStatus: status,
    startDate,
    endDate: '',
    exitReason: '',
    displayName: student.fullName || '',
  };
}

export function subscribeStudentEnrollments({ db, schoolId, academicYearId, classIds, canViewAll, onData, onError }) {
  const ref = schoolCollection(db, schoolId, 'studentEnrollments');
  const sources = canViewAll
    ? [query(ref, where('academicYearId', '==', academicYearId))]
    : classIds.map(classId => query(ref, where('classId', '==', classId)));
  if (sources.length === 0) {
    onData([]);
    return () => undefined;
  }
  const sets = new Map();
  const emit = () => {
    const merged = new Map();
    sets.forEach(items => items.forEach(item => merged.set(item.id, item)));
    onData([...merged.values()]);
  };
  const unsubscribers = sources.map((source, index) => onSnapshot(source, snapshot => {
    sets.set(index, snapshot.docs
      .map(item => ({ id: item.id, ...item.data() }))
      .filter(item => item.academicYearId === academicYearId));
    emit();
  }, onError));
  return () => unsubscribers.forEach(unsubscribe => unsubscribe());
}

function enrollmentRef(db, schoolId, studentId, academicYearId) {
  return schoolDoc(db, schoolId, 'studentEnrollments', studentEnrollmentId(studentId, academicYearId));
}

async function assertNoDuplicateEnrollments({ db, schoolId, students, academicYearId }) {
  const snapshots = await Promise.all(students.map(student => getDoc(enrollmentRef(
    db, schoolId, student.id, academicYearId,
  ))));
  if (snapshots.some(snapshot => snapshot.exists())) throw new Error('ENROLLMENT_EXISTS');
}

async function commitGroups(db, items, appendOperations) {
  for (let index = 0; index < items.length; index += WRITE_GROUP_SIZE) {
    const batch = writeBatch(db);
    items.slice(index, index + WRITE_GROUP_SIZE).forEach(item => appendOperations(batch, item));
    await batch.commit();
  }
}

function priorEnrollmentData({ student, enrollment, currentClass, academicYear }) {
  if (enrollment && !enrollment.legacy) return enrollment;
  const yearId = enrollment?.academicYearId
    || academicYear?.id
    || academicYearIdFromLegacy(student.academicYear);
  if (!yearId) throw new Error('AMBIGUOUS_ACADEMIC_YEAR');
  return enrollmentFromStudent({ student, classItem: currentClass, academicYearId: yearId });
}

function persistedEnrollment(value) {
  const data = { ...value };
  delete data.id;
  delete data.legacy;
  return data;
}

export async function transferEnrollmentWithinYear({ db, schoolId, actor, student, enrollment, nextClass, effectiveDate, reason }) {
  if (!actor?.uid || !enrollment?.academicYearId || !nextClass?.id) throw new Error('INVALID_TRANSFER');
  const nextYearId = nextClass.academicYearId || academicYearIdFromLegacy(nextClass.academicYear);
  if (nextYearId !== enrollment.academicYearId) throw new Error('CROSS_YEAR_TRANSFER');
  const currentRef = enrollmentRef(db, schoolId, student.id, enrollment.academicYearId);
  const studentRef = schoolDoc(db, schoolId, 'students', student.id);
  const historyRef = doc(collection(studentRef, 'history'));
  const batch = writeBatch(db);
  const existing = await getDoc(currentRef);
  const current = persistedEnrollment(enrollment);
  if (existing.exists()) batch.update(currentRef, {
    classId: nextClass.id,
    className: nextClass.name,
    grade: nextClass.gradeLevel || '',
    updatedBy: actor.uid,
    updatedAt: serverTimestamp(),
  });
  else batch.set(currentRef, {
    ...current,
    classId: nextClass.id,
    className: nextClass.name,
    grade: nextClass.gradeLevel || '',
    createdBy: actor.uid,
    updatedBy: actor.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.update(studentRef, {
    classId: nextClass.id,
    className: nextClass.name,
    gradeLevel: nextClass.gradeLevel || '',
    academicYear: nextClass.academicYear,
    currentEnrollmentId: currentRef.id,
    status: 'active',
    joinedAt: effectiveDate,
    endDate: '',
    updatedBy: actor.uid,
    updatedAt: serverTimestamp(),
  });
  batch.set(historyRef, {
    type: 'class_transfer', schoolId, studentId: student.id,
    previousClassId: enrollment.classId || '', previousClassName: enrollment.className || '',
    nextClassId: nextClass.id, nextClassName: nextClass.name,
    academicYearId: enrollment.academicYearId, effectiveDate, reason: reason?.trim() || '',
    createdBy: actor.uid, createdAt: serverTimestamp(),
  });
  await batch.commit();
}

export async function promoteStudents({ db, schoolId, actor, selections, sourceAcademicYear, targetAcademicYear, targetClass, effectiveDate }) {
  if (!actor?.uid || !sourceAcademicYear?.id || !targetAcademicYear?.id || !targetClass?.id) throw new Error('INVALID_PROMOTION');
  if (sourceAcademicYear.id === targetAcademicYear.id) throw new Error('SAME_ACADEMIC_YEAR');
  const targetClassYearId = targetClass.academicYearId || academicYearIdFromLegacy(targetClass.academicYear);
  if (targetClassYearId !== targetAcademicYear.id) throw new Error('INVALID_TARGET_CLASS');
  const students = selections.map(item => item.student);
  await assertNoDuplicateEnrollments({ db, schoolId, students, academicYearId: targetAcademicYear.id });
  await commitGroups(db, selections, (batch, selection) => {
    const { student, enrollment, currentClass } = selection;
    const prior = priorEnrollmentData({ student, enrollment, currentClass, academicYear: sourceAcademicYear });
    const priorRef = enrollmentRef(db, schoolId, student.id, prior.academicYearId);
    const nextRef = enrollmentRef(db, schoolId, student.id, targetAcademicYear.id);
    const studentRef = schoolDoc(db, schoolId, 'students', student.id);
    const historyRef = doc(collection(studentRef, 'history'));
    batch.set(priorRef, {
      ...persistedEnrollment(prior),
      enrollmentStatus: ENROLLMENT_STATUS.COMPLETED,
      endDate: effectiveDate,
      updatedBy: actor.uid,
      updatedAt: serverTimestamp(),
      createdBy: prior.createdBy || actor.uid,
      createdAt: prior.createdAt || serverTimestamp(),
    }, { merge: true });
    batch.set(nextRef, {
      ...enrollmentFields({ student, classItem: targetClass, academicYear: targetAcademicYear, startDate: effectiveDate }),
      createdBy: actor.uid, updatedBy: actor.uid,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    batch.update(studentRef, {
      classId: targetClass.id, className: targetClass.name, gradeLevel: targetClass.gradeLevel || '',
      academicYear: targetAcademicYear.label, currentEnrollmentId: nextRef.id,
      status: 'active', joinedAt: effectiveDate, endDate: '',
      updatedBy: actor.uid, updatedAt: serverTimestamp(),
    });
    batch.set(historyRef, {
      type: 'student_promoted', schoolId, studentId: student.id,
      previousClassId: prior.classId || '', previousAcademicYearId: prior.academicYearId,
      nextClassId: targetClass.id, nextAcademicYearId: targetAcademicYear.id,
      effectiveDate, createdBy: actor.uid, createdAt: serverTimestamp(),
    });
  });
}

export async function changeEnrollmentStatus({ db, schoolId, actor, selections, status, effectiveDate, reason = '', note = '', graduationYear = '' }) {
  if (!actor?.uid || selections.length === 0) throw new Error('INVALID_STATUS_CHANGE');
  if (!Object.values(ENROLLMENT_STATUS).includes(status) || status === ENROLLMENT_STATUS.COMPLETED) throw new Error('INVALID_STATUS');
  await commitGroups(db, selections, (batch, selection) => {
    const { student, enrollment, currentClass, academicYear } = selection;
    const current = priorEnrollmentData({ student, enrollment, currentClass, academicYear });
    const currentRef = enrollmentRef(db, schoolId, student.id, current.academicYearId);
    const studentRef = schoolDoc(db, schoolId, 'students', student.id);
    const historyRef = doc(collection(studentRef, 'history'));
    batch.set(currentRef, {
      ...persistedEnrollment(current),
      enrollmentStatus: status,
      endDate: status === ENROLLMENT_STATUS.ACTIVE ? '' : effectiveDate,
      exitReason: status === ENROLLMENT_STATUS.ACTIVE ? '' : reason.trim(),
      exitNote: status === ENROLLMENT_STATUS.ACTIVE ? '' : note.trim().slice(0, 1000),
      graduationYear: status === ENROLLMENT_STATUS.GRADUATED ? graduationYear : '',
      updatedBy: actor.uid, updatedAt: serverTimestamp(),
      createdBy: current.createdBy || actor.uid,
      createdAt: current.createdAt || serverTimestamp(),
    }, { merge: true });
    batch.update(studentRef, {
      status,
      endDate: status === ENROLLMENT_STATUS.ACTIVE ? '' : effectiveDate,
      updatedBy: actor.uid,
      updatedAt: serverTimestamp(),
    });
    batch.set(historyRef, {
      type: status === ENROLLMENT_STATUS.ACTIVE ? 'student_restored' : `student_${status}`,
      schoolId, studentId: student.id, academicYearId: current.academicYearId,
      classId: current.classId || '', effectiveDate,
      reason: reason.trim(), note: note.trim().slice(0, 1000), graduationYear,
      createdBy: actor.uid, createdAt: serverTimestamp(),
    });
  });
}
