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

export function cleanCollectiveBrainText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function timestampValue(value) {
  return value?.toMillis?.() || value?.seconds * 1000 || 0;
}

export function normalizeCollectiveBrainBoard(item) {
  return {
    ...item,
    question: cleanCollectiveBrainText(item?.question, COLLECTIVE_BRAIN_LIMITS.question) || 'שאלה ללא כותרת',
    description: cleanCollectiveBrainText(item?.description, COLLECTIVE_BRAIN_LIMITS.description),
    status: COLLECTIVE_BRAIN_STATUSES.includes(item?.status) ? item.status : 'closed',
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

export function canContributeToCollectiveBrainBoard(board) {
  return board?.status === 'open';
}
