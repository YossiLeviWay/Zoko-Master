export const COMMUNICATION_CONTEXT_TYPES = Object.freeze({
  GENERAL: 'general',
  TASK: 'task',
  STUDENT: 'student',
  TEAM: 'team',
  INITIATIVE: 'initiative',
  MILESTONE: 'milestone',
  EVENT: 'event',
  CONTACT: 'contact',
});

const ALLOWED_TYPES = new Set(Object.values(COMMUNICATION_CONTEXT_TYPES));

function clean(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function ids(value, max = 100) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(item => clean(item, 128))
    .filter(Boolean))].slice(0, max);
}

export function normalizeCommunicationContext(value = {}) {
  const type = ALLOWED_TYPES.has(value.type) ? value.type : COMMUNICATION_CONTEXT_TYPES.GENERAL;
  const id = clean(value.id, 128) || (type === COMMUNICATION_CONTEXT_TYPES.GENERAL ? 'task_panel' : 'unknown');
  const participantIds = ids(value.participantIds);
  const fileIds = ids(value.fileIds, 20);
  return {
    type,
    id,
    label: clean(value.label, 300) || 'פאנל המשימות',
    description: clean(value.description, 1000),
    recipientEmail: clean(value.recipientEmail, 320),
    studentId: type === COMMUNICATION_CONTEXT_TYPES.STUDENT ? id : clean(value.studentId, 128),
    classId: clean(value.classId, 128),
    teamId: type === COMMUNICATION_CONTEXT_TYPES.TEAM ? id : clean(value.teamId, 128),
    initiativeId: type === COMMUNICATION_CONTEXT_TYPES.INITIATIVE ? id : clean(value.initiativeId, 128),
    milestoneId: type === COMMUNICATION_CONTEXT_TYPES.MILESTONE ? id : clean(value.milestoneId, 128),
    eventId: type === COMMUNICATION_CONTEXT_TYPES.EVENT ? id : clean(value.eventId, 128),
    contactId: type === COMMUNICATION_CONTEXT_TYPES.CONTACT ? id : clean(value.contactId, 128),
    fileIds,
    participantIds,
  };
}

export function communicationSourceFromContext(value) {
  const context = normalizeCommunicationContext(value);
  return {
    id: context.id,
    title: context.label,
    description: context.description,
    priority: 'medium',
    _source: 'context',
    _storageMode: 'context',
    communicationContext: context,
    initiativeId: context.initiativeId,
    milestoneId: context.milestoneId,
    teamId: context.teamId,
    attachedFileId: context.fileIds[0] || '',
  };
}

export function communicationContextLabel(type) {
  return ({
    general: 'פאנל המשימות',
    task: 'משימה',
    student: 'תלמיד',
    team: 'צוות',
    initiative: 'תכנית ארוכת טווח',
    milestone: 'אבן דרך',
    event: 'אירוע',
    contact: 'איש קשר',
  })[type] || 'פריט במערכת';
}
