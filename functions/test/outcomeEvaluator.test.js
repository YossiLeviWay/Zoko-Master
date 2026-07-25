import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateOutcomeDefinition, summarizeOutcomeResults } from '../src/services/outcomeEvaluator.js';

test('structured AND and OR criteria distinguish missing data from failure', () => {
  const definition = {
    calculationMode: 'calculated',
    criteria: [{
      type: 'group', operator: 'AND', criteria: [
        { type: 'subject_min', subjectId: 'math', minimum: 55 },
        { type: 'group', operator: 'OR', criteria: [
          { type: 'practical_complete' },
          { type: 'professional_exam_passed' },
        ] },
      ],
    }],
  };
  assert.equal(evaluateOutcomeDefinition(definition, { subjectScores: { math: 70 } }).status, 'pending_data');
  assert.equal(evaluateOutcomeDefinition(definition, { subjectScores: { math: 45 }, practicalComplete: true }).status, 'not_eligible');
  assert.equal(evaluateOutcomeDefinition(definition, { subjectScores: { math: 70 }, practicalComplete: false, professionalExamPassed: true }).status, 'eligible');
});

test('manual approval wins without exposing arbitrary expressions', () => {
  const result = evaluateOutcomeDefinition({ calculationMode: 'manual', criteria: [{ type: 'manual_approval' }] }, { manualApproved: true });
  assert.equal(result.status, 'manually_approved');
  assert.deepEqual(result.passedCriteria, ['manual-approval']);
});

test('eligibility summary always contains numerator, denominator, pending and completeness', () => {
  const summary = summarizeOutcomeResults([
    { status: 'eligible' },
    { status: 'manually_approved' },
    { status: 'pending_data' },
    { status: 'not_eligible' },
  ], 60);
  assert.deepEqual(summary, {
    eligible: 1,
    manuallyApproved: 1,
    notEligible: 1,
    pending: 1,
    numerator: 2,
    denominator: 4,
    eligibilityPercentage: 50,
    targetPercentage: 60,
    gapFromTarget: -10,
    dataCompletenessPercentage: 75,
  });
});
