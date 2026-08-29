import test from 'node:test';
import assert from 'node:assert/strict';
import { answerZokiOnSpark } from '../../src/utils/zokiSparkAnswer.js';

test('Spark Zoki answers an authorized student class question locally', () => {
  const result = answerZokiOnSpark({
    question: 'באיזו כיתה לומד אלון דגן?',
    students: [{ id: 'student_1', fullName: 'אלון דגן', className: 'ט׳2' }],
  });
  assert.equal(result.answer, 'אלון דגן לומד/ת בכיתה ט׳2.');
  assert.equal(result.sources[0].route, '/students');
});

test('Spark Zoki never claims a hidden student exists', () => {
  const result = answerZokiOnSpark({
    question: 'איפה לומדת נועה כהן?',
    students: [],
  });
  assert.match(result.answer, /לא מצאתי.*הרשאה/u);
});

test('Spark Zoki explains its current capabilities without a backend', () => {
  const result = answerZokiOnSpark({ question: 'מה אתה יכול לעשות?' });
  assert.match(result.answer, /להתמצא באפליקציה/u);
});

