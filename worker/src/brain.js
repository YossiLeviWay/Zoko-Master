const clean = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : '';

const SENSITIVE_PATTERNS = [
  { pattern: /\b\d{8,9}\b/gu, replacement: '[הוסר מספר מזהה]' },
  { pattern: /(?:כתובת\s+)?(?:רחוב|רח׳)\s+[^,\.\n]{2,80}/giu, replacement: '[הוסרה כתובת]' },
  { pattern: /(?:טלפון|נייד|פלאפון)\s*[:：]?\s*[+\d][\d\s-]{7,}/giu, replacement: '[הוסר מספר טלפון]' },
  { pattern: /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/gu, replacement: '[הוסרה כתובת דוא״ל]' },
  { pattern: /(?:מידע רפואי|אבחון רפואי|מחלה|תרופה|טיפול רפואי)\s*[:：]?\s*[^.\n]{0,180}/giu, replacement: '[הוסר מידע רפואי]' },
];

export function sanitizeInstitutionalText(value, max = 5000) {
  let result = clean(value, max).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu, ' ');
  SENSITIVE_PATTERNS.forEach(({ pattern, replacement }) => { result = result.replace(pattern, replacement); });
  return result.replace(/\s{3,}/gu, '  ').trim();
}

const PRIVATE_FIELD = /(identity|national|idnumber|address|street|phone|mobile|email|medical|diagnos|medication|health)/iu;

function sanitizeKnowledgeValue(value, depth = 0) {
  if (depth > 5 || value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') return sanitizeInstitutionalText(value, 1200);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitizeKnowledgeValue(item, depth + 1));
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !PRIVATE_FIELD.test(key))
    .slice(0, 100)
    .map(([key, item]) => [key, sanitizeKnowledgeValue(item, depth + 1)]));
}

export function normalizedIntent(value) {
  const stop = new Set(['של', 'את', 'עם', 'על', 'עבור', 'משימה', 'צריך', 'צריכה', 'חדש', 'חדשה', 'לכל', 'אני']);
  return sanitizeInstitutionalText(value, 1200).toLocaleLowerCase('he')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/u)
    .filter(word => word.length > 1 && !stop.has(word))
    .slice(0, 16)
    .sort()
    .join(' ');
}

export async function fingerprint(value) {
  const bytes = new TextEncoder().encode(normalizedIntent(value) || 'general');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].slice(0, 12).map(item => item.toString(16).padStart(2, '0')).join('');
}

export function learningRecord({ actor, schoolId, request, proposal, savedTask, canonicalIntent = '', summary = '' }) {
  const sanitizedRequest = sanitizeInstitutionalText(request || `${savedTask?.title || ''}\n${savedTask?.description || ''}`, 5000);
  return {
    schoolId,
    actorId: actor.uid,
    actorName: sanitizeInstitutionalText(actor.fullName || 'איש צוות', 120),
    taskId: clean(savedTask?.id, 160),
    originalText: sanitizedRequest,
    summary: sanitizeInstitutionalText(summary || savedTask?.title || sanitizedRequest.split('\n')[0], 500),
    canonicalIntent: sanitizeInstitutionalText(canonicalIntent || normalizedIntent(sanitizedRequest), 500),
    proposal: proposal && typeof proposal === 'object' ? sanitizeKnowledgeValue(proposal) : {},
    savedTask: savedTask && typeof savedTask === 'object' ? sanitizeKnowledgeValue(savedTask) : {},
    status: 'candidate',
  };
}

function lines(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => clean(value, 180)).filter(Boolean))];
}

function table(items, columns, empty = '_אין מידע מסונכרן._') {
  if (!items?.length) return empty;
  const header = `| ${columns.map(column => column.label).join(' | ')} |`;
  const divider = `| ${columns.map(() => '---').join(' | ')} |`;
  const rows = items.map(item => `| ${columns.map(column => String(column.value(item) || '—').replace(/\|/gu, '\\|').replace(/\n/gu, ' ')).join(' | ')} |`);
  return [header, divider, ...rows].join('\n');
}

