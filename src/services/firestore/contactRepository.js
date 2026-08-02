import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';

export const CONTACT_SCOPE = Object.freeze({
  INSTITUTIONAL: 'institutional',
  PRIVATE: 'private',
  INTERNAL: 'internal',
});

export const CONTACT_VISIBILITY = Object.freeze({
  INSTITUTION: 'institution',
  RESPONSIBLE_STAFF: 'responsible_staff',
});

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanText(value, maxLength = 500) {
  return String(value || '').trim().slice(0, maxLength);
}

function unique(values, maxItems = 30) {
  return [...new Set(values.filter(Boolean))].slice(0, maxItems);
}

export function normalizeContactEmail(value) {
  return cleanText(value, 320).toLowerCase().replace(/\s+/g, '');
}

export function normalizeContactEmails(primaryEmail, additionalEmails = []) {
  const normalized = [primaryEmail, ...(Array.isArray(additionalEmails) ? additionalEmails : [])]
    .map(normalizeContactEmail)
    .filter(email => EMAIL_PATTERN.test(email));
  return unique(normalized, 10);
}

export function sanitizeContactInput(input, { scope, schoolId, ownerId }) {
  const normalizedEmails = normalizeContactEmails(input.primaryEmail, input.additionalEmails);
  if (!cleanText(input.fullName, 160) || normalizedEmails.length === 0) {
    throw new Error('INVALID_CONTACT');
  }
  if (scope === CONTACT_SCOPE.INSTITUTIONAL && !cleanText(input.organization, 160) && !cleanText(input.category, 80)) {
    throw new Error('ORGANIZATION_OR_CATEGORY_REQUIRED');
  }
  const base = {
    scope,
    schoolId: cleanText(schoolId, 128),
    fullName: cleanText(input.fullName, 160),
    organization: cleanText(input.organization, 160),
    jobTitle: cleanText(input.jobTitle, 120),
    primaryEmail: normalizedEmails[0],
    additionalEmails: normalizedEmails.slice(1),
    normalizedEmails,
    phone: cleanText(input.phone, 40),
    category: cleanText(input.category, 80),
    tags: unique((Array.isArray(input.tags) ? input.tags : []).map(tag => cleanText(tag, 50)), 20),
    notes: cleanText(input.notes, 2000),
    archived: input.archived === true,
    schemaVersion: 1,
  };
  if (scope === CONTACT_SCOPE.PRIVATE) {
    return { ...base, ownerId };
  }
  return {
    ...base,
    ownerStaffIds: unique((Array.isArray(input.ownerStaffIds) ? input.ownerStaffIds : []).map(id => cleanText(id, 128)), 50),
    visibility: Object.values(CONTACT_VISIBILITY).includes(input.visibility)
      ? input.visibility
      : CONTACT_VISIBILITY.INSTITUTION,
    linkedStaffId: cleanText(input.linkedStaffId, 128),
  };
}

function institutionalCollection(db, schoolId) {
  return collection(db, 'schools', schoolId, 'contactDirectory', 'institutional', 'items');
}

function privateCollection(db, userId) {
  return collection(db, 'users', userId, 'contactDirectory', 'private', 'items');
}

function contactRef(db, { scope, schoolId, userId, contactId }) {
  return scope === CONTACT_SCOPE.PRIVATE
    ? doc(db, 'users', userId, 'contactDirectory', 'private', 'items', contactId)
    : doc(db, 'schools', schoolId, 'contactDirectory', 'institutional', 'items', contactId);
}

export function subscribeContacts({
  db,
  schoolId,
  userId,
  includeInstitutional,
  canReadRestricted,
  onData,
  onError,
}) {
  const buckets = new Map();
  const listeners = [];
  const emit = () => {
    const contacts = new Map();
    buckets.forEach(items => items.forEach(item => contacts.set(`${item.scope}:${item.id}`, item)));
    onData([...contacts.values()]);
  };
  const listen = (key, reference, scope) => {
    listeners.push(onSnapshot(reference, snapshot => {
      buckets.set(key, snapshot.docs.map(item => ({ id: item.id, scope, ...item.data() })));
      emit();
    }, onError));
  };

  listen('private', privateCollection(db, userId), CONTACT_SCOPE.PRIVATE);
  if (includeInstitutional && schoolId) {
    const ref = institutionalCollection(db, schoolId);
    if (canReadRestricted) {
      listen('institutional-all', ref, CONTACT_SCOPE.INSTITUTIONAL);
    } else {
      listen('institutional-visible', query(ref, where('visibility', '==', CONTACT_VISIBILITY.INSTITUTION)), CONTACT_SCOPE.INSTITUTIONAL);
      listen('institutional-owned', query(ref, where('ownerStaffIds', 'array-contains', userId)), CONTACT_SCOPE.INSTITUTIONAL);
      listen('institutional-created', query(ref, where('createdBy', '==', userId)), CONTACT_SCOPE.INSTITUTIONAL);
    }
  }
  return () => listeners.forEach(unsubscribe => unsubscribe());
}

export function findDuplicateByEmail(contacts, input, scope) {
  const emails = new Set(normalizeContactEmails(input.primaryEmail, input.additionalEmails));
  return contacts.find(contact => (
    contact.scope === scope
    && contact.archived !== true
    && (contact.normalizedEmails || []).some(email => emails.has(normalizeContactEmail(email)))
  )) || null;
}

