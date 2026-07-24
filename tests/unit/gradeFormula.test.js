import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSubjectGrade, evaluateMathExpression } from '../../src/utils/gradeFormula.js';

test('grade formulas support percentages and the four arithmetic operations', () => {
  assert.equal(evaluateMathExpression('(80+20)*50%'), 50);
  assert.equal(evaluateMathExpression('100/4-5*2'), 15);
});

test('a subject can calculate a weighted final grade', () => {
  const subject = {
    formula: 'C1*30% + C2*70%',
    components: [{ id: 'project', weight: 30 }, { id: 'exam', weight: 70 }],
  };
  assert.equal(calculateSubjectGrade(subject, { project: 80, exam: 90 }), 87);
});

test('invalid variables and division by zero are rejected', () => {
  assert.throws(() => evaluateMathExpression('10/0'), /DIVIDE_BY_ZERO/);
  assert.throws(() => calculateSubjectGrade({ formula: 'TOTAL+1', components: [{ id: 'one' }] }, { one: 10 }), /UNKNOWN_FORMULA_VARIABLE/);
});
