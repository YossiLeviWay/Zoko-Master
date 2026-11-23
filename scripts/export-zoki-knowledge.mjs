// Exports Zoki's vetted knowledge (verified regulation entries + dated school-year milestones)
// as one Markdown file the school-ai local model can ingest. Public ministry guidance only:
// no personal data and no per-user memories are ever exported.
import { writeFileSync } from 'node:fs';
import { KNOWLEDGE } from '../functions/src/zokiKnowledge.js';
import { MILESTONES, ROUTINES, YEAR } from '../functions/src/schoolYearCalendar.js';

const out = ['# ידע מאומת של זוקי', '', 'מקורות: אתר פדגוגיה (מינהל הכשרה מקצועית) וחוזרי משרד החינוך שנקראו. מה שמסומן "לא נבדק" אינו מקור לציטוט כללים.', ''];
for (const e of KNOWLEDGE.filter(item => item.source.status === 'verified')) {
  out.push(`## ${e.title}`, '', e.summary, '', ...e.points.map(p => `- ${p}`), '', `מקור: ${e.source.name}${e.source.url ? ` (${e.source.url})` : ''}${e.edition ? `, מהדורה ${e.edition}` : ''}`, '');
}
const open = [...KNOWLEDGE.filter(item => item.source.status !== 'verified').map(item => item.title), 'ההגדרה המדויקת של "גמול 6%" ותנאיו (המסמכים רק מציינים אילו תפקידים נמנים עליו)'];
if (open.length) out.push('## נושאים שלא נבדקו מול המקור הרשמי', '', ...open.map(t => `- ${t}`), '', 'בנושאים אלה אין לצטט כללים. יש להפנות למנהל או למפקח.', '');
out.push(`## תאריכים חשובים בשנת הלימודים ${YEAR.label}`, '', ...MILESTONES.map(m => `- ${m.from}${m.to && m.to !== m.from ? ` עד ${m.to}` : ''}: ${m.text}${m.mandatory ? ' (חובה)' : ''}`), '');
out.push('## שגרות', '', ...ROUTINES.map(r => `- ${r.text || r.title || JSON.stringify(r)}`), '');
writeFileSync(new URL('../docs/zoki-knowledge-export.md', import.meta.url), out.join('\n'));
console.log(`exported ${KNOWLEDGE.length - open.length} verified entries, ${MILESTONES.length} milestones`);
