import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createStaffSchema,
  deleteSchoolSchema,
  notificationSchema,
  createCustomRoleSchema,
  setRoleSchema,
  upsertPersonalFileItemSchema,
  createCvDocumentSchema,
} from '../src/validation/schemas.js';

test('regular staff creation cannot request global_admin', () => {
  assert.throws(() => createStaffSchema.parse({
    email: 'user@example.test',
    fullName: 'User',
    role: 'global_admin',
    schoolId: 'school_a',
  }));
});

test('school deletion requires explicit confirmation', () => {
  assert.throws(() => deleteSchoolSchema.parse({ schoolId: 'school_a' }));
  assert.equal(deleteSchoolSchema.parse({
    schoolId: 'school_a',
    confirmDelete: true,
  }).confirmDelete, true);
});

test('role schema rejects unknown fields and malformed IDs', () => {
  assert.throws(() => setRoleSchema.parse({
    userId: '../unsafe',
    schoolId: 'school_a',
    role: 'viewer',
    unexpected: true,
  }));
});

test('notifications are bounded and links are local routes', () => {
  assert.throws(() => notificationSchema.parse({
    schoolId: 'school_a',
    userIds: ['user_a'],
    title: 'Notice',
    type: 'system',
    link: 'https://example.test/phishing',
  }));
  const parsed = notificationSchema.parse({
    schoolId: 'school_a',
    userIds: ['user_a', 'user_a'],
    title: 'Notice',
    type: 'system',
    link: '/notifications',
  });
  assert.deepEqual(parsed.userIds, ['user_a']);
});

test('custom role validation rejects unknown permissions and empty class scope', () => {
  assert.throws(() => createCustomRoleSchema.parse({
    schoolId: 'school_a',
    name: 'Unsafe role',
    permissions: { 'unknown.permission': true },
    accessScope: { type: 'school', classIds: [] },
  }));
  assert.throws(() => createCustomRoleSchema.parse({
    schoolId: 'school_a',
    name: 'Empty scope',
    permissions: { 'students.view': true },
    accessScope: { type: 'classes', classIds: [] },
  }));
});

test('personal-file payload rejects spoofed ownership and unsafe attachment sizes', () => {
  assert.throws(() => upsertPersonalFileItemSchema.parse({
    schoolId: 'school_a', studentId: 'student_a', kind: 'credentials',
    payload: { title: 'Credential', schoolId: 'school_b' },
  }));
  assert.throws(() => upsertPersonalFileItemSchema.parse({
    schoolId: 'school_a', studentId: 'student_a', kind: 'documents',
    payload: {
      title: 'Oversized',
      attachments: [{
        storagePath: 'schools/school_a/students/student_a/personal-file/documents/file/a.pdf',
        originalName: 'a.pdf', contentType: 'application/pdf', size: 30 * 1024 * 1024,
      }],
    },
  }));
});

test('CV snapshot validation is strict and keeps tenant ownership outside the snapshot', () => {
  const snapshot = {
    personal: { fullName: 'תלמיד א', professionalTitle: '', phone: '', email: '', city: '', birthDate: '', professionalLink: '', photoPath: '' },
    summary: '', education: [], experiences: [], practicalExperience: [], projects: [], skills: [], credentials: [], recommendations: [], languages: [],
    sectionOrder: ['summary', 'experiences'], hiddenSections: [],
    design: { templateId: 'classic_professional', templateName: 'קלאסי מקצועי', accentColor: '#607D8B', showPhoto: false, sidebarSections: ['skills'] },
  };
  assert.equal(createCvDocumentSchema.parse({
    schoolId: 'school_a', studentId: 'student_a', title: 'קורות חיים', snapshot,
  }).snapshot.personal.fullName, 'תלמיד א');
  assert.throws(() => createCvDocumentSchema.parse({
    schoolId: 'school_a', studentId: 'student_a', title: 'קורות חיים',
    snapshot: { ...snapshot, schoolId: 'school_b' },
  }));
});
