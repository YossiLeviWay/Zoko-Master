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
  return word;
}

function containsRoleLabel(source, label) {
  const sourceWords = source.split(' ').map(canonicalWord);
  const labelWords = label.split(' ').map(canonicalWord);
  return labelWords.every(word => sourceWords.includes(word));
}

export function resolveTaskRoleTarget({ request = '', targetLabel = '', proposal = {}, roles = [], staff = [], schoolId = '' }) {
  const requested = normalized(targetLabel);
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
    return {
      status: requested ? 'role_missing' : 'none',
      targetLabel: boundedText(targetLabel || suggestions[0], 120),
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
    targetLabel: boundedText(match.role.name || match.role.title || targetLabel, 120),
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
