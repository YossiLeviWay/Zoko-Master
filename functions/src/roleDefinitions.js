// Official role definitions of the Ministry of Labor Vocational Training Administration,
// parsed (as data, never executed) from the "מפת התפקידים וההגדרות" published at
// https://pedagogiamh.co.il/tafkidim.html. `complete: false` means the site only publishes a
// one-paragraph summary for that role so far; Zoki must not invent more than that.
import data from './data/roleDefinitions.js';

export const ROLE_DEFINITIONS_SOURCE = Object.freeze(data.source);
export const ROLE_DEFINITIONS = Object.freeze(data.roles);

export const roleDefinition = roleId => ROLE_DEFINITIONS[roleId] || null;

const PRIORITY = [/מטרות/, /תחומי אחריות/, /עיקרי הפעולות/, /תפיסה|הגדרה/, /עקרונות/];

// A compact, prompt-sized brief: summary, hours/compensation, then the most useful sections.
export function roleBrief(roleId, { maxChars = 1800 } = {}) {
  const def = roleDefinition(roleId);
  if (!def) return '';
  const lines = [`הגדרת התפקיד הרשמית (${def.title}): ${def.summary}`];
  if (def.chips.length) lines.push(`נתוני תקן: ${def.chips.join(' · ')}`);
  const sections = [...def.sections].sort((a, b) => PRIORITY.findIndex(p => p.test(a.heading)) - PRIORITY.findIndex(p => p.test(b.heading)));
  for (const section of sections) {
    if (!PRIORITY.some(p => p.test(section.heading))) continue;
    for (const item of section.items.slice(0, 6)) lines.push(`• ${section.heading}: ${item}`);
  }
  let text = '';
  for (const line of lines) { if ((text + '\n' + line).length > maxChars) break; text += (text ? '\n' : '') + line; }
  return text;
}

export function definitionIds() { return Object.keys(ROLE_DEFINITIONS); }
