import { onSnapshot, query, where } from 'firebase/firestore';
import { schoolCollection } from './paths';
import {
  bulkCreateCvDrafts,
  cvTemplateAction,
  previewBulkCvDrafts,
  upsertCvTemplate,
} from '../adminUserService';

export const TEMPLATE_PLACEHOLDERS = Object.freeze([
  '{{student.fullName}}', '{{student.phone}}', '{{student.email}}', '{{student.city}}',
  '{{student.major}}', '{{student.graduationYear}}', '{{school.name}}', '{{class.name}}',
]);

export function sharedTemplatePrivacyIssues(template) {
  if (template.scope !== 'school' || template.type !== 'content') return [];
  let text = [template.content.summaryTemplate, template.content.educationText, template.content.experienceText].join('\n');
  TEMPLATE_PLACEHOLDERS.forEach(placeholder => { text = text.replaceAll(placeholder, ''); });
  const issues = [];
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(text)) issues.push('כתובת דוא״ל אישית');
  if (/(?:\d[\s().-]*){7,}/.test(text)) issues.push('מספר טלפון');
  if (/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/.test(text)) issues.push('תאריך אישי');
  if (/{{[^}]+}}/.test(text)) issues.push('שדה דינמי שאינו מוכר');
  return issues;
}

export function subscribeCvTemplates({ db, schoolId, actorUid, onData, onError }) {
  const source = schoolCollection(db, schoolId, 'cvTemplates');
  let schoolItems = [];
  let personalItems = [];
  const emit = () => onData([...schoolItems, ...personalItems].sort((a, b) => a.name.localeCompare(b.name, 'he')));
  const unsubSchool = onSnapshot(query(source, where('scope', '==', 'school'), where('status', '==', 'active')), snapshot => {
    schoolItems = snapshot.docs.map(item => ({ id: item.id, ...item.data() })); emit();
  }, onError);
  const unsubPersonal = onSnapshot(query(source, where('scope', '==', 'personal'), where('createdBy', '==', actorUid), where('status', '==', 'active')), snapshot => {
    personalItems = snapshot.docs.map(item => ({ id: item.id, ...item.data() })); emit();
  }, onError);
  return () => { unsubSchool(); unsubPersonal(); };
}

export async function saveCvTemplate(payload) {
  return upsertCvTemplate(payload);
}

export async function cloneCvTemplate(payload) {
  return cvTemplateAction({ ...payload, action: 'clone', confirm: true });
}

export async function archiveCvTemplate(payload) {
  return cvTemplateAction({ ...payload, action: 'archive', confirm: true });
}

export async function previewBulkCv(payload) {
  return previewBulkCvDrafts(payload);
}

export async function createBulkCvDrafts(payload) {
  return bulkCreateCvDrafts(payload);
}
