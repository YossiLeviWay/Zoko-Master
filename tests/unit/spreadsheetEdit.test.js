import test from 'node:test';
import assert from 'node:assert/strict';
import { blurShouldCommit, editDir, nextAfterEdit, nextAfterHeader } from '../../src/utils/spreadsheetEdit.js';

test('hebrew text edits right to left and formulas stay left to right', () => {
  assert.equal(editDir('שלום כיתה'), 'rtl');
  assert.equal(editDir('=SUM(A1:A3)'), 'ltr');
  assert.equal(editDir('12'), 'auto');
});

test('enter moves down, escape is not a move, and tab moves visually right', () => {
  assert.deepEqual(nextAfterEdit({ row: 1, col: 2, rows: 10, cols: 5, key: 'Enter' }), { kind: 'cell', row: 2, col: 2 });
  assert.equal(nextAfterEdit({ row: 9, col: 2, rows: 10, cols: 5, key: 'Enter' }), null);
  assert.equal(nextAfterEdit({ row: 1, col: 2, rows: 10, cols: 5, key: 'Escape' }), null);
  assert.deepEqual(nextAfterEdit({ row: 1, col: 2, rows: 10, cols: 5, key: 'Tab' }), { kind: 'cell', row: 1, col: 1 });
  assert.deepEqual(nextAfterEdit({ row: 1, col: 2, rows: 10, cols: 5, key: 'Tab', shift: true }), { kind: 'cell', row: 1, col: 3 });
  assert.equal(nextAfterEdit({ row: 1, col: 0, rows: 10, cols: 5, key: 'Tab' }), null);
});

test('a header edit uses the same keys: tab right, enter down into the column', () => {
  assert.deepEqual(nextAfterHeader({ col: 2, cols: 5, rows: 10, key: 'Tab' }), { kind: 'header', col: 1 });
  assert.deepEqual(nextAfterHeader({ col: 2, cols: 5, rows: 10, key: 'Enter' }), { kind: 'cell', row: 0, col: 2 });
  assert.equal(nextAfterHeader({ col: 2, cols: 5, rows: 0, key: 'Enter' }), null);
});

test('moving between the cell and the formula bar does not commit', () => {
  const bar = { closest: selector => selector === '.spreadsheet-edit-surface' };
  const outside = { closest: () => null };
  assert.equal(blurShouldCommit(bar), false);
  assert.equal(blurShouldCommit(outside), true);
  assert.equal(blurShouldCommit(null), true);
});
