const VALID_OPERATIONS = new Set(['compose', 'shorten', 'expand', 'change_tone']);
const VALID_STYLES = new Set(['respectful', 'direct', 'friendly', 'formal']);
const VALID_PRIORITIES = new Set(['low', 'normal', 'high']);

function text(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}
function date(value) {
  const normalized = text(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

export function buildSparkAgentInput({ request, operation, language, style, currentProposal }) {
  const prompt = text(request, 2000);
  if (prompt.length < 3) throw new Error('agent-request-too-short');
  const safeOperation = VALID_OPERATIONS.has(operation) ? operation : 'compose';
  const safeStyle = VALID_STYLES.has(style) ? style : 'respectful';
  const safeLanguage = language === 'en' ? 'en' : 'he';
  const previous = currentProposal && safeOperation !== 'compose'
    ? {
        subject: text(currentProposal.subject, 300),
        body: text(currentProposal.body, 6000),
        summary: text(currentProposal.summary, 800),
        followUpAt: date(currentProposal.followUpAt),
        completionCriteria: text(currentProposal.completionCriteria, 800),
      }
    : null;

  return JSON.stringify({
    request: prompt,
    operation: safeOperation,
    language: safeLanguage,
    style: safeStyle,
    currentProposal: previous,
  });
}

export function normalizeSparkAgentProposal(value) {
  const proposal = value && typeof value === 'object' ? value : {};
  return {
    // The Spark demo agent never receives contact data and must not invent recipients.
    recipients: [],
    cc: [],
    bcc: [],
    subject: text(proposal.subject, 300),
    body: text(proposal.body, 10000),
    summary: text(proposal.summary, 1000),
    priority: VALID_PRIORITIES.has(proposal.priority) ? proposal.priority : 'normal',
    followUpAt: date(proposal.followUpAt),
    completionCriteria: text(proposal.completionCriteria, 1000),
    suggestedAssigneeId: null,
    linkedEntities: [],
    missingFields: Array.isArray(proposal.missingFields)
      ? proposal.missingFields.map(item => text(item, 120)).filter(Boolean).slice(0, 12)
      : [],
    suggestedNextAction: text(proposal.suggestedNextAction, 500),
  };
}
