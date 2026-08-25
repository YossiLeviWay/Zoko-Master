const TASK_TYPES = new Set(['personal', 'assigned', 'team', 'initiative', 'mandatory']);
const PRIORITIES = new Set(['low', 'normal', 'medium', 'high']);
const SENSITIVE_TERMS = /(?:תעודת\s*זהות|מספר\s*זהות|מידע\s*רפואי|אבחו(?:ן|נים)|תרופ(?:ה|ות)|תיק\s*אישי|הער(?:ה|ות)\s*אישי(?:ת|ות))/iu;
const INDIVIDUAL_STUDENT_RECORD = /(?:(?:ציו(?:ן|נים)|הישגים|הערכה).{0,35}(?:של|עבור)\s+(?:ה?תלמיד(?:ה)?)(?:\s+\p{L}+)?|(?:ה?תלמיד(?:ה)?)(?:\s+\p{L}+)?\s*.{0,35}(?:ציו(?:ן|נים)|הישגים|הערכה))/iu;
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
  if (SENSITIVE_TERMS.test(raw) || INDIVIDUAL_STUDENT_RECORD.test(raw)) return { safe: false, text: '', reason: 'sensitive-content' };
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
  const normalizeParty = party => party && typeof party === 'object' && !Array.isArray(party)
    ? {
        id: text(party.id, 128),
        name: text(party.name, 120),
        jobTitle: text(party.jobTitle, 120),
        source: ['staff', 'team', 'role'].includes(party.source) ? party.source : 'staff',
      }
    : null;
  const normalizeParties = value => Array.isArray(value)
    ? value.map(normalizeParty).filter(item => item?.id && item.name).slice(0, 50)
    : [];
  const assignmentPlan = proposal.assignmentPlan && typeof proposal.assignmentPlan === 'object'
    ? {
        responsible: normalizeParties(proposal.assignmentPlan.responsible),
        partners: normalizeParties(proposal.assignmentPlan.partners),
        informed: normalizeParties(proposal.assignmentPlan.informed),
      }
    : { responsible: [], partners: [], informed: [] };
  const workPlanSteps = Array.isArray(proposal.workPlanSteps) ? proposal.workPlanSteps.map((step, index) => ({
    id: text(step?.id, 60) || `step_${index + 1}`,
    phase: text(step?.phase, 80) || 'ביצוע',
    title: text(step?.title, 180),
    party: text(step?.party, 80),
    relativeDays: Number.isFinite(Number(step?.relativeDays)) ? Math.max(-365, Math.min(365, Math.round(Number(step.relativeDays)))) : 0,
    condition: text(step?.condition, 60),
    suggestedParties: normalizeParties(step?.suggestedParties),
  })).filter(step => step.title).slice(0, 30) : [];
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
    assignmentPlan,
    workPlanSteps,
    confidence: ['high', 'medium', 'low'].includes(proposal.confidence) ? proposal.confidence : 'low',
    domain: text(proposal.domain, 80),
    playbookId: text(proposal.playbookId, 80),
    commonDocuments: list(proposal.commonDocuments, 20, 180),
  };
}

