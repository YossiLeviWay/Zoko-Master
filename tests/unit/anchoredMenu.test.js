import test from 'node:test';
import assert from 'node:assert/strict';
import { anchoredMenuPosition } from '../../src/utils/anchoredMenu.js';
test('opens beside the trigger and stays inside narrow screens', () => {
  const p = anchoredMenuPosition({ top: 100, bottom: 140, right: 300 }, 320, 200, { width: 390, height: 844 });
  assert.equal(p.top, 146); assert.equal(p.left, 8); assert.ok(p.left + p.width <= 382);
});
test('flips above a low trigger and limits a tall menu', () => {
  const p = anchoredMenuPosition({ top: 700, bottom: 740, right: 500 }, 320, 800, { width: 1000, height: 800 });
  assert.equal(p.top, 8); assert.equal(p.maxHeight, 686);
});
