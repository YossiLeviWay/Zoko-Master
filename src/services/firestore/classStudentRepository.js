import {
  collection,
  doc,
  getDocs,
  documentId,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { schoolCollection, schoolDoc } from './paths';
import { academicYearIdFromLegacy } from './academicYearRepository';
import { enrollmentFields, studentEnrollmentId } from './studentLifecycleRepository';

export const CLASS_STATUS = Object.freeze({ ACTIVE: 'active', ARCHIVED: 'archived' });
export const STUDENT_STATUS = Object.freeze({
  ACTIVE: 'active',
  TRANSFERRED: 'transferred',
  GRADUATED: 'graduated',
  WITHDRAWN: 'withdrawn',
  DROPOUT: 'dropout',
  ARCHIVED: 'archived',
});

function unique(values = []) {
  return [...new Set(values.filter(value => typeof value === 'string' && value))];
}

function subscribeQueries(queries, onData, onError) {
  if (queries.length === 0) {
    onData([]);
    return () => undefined;
  }
  const resultSets = new Map();
  const emit = () => {
    const merged = new Map();
    resultSets.forEach(items => items.forEach(item => merged.set(item.id, item)));
    onData([...merged.values()]);
  };
  const unsubscribers = queries.map((source, index) => onSnapshot(
    source,
    snapshot => {
      resultSets.set(index, snapshot.docs.map(item => ({ id: item.id, ...item.data() })));
      emit();
    },
    onError,
  ));
  return () => unsubscribers.forEach(unsubscribe => unsubscribe());
}

export function subscribeClasses({ db, schoolId, uid, canViewAll, explicitClassIds = [], onData, onError }) {
  const ref = schoolCollection(db, schoolId, 'classes');
  const classIdQueries = [];
  for (let index = 0; index < explicitClassIds.length; index += 30) {
    classIdQueries.push(query(ref, where(documentId(), 'in', explicitClassIds.slice(index, index + 30))));
  }
  const sources = canViewAll
    ? [ref]
    : [
        query(ref, where('teacherId', '==', uid)),
        query(ref, where('staffIds', 'array-contains', uid)),
        query(ref, where('createdBy', '==', uid)),
        ...classIdQueries,
      ];
  return subscribeQueries(sources, onData, onError);
}

export function subscribeStudents({ db, schoolId, classIds, legacyClassNames = [], canViewAll, onData, onError }) {
  const ref = schoolCollection(db, schoolId, 'students');
  const sources = canViewAll
    ? [ref]
    : [
        ...unique(classIds).map(classId => query(ref, where('classId', '==', classId))),
        ...unique(legacyClassNames).map(className => query(ref, where('className', '==', className))),
      ];
  return subscribeQueries(sources, onData, onError);
}

export async function listSchoolStaff(db, schoolId) {
  const [modern, legacy] = await Promise.all([
    getDocs(query(collection(db, 'users'), where('schoolIds', 'array-contains', schoolId))),
    getDocs(query(collection(db, 'users'), where('schoolId', '==', schoolId))),
  ]);
  const users = new Map();
  modern.docs.forEach(item => users.set(item.id, { id: item.id, ...item.data() }));
  legacy.docs.forEach(item => users.set(item.id, { id: item.id, ...item.data() }));
  return [...users.values()].filter(user => user.accountStatus !== 'pending' && user.accountStatus !== 'disabled');
}

function normalizeName(value) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('he-IL');
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function classDocumentId(name, academicYear) {
  return `class_${await sha256(`${academicYear}\u0000${normalizeName(name)}`)}`;
}

function classFields(input) {
  return {
    name: input.name.trim().replace(/\s+/g, ' '),
    normalizedName: normalizeName(input.name),
    gradeLevel: input.gradeLevel || '',
    academicYear: input.academicYear.trim(),
    academicYearId: input.academicYearId || academicYearIdFromLegacy(input.academicYear),
    teacherId: input.teacherId || '',
    staffIds: unique(input.staffIds),
    trackIds: unique(input.trackIds),
    programTypes: unique(input.programTypes),
    studyDays: unique(input.studyDays),
    status: input.status === CLASS_STATUS.ARCHIVED ? CLASS_STATUS.ARCHIVED : CLASS_STATUS.ACTIVE,
  };
}

export async function createClass({ db, schoolId, actor, input }) {
  if (!actor?.uid || !input.name?.trim() || !input.academicYear?.trim()) throw new Error('INVALID_CLASS');
  const classId = await classDocumentId(input.name, input.academicYear);
  const classRef = schoolDoc(db, schoolId, 'classes', classId);
  await runTransaction(db, async transaction => {
    if ((await transaction.get(classRef)).exists()) throw new Error('CLASS_EXISTS');
    transaction.set(classRef, {
      ...classFields(input),
      schoolId,
      createdBy: actor.uid,
      updatedBy: actor.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
  return classId;
}

export async function updateClass({ db, schoolId, actor, current, input }) {
  const classesRef = schoolCollection(db, schoolId, 'classes');
  const duplicate = await getDocs(query(
    classesRef,
    where('normalizedName', '==', normalizeName(input.name)),
    where('academicYear', '==', input.academicYear.trim()),
  ));
  if (duplicate.docs.some(item => item.id !== current.id)) throw new Error('CLASS_EXISTS');

  const classRef = schoolDoc(db, schoolId, 'classes', current.id);
  const historyRef = doc(collection(classRef, 'history'));
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(classRef);
    if (!snapshot.exists()) throw new Error('CLASS_NOT_FOUND');
    const previous = snapshot.data();
    transaction.update(classRef, {
      ...classFields(input),
      updatedBy: actor.uid,
      updatedAt: serverTimestamp(),
    });
    if ((previous.teacherId || '') !== (input.teacherId || '')) {
      transaction.set(historyRef, {
        type: 'teacher_changed',
        schoolId,
        classId: current.id,
        previousTeacherId: previous.teacherId || '',
        nextTeacherId: input.teacherId || '',
        createdBy: actor.uid,
        createdAt: serverTimestamp(),
      });
    }
  });
}

export async function setClassArchived({ db, schoolId, actor, classItem, archived }) {
  const classRef = schoolDoc(db, schoolId, 'classes', classItem.id);
  const historyRef = doc(collection(classRef, 'history'));
  const batch = writeBatch(db);
  batch.update(classRef, {
    status: archived ? CLASS_STATUS.ARCHIVED : CLASS_STATUS.ACTIVE,
    updatedBy: actor.uid,
    updatedAt: serverTimestamp(),
  });
  batch.set(historyRef, {
    type: archived ? 'class_archived' : 'class_restored',
    schoolId,
    classId: classItem.id,
    createdBy: actor.uid,
    createdAt: serverTimestamp(),
  });
  await batch.commit();
}

function studentFields(input, classItem) {
  const firstName = input.firstName?.trim() || '';
  const lastName = input.lastName?.trim() || '';
  const fullName = input.fullName?.trim() || `${firstName} ${lastName}`.trim();
  return {
    firstName,
    lastName,
    fullName,
    idNumber: input.idNumber?.trim() || '',
    phone: input.phone?.trim() || '',
    parentPhone: input.parentPhone?.trim() || '',
    classId: classItem?.id || '',
    className: classItem?.name || input.className || '',
    gradeLevel: classItem?.gradeLevel || input.gradeLevel || '',
    academicYear: classItem?.academicYear || input.academicYear || '',
    trackIds: unique(input.trackIds),
    trackId: unique(input.trackIds)[0] || '',
    programTypes: unique(input.programTypes),
    programType: unique(input.programTypes)[0] || '',
    additionalSubjects: Array.isArray(input.additionalSubjects) ? input.additionalSubjects.slice(0, 30) : [],
    joinedAt: input.joinedAt || '',
    endDate: input.endDate || '',
    status: Object.values(STUDENT_STATUS).includes(input.status) ? input.status : STUDENT_STATUS.ACTIVE,
  };
}

export async function createStudent({ db, schoolId, actor, input, classItem }) {
  if (!actor?.uid || !classItem?.id) throw new Error('INVALID_STUDENT');
  const studentRef = doc(schoolCollection(db, schoolId, 'students'));
  const historyRef = doc(collection(studentRef, 'history'));
  const yearId = classItem?.academicYearId || academicYearIdFromLegacy(classItem?.academicYear);
  if (!yearId) throw new Error('AMBIGUOUS_ACADEMIC_YEAR');
  const enrollmentRef = schoolDoc(
    db, schoolId, 'studentEnrollments', studentEnrollmentId(studentRef.id, yearId),
  );
  const personalFileRef = schoolDoc(db, schoolId, 'personalFiles', studentRef.id);
  const studentData = studentFields(input, classItem);
  const batch = writeBatch(db);
  batch.set(studentRef, {
    ...studentData,
    schoolId,
    currentEnrollmentId: enrollmentRef.id,
    requirementStatus: {},
    createdBy: actor.uid,
    updatedBy: actor.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(historyRef, {
    type: 'student_created',
    schoolId,
    studentId: studentRef.id,
    nextClassId: classItem?.id || '',
    effectiveDate: input.joinedAt || '',
    createdBy: actor.uid,
    createdAt: serverTimestamp(),
  });
  batch.set(enrollmentRef, {
    ...enrollmentFields({
      student: { id: studentRef.id, schoolId, ...studentData },
      classItem,
      academicYear: {
        id: yearId,
        label: classItem?.academicYear || '',
      },
      startDate: input.joinedAt || '',
    }),
    createdBy: actor.uid,
    updatedBy: actor.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(personalFileRef, {
    studentId: studentRef.id,
    schoolId,
    status: 'active',
    createdBy: actor.uid,
    updatedBy: actor.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
  return studentRef.id;
}

export async function updateStudent({ db, schoolId, actor, student, input, classItem }) {
  const studentRef = schoolDoc(db, schoolId, 'students', student.id);
  const next = studentFields(input, classItem);
  delete next.classId;
  delete next.className;
  delete next.gradeLevel;
  delete next.academicYear;
  await runTransaction(db, async transaction => {
    if (!(await transaction.get(studentRef)).exists()) throw new Error('STUDENT_NOT_FOUND');
    transaction.update(studentRef, {
      ...next,
      updatedBy: actor.uid,
      updatedAt: serverTimestamp(),
    });
  });
}

export async function transferStudent({ db, schoolId, actor, student, nextClass, effectiveDate, reason }) {
  const studentRef = schoolDoc(db, schoolId, 'students', student.id);
  const historyRef = doc(collection(studentRef, 'history'));
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(studentRef);
    if (!snapshot.exists()) throw new Error('STUDENT_NOT_FOUND');
    const previous = snapshot.data();
    transaction.update(studentRef, {
      classId: nextClass.id,
      className: nextClass.name,
      gradeLevel: nextClass.gradeLevel || '',
      academicYear: nextClass.academicYear,
      status: STUDENT_STATUS.ACTIVE,
      joinedAt: effectiveDate,
      endDate: '',
      updatedBy: actor.uid,
      updatedAt: serverTimestamp(),
    });
    transaction.set(historyRef, {
      type: 'class_transfer',
      schoolId,
      studentId: student.id,
      previousClassId: previous.classId || '',
      previousClassName: previous.className || '',
      nextClassId: nextClass.id,
      nextClassName: nextClass.name,
      effectiveDate,
      reason: reason?.trim() || '',
      createdBy: actor.uid,
      createdAt: serverTimestamp(),
    });
  });
}

export async function setStudentStatus({ db, schoolId, actor, student, status, effectiveDate = '' }) {
  const studentRef = schoolDoc(db, schoolId, 'students', student.id);
  const historyRef = doc(collection(studentRef, 'history'));
  const batch = writeBatch(db);
  batch.update(studentRef, {
    status,
    endDate: status === STUDENT_STATUS.ACTIVE ? '' : effectiveDate,
    updatedBy: actor.uid,
    updatedAt: serverTimestamp(),
  });
  batch.set(historyRef, {
    type: status === STUDENT_STATUS.ARCHIVED ? 'student_archived' : 'student_status_changed',
    schoolId,
    studentId: student.id,
    previousStatus: student.status || STUDENT_STATUS.ACTIVE,
    nextStatus: status,
    effectiveDate,
    createdBy: actor.uid,
    createdAt: serverTimestamp(),
  });
  await batch.commit();
}

export function subscribeStudentHistory({ db, schoolId, studentId, onData, onError }) {
  return onSnapshot(
    collection(schoolDoc(db, schoolId, 'students', studentId), 'history'),
    snapshot => onData(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))),
    onError,
  );
}

export function subscribeStudentNotes({ db, schoolId, studentId, onData, onError }) {
  return onSnapshot(
    collection(schoolDoc(db, schoolId, 'students', studentId), 'notes'),
    snapshot => onData(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))),
    onError,
  );
}

export async function addStudentNote({ db, schoolId, actor, studentId, content, type, visibility }) {
  const noteRef = doc(collection(schoolDoc(db, schoolId, 'students', studentId), 'notes'));
  const batch = writeBatch(db);
  batch.set(noteRef, {
    schoolId,
    studentId,
    content: content.trim(),
    type: type || 'general',
    visibility: visibility === 'school_admin' ? 'school_admin' : 'class_staff',
    createdBy: actor.uid,
    createdByName: actor.fullName || '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    editHistory: [],
  });
  await batch.commit();
}
