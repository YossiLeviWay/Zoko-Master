import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { schoolCollection, schoolDoc, schoolSubcollection } from './paths';

const DATA_MODE = 'nested';

export function classFolderId(classId) {
  return `class_${classId}`;
}

export function classGradebookId(classId, academicYearId) {
  return `grades_${classId}_${academicYearId || 'current'}`;
}

export async function ensureClassFolder({ db, schoolId, actor, classItem }) {
  const folderId = classFolderId(classItem.id);
  const folderRef = schoolDoc(db, schoolId, 'folders', folderId, DATA_MODE);
  let folderExists = false;
  try { folderExists = (await getDoc(folderRef)).exists(); } catch { folderExists = false; }
  await setDoc(folderRef, {
    name: `כיתה ${classItem.name}`,
    schoolId,
    classId: classItem.id,
    className: classItem.name,
    academicYearId: classItem.academicYearId || '',
    visibility: 'class_restricted',
    specialFolder: true,
    updatedBy: actor.uid,
    updatedAt: serverTimestamp(),
    ...(folderExists ? {} : { createdBy: actor.uid, createdAt: serverTimestamp() }),
  }, { merge: true });
  return folderId;
}

export async function ensureClassGradebook({ db, schoolId, actor, classItem }) {
  const folderId = await ensureClassFolder({ db, schoolId, actor, classItem });
  const gradebookId = classGradebookId(classItem.id, classItem.academicYearId);
  const gradebookRef = schoolDoc(db, schoolId, 'gradebooks', gradebookId, DATA_MODE);
  let gradebookExists = false;
  try { gradebookExists = (await getDoc(gradebookRef)).exists(); } catch { gradebookExists = false; }
  await setDoc(gradebookRef, {
    schoolId,
    classId: classItem.id,
    className: classItem.name,
    academicYearId: classItem.academicYearId || '',
    academicYearLabel: classItem.academicYearLabel || classItem.academicYear || '',
    academicYearRange: classItem.academicYearRange || '',
    status: 'active',
    ...(gradebookExists ? {} : { subjects: [] }),
    updatedBy: actor.uid,
    updatedAt: serverTimestamp(),
    ...(gradebookExists ? {} : { createdBy: actor.uid, createdAt: serverTimestamp() }),
  }, { merge: true });
  const fileId = `gradebook_${gradebookId}`;
  const fileRef = schoolDoc(db, schoolId, 'files', fileId, DATA_MODE);
  let fileExists = false;
  try { fileExists = (await getDoc(fileRef)).exists(); } catch { fileExists = false; }
  await setDoc(fileRef, {
    name: `מיפוי ציונים - ${classItem.name}`,
    fileType: 'gradebook',
    type: 'application/x-zoko-gradebook',
    folderId,
    schoolId,
    classId: classItem.id,
    className: classItem.name,
    gradebookId,
    academicYearId: classItem.academicYearId || '',
    academicYear: classItem.academicYearLabel || classItem.academicYear || '',
    academicYearRange: classItem.academicYearRange || '',
    status: 'active',
    updatedBy: actor.uid,
    uploadedBy: actor.fullName || '',
    ...(fileExists ? {} : { createdBy: actor.uid, createdAt: serverTimestamp() }),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  return { fileId, folderId, gradebookId };
}

export function subscribeGradebook({ db, schoolId, gradebookId, onData, onError }) {
  return onSnapshot(schoolDoc(db, schoolId, 'gradebooks', gradebookId, DATA_MODE), snapshot => (
    onData(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null)
  ), onError);
}

export function subscribeGradebookGrades({ db, schoolId, gradebookId, onData, onError }) {
  return onSnapshot(schoolSubcollection(db, schoolId, 'gradebooks', gradebookId, 'grades', DATA_MODE), snapshot => (
    onData(snapshot.docs.map(item => ({ id: item.id, ...item.data() })))
  ), onError);
}

export function subscribeClassGradebooks({ db, schoolId, classId, onData, onError }) {
  return onSnapshot(query(collection(db, `schools/${schoolId}/gradebooks`), where('classId', '==', classId)), snapshot => {
    onData(snapshot.docs.map(item => ({ id: item.id, ...item.data() })).filter(item => item.status !== 'archived'));
  }, onError);
}

export async function saveGradebookSubjects({ db, schoolId, gradebookId, actor, subjects }) {
  await updateDoc(schoolDoc(db, schoolId, 'gradebooks', gradebookId, DATA_MODE), {
    subjects,
    updatedBy: actor.uid,
    updatedAt: serverTimestamp(),
  });
}

export async function saveStudentGrades({ db, schoolId, gradebookId, actor, student, scores, calculated }) {
  await setDoc(doc(schoolCollection(db, schoolId, 'gradebooks', DATA_MODE), gradebookId, 'grades', student.id), {
    schoolId,
    gradebookId,
    classId: student.classId,
    studentId: student.id,
    displayName: student.fullName,
    scores,
    calculated,
    updatedBy: actor.uid,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}
