import test from 'node:test';
import assert from 'node:assert/strict';
import {
  communicationSourceFromContext,
  normalizeCommunicationContext,
} from '../../src/utils/communicationContext.js';

test('student communication context keeps only minimal non-sensitive linkage', () => {
  const context = normalizeCommunicationContext({
    type: 'student', id: 'student_1', label: 'תלמיד א', classId: 'class_1',
    idNumber: 'sensitive', grades: [100], medicalNotes: 'sensitive', notes: 'sensitive',
  });
  assert.deepEqual(context, {
    type: 'student', id: 'student_1', label: 'תלמיד א', description: '', recipientEmail: '',
    studentId: 'student_1', classId: 'class_1', teamId: '', initiativeId: '', milestoneId: '',
    eventId: '', contactId: '', fileIds: [], participantIds: [],
  });
  assert.equal('idNumber' in context, false);
  assert.equal('grades' in context, false);
  assert.equal('medicalNotes' in context, false);
});

test('context source is a stable task-compatible reference without copying source data', () => {
  const source = communicationSourceFromContext({
    type: 'team', id: 'team_1', label: 'צוות א', participantIds: ['u1', 'u1', 'u2'], fileIds: ['f1'],
  });
  assert.equal(source.id, 'team_1');
  assert.equal(source._storageMode, 'context');
  assert.deepEqual(source.communicationContext.participantIds, ['u1', 'u2']);
  assert.equal(source.attachedFileId, 'f1');
});
