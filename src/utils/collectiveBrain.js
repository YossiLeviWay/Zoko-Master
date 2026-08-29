export const COLLECTIVE_BRAIN_LIMITS = Object.freeze({
  question: 300,
  description: 1500,
  response: 2000,
});

export const COLLECTIVE_BRAIN_STATUSES = Object.freeze([
  'open',
  'closed',
  'archived',
  'deleted',
]);

export const COLLECTIVE_BRAIN_AUDIENCES = Object.freeze(['school', 'restricted']);
export const COLLECTIVE_BRAIN_VISIBILITIES = Object.freeze(['private', 'public']);
export const COLLECTIVE_BRAIN_COLLABORATION_MODES = Object.freeze(['individual', 'group']);

export function cleanCollectiveBrainText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function timestampValue(value) {
  return value?.toMillis?.() || value?.seconds * 1000 || 0;
}

export function normalizeCollectiveBrainBoard(item) {
  const audienceMode = COLLECTIVE_BRAIN_AUDIENCES.includes(item?.audienceMode)
    ? item.audienceMode : 'school';
  return {
    ...item,
    question: cleanCollectiveBrainText(item?.question, COLLECTIVE_BRAIN_LIMITS.question) || 'שאלה ללא כותרת',
    description: cleanCollectiveBrainText(item?.description, COLLECTIVE_BRAIN_LIMITS.description),
    status: COLLECTIVE_BRAIN_STATUSES.includes(item?.status) ? item.status : 'closed',
    audienceMode,
    audienceUserIds: Array.isArray(item?.audienceUserIds) ? item.audienceUserIds : [],
    audienceTeamIds: Array.isArray(item?.audienceTeamIds) ? item.audienceTeamIds : [],
    visibility: COLLECTIVE_BRAIN_VISIBILITIES.includes(item?.visibility) ? item.visibility : 'private',
    collaborationMode: COLLECTIVE_BRAIN_COLLABORATION_MODES.includes(item?.collaborationMode) ? item.collaborationMode : 'individual',
    collaborationUserIds: Array.isArray(item?.collaborationUserIds) ? item.collaborationUserIds : [],
    publicShareId: typeof item?.publicShareId === 'string' ? item.publicShareId : '',
    maxResponsesPerUser: Number.isInteger(item?.maxResponsesPerUser)
      ? Math.min(20, Math.max(1, item.maxResponsesPerUser)) : 1,
    responseSlots: Array.isArray(item?.responseSlots) ? item.responseSlots : ['1'],
    linkedTaskIds: Array.isArray(item?.linkedTaskIds) ? item.linkedTaskIds : [],
  };
}

export function sortCollectiveBrainBoards(items) {
  const statusOrder = { open: 0, closed: 1, archived: 2, deleted: 3 };
  return [...items].sort((left, right) => {
    const statusDifference = (statusOrder[left.status] ?? 9) - (statusOrder[right.status] ?? 9);
    if (statusDifference) return statusDifference;
    return timestampValue(right.updatedAt || right.createdAt) - timestampValue(left.updatedAt || left.createdAt);
  });
}

export function sortCollectiveBrainResponses(items) {
  return [...items].sort((left, right) => (
    timestampValue(left.createdAt) - timestampValue(right.createdAt)
  ));
}

export function findOwnCollectiveBrainResponse(items, uid) {
  return items.find(item => item.id === uid || item.authorId === uid) || null;
}

export function findOwnCollectiveBrainResponses(items, uid) {
  return items.filter(item => item.id === uid || item.authorId === uid);
}

export function canReadCollectiveBrainBoard(board, uid) {
  if (!board || board.status === 'deleted') return false;
  return board.audienceMode !== 'restricted' || board.audienceUserIds?.includes(uid);
}

export function canContributeToCollectiveBrainBoard(board, currentCount = 0) {
  return board?.status === 'open' && currentCount < (board?.maxResponsesPerUser || 1);
}
