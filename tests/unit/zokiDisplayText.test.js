import test from 'node:test';
import assert from 'node:assert/strict';
import { zokiDisplayText } from '../../src/utils/zokiDisplayText.js';

test('hides multiline technical citations without losing the proposal', () => {
  assert.equal(zokiDisplayText('הכנתי הצעה לעדכון התפקיד (מקור:\nusers/abc123). האם לאשר?'), 'הכנתי הצעה לעדכון התפקיד. האם לאשר?');
  assert.equal(zokiDisplayText('ההצעה מוכנה [sources: users/abc123].'), 'ההצעה מוכנה.');
});
test('keeps useful prose, names, dates and public links', () => {
  const answer = 'הפעילות ביום שני (14.9). קישור: https://example.com/source';
  assert.equal(zokiDisplayText(answer), answer);
  assert.equal(zokiDisplayText('אורפז חן היא הרכזת. מקור: users/abc123'), 'אורפז חן היא הרכזת.');
});
test('removes known record IDs without changing structured evidence', () => {
  const sources = [{ id: 'schools/a/tasks/task1' }];
  assert.equal(zokiDisplayText('המשימה מוכנה (schools/a/tasks/task1).', sources), 'המשימה מוכנה.');
  assert.equal(sources[0].id, 'schools/a/tasks/task1');
});
