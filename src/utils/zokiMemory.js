const safeId = value => typeof value === 'string' && /^[\w-]{1,128}$/u.test(value);
const clean = (value, max = 600) => typeof value === 'string' ? value.trim().slice(0, max) : '';
export const zokiContextFields = ['fullName', 'name', 'title', 'description', 'jobTitle', 'responsibilityAreas', 'classId', 'className', 'gradeLevel', 'teamId', 'teamIds', 'assigneeIds', 'createdBy', 'status', 'priority', 'dueDate', 'date', 'time'];
const types = ['tasks', 'teams', 'classes', 'students', 'events', 'roles', 'roleDefinitions', 'initiatives'];
const sensitive = /(?:\b\d{8,9}\b|AIza[\w-]+|AQ\.[\w-]+|(?:password|api.?key|סיסמה|מפתח API)\s*[:=])/iu;
export const isSafeMemoryText = value => typeof value === 'string' && value.length <= 600 && !sensitive.test(value);

export function normalizeMemories(value) {
  return (Array.isArray(value) ? value : []).slice(-100).filter(item => item && safeId(item.id)
    && ['preference', 'fact', 'goal', 'followup'].includes(item.type)
    && typeof item.content === 'string' && item.content.length <= 600 && !sensitive.test(item.content)
    && typeof item.updatedAt === 'string' && Number.isFinite(Date.parse(item.updatedAt))
    && (item.expiresAt === null || (typeof item.expiresAt === 'string' && Number.isFinite(Date.parse(item.expiresAt))))
    && Array.isArray(item.refs) && item.refs.length <= 3 && item.refs.every(ref => typeof ref === 'string'));
}

// Keep durable preferences and active work in context, but omit unrelated facts.
// This bounds prompt size without losing the memories most likely to affect an answer.
export function selectRelevantMemories(value, question, limit = 6) {
  const words = clean(question, 2000).toLocaleLowerCase('he-IL').match(/[\p{L}\p{N}]+/gu)?.filter(word => word.length > 2) || [];
  const terms = [...new Set(words.flatMap(word => [word, ...(word.length > 4 && /^[הבוכלמש]/u.test(word) ? [word.slice(1)] : [])]))];
  return normalizeMemories(value).map((memory, index) => {
    const content = memory.content.toLocaleLowerCase('he-IL');
    const matches = terms.filter(term => content.includes(term)).length;
    const durable = memory.type === 'preference' ? 30 : ['goal', 'followup'].includes(memory.type) ? 12 : 0;
    return { memory, score: matches * 40 + durable, index };
  }).filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, Math.max(0, Math.min(8, limit)))
    .map(item => item.memory);
}

export function validSourcePath(path, schoolId, uid) {
  if (typeof path !== 'string') return false;
  const parts = path.split('/');
  if (!parts.every(safeId)) return false;
  return (parts.length === 4 && parts[0] === 'schools' && parts[1] === schoolId && types.includes(parts[2]))
    || (parts.length === 2 && types.some(type => parts[0] === `${type}_${schoolId}`))
    || (parts.length === 4 && parts[0] === 'users' && parts[1] === uid && parts[2] === 'personalTasks');
}

export function mergeMemories(previous, mutations, sources, enabled, now = Date.now()) {
  const entries = new Map(previous.filter(item => !item.expiresAt || Date.parse(item.expiresAt) > now).map(item => [item.id, item]));
  const changed = [];
  for (const mutation of mutations.slice(0, 3)) {
    if (!mutation || typeof mutation !== 'object') continue;
    if (mutation.operation === 'delete' && entries.has(mutation.id)) {
      entries.delete(mutation.id); changed.push(mutation.id); continue;
    }
    if (!enabled || mutation.operation !== 'upsert' || !['preference', 'fact', 'goal', 'followup'].includes(mutation.type)) continue;
    const content = clean(mutation.content);
    if (!content || sensitive.test(content)) continue;
    const ids = Array.isArray(mutation.sourceIds) ? [...new Set(mutation.sourceIds)] : [];
    if (!ids.length || ids.length > 3 || ids.some(id => id !== 'user' && !sources.some(source => source.id === id))) continue;
    if (mutation.type === 'fact' && !ids.some(id => sources.some(source => source.id === id))) continue;
    // All automatic memories belong to the current school. Global preferences are
    // explicitly promoted by the owner, never inferred from model output.
    const duplicate = [...entries.values()].find(item => item.content === content);
    const id = entries.has(mutation.id) ? mutation.id : duplicate?.id || crypto.randomUUID();
    if (duplicate && duplicate.id === id) continue;
    entries.set(id, { id, type: mutation.type, content,
      refs: ids.filter(id => id !== 'user'), updatedAt: new Date(now).toISOString(),
      expiresAt: mutation.type === 'preference' ? null : new Date(now + 90 * 86400000).toISOString(),
    });
    changed.push(id);
  }
  return { memories: [...entries.values()].slice(-100), changed };
}
