import test from 'node:test';
import assert from 'node:assert/strict';
import {
  importFieldForHeader,
  normalizeImportLookup,
  parseDelimitedStudentText,
} from '../../src/utils/studentBulkImport.js';

test('parses the attached Excel CSV structure including BOM, dotted ID and track', () => {
  const csv = '\uFEFFשם תלמיד,שם משפחה,ת.ז ,כיתה,מגמה\nאביתר,אזואלי,220706329,הכיתה של דגנית,אוטוטרוניקה\nאדיסו,גססה,346764913,י\',מערכות הנדסיות';
  const result = parseDelimitedStudentText(csv);

  assert.equal(result.hasHeader, true);
  assert.deepEqual(result.mapping, {
    0: 'firstName',
    1: 'lastName',
    2: 'idNumber',
    3: 'className',
    4: 'trackName',
  });
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows[0], ['אביתר', 'אזואלי', '220706329', 'הכיתה של דגנית', 'אוטוטרוניקה']);
});

test('keeps the first student when pasted data has no header row', () => {
  const pasted = 'אביתר\tאזואלי\t220706329\tהכיתה של דגנית\tאוטוטרוניקה\nאדיסו\tגססה\t346764913\tי\'\tמערכות הנדסיות';
  const result = parseDelimitedStudentText(pasted);

  assert.equal(result.hasHeader, false);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0][0], 'אביתר');
  assert.equal(result.mapping[4], 'trackName');
});

test('supports Excel-compatible semicolon CSV and quoted delimiters', () => {
  const csv = 'שם תלמיד;שם משפחה;ת.ז;כיתה;מגמה\n"מיכל, לי";כהן;123;י;עיצוב';
  const result = parseDelimitedStudentText(csv);

  assert.equal(result.rows[0][0], 'מיכל, לי');
  assert.equal(importFieldForHeader(' ת.ז '), 'idNumber');
  assert.equal(normalizeImportLookup('י׳'), normalizeImportLookup("י'"));
});
