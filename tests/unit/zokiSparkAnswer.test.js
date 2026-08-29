import test from 'node:test';
import assert from 'node:assert/strict';
import { answerZokiOnSpark } from '../../src/utils/zokiSparkAnswer.js';

test('Spark Zoki answers an authorized student class question locally', async () => {
  const result = await answerZokiOnSpark({
    question: 'באיזו כיתה לומד אלון דגן?',
    data: { students: [{ id: 'student_1', fullName: 'אלון דגן', className: 'ט׳2' }] },
  });
  assert.equal(result.answer, 'אלון דגן לומד/ת בכיתה ט׳2.');
  assert.equal(result.sources[0].route, '/students');
});

test('Spark Zoki never claims a hidden student exists', async () => {
  const result = await answerZokiOnSpark({
    question: 'איפה לומדת נועה כהן?',
    data: { students: [] },
  });
  assert.match(result.answer, /לא מצאתי.*הרשאה/u);
});

test('Spark Zoki explains its current capabilities without a backend', async () => {
  const result = await answerZokiOnSpark({ question: 'מה אתה יכול לעשות?' });
  assert.match(result.answer, /מחובר לנתונים.*Firebase/u);
});

test('Spark Zoki counts the students in a named authorized class', async () => {
  const result = await answerZokiOnSpark({
    question: 'כמה תלמידים יש בכיתה של דגנית?',
    data: {
      classes: [{ id: 'class_1', name: 'הכיתה של דגנית' }],
      students: [
        { id: 'student_1', fullName: 'אלדר בוגלו', classId: 'class_1' },
        { id: 'student_2', fullName: 'נועה כהן', classId: 'class_1' },
      ],
    },
  });
  assert.match(result.answer, /2 תלמידים/u);
});

test('Spark Zoki resolves a student track from the authorized track collection', async () => {
  const result = await answerZokiOnSpark({
    question: 'איזה מגמה אלדר בוגלו?',
    data: {
      students: [{ id: 'student_1', fullName: 'אלדר בוגלו', trackIds: ['track_1'] }],
      tracks: [{ id: 'track_1', name: 'אוטוטרוניקה' }],
    },
  });
  assert.match(result.answer, /אוטוטרוניקה/u);
});

test('Spark Zoki loads grade details only for the named student', async () => {
  let loadedStudentId = '';
  const result = await answerZokiOnSpark({
    question: 'מה הציון של אלדר בוגלו?',
    data: { students: [{ id: 'student_1', fullName: 'אלדר בוגלו' }] },
    loadStudentDetails: async student => {
      loadedStudentId = student.id;
      return {
        gradebooks: [{
          subjects: [{ id: 'math', name: 'מתמטיקה', components: [{ id: 'exam', name: 'מבחן' }] }],
          scores: { math: { exam: 91 } },
          calculated: { math: 91 },
        }],
      };
    },
  });
  assert.equal(loadedStudentId, 'student_1');
  assert.match(result.answer, /מתמטיקה.*91/u);
});

test('Spark Zoki summarizes authorized attendance records', async () => {
  const result = await answerZokiOnSpark({
    question: 'מה הנוכחות של נועה כהן?',
    data: { students: [{ id: 'student_2', fullName: 'נועה כהן' }] },
    loadStudentDetails: async () => ({
      attendance: [{ records: [{ primaryStatusId: 'late' }, { primaryStatusId: 'present' }], legend: { late: 'איחור', present: 'נוכח' } }],
    }),
  });
  assert.match(result.answer, /2 רישומי נוכחות/u);
  assert.match(result.answer, /איחור: 1/u);
});

test('Spark Zoki finds authorized staff, tasks and files', async () => {
  const data = {
    staff: [{ id: 'staff_1', fullName: 'דגנית ישראלי', jobTitle: 'מחנכת' }],
    tasks: [{ id: 'task_1', title: 'הכנת טקס', status: 'in_progress' }],
    files: [{ id: 'file_1', name: 'נוהל טיולים', fileType: 'document' }],
  };
  const staff = await answerZokiOnSpark({ question: 'מה התפקיד של דגנית ישראלי?', data });
  const task = await answerZokiOnSpark({ question: 'מה מצב המשימה הכנת טקס?', data });
  const file = await answerZokiOnSpark({ question: 'איפה הקובץ נוהל טיולים?', data });
  assert.match(staff.answer, /מחנכת/u);
  assert.match(task.answer, /in_progress/u);
  assert.match(file.answer, /document/u);
});

test('Spark Zoki answers from authorized school rules without a paid backend', async () => {
  const result = await answerZokiOnSpark({
    question: 'מה הנוהל הבית ספרי בנושא טיולים?',
    data: {
      approvedRules: ['לפני יציאה לטיול יש לקבל אישור מנהל ולוודא נוכחות מלווים.'],
    },
  });
  assert.match(result.answer, /אישור מנהל/u);
  assert.match(result.answer, /נוכחות מלווים/u);
});
