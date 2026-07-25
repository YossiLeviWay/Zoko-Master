function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function criterionKey(criterion, path) {
  if (criterion.type === 'subject_min') return `subject:${criterion.subjectId}`;
  return `${path}:${criterion.type}`;
}

function leafResult(criterion, facts, path) {
  const key = criterionKey(criterion, path);
  const result = (status, actual = null) => ({
    key,
    type: criterion.type,
    status,
    actual,
    required: criterion.minimum ?? true,
  });

  switch (criterion.type) {
    case 'subject_min': {
      const actual = numberOrNull(facts.subjectScores?.[criterion.subjectId]);
      return actual === null ? result('missing') : result(actual >= criterion.minimum ? 'passed' : 'failed', actual);
    }
    case 'average_min': {
      const scores = Object.values(facts.subjectScores || {}).map(numberOrNull).filter(value => value !== null);
      const actual = numberOrNull(facts.average) ?? (scores.length
        ? scores.reduce((total, value) => total + value, 0) / scores.length : null);
      return actual === null ? result('missing') : result(actual >= criterion.minimum ? 'passed' : 'failed', actual);
    }
    case 'units_min': {
      const actual = numberOrNull(facts.units);
      return actual === null ? result('missing') : result(actual >= criterion.minimum ? 'passed' : 'failed', actual);
    }
    case 'work_hours_min': {
      const actual = numberOrNull(facts.workHours);
      return actual === null ? result('missing') : result(actual >= criterion.minimum ? 'passed' : 'failed', actual);
    }
    case 'attendance_min': {
      const actual = numberOrNull(facts.attendancePercentage);
      return actual === null ? result('missing') : result(actual >= criterion.minimum ? 'passed' : 'failed', actual);
    }
    case 'practical_complete':
      return typeof facts.practicalComplete !== 'boolean' ? result('missing') : result(facts.practicalComplete ? 'passed' : 'failed', facts.practicalComplete);
    case 'professional_exam_passed':
      return typeof facts.professionalExamPassed !== 'boolean' ? result('missing') : result(facts.professionalExamPassed ? 'passed' : 'failed', facts.professionalExamPassed);
    case 'evidence_uploaded':
      return typeof facts.evidenceUploaded !== 'boolean' ? result('missing') : result(facts.evidenceUploaded ? 'passed' : 'failed', facts.evidenceUploaded);
    case 'manual_approval':
      return facts.manualApproved === true ? result('passed', true) : result('missing');
    default:
      return result('missing');
  }
}

function evaluateCriterion(criterion, facts, path = 'criterion') {
  if (criterion.type !== 'group') return leafResult(criterion, facts, path);
  const children = criterion.criteria.map((child, index) => evaluateCriterion(child, facts, `${path}.${index}`));
  const statuses = children.map(child => child.status);
  const status = criterion.operator === 'AND'
    ? statuses.includes('failed') ? 'failed' : statuses.includes('missing') ? 'missing' : 'passed'
    : statuses.includes('passed') ? 'passed' : statuses.includes('missing') ? 'missing' : 'failed';
  return { key: `${path}:group`, type: 'group', operator: criterion.operator, status, children };
}

function flattenLeaves(result) {
  if (!result.children) return [result];
  return result.children.flatMap(flattenLeaves);
}

export function evaluateOutcomeDefinition(definition, facts = {}) {
  if (facts.manualApproved === true) {
    return {
      status: 'manually_approved',
      passedCriteria: ['manual-approval'],
      failedCriteria: [],
      missingCriteria: [],
      criteriaResults: [],
    };
  }

  const criteriaResults = (definition.criteria || []).map((criterion, index) => (
    evaluateCriterion(criterion, facts, `criterion.${index}`)
  ));
  const leaves = criteriaResults.flatMap(flattenLeaves);
  const passedCriteria = leaves.filter(item => item.status === 'passed').map(item => item.key);
  const failedCriteria = leaves.filter(item => item.status === 'failed').map(item => item.key);
  const missingCriteria = leaves.filter(item => item.status === 'missing').map(item => item.key);
  const topStatuses = criteriaResults.map(item => item.status);
  let status = 'eligible';
  if (definition.calculationMode === 'manual') status = 'pending_data';
  else if (topStatuses.includes('failed')) status = 'not_eligible';
  else if (topStatuses.includes('missing') || criteriaResults.length === 0) status = 'pending_data';

  return { status, passedCriteria, failedCriteria, missingCriteria, criteriaResults };
}

export function summarizeOutcomeResults(results, targetPercentage = 0) {
  const eligible = results.filter(item => item.status === 'eligible').length;
  const manuallyApproved = results.filter(item => item.status === 'manually_approved').length;
  const notEligible = results.filter(item => item.status === 'not_eligible').length;
  const pending = results.filter(item => item.status === 'pending_data').length;
  const denominator = results.length;
  const numerator = eligible + manuallyApproved;
  const eligibilityPercentage = denominator ? (numerator / denominator) * 100 : 0;
  const dataCompletenessPercentage = denominator ? ((denominator - pending) / denominator) * 100 : 0;
  return {
    eligible,
    manuallyApproved,
    notEligible,
    pending,
    numerator,
    denominator,
    eligibilityPercentage: Math.round(eligibilityPercentage * 10) / 10,
    targetPercentage,
    gapFromTarget: Math.round((eligibilityPercentage - targetPercentage) * 10) / 10,
    dataCompletenessPercentage: Math.round(dataCompletenessPercentage * 10) / 10,
  };
}
