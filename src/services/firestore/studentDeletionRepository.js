import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
} from 'firebase/firestore';
import { deleteObject, listAll, ref as storageRef } from 'firebase/storage';
import { db, storage } from '../../firebase';

const DELETABLE_STATUSES = new Set(['withdrawn', 'dropout', 'transferred', 'archived']);
const PERSONAL_FILE_KINDS = ['documents', 'credentials', 'experiences', 'skills', 'recommendations'];

async function appendCollection(target, reference) {
  const snapshot = await getDocs(reference);
  target.push(...snapshot.docs.map(item => item.ref));
  return snapshot.docs;
}

async function appendPersonalFileTree(target, reference) {
  for (const kind of PERSONAL_FILE_KINDS) await appendCollection(target, collection(reference, kind));
  const cvDocuments = await appendCollection(target, collection(reference, 'cvDocuments'));
  for (const cvDocument of cvDocuments) {
    const versions = await appendCollection(target, collection(cvDocument.ref, 'versions'));
    for (const version of versions) await appendCollection(target, collection(version.ref, 'exports'));
  }
}

async function deleteReferences(references) {
  const unique = [...new Map(references.map(reference => [reference.path, reference])).values()];
  for (let offset = 0; offset < unique.length; offset += 400) {
    const batch = writeBatch(db);
    unique.slice(offset, offset + 400).forEach(reference => batch.delete(reference));
    await batch.commit();
  }
}

async function deleteStorageTree(reference) {
  const contents = await listAll(reference);
  await Promise.all(contents.items.map(item => deleteObject(item)));
  await Promise.all(contents.prefixes.map(prefix => deleteStorageTree(prefix)));
}

export async function permanentlyDeleteStudent({ schoolId, studentId }) {
  const nestedStudentRef = doc(db, `schools/${schoolId}/students/${studentId}`);
  const legacyStudentRef = doc(db, `students_${schoolId}/${studentId}`);
  const [nestedStudent, legacyStudent] = await Promise.all([
    getDoc(nestedStudentRef), getDoc(legacyStudentRef),
  ]);
  const source = nestedStudent.exists() ? nestedStudent : legacyStudent;
  if (!source.exists() || source.data().schoolId !== schoolId) throw new Error('STUDENT_NOT_FOUND');
  if (!DELETABLE_STATUSES.has(source.data().status)) throw new Error('STUDENT_NOT_ARCHIVED');

  const dependentReferences = [];
  await Promise.all([
    appendCollection(dependentReferences, collection(nestedStudentRef, 'history')),
    appendCollection(dependentReferences, collection(nestedStudentRef, 'notes')),
    appendCollection(dependentReferences, collection(nestedStudentRef, 'sensitive')),
    appendCollection(dependentReferences, collection(legacyStudentRef, 'history')),
    appendCollection(dependentReferences, collection(legacyStudentRef, 'notes')),
    appendCollection(dependentReferences, collection(legacyStudentRef, 'sensitive')),
    appendCollection(dependentReferences, query(collection(db, `schools/${schoolId}/studentEnrollments`), where('studentId', '==', studentId))),
    appendCollection(dependentReferences, query(collection(db, `studentEnrollments_${schoolId}`), where('studentId', '==', studentId))),
    appendCollection(dependentReferences, query(collection(db, `schools/${schoolId}/studentOutcomeResults`), where('studentId', '==', studentId))),
  ]);

  const nestedPersonalRef = doc(db, `schools/${schoolId}/personalFiles/${studentId}`);
  const legacyPersonalRef = doc(db, `personal_files_${schoolId}/${studentId}`);
  await Promise.all([
    appendPersonalFileTree(dependentReferences, nestedPersonalRef),
    appendPersonalFileTree(dependentReferences, legacyPersonalRef),
  ]);
  const [nestedPersonal, legacyPersonal, nestedGradebooks, legacyGradebooks, nestedAttendance, legacyAttendance] = await Promise.all([
    getDoc(nestedPersonalRef),
    getDoc(legacyPersonalRef),
    getDocs(collection(db, `schools/${schoolId}/gradebooks`)),
    getDocs(collection(db, `gradebooks_${schoolId}`)),
    getDocs(query(collection(db, `schools/${schoolId}/files`), where('fileType', '==', 'attendance'))),
    getDocs(query(collection(db, `files_${schoolId}`), where('fileType', '==', 'attendance'))),
  ]);
  if (nestedPersonal.exists()) dependentReferences.push(nestedPersonal.ref);
  if (legacyPersonal.exists()) dependentReferences.push(legacyPersonal.ref);

  const gradeRefs = [...nestedGradebooks.docs, ...legacyGradebooks.docs].map(item => doc(item.ref, 'grades', studentId));
  const gradeSnapshots = await Promise.all(gradeRefs.map(reference => getDoc(reference)));
  dependentReferences.push(...gradeSnapshots.filter(item => item.exists()).map(item => item.ref));

  for (const file of [...nestedAttendance.docs, ...legacyAttendance.docs]) {
    await Promise.all([
      appendCollection(dependentReferences, query(collection(file.ref, 'attendanceRecords'), where('studentId', '==', studentId))),
      appendCollection(dependentReferences, query(collection(file.ref, 'attendanceHistory'), where('studentId', '==', studentId))),
    ]);
    const member = await getDoc(doc(file.ref, 'attendanceMembers', studentId));
    if (member.exists()) dependentReferences.push(member.ref);
  }

  await deleteStorageTree(storageRef(storage, `schools/${schoolId}/students/${studentId}`));
  await deleteReferences(dependentReferences);
  await deleteReferences([nestedStudent.exists() ? nestedStudentRef : null, legacyStudent.exists() ? legacyStudentRef : null].filter(Boolean));
  return { ok: true, studentId };
}
