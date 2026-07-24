import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { getBlob, ref, uploadBytes } from 'firebase/storage';
import { schoolCollection, schoolDoc } from './paths';
import {
  archivePersonalFileItem,
  recordPersonalFileAccess,
  upsertPersonalFileItem,
  upsertSkillCatalogItem,
} from '../adminUserService';

export const PERSONAL_FILE_KINDS = Object.freeze([
  'documents', 'credentials', 'experiences', 'skills', 'recommendations',
]);

function safeExtension(filename) {
  const match = filename.toLowerCase().match(/\.([a-z0-9]{1,10})$/);
  return match ? `.${match[1]}` : '';
}

function safeDownloadName(value) {
  return [...String(value || 'document')]
    .map(character => character.charCodeAt(0) < 32 ? '-' : character)
    .join('')
    .replace(/[\\/:*?"<>|]/g, '-')
    .slice(0, 180);
}

export function subscribePersonalFileKind({ db, schoolId, studentId, kind, onData, onError }) {
  const source = collection(schoolDoc(db, schoolId, 'personalFiles', studentId), kind);
  return onSnapshot(source, snapshot => {
    onData(snapshot.docs.map(item => ({ id: item.id, ...item.data() })));
  }, onError);
}

export function subscribeSkillCatalog({ db, schoolId, onData, onError }) {
  return onSnapshot(
    query(schoolCollection(db, schoolId, 'skillCatalog'), where('status', '==', 'active')),
    snapshot => onData(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))),
    onError,
  );
}

export async function savePersonalFileItem({ schoolId, studentId, kind, itemId, payload }) {
  return upsertPersonalFileItem({ schoolId, studentId, kind, itemId, payload });
}

export async function archivePersonalItem({ schoolId, studentId, kind, itemId }) {
  return archivePersonalFileItem({ schoolId, studentId, kind, itemId });
}

export async function saveSkillCatalogItem(payload) {
  return upsertSkillCatalogItem(payload);
}

export async function uploadPersonalFile({ storage, schoolId, studentId, kind, file }) {
  const fileId = globalThis.crypto.randomUUID().replaceAll('-', '');
  const filename = `${fileId}${safeExtension(file.name)}`;
  const storagePath = `schools/${schoolId}/students/${studentId}/personal-file/${kind}/${fileId}/${filename}`;
  await uploadBytes(ref(storage, storagePath), file, {
    contentType: file.type || 'application/octet-stream',
    customMetadata: { studentId, schoolId, kind },
  });
  return {
    storagePath,
    originalName: safeDownloadName(file.name),
    contentType: file.type || 'application/octet-stream',
    size: file.size,
  };
}

export async function downloadPersonalFile({ storage, schoolId, studentId, kind, itemId, attachment }) {
  await recordPersonalFileAccess({ schoolId, studentId, action: 'download', kind, itemId });
  const blob = await getBlob(ref(storage, attachment.storagePath));
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = safeDownloadName(attachment.originalName);
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function auditPersonalFileView({ schoolId, studentId }) {
  return recordPersonalFileAccess({ schoolId, studentId, action: 'view' });
}
