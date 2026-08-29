import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { schoolDoc } from './firestore/paths.js';

const array = value => Array.isArray(value) ? value : [];

async function safeGetDocs(reference) {
  try { return await getDocs(reference); } catch { return null; }
}

async function safeGetDoc(reference) {
  try { return await getDoc(reference); } catch { return null; }
}

function mergeSnapshots(snapshots) {
  const items = new Map();
  snapshots.filter(Boolean).forEach(snapshot => snapshot.docs.forEach(item => items.set(item.id, { id: item.id, ...item.data() })));
  return [...items.values()];
}

async function loadGrades({ db, schoolId, student }) {
  if (!student.classId) return [];
  const gradebooks = await safeGetDocs(query(collection(db, `schools/${schoolId}/gradebooks`), where('classId', '==', student.classId)));
  if (!gradebooks) return [];
  return Promise.all(gradebooks.docs.map(async item => {
    const book = item.data();
    const grade = await safeGetDoc(doc(db, `schools/${schoolId}/gradebooks/${item.id}/grades/${student.id}`));
    const data = grade?.data() || {};
    return { id: item.id, subjects: array(book.subjects), scores: data.scores || {}, calculated: data.calculated || {} };
  }));
}

async function loadAttendance({ db, schoolId, student }) {
  if (!student.classId) return [];
  const files = await safeGetDocs(query(collection(db, `schools/${schoolId}/files`), where('classId', '==', student.classId)));
  const sheets = (files?.docs || []).filter(item => item.data().fileType === 'attendance' && item.data().status !== 'archived');
  return Promise.all(sheets.slice(0, 12).map(async item => {
    const [records, legend] = await Promise.all([
      safeGetDocs(query(collection(db, `schools/${schoolId}/files/${item.id}/attendanceRecords`), where('studentId', '==', student.id))),
      safeGetDocs(collection(db, `schools/${schoolId}/files/${item.id}/attendanceLegend`)),
    ]);
    return {
      id: item.id,
      name: item.data().name || '',
      records: (records?.docs || []).map(record => ({ id: record.id, ...record.data() })),
      legend: Object.fromEntries((legend?.docs || []).map(entry => [entry.id, entry.data().label || entry.id])),
    };
  }));
}

async function loadHistory({ db, schoolId, student }) {
  const legacyRef = schoolDoc(db, schoolId, 'students', student.id);
  const snapshots = await Promise.all([
    safeGetDocs(collection(legacyRef, 'history')),
    safeGetDocs(collection(legacyRef, 'notes')),
    safeGetDocs(collection(db, `schools/${schoolId}/students/${student.id}/history`)),
    safeGetDocs(collection(db, `schools/${schoolId}/students/${student.id}/notes`)),
  ]);
  return {
    history: mergeSnapshots([snapshots[0], snapshots[2]]),
    notes: mergeSnapshots([snapshots[1], snapshots[3]]),
  };
}

export async function loadAuthorizedStudentDetails({ db, schoolId, student, question }) {
  const wantsGrades = /ציון|ציונים|מבחן|הערכה/u.test(question);
  const wantsAttendance = /נוכחות|חיסור|חיסורים|איחור|איחורים|נעדר|נעדרה/u.test(question);
  const wantsHistory = /היסטוריה|היסטוריית|הערה|הערות|תיעוד/u.test(question);
  const [gradebooks, attendance, history] = await Promise.all([
    wantsGrades ? loadGrades({ db, schoolId, student }) : [],
    wantsAttendance ? loadAttendance({ db, schoolId, student }) : [],
    wantsHistory ? loadHistory({ db, schoolId, student }) : { history: [], notes: [] },
  ]);
  return { gradebooks, attendance, ...history };
}
