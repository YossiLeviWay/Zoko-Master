import { onSnapshot } from 'firebase/firestore';
import { schoolDoc } from './paths.js';
import { saveZokiBrainSettings } from '../adminUserService.js';

const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';

function normalizeAudience(audience = {}) {
  const type = ['school', 'roles', 'users'].includes(audience.type) ? audience.type : 'school';
  const ids = value => [...new Set((Array.isArray(value) ? value : []).filter(item => typeof item === 'string' && item))].slice(0, 50);
  return { type, roleIds: ids(audience.roleIds), userIds: ids(audience.userIds) };
}

export function normalizeZokiKnowledgeEntry(entry = {}, index = 0) {
  return {
    id: clean(entry.id, 80) || `knowledge_${Date.now()}_${index}`,
    title: clean(entry.title, 160),
    body: clean(entry.body, 6000),
    category: clean(entry.category, 80),
    validUntil: clean(entry.validUntil, 20),
    status: entry.status === 'draft' ? 'draft' : 'published',
    audience: normalizeAudience(entry.audience),
  };
}

export function subscribeZokiBrain({ db, schoolId, onData, onError }) {
  return onSnapshot(schoolDoc(db, schoolId, 'settings', 'zoki_brain', 'nested'), snapshot => {
    const data = snapshot.data() || {};
    onData({
      instructions: clean(data.instructions, 8000),
      entries: (Array.isArray(data.entries) ? data.entries : []).map(normalizeZokiKnowledgeEntry).slice(0, 100),
    });
  }, onError);
}

export async function saveZokiBrain({ db, schoolId, actorId, instructions, entries }) {
  if (!db || !schoolId || !actorId) throw new Error('permission-denied');
  const normalizedEntries = (Array.isArray(entries) ? entries : []).map(normalizeZokiKnowledgeEntry).filter(item => item.title && item.body).slice(0, 100);
  const result = await saveZokiBrainSettings({ schoolId, instructions: clean(instructions, 8000), entries: normalizedEntries });
  return result.entries;
}
