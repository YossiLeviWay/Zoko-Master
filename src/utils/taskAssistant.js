const TASK_TYPES = new Set(['personal', 'assigned', 'team', 'initiative', 'mandatory']);
const PRIORITIES = new Set(['low', 'normal', 'medium', 'high']);
const SENSITIVE_TERMS = /(?:תעודת\s*זהות|מספר\s*זהות|מידע\s*רפואי|אבחו(?:ן|נים)|תרופ(?:ה|ות)|תיק\s*אישי|ציו(?:ן|נים)|הער(?:ה|ות)\s*אישי(?:ת|ות))/iu;
const EMAIL_PATTERN = /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu;
const PHONE_PATTERN = /(?:\+?972[-\s]?|0)(?:5\d|[23489])[-\s]?\d{3}[-\s]?\d{4}/gu;
const ID_PATTERN = /(?:^|\D)\d{9}(?=\D|$)/gu;

const text = (value, maxLength = 500) => typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
const list = (value, maxItems = 12, maxLength = 120) => Array.isArray(value)
  ? value.map(item => text(item, maxLength)).filter(Boolean).slice(0, maxItems)
  : [];
const isoDate = value => /^\d{4}-\d{2}-\d{2}$/.test(text(value, 10)) ? text(value, 10) : null;
const localIsoDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function resolveRelativeTaskDate(value, today = new Date()) {
  const source = text(value, 1800);
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (/(?:^|\s)היום(?:\s|$)/u.test(source)) return localIsoDate(date);
  if (/(?:^|\s)מחר(?:\s|$)/u.test(source)) {
    date.setDate(date.getDate() + 1);
    return localIsoDate(date);
  }
  const weekdayMatch = source.match(/יום\s+(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)\s+הבא/u);
  if (!weekdayMatch) return null;
  const weekdays = { ראשון: 0, שני: 1, שלישי: 2, רביעי: 3, חמישי: 4, שישי: 5, שבת: 6 };
  const target = weekdays[weekdayMatch[1]];
  let offset = (target - date.getDay() + 7) % 7;
  if (offset === 0) offset = 7;
  date.setDate(date.getDate() + offset);
  return localIsoDate(date);
}

export function redactTaskAssistantInput(value, maxLength = 1800) {
  const raw = text(value, maxLength);
  if (raw.length < 3) return { safe: false, text: '', reason: 'too-short' };
  if (SENSITIVE_TERMS.test(raw)) return { safe: false, text: '', reason: 'sensitive-content' };
  const cleaned = raw
    .replace(EMAIL_PATTERN, '[דוא״ל הוסר]')
    .replace(PHONE_PATTERN, '[טלפון הוסר]')
    .replace(ID_PATTERN, match => match.replace(/\d{9}/u, '[מספר מזהה הוסר]'));
  return { safe: true, text: cleaned, reason: '' };
}

export function normalizeTaskAssistantProposal(value) {
  const proposal = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const range = proposal.dateRange && typeof proposal.dateRange === 'object'
    ? { startDate: isoDate(proposal.dateRange.startDate), endDate: isoDate(proposal.dateRange.endDate) }
    : null;
  return {
    title: text(proposal.title, 180),
    description: text(proposal.description, 2000),
    taskType: TASK_TYPES.has(proposal.taskType) ? proposal.taskType : 'personal',
    priority: PRIORITIES.has(proposal.priority) ? (proposal.priority === 'normal' ? 'medium' : proposal.priority) : 'medium',
    dueDate: isoDate(proposal.dueDate),
    dateRange: range?.startDate || range?.endDate ? range : null,
    assigneeSuggestions: list(proposal.assigneeSuggestions),
    teamSuggestions: list(proposal.teamSuggestions),
    linkedEntitySuggestions: list(proposal.linkedEntitySuggestions),
    subtasks: list(proposal.subtasks, 20, 180),
    reminderSuggestion: isoDate(proposal.reminderSuggestion),
    completionCriteria: text(proposal.completionCriteria, 800),
    followUpQuestion: text(proposal.followUpQuestion, 240) || null,
    reasoningSummary: text(proposal.reasoningSummary, 400),
  };
}

