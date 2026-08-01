import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTACT_SCOPE,
  findDuplicateByEmail,
  normalizeContactEmail,
  normalizeContactEmails,
  sanitizeContactInput,
} from '../../src/services/firestore/contactRepository.js';

test('contact emails are normalized, validated and deduplicated', () => {
  assert.equal(normalizeContactEmail('  Person@Example.COM '), 'person@example.com');
  assert.deepEqual(
    normalizeContactEmails('Person@Example.COM', [' person@example.com ', 'other@example.com', 'invalid']),
    ['person@example.com', 'other@example.com'],
  );
});

test('institutional contact requires an organization or category', () => {
  assert.throws(() => sanitizeContactInput({
    fullName: 'ספק חיצוני',
    primaryEmail: 'vendor@example.com',
  }, {
    scope: CONTACT_SCOPE.INSTITUTIONAL,
    schoolId: 'school_a',
    ownerId: 'user_a',
  }), /ORGANIZATION_OR_CATEGORY_REQUIRED/);

  const contact = sanitizeContactInput({
    fullName: ' ספק חיצוני ',
    primaryEmail: ' VENDOR@example.com ',
    organization: 'חברה',
    tags: ['ספק', 'ספק', 'תחבורה'],
  }, {
    scope: CONTACT_SCOPE.INSTITUTIONAL,
    schoolId: 'school_a',
    ownerId: 'user_a',
  });
  assert.equal(contact.primaryEmail, 'vendor@example.com');
  assert.deepEqual(contact.tags, ['ספק', 'תחבורה']);
  assert.equal(contact.schoolId, 'school_a');
});

test('duplicate detection remains isolated between private and institutional scopes', () => {
  const contacts = [
    { id: 'institutional_1', scope: CONTACT_SCOPE.INSTITUTIONAL, normalizedEmails: ['same@example.com'] },
    { id: 'private_1', scope: CONTACT_SCOPE.PRIVATE, normalizedEmails: ['private@example.com'] },
  ];
  assert.equal(findDuplicateByEmail(contacts, { primaryEmail: ' SAME@example.com ' }, CONTACT_SCOPE.INSTITUTIONAL)?.id, 'institutional_1');
  assert.equal(findDuplicateByEmail(contacts, { primaryEmail: 'same@example.com' }, CONTACT_SCOPE.PRIVATE), null);
  assert.equal(findDuplicateByEmail(contacts, { primaryEmail: 'private@example.com' }, CONTACT_SCOPE.PRIVATE)?.id, 'private_1');
});
