import {
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { schoolCollection, schoolDoc, schoolSubcollection } from './paths';
import {
  ATTENDANCE_TIMEZONE,
  DEFAULT_ATTENDANCE_LEGEND,
  attendanceRecordId,
  buildScheduledDays,
} from '../../utils/attendance';

const CHILD_BATCH_SIZE = 400;
const DATA_MODE = 'nested';

function uniqueStrings(values = []) {
  return [...new Set(values.filter(value => typeof value === 'string' && value))];
}

function childCollection(db, schoolId, fileId, name, mode = DATA_MODE) {
  return schoolSubcollection(db, schoolId, 'files', fileId, name, mode);
}

async function commitInChunks(db, operations) {
  for (let index = 0; index < operations.length; index += CHILD_BATCH_SIZE) {
    const batch = writeBatch(db);
    operations.slice(index, index + CHILD_BATCH_SIZE).forEach(operation => operation(batch));
    await batch.commit();
  }
}

export async function createAttendanceSheets({ db, schoolId, actor, folderId, input, selections }) {
  if (!actor?.uid || !schoolId || !folderId || selections.length === 0) throw new Error('INVALID_ATTENDANCE_SHEET');
  const created = [];

  for (const selection of selections) {
    const { classItem, students } = selection;
    const days = buildScheduledDays({
      startDate: input.startDate,
      endDate: input.endDate,
      studyDays: classItem.studyDays || [],
    });
    const fileRef = doc(schoolCollection(db, schoolId, 'files', DATA_MODE));
    const title = selections.length === 1
      ? input.title.trim()
      : `${input.title.trim()} - ${classItem.name}`;

    await setDoc(fileRef, {
      name: title,
      fileType: 'attendance',
      type: 'application/x-attendance-sheet',
      folderId,
      size: 0,
      schoolId,
      classId: classItem.id,
      className: classItem.name,
      academicYearId: input.academicYearId || classItem.academicYearId,
      academicYear: input.academicYear || classItem.academicYear,
      academicYearRange: input.academicYearRange || classItem.academicYearRange || '',
      dateRange: { start: input.startDate, end: input.endDate },
      timezone: ATTENDANCE_TIMEZONE,
      description: input.description?.trim() || '',
      status: 'active',
      setupStatus: 'creating',
      studentCount: students.length,
      scheduledDayCount: days.length,
      createdBy: actor.uid,
      updatedBy: actor.uid,
      uploadedBy: actor.fullName || '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const operations = [];
    DEFAULT_ATTENDANCE_LEGEND.forEach(item => {
      const itemRef = doc(childCollection(db, schoolId, fileRef.id, 'attendanceLegend'), item.id);
      operations.push(batch => batch.set(itemRef, {
        ...item,
        schoolId,
        fileId: fileRef.id,
        createdBy: actor.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }));
    });
    students.forEach((student, order) => {
      const memberRef = doc(childCollection(db, schoolId, fileRef.id, 'attendanceMembers'), student.id);
      operations.push(batch => batch.set(memberRef, {
        schoolId,
        fileId: fileRef.id,
        classId: classItem.id,
        studentId: student.id,
        displayName: student.fullName || `${student.firstName || ''} ${student.lastName || ''}`.trim(),
        joinedAt: student.joinedAt || '',
        endDate: student.endDate || '',
        status: student.status || 'active',
        included: true,
        order,
        createdBy: actor.uid,
        createdAt: serverTimestamp(),
      }));
    });
    days.forEach(day => {
      const dayRef = doc(childCollection(db, schoolId, fileRef.id, 'attendanceDays'), day.id);
      operations.push(batch => batch.set(dayRef, {
        ...day,
        schoolId,
        fileId: fileRef.id,
        createdBy: actor.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }));
    });
    try {
      await commitInChunks(db, operations);
      await updateDoc(fileRef, {
        setupStatus: 'ready',
        updatedBy: actor.uid,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      try {
        await updateDoc(fileRef, {
          setupStatus: 'error',
          updatedBy: actor.uid,
          updatedAt: serverTimestamp(),
        });
      } catch {
        // Preserve the original setup error; no data is deleted automatically.
      }
      throw error;
    }
    created.push({
      id: fileRef.id,
      name: title,
      fileType: 'attendance',
      type: 'application/x-attendance-sheet',
      folderId,
      schoolId,
      classId: classItem.id,
      className: classItem.name,
      academicYearId: input.academicYearId || classItem.academicYearId,
      academicYear: input.academicYear || classItem.academicYear,
      academicYearRange: input.academicYearRange || classItem.academicYearRange || '',
      dateRange: { start: input.startDate, end: input.endDate },
      timezone: ATTENDANCE_TIMEZONE,
      status: 'active',
      setupStatus: 'ready',
    });
  }
  return created;
}

function subscribeChild({ db, schoolId, fileId, name, mode = DATA_MODE, onData, onError, sort }) {
  return onSnapshot(
    childCollection(db, schoolId, fileId, name, mode),
    snapshot => {
      const items = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
      onData(sort ? items.sort(sort) : items);
    },
    onError,
  );
}

export function subscribeAttendanceLegend(options) {
  return subscribeChild({ ...options, name: 'attendanceLegend', sort: (a, b) => (a.order || 0) - (b.order || 0) });
}

export function subscribeAttendanceMembers(options) {
  return subscribeChild({ ...options, name: 'attendanceMembers', sort: (a, b) => (a.order || 0) - (b.order || 0) });
}

export function subscribeAttendanceDays(options) {
  return subscribeChild({ ...options, name: 'attendanceDays', sort: (a, b) => a.dateKey.localeCompare(b.dateKey) });
}

export function subscribeAttendanceRecords(options) {
  return subscribeChild({ ...options, name: 'attendanceRecords' });
}

export async function saveAttendanceCell({ db, schoolId, file, actor, studentId, dateKey, value }) {
  const recordId = attendanceRecordId(studentId, dateKey);
  const recordRef = doc(childCollection(db, schoolId, file.id, 'attendanceRecords', file._dataMode), recordId);
  const historyRef = doc(childCollection(db, schoolId, file.id, 'attendanceHistory', file._dataMode));
  const previousSnapshot = await getDoc(recordRef);
  const previous = previousSnapshot.exists() ? previousSnapshot.data() : null;
  const primaryStatusId = value.primaryStatusId || '';
  const actionIds = uniqueStrings(value.actionIds);
  const note = value.note?.trim().slice(0, 2000) || '';
  const empty = !primaryStatusId && actionIds.length === 0 && !note;
  const batch = writeBatch(db);

  if (empty) {
    if (!previous) return;
    batch.set(recordRef, {
      schoolId,
      fileId: file.id,
      classId: file.classId,
      studentId,
      dateKey,
      primaryStatusId: '',
      actionIds: [],
      note: '',
      updatedBy: actor.uid,
      updatedAt: serverTimestamp(),
    });
  } else {
    batch.set(recordRef, {
      schoolId,
      fileId: file.id,
      classId: file.classId,
      studentId,
      dateKey,
      primaryStatusId,
      actionIds,
      note,
      updatedBy: actor.uid,
      updatedAt: serverTimestamp(),
    });
  }
  batch.set(historyRef, {
    schoolId,
    fileId: file.id,
    classId: file.classId,
    recordId,
    studentId,
    dateKey,
    type: empty ? 'cell_cleared' : previous ? 'cell_updated' : 'cell_created',
    previous: previous ? {
      primaryStatusId: previous.primaryStatusId || '',
      actionIds: previous.actionIds || [],
      note: previous.note || '',
    } : null,
    next: empty ? null : { primaryStatusId, actionIds, note },
    createdBy: actor.uid,
    createdAt: serverTimestamp(),
  });
  await batch.commit();
}

export async function markAttendanceDate({ db, schoolId, file, actor, members, dateKey, statusId = 'present' }) {
  const operations = [];
  members.filter(member => member.included !== false).forEach(member => {
    const recordId = attendanceRecordId(member.studentId, dateKey);
    const recordRef = doc(childCollection(db, schoolId, file.id, 'attendanceRecords', file._dataMode), recordId);
    const historyRef = doc(childCollection(db, schoolId, file.id, 'attendanceHistory', file._dataMode));
    operations.push(batch => batch.set(recordRef, {
      schoolId,
      fileId: file.id,
      classId: file.classId,
      studentId: member.studentId,
      dateKey,
      primaryStatusId: statusId,
      actionIds: [],
      note: '',
      updatedBy: actor.uid,
      updatedAt: serverTimestamp(),
    }, { merge: true }));
    operations.push(batch => batch.set(historyRef, {
      schoolId,
      fileId: file.id,
      classId: file.classId,
      recordId,
      studentId: member.studentId,
      dateKey,
      type: 'bulk_status_applied',
      next: { primaryStatusId: statusId, actionIds: [], note: '' },
      createdBy: actor.uid,
      createdAt: serverTimestamp(),
    }));
  });
  await commitInChunks(db, operations);
}

export async function addAttendanceLegendItem({ db, schoolId, file, actor, input, order }) {
  const itemRef = doc(childCollection(db, schoolId, file.id, 'attendanceLegend', file._dataMode));
  await setDoc(itemRef, {
    schoolId,
    fileId: file.id,
    label: input.label.trim().slice(0, 80),
    shortCode: input.shortCode.trim().slice(0, 4),
    color: input.color,
    type: input.type,
    attendanceEffect: input.attendanceEffect,
    order,
    active: true,
    createdBy: actor.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return itemRef.id;
}

export async function deleteAttendanceLegendItem({ db, schoolId, fileId, itemId, mode = DATA_MODE }) {
  await deleteDoc(doc(childCollection(db, schoolId, fileId, 'attendanceLegend', mode), itemId));
}

export async function archiveAttendanceSheet({ db, schoolId, fileId, actor, mode = DATA_MODE }) {
  await updateDoc(schoolDoc(db, schoolId, 'files', fileId, mode), {
    status: 'archived',
    updatedBy: actor.uid,
    updatedAt: serverTimestamp(),
  });
}
