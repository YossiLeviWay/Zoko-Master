import assert from 'node:assert/strict';
import test from 'node:test';
import { attendanceRowStatus, studentsMissingFromSheet } from '../../src/utils/attendance.js';

test('a missing card or a stale archived flag does not label a current classmate as archived', () => {
  assert.equal(attendanceRowStatus({ member: { status: 'archived', classId: 'c1' }, classId: 'c1' }), 'active');
  assert.equal(attendanceRowStatus({
    member: { status: 'archived', classId: 'c1' },
    student: { status: 'archived', classId: 'c1' },
    classId: 'c1',
  }), 'active');
  assert.equal(attendanceRowStatus({
    member: { classId: 'c1' },
    student: { status: 'archived', classId: 'c1' },
    enrollment: { classId: 'c1', enrollmentStatus: 'active', academicYearId: 'y' },
    classId: 'c1',
  }), 'active');
  assert.equal(attendanceRowStatus({
    member: { classId: 'c1' },
    student: { status: 'active', classId: 'c1' },
    enrollment: { classId: 'c1', enrollmentStatus: 'withdrawn' },
    classId: 'c1',
  }), 'withdrawn');
  assert.equal(attendanceRowStatus({
    member: { classId: 'c1' },
    student: { status: 'graduated', classId: 'c2' },
    classId: 'c1',
  }), 'graduated');
});

test('students missing from the sheet include an active enrollment even when the card says archived', () => {
  const missing = studentsMissingFromSheet({
    members: [{ id: 'a' }],
    students: [
      { id: 'a', status: 'active' },
      { id: 'b', status: 'archived' },
      { id: 'c', status: 'archived' },
      { id: 'd', status: 'withdrawn' },
    ],
    enrollments: [{ studentId: 'b', enrollmentStatus: 'active' }, { studentId: 'd', enrollmentStatus: 'withdrawn' }],
  });
  assert.deepEqual(missing.map(item => item.id), ['b']);
});