export async function findStoredDuplicate({ db, schoolId, userId, scope, emails, excludeId = '' }) {
  const reference = scope === CONTACT_SCOPE.PRIVATE
    ? privateCollection(db, userId)
    : institutionalCollection(db, schoolId);
  for (const email of normalizeContactEmails(emails?.[0], emails?.slice(1))) {
    const snapshot = await getDocs(query(reference, where('normalizedEmails', 'array-contains', email)));
    const duplicate = snapshot.docs.find(item => item.id !== excludeId && item.data().archived !== true);
    if (duplicate) return { id: duplicate.id, scope, ...duplicate.data() };
  }
  return null;
}

export async function createContact({ db, schoolId, actor, scope, input, permissions = {} }) {
  if (!actor?.uid || !schoolId) throw new Error('INVALID_CONTACT_CONTEXT');
  if (scope === CONTACT_SCOPE.INSTITUTIONAL && permissions.create !== true) throw new Error('CONTACT_CREATE_FORBIDDEN');
  const payload = sanitizeContactInput(input, { scope, schoolId, ownerId: actor.uid });
  const duplicate = await findStoredDuplicate({
    db,
    schoolId,
    userId: actor.uid,
    scope,
    emails: payload.normalizedEmails,
  });
  if (duplicate) {
    const error = new Error('DUPLICATE_CONTACT');
    error.duplicate = duplicate;
    throw error;
  }
  const ref = doc(scope === CONTACT_SCOPE.PRIVATE
    ? privateCollection(db, actor.uid)
    : institutionalCollection(db, schoolId));
  const batch = writeBatch(db);
  batch.set(ref, {
    ...payload,
    createdBy: actor.uid,
    updatedBy: actor.uid,
    archivedBy: '',
    archivedAt: null,
    mergedIntoId: '',
    mergedFromIds: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
  return { id: ref.id, ...payload };
}

export async function updateContact({ db, schoolId, actor, scope, contactId, input, permissions = {} }) {
  if (scope === CONTACT_SCOPE.INSTITUTIONAL && permissions.edit !== true) throw new Error('CONTACT_EDIT_FORBIDDEN');
  const payload = sanitizeContactInput(input, { scope, schoolId, ownerId: actor.uid });
  const duplicate = await findStoredDuplicate({
    db,
    schoolId,
    userId: actor.uid,
    scope,
    emails: payload.normalizedEmails,
    excludeId: contactId,
  });
  if (duplicate) {
    const error = new Error('DUPLICATE_CONTACT');
    error.duplicate = duplicate;
    throw error;
  }
  const batch = writeBatch(db);
  batch.update(contactRef(db, { scope, schoolId, userId: actor.uid, contactId }), {
    ...payload,
    updatedBy: actor.uid,
    updatedAt: serverTimestamp(),
  });
  return batch.commit();
}

export async function archiveContact({ db, schoolId, actor, contact, permissions = {} }) {
  if (contact.scope === CONTACT_SCOPE.INSTITUTIONAL && permissions.archive !== true) throw new Error('CONTACT_ARCHIVE_FORBIDDEN');
  const batch = writeBatch(db);
  batch.update(contactRef(db, {
    scope: contact.scope,
    schoolId,
    userId: actor.uid,
    contactId: contact.id,
  }), {
    archived: true,
    archivedBy: actor.uid,
    archivedAt: serverTimestamp(),
    updatedBy: actor.uid,
    updatedAt: serverTimestamp(),
  });
  return batch.commit();
}

export async function restoreContact({ db, schoolId, actor, contact, permissions = {} }) {
  if (contact.scope === CONTACT_SCOPE.INSTITUTIONAL && permissions.archive !== true) throw new Error('CONTACT_ARCHIVE_FORBIDDEN');
  const batch = writeBatch(db);
  batch.update(contactRef(db, {
    scope: contact.scope,
    schoolId,
    userId: actor.uid,
    contactId: contact.id,
  }), {
    archived: false,
    archivedBy: '',
    archivedAt: null,
    updatedBy: actor.uid,
    updatedAt: serverTimestamp(),
  });
  return batch.commit();
}

export async function mergeContacts({ db, schoolId, actor, source, target, permissions = {} }) {
  if (source.scope !== target.scope || source.id === target.id) throw new Error('INVALID_CONTACT_MERGE');
  if (source.scope === CONTACT_SCOPE.INSTITUTIONAL && permissions.merge !== true) throw new Error('CONTACT_MERGE_FORBIDDEN');
  const normalizedEmails = unique([
    ...(target.normalizedEmails || []),
    ...(source.normalizedEmails || []),
  ].map(normalizeContactEmail), 10);
  const targetReference = contactRef(db, {
    scope: target.scope, schoolId, userId: actor.uid, contactId: target.id,
  });
  const sourceReference = contactRef(db, {
    scope: source.scope, schoolId, userId: actor.uid, contactId: source.id,
  });
  const batch = writeBatch(db);
  batch.update(targetReference, {
    primaryEmail: normalizedEmails[0],
    additionalEmails: normalizedEmails.slice(1),
    normalizedEmails,
    tags: unique([...(target.tags || []), ...(source.tags || [])], 20),
    mergedFromIds: unique([...(target.mergedFromIds || []), source.id, ...(source.mergedFromIds || [])], 50),
    updatedBy: actor.uid,
    updatedAt: serverTimestamp(),
  });
  batch.update(sourceReference, {
    archived: true,
    archivedBy: actor.uid,
    archivedAt: serverTimestamp(),
    mergedIntoId: target.id,
    updatedBy: actor.uid,
    updatedAt: serverTimestamp(),
  });
  return batch.commit();
}