export function buildTaskAssistantInput({ request, currentProposal, answer, maxLength = 1800 }) {
  const cleaned = redactTaskAssistantInput(request, maxLength);
  if (!cleaned.safe) {
    const error = new Error(cleaned.reason);
    error.code = cleaned.reason;
    throw error;
  }
  return JSON.stringify({
    request: cleaned.text,
    today: new Date().toISOString().slice(0, 10),
    currentProposal: currentProposal ? normalizeTaskAssistantProposal(currentProposal) : null,
    answer: text(answer, 500) || null,
  });
}

const normalizedName = value => text(value, 180).toLocaleLowerCase('he').replace(/[\s"'׳״-]+/gu, '');
const findBySuggestion = (items, suggestions) => {
  const wanted = suggestions.map(normalizedName).filter(Boolean);
  return items.find(item => {
    const name = normalizedName(item.fullName || item.name || item.title);
    return wanted.some(suggestion => name.includes(suggestion) || suggestion.includes(name));
  }) || null;
};

export function resolveTaskAssistantProposal({
  proposal,
  staff = [],
  teams = [],
  classes = [],
  initiatives = [],
  canAssign = false,
  canCreateInitiative = false,
  canAssignMandatory = false,
}) {
  const normalized = normalizeTaskAssistantProposal(proposal);
  let taskType = normalized.taskType;
  if (taskType === 'initiative' && !canCreateInitiative) taskType = 'personal';
  if (taskType === 'mandatory' && !canAssignMandatory) taskType = canAssign ? 'assigned' : 'personal';
  if (['assigned', 'team'].includes(taskType) && !canAssign) taskType = 'personal';
  const assignee = canAssign ? findBySuggestion(staff, normalized.assigneeSuggestions) : null;
  const team = canAssign ? findBySuggestion(teams, normalized.teamSuggestions) : null;
  const linkedClass = findBySuggestion(classes, normalized.linkedEntitySuggestions);
  const initiative = findBySuggestion(initiatives, normalized.linkedEntitySuggestions);
  if (taskType === 'assigned' && !assignee) taskType = 'personal';
  if (taskType === 'team' && !team) taskType = 'personal';
  return { ...normalized, taskType, assignee, team, linkedClass, initiative };
}

export function proposalToTaskForm(resolved, baseForm) {
  const isInitiative = resolved.taskType === 'initiative';
  const scope = resolved.taskType === 'assigned' ? 'assigned'
    : resolved.taskType === 'team' ? 'team'
      : 'personal';
  return {
    ...baseForm,
    creationKind: isInitiative ? 'initiative' : 'task',
    mandatory: resolved.taskType === 'mandatory',
    title: resolved.title,
    description: resolved.description,
    priority: resolved.priority,
    dueDate: resolved.dueDate || resolved.dateRange?.endDate || '',
    startDate: resolved.dateRange?.startDate || '',
    endDate: resolved.dateRange?.endDate || resolved.dueDate || '',
    reminderAt: resolved.reminderSuggestion ? `${resolved.reminderSuggestion}T09:00` : '',
    scope,
    assigneeIds: resolved.assignee ? [resolved.assignee.uid || resolved.assignee.id] : [],
    teamId: resolved.team?.id || '',
    initiativeId: resolved.initiative?.id || '',
    classIds: resolved.linkedClass?.id ? [resolved.linkedClass.id] : [],
    subtasks: resolved.subtasks,
    completionCriteria: resolved.completionCriteria,
    nextAction: resolved.subtasks[0] || '',
  };
}

export function findHolidayConflict(dueDate, holidays = []) {
  if (!dueDate) return null;
  return holidays.find(item => {
    const start = isoDate(item.startDate || item.date);
    const end = isoDate(item.endDate || item.date || item.startDate);
    return start && end && dueDate >= start && dueDate <= end && item.isSchoolDay !== true;
  }) || null;
}