export function createLocalTaskAgentProposal(request, maxInputLength = 1800) {
  const source = String(request || '').trim().slice(0, maxInputLength);
  const title = source.split(/[.!?\n]/u).find(Boolean)?.trim().slice(0, 180) || 'משימה חדשה';
  const gradeMatch = source.match(/(?:שכבת|כית(?:ה|ות))\s*([א-יב]{1,2})[׳']/u);
  const grade = gradeMatch?.[1] || '';
  const isExam = /מבחנ|בחינ|הערכה|מבדק/u.test(source);
  const isEvent = /טקס|אירוע|מסיבה/u.test(source);
  const isTrip = /טיול|מסע|סיור/u.test(source);
  const domain = isExam ? 'exams' : isTrip ? 'school_trip' : isEvent ? 'school_event' : 'general';
  const roleSuggestions = isExam
    ? ['רכז פדגוגי', grade ? `מחנכי שכבת ${grade}׳` : 'מחנכי הכיתות הרלוונטיות']
    : isTrip ? ['רכז טיולים', grade ? `מחנכי שכבת ${grade}׳` : 'מחנכי הכיתות הרלוונטיות']
      : isEvent ? ['רכז חברתי', 'צוות אירועים'] : [];
  const teamSuggestions = isExam ? ['צוות פדגוגי'] : isTrip ? ['צוות טיולים'] : isEvent ? ['צוות אירועים וטקסים'] : [];
  const subtasks = isExam
    ? ['הגדרת מבנה ותכני המבחן', 'חלוקת כתיבה ובקרה מקצועית', 'תיאום מועד והיערכות הכיתות', 'בדיקה סופית והפצה לצוות']
    : isTrip ? ['הגדרת מטרה ומסלול', 'ריכוז אישורים וספקים', 'תיאום צוות והורים', 'בדיקת מוכנות לפני היציאה']
      : isEvent ? ['הגדרת תוצר ולוח זמנים', 'חלוקת אחריות', 'תיאום משאבים ותקשורת', 'בדיקת מוכנות וביצוע']
        : ['הגדרת התוצאה הרצויה', 'חלוקת צעדים ואחריות', 'ביצוע ומעקב', 'סיכום וסגירה'];
  return normalizeTaskAssistantProposal({
    title,
    description: source,
    taskType: roleSuggestions.length || teamSuggestions.length ? 'team' : 'personal',
    priority: 'medium',
    assigneeSuggestions: roleSuggestions,
    teamSuggestions,
    linkedEntitySuggestions: grade ? [`שכבת ${grade}׳`] : [],
    subtasks,
    completionCriteria: isExam ? 'המבחן אושר מקצועית, תואם לכל הכיתות ומוכן להפצה במועד.' : 'כל הצעדים הושלמו והתוצר נבדק.',
    reasoningSummary: roleSuggestions.length ? 'ההצעה מבוססת על תפקידים וצוותים המקובלים למשימה מסוג זה.' : 'נבנתה טיוטה בסיסית שאפשר להתאים.',
    domain,
    commonDocuments: isExam ? ['טבלת מפרט', 'טיוטת מבחן', 'מחוון בדיקה'] : [],
  });
}

export function normalizeTaskAssistantOrganizationContext(value) {
  const context = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const safeLabels = (items, maxItems, maxLength) => list(items, maxItems, maxLength)
    .map(item => redactTaskAssistantInput(item, maxLength))
    .filter(item => item.safe)
    .map(item => item.text);
  return {
    domain: safeLabels([context.domain], 1, 80)[0] || null,
    grade: text(context.grade, 12) || null,
    matchingTeamLabels: safeLabels(context.matchingTeamLabels, 5, 120),
    relevantRoleLabels: safeLabels(context.relevantRoleLabels, 5, 120),
    classLabels: safeLabels(context.classLabels, 8, 120),
    blockedDates: Array.isArray(context.blockedDates) ? context.blockedDates.slice(0, 20).map(item => ({
      title: safeLabels([item?.title], 1, 120)[0] || '',
      startDate: isoDate(item?.startDate),
      endDate: isoDate(item?.endDate),
    })).filter(item => item.title && item.startDate) : [],
    relatedInitiativeLabels: safeLabels(context.relatedInitiativeLabels, 5, 120),
    similarTaskLabels: safeLabels(context.similarTaskLabels, 5, 180),
    approvedRules: safeLabels(context.approvedRules, 10, 240),
  };
}

export function buildTaskAssistantInput({ request, currentProposal, answer, organizationContext = null, maxLength = 1800 }) {
  const cleaned = redactTaskAssistantInput(request, maxLength);
  if (!cleaned.safe) {
    const error = new Error(cleaned.reason);
    error.code = cleaned.reason;
    throw error;
  }
  const normalizedCurrent = currentProposal ? normalizeTaskAssistantProposal(currentProposal) : null;
  const modelCurrentProposal = normalizedCurrent ? {
    title: normalizedCurrent.title,
    description: normalizedCurrent.description,
    taskType: normalizedCurrent.taskType,
    priority: normalizedCurrent.priority,
    dueDate: normalizedCurrent.dueDate,
    dateRange: normalizedCurrent.dateRange,
    subtasks: normalizedCurrent.subtasks,
    completionCriteria: normalizedCurrent.completionCriteria,
    followUpQuestion: normalizedCurrent.followUpQuestion,
  } : null;
  return JSON.stringify({
    request: cleaned.text,
    today: new Date().toISOString().slice(0, 10),
    organizationContext: organizationContext && typeof organizationContext === 'object'
      ? normalizeTaskAssistantOrganizationContext(organizationContext)
      : null,
    currentProposal: modelCurrentProposal,
    answer: text(answer, 500) || null,
  });
}

const STOP_WORDS = new Set([
  'אני', 'את', 'אתה', 'אתם', 'אנחנו', 'צריך', 'צריכה', 'צריכים', 'לקדם', 'משימה', 'עבור',
  'של', 'עם', 'על', 'אל', 'או', 'גם', 'כל', 'כבר', 'עד', 'במהלך', 'בתחילת', 'בסוף', 'חדש', 'חדשה', 'צוות',
]);
const NON_PERSON_TERMS = new Set([
  'לינה', 'אירוח', 'טיול', 'טיולים', 'מסע', 'סיור', 'ציונים', 'הערכה', 'מיפוי',
  'בגרויות', 'טקסים', 'אירועים', 'בטיחות', 'תקשוב', 'פדגוגיה',
]);
const TEAM_DOMAINS = [
  { pattern: /טיול|סיור|מסע/iu, name: 'צוות טיולים' },
  { pattern: /ציו(?:ן|נים)|הערכה|מיפוי|הישגים/iu, name: 'צוות ציונים והערכה' },
  { pattern: /בגרות|בגרויות/iu, name: 'צוות בגרויות' },
  { pattern: /אירוע|טקס|מסיבה/iu, name: 'צוות אירועים וטקסים' },
  { pattern: /תקשוב|מחשבים|טכנולוג/iu, name: 'צוות תקשוב' },
  { pattern: /פדגוג|הוראה|למידה/iu, name: 'צוות פדגוגי' },
  { pattern: /חברתי|קהיל|התנדבות/iu, name: 'צוות חברתי־קהילתי' },
  { pattern: /בטיחות|חירום|ביטחון/iu, name: 'צוות בטיחות וחירום' },
];

const normalizedName = value => text(value, 180)
  .toLocaleLowerCase('he')
  .replace(/\bצוות\b/gu, '')
  .replace(/[^\p{L}\p{N}]+/gu, '');
const stemToken = value => {
  const token = value.toLocaleLowerCase('he').replace(/[^\p{L}\p{N}]+/gu, '');
  if (token.length > 4 && (token.endsWith('ים') || token.endsWith('ות'))) return token.slice(0, -2);
  return token;
};
const tokens = value => text(value, 500)
  .split(/[^\p{L}\p{N}]+/gu)
  .map(stemToken)
  .filter(token => token.length > 1 && !STOP_WORDS.has(token));
const regexEscape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const personSuggestions = (suggestions, request) => suggestions.filter(suggestion => {
  const parts = text(suggestion, 120).split(/[^\p{L}\p{N}]+/gu).filter(Boolean);
  const single = parts[0] || '';
  if (parts.length > 1 || !NON_PERSON_TERMS.has(single) || !request) return true;
  const name = regexEscape(single);
  const explicitPersonCue = new RegExp(`(?:עם|לצרף(?:\\s+את)?|אחראי(?:ת)?|בהשתתפות)\\s+${name}|${name}\\s+(?:יטפל|תטפל|יכין|תכין|יוביל|תוביל|יצטרף|תצטרף)`, 'u');
  return explicitPersonCue.test(request);
});
const entityLabels = (item, kind) => kind === 'staff'
  ? [item.fullName, item.displayName, item.name, item.firstName, item.lastName, item.jobTitle, item.position, item.profession, item.subject, item.roleName]
  : [item.name, item.title, item.description, item.category, ...(Array.isArray(item.tags) ? item.tags : [])];

function matchScore(item, suggestion, kind) {
  const wanted = normalizedName(suggestion);
  if (!wanted) return 0;
  const wantedTokens = new Set(tokens(suggestion));
  return Math.max(0, ...entityLabels(item, kind).filter(Boolean).map(label => {
    const candidate = normalizedName(label);
    if (!candidate) return 0;
    if (candidate === wanted) return 120;
    if (candidate.includes(wanted) || wanted.includes(candidate)) return 90;
    const candidateTokens = new Set(tokens(label));
    const overlap = [...wantedTokens].filter(token => candidateTokens.has(token)).length;
    if (!overlap) return 0;
    const coverage = overlap / Math.max(1, wantedTokens.size);
    return 45 + Math.round(coverage * 35);
  }));
}

function rankSuggestion(items, suggestion, kind) {
  return items
    .map(item => ({ item, score: matchScore(item, suggestion, kind) }))
    .filter(entry => entry.score >= 65)
    .sort((a, b) => b.score - a.score);
}

function resolveSuggestions(items, suggestions, kind) {
  const matches = [];
  const unresolved = [];
  const candidates = [];
  suggestions.forEach(suggestion => {
    const ranked = rankSuggestion(items, suggestion, kind);
    const top = ranked[0];
    const runnerUp = ranked[1];
    const isUnambiguous = top && (top.score >= 90 || !runnerUp || top.score - runnerUp.score >= 15);
    if (isUnambiguous) {
      const id = top.item.uid || top.item.id;
      if (!matches.some(item => (item.uid || item.id) === id)) matches.push(top.item);
    } else {
      unresolved.push(suggestion);
      candidates.push(...ranked.slice(0, 3).map(entry => entry.item));
    }
  });
  return { matches, unresolved, candidates };
}

export function inferTaskTeamSuggestion(request, proposal = {}) {
  const explicit = list(proposal.teamSuggestions, 8, 120)[0];
  if (explicit) return explicit.startsWith('צוות') ? explicit : `צוות ${explicit}`;
  const source = `${text(request, 1800)} ${text(proposal.title, 180)} ${text(proposal.description, 500)}`;
  return TEAM_DOMAINS.find(domain => domain.pattern.test(source))?.name || '';
}

export function resolveTaskAssistantProposal({
  proposal,
  staff = [],
  teams = [],
  classes = [],
  initiatives = [],
  request = '',
  canAssign = false,
  canCreateInitiative = false,
  canAssignMandatory = false,
  canCreateTeam = false,
}) {
  const normalized = normalizeTaskAssistantProposal(proposal);
  let taskType = normalized.taskType;
  if (taskType === 'initiative' && !canCreateInitiative) taskType = 'personal';
  if (taskType === 'mandatory' && !canAssignMandatory) taskType = canAssign ? 'assigned' : 'personal';
  if (['assigned', 'team'].includes(taskType) && !canAssign) taskType = 'personal';
  const safeAssigneeSuggestions = personSuggestions(normalized.assigneeSuggestions, request);
  const assignees = canAssign
    ? resolveSuggestions(staff, safeAssigneeSuggestions, 'staff')
    : { matches: [], unresolved: safeAssigneeSuggestions, candidates: [] };
  const inferredTeamSuggestion = inferTaskTeamSuggestion(request, normalized);
  const teamSuggestions = [...new Set([
    ...normalized.teamSuggestions,
    inferredTeamSuggestion,
  ].filter(Boolean))];
  const teamResolution = canAssign
    ? resolveSuggestions(teams, teamSuggestions, 'team')
    : { matches: [], unresolved: teamSuggestions, candidates: [] };
  const linkedClassResolution = resolveSuggestions(classes, normalized.linkedEntitySuggestions, 'team');
  const initiativeResolution = resolveSuggestions(initiatives, normalized.linkedEntitySuggestions, 'team');
  const assignee = assignees.matches[0] || null;
  const team = teamResolution.matches[0] || null;
  const linkedClass = linkedClassResolution.matches[0] || null;
  const initiative = initiativeResolution.matches[0] || null;

  if (canAssign && team && ['personal', 'assigned'].includes(taskType) && teamSuggestions.length) taskType = 'team';
  if (canAssign && inferredTeamSuggestion && !team && ['personal', 'assigned'].includes(taskType)) taskType = 'team';
  if (canAssign && assignees.matches.length > 1 && taskType === 'assigned') taskType = 'team';
  const proposedTeam = canAssign && canCreateTeam && taskType === 'team' && !team && inferredTeamSuggestion
    ? {
        name: inferredTeamSuggestion,
        memberIds: assignees.matches.map(item => item.uid || item.id).filter(Boolean),
        members: assignees.matches,
      }
    : null;
  const missingTeamMembers = team
    ? assignees.matches.filter(item => !Array.isArray(team.memberIds) || !team.memberIds.includes(item.uid || item.id))
    : [];
  return {
    ...normalized,
    taskType,
    assignee,
    assigneeMatches: assignees.matches,
    unresolvedAssigneeSuggestions: assignees.unresolved,
    assigneeCandidates: assignees.candidates,
    team,
    teamSuggestions,
    unresolvedTeamSuggestions: teamResolution.unresolved,
    teamCandidates: teamResolution.candidates,
    proposedTeam,
    missingTeamMembers,
    linkedClass,
    initiative,
  };
}

export function proposalToTaskForm(resolved, baseForm) {
  const scope = resolved.taskType === 'assigned' ? 'assigned'
    : ((resolved.taskType === 'team' || resolved.taskType === 'initiative') && resolved.team) ? 'team'
      : 'personal';
  const staffIds = level => (resolved.assignmentPlan?.[level] || [])
    .filter(item => item.source === 'staff')
    .map(item => item.id);
  const responsibleIds = staffIds('responsible');
  const partnerIds = staffIds('partners');
  const informedIds = staffIds('informed');
  return {
    ...baseForm,
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
    responsibleIds,
    partnerIds,
    informedIds,
    memberIds: [...new Set([...(baseForm.memberIds || []), ...partnerIds, ...informedIds])],
    subtasks: resolved.workPlanSteps.length ? resolved.workPlanSteps.map(step => step.title) : resolved.subtasks,
    workPlanSteps: resolved.workPlanSteps,
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
