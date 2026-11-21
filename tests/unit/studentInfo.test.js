import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { missingStudentInfo } from '../../src/utils/studentInfo.js';

test('a complete student card reports nothing missing', () => {
  assert.deepEqual(missingStudentInfo({ parentPhone: '050', phone: '052', joinedAt: '2026-09-01', trackIds: ['t1'] }), []);
});
test('missing fields are listed by name', () => {
  assert.deepEqual(missingStudentInfo({ joinedAt: '2026-09-01', trackIds: ['t1'] }), ['טלפון הורה', 'טלפון תלמיד']);
  assert.equal(missingStudentInfo({}).length, 4);
  assert.equal(missingStudentInfo({ parentPhone: '  ', phone: '1', joinedAt: 'x', trackId: 'a' }).includes('טלפון הורה'), true);
});
test('the legacy rollout snapshot of the students page has the same simplifications as the source', async () => {
  const legacy = JSON.parse(await readFile('scripts/simple-access-legacy.json', 'utf8'))['src/components/Students/Students.jsx'];
  const current = await readFile('src/components/Students/Students.jsx', 'utf8');
  for (const marker of ['<MoreMenu', 'MissingInfoMark', "get('student')"]) {
    assert.ok(legacy.includes(marker), `legacy missing ${marker}`);
    assert.ok(current.includes(marker), `current missing ${marker}`);
  }
});

test('every route that creates a student syncs them into the class attendance sheets from one place', async () => {
  const repo = await readFile('src/services/firestore/classStudentRepository.js', 'utf8');
  assert.match(repo, /addStudentToClassSheets\(/);
  const editor = await readFile('src/components/Files/AttendanceSheetEditor.jsx', 'utf8');
  assert.match(editor, /students_create/);
});
