import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';

export const COMMUNICATION_TEMPLATE_SCOPE = Object.freeze({
  PRIVATE: 'private',
  INSTITUTIONAL: 'institutional',
  BUILTIN: 'builtin',
});

export const BUILTIN_COMMUNICATION_TEMPLATES = Object.freeze([
  ['information', 'בקשת מידע', 'בקשת מידע בנושא {{context}}', 'שלום,\n\nאשמח לקבל מידע ועדכון בנושא {{context}}.\n\nתודה רבה.'],
  ['gentle_reminder', 'תזכורת עדינה', 'תזכורת: {{subject}}', 'שלום,\n\nרציתי להזכיר בעדינות את פנייתי בנושא {{subject}} ולבדוק אם יש עדכון.\n\nתודה רבה.'],
  ['no_reply', 'תזכורת לאחר אי־מענה', 'מעקב: {{subject}}', 'שלום,\n\nטרם התקבל מענה לפנייה בנושא {{subject}}. אשמח לקבל עדכון בהקדם.\n\nתודה.'],
  ['meeting', 'תיאום פגישה', 'תיאום פגישה בנושא {{context}}', 'שלום,\n\nאשמח לתאם פגישה בנושא {{context}}. אנא עדכנו אילו מועדים מתאימים לכם.\n\nבברכה.'],
  ['supplier', 'פנייה לספק', 'פנייה בנושא {{context}}', 'שלום,\n\nאנו פונים אליכם מבית הספר בנושא {{context}}. נשמח לקבל את התייחסותכם והמשך טיפול.\n\nתודה.'],
  ['event', 'הזמנה לאירוע', 'הזמנה: {{context}}', 'שלום,\n\nנשמח להזמינכם להשתתף ב־{{context}}. פרטים נוספים יימסרו בהמשך.\n\nבברכה.'],
  ['documents', 'בקשת מסמכים', 'בקשת מסמכים בנושא {{context}}', 'שלום,\n\nלצורך המשך הטיפול בנושא {{context}}, נבקש להעביר את המסמכים הרלוונטיים.\n\nתודה.'],
  ['parents', 'עדכון הורים', 'עדכון בנושא {{context}}', 'שלום,\n\nברצוננו לעדכן בנושא {{context}}. אנא צרו קשר אם נדרש בירור נוסף.\n\nבברכה.'],
  ['employer', 'פנייה למעסיק', 'פנייה בנושא {{context}}', 'שלום,\n\nאנו פונים אליכם מטעם בית הספר בנושא {{context}} ונשמח לתאם את המשך הטיפול.\n\nתודה.'],
  ['call_summary', 'סיכום שיחה', 'סיכום שיחה בנושא {{context}}', 'שלום,\n\nבהמשך לשיחתנו, להלן סיכום הנקודות שסוכמו בנושא {{context}}:\n\n• \n\nבברכה.'],
].map(([id, name, subjectTemplate, bodyTemplate]) => Object.freeze({
  id: `builtin_${id}`,
  scope: COMMUNICATION_TEMPLATE_SCOPE.BUILTIN,
  name,
  category: name,
  subjectTemplate,
  bodyTemplate,
  tone: 'respectful',
  builtin: true,
})));

function cleanText(value, max) {
  return String(value || '').trim().slice(0, max);
}

function templateCollection(db, { schoolId, userId, scope }) {
  return scope === COMMUNICATION_TEMPLATE_SCOPE.PRIVATE
    ? collection(db, 'users', userId, 'communicationTemplates')
    : collection(db, 'schools', schoolId, 'communicationTemplates');
}

function templateRef(db, { schoolId, userId, scope, templateId }) {
  return doc(templateCollection(db, { schoolId, userId, scope }), templateId);
}

export function sanitizeCommunicationTemplate(input, scope) {
  const name = cleanText(input.name, 120);
  const subjectTemplate = cleanText(input.subjectTemplate, 300);
  const bodyTemplate = cleanText(input.bodyTemplate, 10000);
  if (!name || !bodyTemplate) throw new Error('INVALID_COMMUNICATION_TEMPLATE');
  return {
    scope,
    name,
    category: cleanText(input.category, 80),
    subjectTemplate,
    bodyTemplate,
    tone: ['respectful', 'direct', 'friendly', 'formal'].includes(input.tone) ? input.tone : 'respectful',
  };
}

