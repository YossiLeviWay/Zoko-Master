import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateSubjectGrade } from '../src/services/gradeCalculator.js';

test('server grade calculation matches weighted and formula-based gradebooks', () => {
  const weighted = {
    components: [{ id: 'exam', weight: 70 }, { id: 'work', weight: 30 }],
  };
  assert.equal(calculateSubjectGrade(weighted, { exam: '80', work: '100' }), 86);
  const formula = {
    formula: 'C1 * 80% + C2 * 20%',
    components: [{ id: 'exam' }, { id: 'bonus' }],
  };
  assert.equal(calculateSubjectGrade(formula, { exam: '75', bonus: '100' }), 80);
});

test('server grade calculation rejects executable or unknown formulas', () => {
  assert.throws(() => calculateSubjectGrade({ formula: 'process.exit()', components: [{ id: 'exam' }] }, { exam: 80 }));
  assert.throws(() => calculateSubjectGrade({ formula: 'C1 + UNKNOWN', components: [{ id: 'exam' }] }, { exam: 80 }));
});