export function createSchoolBrain(snapshot = {}) {
  const school = snapshot.school || {};
  const patterns = snapshot.patterns || [];
  const generatedAt = snapshot.generatedAt || new Date().toISOString();
  return `---
schemaVersion: 1
schoolId: ${clean(school.id, 128)}
schoolName: ${sanitizeInstitutionalText(school.name || '', 180)}
updatedAt: ${generatedAt}
---

# המוח המוסדי — ${sanitizeInstitutionalText(school.name || 'בית הספר', 180)}

> קובץ זה מתעד ידע מוסדי מאושר. אין לשמור בו מספרי זהות, כתובות, מידע רפואי או תוכן אישי.

## כללי פעולה

- כל הצעה היא טיוטה עד שהמשתמש שומר אותה.
- יש להציע רק אנשים ותפקידים המופיעים בסגל הפעיל.
- יש להתחשב בלוח השנה, בתכניות ובדפוסים המאושרים.
- מידע שלא אושר על ידי מנהל אינו משפיע על כלל הצוות.

## סגל ותפקידים

${table(snapshot.staff, [
    { label: 'מזהה', value: item => item.id },
    { label: 'שם', value: item => sanitizeInstitutionalText(item.name, 120) },
    { label: 'תפקיד', value: item => sanitizeInstitutionalText(item.jobTitle, 120) },
    { label: 'צוותים וכיתות', value: item => lines([...(item.teams || []), ...(item.classes || [])]).join(', ') },
  ])}

## צוותים, כיתות ותכניות

${table(snapshot.units, [
    { label: 'סוג', value: item => item.type },
    { label: 'שם', value: item => sanitizeInstitutionalText(item.name, 180) },
    { label: 'אחראים', value: item => lines(item.owners).join(', ') },
    { label: 'תקציר', value: item => sanitizeInstitutionalText(item.summary, 400) },
  ])}

## תלמידים והקשרים לימודיים

${table(snapshot.students, [
    { label: 'שם', value: item => sanitizeInstitutionalText(item.name, 120) },
    { label: 'כיתה', value: item => sanitizeInstitutionalText(item.className, 120) },
    { label: 'שכבה/מסלול', value: item => sanitizeInstitutionalText(lines([item.grade, ...(item.programs || [])]).join(', '), 220) },
  ])}

## לוח שנה ותהליכים פעילים

${table(snapshot.calendar, [
    { label: 'מועד', value: item => item.date || item.range },
    { label: 'נושא', value: item => sanitizeInstitutionalText(item.title, 180) },
    { label: 'הקשר', value: item => sanitizeInstitutionalText(item.summary, 350) },
  ])}

## ידע ממסמכים

${table(snapshot.documents, [
    { label: 'מסמך', value: item => sanitizeInstitutionalText(item.name, 180) },
    { label: 'תחום', value: item => sanitizeInstitutionalText(item.domain, 100) },
    { label: 'ידע שימושי', value: item => sanitizeInstitutionalText(item.summary, 600) },
  ])}

## דפוסי משימות מאושרים

${patterns.length ? patterns.map(renderPattern).join('\n\n') : '_עדיין לא פורסמו דפוסי משימות._'}
`;
}

export function renderPattern(pattern = {}) {
  const id = clean(pattern.id, 128) || 'pattern';
  const contributors = lines(pattern.contributors).join(', ') || 'לא צוין';
  const people = lines(pattern.people).join(', ') || 'לפי הסגל הפעיל';
  const roles = lines(pattern.roles).join(', ') || 'לפי ההקשר';
  const steps = lines(pattern.steps);
  const documents = lines(pattern.documents);
  return `### ${sanitizeInstitutionalText(pattern.name || pattern.summary || 'דפוס משימה', 180)}
<!-- zoko:pattern:${id} -->

- **כוונה:** ${sanitizeInstitutionalText(pattern.canonicalIntent || pattern.summary || '', 500)}
- **מילות זיהוי:** ${lines(pattern.keywords).join(', ') || '—'}
- **בעלי תפקידים:** ${roles}
- **אנשי צוות:** ${people}
- **תורמים:** ${contributors}
- **מסמכים שכיחים:** ${documents.join(', ') || '—'}
- **מועד מקובל:** ${sanitizeInstitutionalText(pattern.timing || '', 180) || 'לפי המשימה'}
- **שלבים:**
${steps.length ? steps.map(step => `  - ${sanitizeInstitutionalText(step, 240)}`).join('\n') : '  - הגדרת אחריות ומועד'}
<!-- /zoko:pattern:${id} -->`;
}

export function upsertApprovedPattern(markdown, pattern) {
  const source = typeof markdown === 'string' && markdown.trim() ? markdown : createSchoolBrain({ school: {}, patterns: [] });
  const block = renderPattern(pattern);
  const id = clean(pattern.id, 128) || 'pattern';
  const expression = new RegExp(`### [^\\n]+\\n<!-- zoko:pattern:${id} -->[\\s\\S]*?<!-- \/zoko:pattern:${id} -->`, 'u');
  if (expression.test(source)) return source.replace(expression, block);
  const marker = '## דפוסי משימות מאושרים';
  if (!source.includes(marker)) return `${source.trim()}\n\n${marker}\n\n${block}\n`;
  return source.replace('_עדיין לא פורסמו דפוסי משימות._', '').trimEnd() + `\n\n${block}\n`;
}

export function preserveApprovedPatterns(previousMarkdown, nextMarkdown) {
  const blocks = String(previousMarkdown || '').match(/### [^\n]+\n<!-- zoko:pattern:[^>]+ -->[\s\S]*?<!-- \/zoko:pattern:[^>]+ -->/gu) || [];
  if (!blocks.length) return nextMarkdown;
  return String(nextMarkdown || '').replace('_עדיין לא פורסמו דפוסי משימות._', blocks.join('\n\n'));
}

export function relevantBrainContext(markdown, request, maxCharacters = 16000) {
  const source = clean(markdown, 250000);
  if (source.length <= maxCharacters) return source;
  const words = new Set(normalizedIntent(request).split(' ').filter(Boolean));
  const sections = source.split(/\n(?=## |### )/u);
  const scored = sections.map((section, index) => ({
    section,
    index,
    score: [...words].reduce((sum, word) => sum + (section.toLocaleLowerCase('he').includes(word) ? 1 : 0), 0),
  }));
  const always = scored.filter(item => item.index < 3);
  const ranked = scored.filter(item => item.index >= 3).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 10);
  const chosen = [...new Map([...always, ...ranked].map(item => [item.index, item])).values()];
  return chosen.map(item => item.section).join('\n').slice(0, maxCharacters);
}
