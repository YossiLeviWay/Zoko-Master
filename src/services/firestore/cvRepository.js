import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { getBlob, ref, uploadBytes } from 'firebase/storage';
import { schoolDoc } from './paths';
import {
  archiveCvDocument,
  createCvDocument,
  duplicateCvDocument,
  finalizeCvDocument,
  recordCvAccess,
  registerCvPdf,
  saveCvDraft,
} from '../adminUserService';

export const CV_SECTION_ORDER = Object.freeze([
  'summary', 'experiences', 'practicalExperience', 'projects', 'recommendations',
  'skills', 'credentials', 'education', 'languages',
]);

export const CV_SECTION_LABELS = Object.freeze({
  summary: 'קצת עליי', experiences: 'ניסיון תעסוקתי',
  practicalExperience: 'ניסיון מעשי', projects: 'פרויקטים',
  recommendations: 'המלצות', skills: 'מיומנויות', credentials: 'הסמכות',
  education: 'השכלה', languages: 'שפות',
});

function cvCollection(db, schoolId, studentId) {
  return collection(schoolDoc(db, schoolId, 'personalFiles', studentId), 'cvDocuments');
}

export function subscribeCvDocuments({ db, schoolId, studentId, onData, onError }) {
  return onSnapshot(
    query(cvCollection(db, schoolId, studentId), orderBy('updatedAt', 'desc')),
    snapshot => onData(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))),
    onError,
  );
}

export function subscribeCvVersions({ db, schoolId, studentId, documentId, onData, onError }) {
  const source = collection(schoolDoc(db, schoolId, 'personalFiles', studentId), 'cvDocuments', documentId, 'versions');
  return onSnapshot(query(source, orderBy('versionNumber', 'desc')), snapshot => (
    onData(snapshot.docs.map(item => ({ id: item.id, ...item.data() })))
  ), onError);
}

export function subscribeCvExports({ db, schoolId, studentId, documentId, versionId, onData, onError }) {
  const source = collection(
    schoolDoc(db, schoolId, 'personalFiles', studentId),
    'cvDocuments', documentId, 'versions', versionId, 'exports',
  );
  return onSnapshot(source, snapshot => onData(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))), onError);
}

export function createDefaultCvSnapshot(student) {
  return {
    personal: {
      fullName: student.fullName || student.displayName || '',
      professionalTitle: '',
      phone: student.phone || '',
      email: student.email || '',
      city: student.city || '',
      birthDate: '',
      professionalLink: '',
      photoPath: '',
    },
    summary: '',
    education: [{
      title: student.schoolName || 'בית הספר',
      subtitle: [student.className, student.gradeLevel].filter(Boolean).join(' · '),
      organization: '', period: student.academicYear || '', description: '', bullets: [],
      category: '', level: '', quote: '', contact: '', link: '',
    }],
    experiences: [], practicalExperience: [], projects: [], skills: [], credentials: [],
    recommendations: [], languages: [],
    sectionOrder: [...CV_SECTION_ORDER], hiddenSections: [],
    design: {
      templateId: 'classic_professional', templateName: 'קלאסי מקצועי',
      accentColor: '#607D8B', showPhoto: false,
      sidebarSections: ['skills', 'credentials', 'education', 'languages'],
    },
  };
}

export async function createCv(payload) {
  return createCvDocument(payload);
}

export async function saveCv(payload) {
  return saveCvDraft(payload);
}

export async function duplicateCv(payload) {
  return duplicateCvDocument({ ...payload, confirm: true });
}

export async function finalizeCv(payload) {
  return finalizeCvDocument({ ...payload, confirm: true });
}

export async function archiveCv(payload) {
  return archiveCvDocument({ ...payload, confirm: true });
}

export async function auditCvView(payload) {
  return recordCvAccess({ ...payload, action: 'view' });
}

export async function uploadCvPdf({ storage, schoolId, studentId, documentId, versionId, exportId, filename, blob }) {
  const storagePath = `schools/${schoolId}/students/${studentId}/cv/${documentId}/${versionId}/${exportId}/${filename}`;
  await uploadBytes(ref(storage, storagePath), blob, {
    contentType: 'application/pdf',
    customMetadata: { schoolId, studentId, documentId, versionId, exportId },
  });
  const attachment = { storagePath, originalName: filename, contentType: 'application/pdf', size: blob.size };
  await registerCvPdf({ schoolId, studentId, documentId, versionId, exportId, attachment });
  return attachment;
}

export async function downloadCvPdf({ storage, schoolId, studentId, documentId, attachment }) {
  await recordCvAccess({ schoolId, studentId, documentId, action: 'download' });
  const blob = await getBlob(ref(storage, attachment.storagePath));
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = attachment.originalName;
  anchor.click();
  URL.revokeObjectURL(url);
}
