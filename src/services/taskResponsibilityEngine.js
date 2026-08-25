import { ANNUAL_TRIP_PLAYBOOK_ID, resolveTaskPlaybooks } from '../config/taskPlaybooks.js';

const text = (value, maxLength = 180) => typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
const uniqueById = values => [...new Map(values.filter(Boolean).map(item => [`${item.source || 'staff'}:${item.id}`, item])).values()];
const uniqueText = values => [...new Set(values.map(item => text(item, 120)).filter(Boolean))];
const normalize = value => text(value, 400).toLocaleLowerCase('he').replace(/["״׳']/gu, '');

function frequentIds(items, fields, limit = 6) {
  const counts = new Map();
  (items || []).forEach(item => fields.forEach(field => {
    (Array.isArray(item?.[field]) ? item[field] : []).forEach(id => {
      if (typeof id === 'string' && id) counts.set(id, (counts.get(id) || 0) + 1);
    });
  }));
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([id]) => id);
}

function frequentValue(items, field) {
  const counts = new Map();
  (items || []).forEach(item => {
    const value = text(item?.[field], 128);
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
  });
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] || '';
}

function containsAny(value, terms) {
  const source = normalize(value);
  return terms.some(term => source.includes(normalize(term)));
}

function answerIsYes(value) {
  return /(?:^|\s)(?:כן|כולל(?:ת)?\s+לינה|עם\s+לינה|לנים)(?:\s|$)/u.test(normalize(value));
}

function answerIsNo(value) {
  return /(?:^|\s)(?:לא|ללא\s+לינה|בלי\s+לינה|טיול\s+יומי|יום\s+אחד)(?:\s|$)/u.test(normalize(value));
}

export function inferOvernightState(request, answer = '') {
  const combined = `${text(request, 1800)} ${text(answer, 500)}`;
  if (answerIsNo(combined)) return false;
  if (answerIsYes(combined) || /לינה|מלון|אכסני/u.test(combined)) return true;
  return null;
}

function staffLabel(item) {
  return { id: item.id, name: item.name, jobTitle: item.jobTitle || '', source: 'staff' };
}

function teamLabel(item) {
  return { id: item.id, name: item.name, source: 'team' };
}

function findSupportHolders(context, terms) {
  return uniqueById([
    ...(context.supportRoleHolders || []),
    ...(context.roleHolders || []).filter(member => containsAny(member.jobTitle, terms)),
    ...(context.authorizedStaff || []).filter(member => containsAny(member.jobTitle, terms)),
  ]);
}

function partyForStep(step, assignments) {
  const team = assignments.responsible.find(item => item.source === 'team');
  const leader = assignments.responsible.find(item => item.source === 'staff');
  const homeroom = assignments.partners.filter(item => containsAny(item.jobTitle, ['מחנך', 'מחנכת']));
  const counselor = assignments.partners.filter(item => containsAny(item.jobTitle, ['יועץ', 'יועצת']));
  const administration = assignments.partners.filter(item => containsAny(item.jobTitle, ['מנהלנ', 'מזכיר']));
  const map = {
    team: team ? [team] : leader ? [leader] : [],
    team_leader: leader ? [leader] : team ? [team] : [],
    administration,
    homeroom,
    homeroom_secretary: uniqueById([...homeroom, ...administration]),
    counselor_homeroom: uniqueById([...counselor, ...homeroom]),
  };
  return map[step.party] || (team ? [team] : []);
}

function confidenceFor({ teams, leaderIds, grade, homeroomTeachers }) {
  if (teams.length === 1 && leaderIds.length === 1 && (!grade || homeroomTeachers.length > 0)) return 'high';
  if (teams.length === 1) return 'medium';
  return 'low';
}

function endOfMonthRange(request, now = new Date()) {
  const months = {
    ינואר: 0, פברואר: 1, מרץ: 2, אפריל: 3, מאי: 4, יוני: 5,
    יולי: 6, אוגוסט: 7, ספטמבר: 8, אוקטובר: 9, נובמבר: 10, דצמבר: 11,
  };
  const match = normalize(request).match(/(תחילת|אמצע|סוף)?\s*(ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר)/u);
  if (!match) return null;
  const month = months[match[2]];
  let year = now.getFullYear();
  if (month < now.getMonth()) year += 1;
  const lastDay = new Date(year, month + 1, 0).getDate();
  if (match[1] === 'תחילת') return { startDate: `${year}-${String(month + 1).padStart(2, '0')}-01`, endDate: `${year}-${String(month + 1).padStart(2, '0')}-07` };
  if (match[1] === 'אמצע') return { startDate: `${year}-${String(month + 1).padStart(2, '0')}-12`, endDate: `${year}-${String(month + 1).padStart(2, '0')}-18` };
  return { startDate: `${year}-${String(month + 1).padStart(2, '0')}-${String(Math.max(1, lastDay - 7)).padStart(2, '0')}`, endDate: `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}` };
}