export function renderCommunicationTemplate(template, variables = {}) {
  const values = {
    name: cleanText(variables.name, 160),
    organization: cleanText(variables.organization, 160),
    subject: cleanText(variables.subject, 300),
    context: cleanText(variables.context, 300),
  };
  const render = value => String(value || '').replace(/\{\{(name|organization|subject|context)\}\}/g, (_, key) => values[key]);
  return {
    subject: render(template.subjectTemplate).slice(0, 300),
    body: render(template.bodyTemplate).slice(0, 10000),
  };
}

export function subscribeCommunicationTemplates({
  db,
  schoolId,
  userId,
  includeInstitutional,
  onData,
  onError,
}) {
  const buckets = new Map([['builtin', BUILTIN_COMMUNICATION_TEMPLATES]]);
  const listeners = [];
  const emit = () => onData([...buckets.values()].flat().filter(item => item.archived !== true));
  const listen = (key, ref, scope) => listeners.push(onSnapshot(ref, snapshot => {
    buckets.set(key, snapshot.docs.map(item => ({ id: item.id, scope, ...item.data() })));
    emit();
  }, onError));
  listen('private', templateCollection(db, { userId, scope: COMMUNICATION_TEMPLATE_SCOPE.PRIVATE }), COMMUNICATION_TEMPLATE_SCOPE.PRIVATE);
  if (includeInstitutional && schoolId) {
    listen('institutional', templateCollection(db, { schoolId, scope: COMMUNICATION_TEMPLATE_SCOPE.INSTITUTIONAL }), COMMUNICATION_TEMPLATE_SCOPE.INSTITUTIONAL);
  }
  emit();
  return () => listeners.forEach(unsubscribe => unsubscribe());
}

export async function saveCommunicationTemplate({
  db,
  schoolId,
  userId,
  templateId = '',
  scope,
  input,
  canManageInstitutional = false,
}) {
  if (!userId || !schoolId || ![COMMUNICATION_TEMPLATE_SCOPE.PRIVATE, COMMUNICATION_TEMPLATE_SCOPE.INSTITUTIONAL].includes(scope)) {
    throw new Error('INVALID_COMMUNICATION_TEMPLATE_CONTEXT');
  }
  if (scope === COMMUNICATION_TEMPLATE_SCOPE.INSTITUTIONAL && !canManageInstitutional) {
    throw new Error('COMMUNICATION_TEMPLATE_FORBIDDEN');
  }
  const payload = sanitizeCommunicationTemplate(input, scope);
  const ref = templateId
    ? templateRef(db, { schoolId, userId, scope, templateId })
    : doc(templateCollection(db, { schoolId, userId, scope }));
  const batch = writeBatch(db);
  if (templateId) {
    batch.update(ref, { ...payload, updatedBy: userId, updatedAt: serverTimestamp() });
  } else {
    batch.set(ref, {
      ...payload,
      schoolId,
      ownerId: scope === COMMUNICATION_TEMPLATE_SCOPE.PRIVATE ? userId : '',
      archived: false,
      archivedBy: '',
      archivedAt: null,
      createdBy: userId,
      updatedBy: userId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      schemaVersion: 1,
    });
  }
  await batch.commit();
  return ref.id;
}

export async function archiveCommunicationTemplate({ db, schoolId, userId, template, canManageInstitutional = false }) {
  if (!template?.id || template.builtin) throw new Error('INVALID_COMMUNICATION_TEMPLATE');
  if (template.scope === COMMUNICATION_TEMPLATE_SCOPE.INSTITUTIONAL && !canManageInstitutional) {
    throw new Error('COMMUNICATION_TEMPLATE_FORBIDDEN');
  }
  const batch = writeBatch(db);
  batch.update(templateRef(db, {
    schoolId,
    userId,
    scope: template.scope,
    templateId: template.id,
  }), {
    archived: true,
    archivedBy: userId,
    archivedAt: serverTimestamp(),
    updatedBy: userId,
    updatedAt: serverTimestamp(),
  });
  return batch.commit();
}
