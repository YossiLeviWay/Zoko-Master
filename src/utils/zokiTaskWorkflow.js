const boundedText = (value, max = 180) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const ids = value => Array.isArray(value) ? value.filter(item => typeof item === 'string' && item).slice(0, 50) : [];

function normalized(value) {
  return boundedText(value, 600)
    .toLocaleLowerCase('he')
    .replace(/[״"׳']/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function roleLabels(role) {
  return [role?.name, role?.title, ...(Array.isArray(role?.aliases) ? role.aliases : [])]
    .map(normalized)
    .filter(Boolean);
}

function roleIdsForStaff(member, schoolId) {
  return new Set([
    ...ids(member?.customRoleIds),
    ...ids(member?.customRoleAssignments?.[schoolId]),
  ]);
}

function canonicalWord(value) {
  let word = normalized(value);
  while (word.length > 3 && /^[והלמבכ]/u.test(word)) word = word.slice(1);
  if (word.length > 4 && word.endsWith('ית')) word = word.slice(0, -2);
  else if (word.length > 3 && /[תי]$/u.test(word)) word = word.slice(0, -1);
  else if (word.length > 4 && /(?:ים|ות)$/u.test(word)) word = word.slice(0, -2);
  return word;
}

function containsRoleLabel(source, label) {
  const sourceWords = source.split(' ').map(canonicalWord);
  const labelWords = label.split(' ').map(canonicalWord);
  return labelWords.every(word => sourceWords.includes(word));
}

const ROLE_TARGET_IN_REQUEST = /(?:(?:עבור|בשביל|אל|אצל)\s+(?:את\s+)?|ל)(ה?(?:רכז(?:ת)?|מנהל(?:ת)?|מחנכ(?:ת)?|יועצ(?:ת)?|מזכיר(?:ה)?|סגנ(?:ית)?|אחראי(?:ת)?|ראש(?:ת)?)(?:\s+[\p{L}״׳'-]+){0,3}?)(?=\s+(?:להכ(?:ין|נת)|לבצע|לעשות|ליצור|לבנות|לתכנן|כדי|שי|שת)|[.,:;!?]|$)/u;

export function inferTaskRoleTarget(request = '') {
  const label = boundedText(request, 1000).match(ROLE_TARGET_IN_REQUEST)?.[1]?.trim() || '';
  return label ? { type: 'role', label } : {};
}

function legacyJobTitleResolution({ requestText, requested, staff }) {
  const sourceWords = new Set(`${requestText} ${requested}`.split(' ').map(canonicalWord).filter(Boolean));
  const roleCues = new Set(['רכז', 'מנהל', 'מחנכ', 'יועצ', 'מזכיר', 'סגנ']);
  const ranked = staff.map(member => {
    const jobTitle = boundedText(member?.jobTitle || member?.roleName || member?.position, 120);
    const words = normalized(jobTitle).split(' ').map(canonicalWord).filter(Boolean);
    const overlap = [...new Set(words)].filter(word => sourceWords.has(word)).length;
    const hasRoleCue = words.some(word => roleCues.has(word));
    return { member, jobTitle, words, score: hasRoleCue && overlap >= 2 ? overlap * 20 + Math.min(words.length, 8) : 0 };
  }).filter(item => item.score > 0).sort((left, right) => right.score - left.score);
  if (!ranked.length) return null;
  const best = ranked[0];
  const holders = ranked.filter(item => item.score === best.score).map(item => item.member);
  return {
    status: holders.length === 1 ? 'resolved' : 'multiple_holders',
    targetLabel: best.jobTitle,
    role: { id: `job_title:${normalized(best.jobTitle)}`, name: best.jobTitle, legacyJobTitle: true },
    holders,
  };
}

export function resolveTaskRoleTarget({ request = '', targetLabel = '', proposal = {}, roles = [], staff = [], schoolId = '' }) {
  const inferredTargetLabel = inferTaskRoleTarget(request).label || '';
  const effectiveTargetLabel = targetLabel || inferredTargetLabel;
  const requested = normalized(effectiveTargetLabel);
  const requestText = normalized(request);
  const suggestions = (proposal?.assigneeSuggestions || []).map(normalized).filter(Boolean);
  const ranked = roles.map(role => {
    const labels = roleLabels(role);
    const score = Math.max(0, ...labels.map(label => {
      if (requested && label === requested) return 120;
      if (requested && (label.includes(requested) || requested.includes(label))) return 105;
      if (suggestions.some(suggestion => suggestion === label)) return 100;
      if (suggestions.some(suggestion => suggestion.includes(label) || label.includes(suggestion))) return 90;
      if (requestText && containsRoleLabel(requestText, label)) return 80 + Math.min(label.length, 19);
      return 0;
    }));
    return { role, score };
  }).filter(item => item.score > 0).sort((left, right) => right.score - left.score);
  const match = ranked[0];
  if (!match || (ranked[1] && ranked[1].score === match.score)) {
    const legacyResolution = legacyJobTitleResolution({ requestText, requested, staff });
    if (legacyResolution) return legacyResolution;
    return {
      status: requested ? 'role_missing' : 'none',
      targetLabel: boundedText(effectiveTargetLabel || suggestions[0], 120),
      role: null,
      holders: [],
    };
  }
  const roleId = match.role.id;
  const labels = roleLabels(match.role);
  const holders = staff.filter(member => {
    if (roleIdsForStaff(member, schoolId).has(roleId)) return true;
    const jobTitle = normalized(member?.jobTitle || member?.roleName || member?.position);
    return jobTitle && labels.some(label => jobTitle === label || jobTitle.includes(label));
  });
  return {
    status: holders.length === 1 ? 'resolved' : holders.length > 1 ? 'multiple_holders' : 'unassigned_role',
    targetLabel: boundedText(match.role.name || match.role.title || effectiveTargetLabel, 120),
    role: match.role,
    holders,
  };
}

export function proposalWithRoleHolder(proposal, member) {
  const id = boundedText(member?.uid || member?.id, 128);
  const name = boundedText(member?.fullName || member?.displayName || member?.name, 120);
  if (!id || !name) return proposal;
  const party = { id, name, jobTitle: boundedText(member?.jobTitle || member?.roleName, 120), source: 'staff' };
  return {
    ...proposal,
    taskType: 'assigned',
    assigneeSuggestions: [name],
    teamSuggestions: [],
    assignmentPlan: {
      responsible: [party],
      // Addressing one institutional role is an explicit assignment. Generic
      // collaborators suggested by the model must not be added silently.
      partners: [],
      informed: [],
    },
    followUpQuestion: null,
  };
}

export function taskCreationSourceForContext(context = {}) {
  return context?.creationSource === 'agent' || Boolean(context?.sessionId) ? 'agent' : 'manual';
}