export function buildTaskResponsibilityPlan({ request, answer = '', context = {}, playbooks = [], now = new Date() }) {
  const availablePlaybooks = resolveTaskPlaybooks(playbooks);
  const trip = context?.inferred?.domain && containsAny(context.inferred.domain, ['טיול', 'מסע', 'סיור']);
  const playbook = trip ? availablePlaybooks.find(item => item.id === ANNUAL_TRIP_PLAYBOOK_ID) : null;
  const history = context.tasks || [];
  const historyTeamId = frequentValue(history, 'teamId');
  const learnedTeam = (context.authorizedTeams || []).find(team => team.id === historyTeamId) || null;
  const teams = context.teams || [];
  const primaryTeam = teams[0] || learnedTeam;
  const leaderIds = primaryTeam?.leaderIds || [];
  const leaderSet = new Set(leaderIds);
  const leaders = (context.authorizedStaff || context.teamMembers || []).filter(member => leaderSet.has(member.id));
  const homeroomTeachers = context.homeroomTeachers || [];
  const supportTerms = playbook?.supportingRoles || primaryTeam?.supportingRoles || [];
  const supportHolders = findSupportHolders(context, supportTerms);
  const management = (context.authorizedStaff || []).filter(member => ['principal', 'institution_manager'].includes(member.role));
  const learnedResponsibleIds = new Set(frequentIds(history, ['assigneeIds', 'responsibleIds']));
  const learnedPartnerIds = new Set(frequentIds(history, ['partnerIds']));
  const learnedInformedIds = new Set(frequentIds(history, ['informedIds']));
  const learnedResponsible = (context.authorizedStaff || []).filter(member => learnedResponsibleIds.has(member.id));
  const learnedPartners = (context.authorizedStaff || []).filter(member => learnedPartnerIds.has(member.id));
  const learnedInformed = (context.authorizedStaff || []).filter(member => learnedInformedIds.has(member.id));
  const responsible = uniqueById([
    ...(primaryTeam ? [teamLabel(primaryTeam)] : []),
    ...leaders.map(staffLabel),
    ...learnedResponsible.map(staffLabel),
  ]);
  const partners = uniqueById([
    ...homeroomTeachers.map(staffLabel),
    ...supportHolders.map(staffLabel),
    ...learnedPartners.map(staffLabel),
  ]).filter(item => !responsible.some(owner => owner.id === item.id));
  const informed = uniqueById([...management.map(staffLabel), ...learnedInformed.map(staffLabel)])
    .filter(item => !responsible.some(owner => owner.id === item.id) && !partners.some(owner => owner.id === item.id));
  const confidence = confidenceFor({ teams, leaderIds, grade: context?.inferred?.grade, homeroomTeachers });
  const overnight = inferOvernightState(request, answer);
  let followUpQuestion = null;
  if (teams.length > 1) followUpQuestion = 'מצאתי יותר מצוות מתאים אחד. איזה צוות יוביל את המשימה?';
  else if (primaryTeam && leaderIds.length === 0) followUpQuestion = 'לא הוגדר ראש צוות. מי יוביל את המשימה מטעם הצוות?';
  else if (playbook && overnight === null) followUpQuestion = playbook.clarificationQuestions.find(item => item.id === 'overnight')?.text || null;
  const workPlanSteps = (playbook?.steps || [])
    .filter(step => !step.condition || (step.condition === 'overnight' && overnight === true))
    .map(step => ({
      ...step,
      suggestedParties: partyForStep(step, { responsible, partners, informed }),
    }));
  return {
    domain: playbook?.domain || context?.inferred?.domain || '',
    playbookId: playbook?.id || '',
    confidence,
    assignments: { responsible, partners, informed },
    workPlanSteps,
    followUpQuestion,
    completionCriteria: playbook?.completionCriteria || '',
    commonDocuments: playbook?.commonDocuments || [],
    dateRange: endOfMonthRange(request, now),
    overnight,
    summary: primaryTeam
      ? `${learnedTeam && primaryTeam.id === learnedTeam.id ? 'לפי משימות דומות שלך, ' : ''}הצוות המוביל שנמצא הוא ${primaryTeam.name}${context?.inferred?.grade ? ` עבור שכבת ${context.inferred.grade}` : ''}.`
      : 'לא נמצאה התאמה מוסדית חד־משמעית; אפשר לבחור אחראי ידנית.',
  };
}

export function canSaveInstitutionalAgentRule({ isManager = false, permissions = {} } = {}) {
  return isManager || permissions['tasks.managePlaybooks'] === true;
}

export function assignmentNames(plan, level) {
  return uniqueText((plan?.assignments?.[level] || []).map(item => item.name));
}
