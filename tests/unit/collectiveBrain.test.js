import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canContributeToCollectiveBrainBoard,
  canReadCollectiveBrainBoard,
  cleanCollectiveBrainText,
  findOwnCollectiveBrainResponse,
  findOwnCollectiveBrainResponses,
  normalizeCollectiveBrainBoard,
  sortCollectiveBrainBoards,
  sortCollectiveBrainResponses,
} from '../../src/utils/collectiveBrain.js';

const time = seconds => ({ seconds });

test('collective brain text is trimmed and bounded', () => {
  assert.equal(cleanCollectiveBrainText('  תשובה  ', 20), 'תשובה');
  assert.equal(cleanCollectiveBrainText('123456', 4), '1234');
  assert.equal(cleanCollectiveBrainText(null, 20), '');
});

test('invalid board data fails closed as a closed board', () => {
  const board = normalizeCollectiveBrainBoard({ question: '  שאלה?  ', status: 'unexpected' });
  assert.equal(board.question, 'שאלה?');
  assert.equal(board.status, 'closed');
});

test('boards are grouped by status and newest first', () => {
  const items = sortCollectiveBrainBoards([
    { id: 'old', status: 'open', updatedAt: time(1) },
    { id: 'closed', status: 'closed', updatedAt: time(9) },
    { id: 'new', status: 'open', updatedAt: time(3) },
  ]);
  assert.deepEqual(items.map(item => item.id), ['new', 'old', 'closed']);
});

test('responses are ordered oldest first and own response is deterministic', () => {
  const items = sortCollectiveBrainResponses([
    { id: 'user_b', authorId: 'user_b', createdAt: time(5) },
    { id: 'user_a', authorId: 'user_a', createdAt: time(1) },
  ]);
  assert.deepEqual(items.map(item => item.id), ['user_a', 'user_b']);
  assert.equal(findOwnCollectiveBrainResponse(items, 'user_b')?.id, 'user_b');
  assert.equal(findOwnCollectiveBrainResponse(items, 'missing'), null);
});

test('only open boards accept member contributions', () => {
  assert.equal(canContributeToCollectiveBrainBoard({ status: 'open' }), true);
  assert.equal(canContributeToCollectiveBrainBoard({ status: 'closed' }), false);
  assert.equal(canContributeToCollectiveBrainBoard({ status: 'archived' }), false);
  assert.equal(canContributeToCollectiveBrainBoard({ status: 'open', maxResponsesPerUser: 2 }, 2), false);
  assert.equal(canContributeToCollectiveBrainBoard({ status: 'open', maxResponsesPerUser: 2 }, 1), true);
});

test('restricted boards and multiple own responses are resolved explicitly', () => {
  assert.equal(canReadCollectiveBrainBoard({ status: 'open', audienceMode: 'restricted', audienceUserIds: ['a'] }, 'a'), true);
  assert.equal(canReadCollectiveBrainBoard({ status: 'open', audienceMode: 'restricted', audienceUserIds: ['a'] }, 'b'), false);
  assert.equal(findOwnCollectiveBrainResponses([{ id: 'a_1', authorId: 'a' }, { id: 'a_2', authorId: 'a' }, { id: 'b_1', authorId: 'b' }], 'a').length, 2);
});

test('collective brain boards normalize group collaboration mode', () => {
  assert.equal(normalizeCollectiveBrainBoard({ collaborationMode: 'group' }).collaborationMode, 'group');
  assert.equal(normalizeCollectiveBrainBoard({ collaborationMode: 'unknown' }).collaborationMode, 'individual');
});
