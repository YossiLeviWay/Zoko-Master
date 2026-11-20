// Zoki's sourced knowledge layer.
//
// RULE: Zoki may state a regulation only from an entry whose source.status is 'verified'.
// For entries 'awaiting-source' it must say the rule has not been checked yet, point to the
// official source, and suggest asking the principal/supervisor. Nothing here is written from
// memory: verified entries were read from the pages named in `source`.
//
// To add a circular: paste its text (or upload the PDF) and replace the stub with a verified
// entry carrying the circular number, date and URL. `retrieved` is the date it was read.

import { ROLE_DEFINITIONS, ROLE_DEFINITIONS_SOURCE, roleBrief } from './roleDefinitions.js';
import { SCHOOL_ROLES } from './schoolRoleCatalog.js';

const PMH = 'https://pedagogiamh.co.il';
const MANKAL = 'https://apps.education.gov.il/mankal/';
const verified = (name, url, retrieved = '2026-11-19') => ({ name, url, retrieved, status: 'verified' });
const awaiting = (name, url) => ({ name, url, retrieved: '', status: 'awaiting-source' });

const STATIC_KNOWLEDGE = [
  {
    id: 'appointments-duty', topic: 'role-appointments', title: 'חובת מינוי בעלי תפקידים והגשת נספח',
    keywords: ['מינוי', 'בעלי תפקידים', 'נספח', 'מפקח', 'החלפת בעל תפקיד', 'שעות תפקיד'],
    roles: ['institution_manager', 'deputy_principal', 'pedagogical_coordinator'],
    summary: 'בית הספר ממנה את כלל בעלי התפקידים שבהנחיה, מקצה להם את שעות התפקיד כבטבלה ללא סטייה, ומגיש למפקח בתחילת השנה את נספח בעלי התפקידים בחתימת המנהל.',
    points: [
      'החלפת בעל תפקיד במהלך השנה או בסופה: לעדכן את המפקח ולקבל אישור לפני הפעלת המינוי.',
      'מורים מקצועיים מול המפקח המקצועי; יועץ או עו״ס מול המפקחת על המערך הטיפולי.',
      'יש לבחור 4 בעלי תפקידים מתוך רשימת התפקידים בגמול 6%.',
      'לבנות תוכנית עבודה שנתית לכל בעל תפקיד, בזיקה ליעדי בית הספר ולעקרונות החינוך היוצר.',
      'מינוי מורה חונך: בקשה לאישור המפקח, והעברתה לרשת.',
    ],
    source: verified('הנחיות מינהל הכשרה מקצועית תשפ״ז: בעלי תפקידים מובילים (20.7.26)', `${PMH}/baaley-tafkidim.html`),
  },
  {
    id: 'credits-and-ranks', topic: 'role-benefits', title: 'נקודות זכות ודרגות קידום',
    keywords: ['נקודות זכות', 'דרגת קידום', 'גמול', 'עוז לתמורה'],
    roles: ['institution_manager', 'deputy_principal', 'pedagogical_coordinator'],
    summary: 'עובד הוראה צובר נקודות זכות על ביצוע תפקידים; 10 נקודות מזכות בדרגת קידום של 1.67% מהשכר המשולב, ועד 4 דרגות (6.69% מצטבר).',
    points: [
      'מי שממלא שני תפקידים או יותר צובר ניקוד על תפקיד אחד בלבד בכל שנה: זה שמזכה במספר הנקודות הגבוה ביותר.',
      'נקודות ניתנות רק על ביצוע תפקידים, לא על גמולי השתלמות.',
      'רכז שכבה 4; רכז חינוך חברתי ורכז מקצוע 3; מחנך כיתה 2; רכז פדגוגי, הכלה ושילוב, תקשוב, בגרות, משמעת ואקלים, ייעוץ ומערכת 2.5 (החל מ־1.9.2025).',
      'פעם בשנה הרשת מעבירה למשרד העבודה את קידום הדרגות.',
    ],
    source: verified('הנחיות מינהל הכשרה מקצועית תשפ״ז: בעלי תפקידים מובילים', `${PMH}/baaley-tafkidim.html`),
  },
  {
    id: 'hours-framework', topic: 'hours', title: 'מסגרת השעות השבועיות',
    keywords: ['שעות', 'שעות תומכות', 'שעות פרטניות', 'ש״ש', 'בדיקת מבחנים', 'ישיבות', 'שיחות הורים'],
    roles: ['teacher', 'homeroom', 'deputy_principal', 'pedagogical_coordinator'],
    summary: 'המסגרת מחולקת לשעות הוראה פרונטליות, פרטניות ותומכות הוראה.',
    points: [
      'שעות תומכות הוראה: בדיקת מבחנים ועבודות 5 ש״ש, השתלמות צוותית 2, ישיבות עבודה 2, שיחות עם הורים 1.',
      'שעות פרטניות: קבוצות של עד 3 או 5 תלמידים, לפי החלטת צוות פדגוגי בראשות המנהל.',
      'השעות הפרטניות והתומכות הן חלק מהתפקיד ואינן ניתנות להמרה למשימות אחרות.',
    ],
    source: verified('הנחיות מינהל הכשרה מקצועית תשפ״ז: בעלי תפקידים מובילים', `${PMH}/baaley-tafkidim.html`),
  },
  {
    id: 'social-coordinator', topic: 'role-social', title: 'רכז/ת חינוך חברתי: משימות וסדירויות',
    keywords: ['רכז חברתי', 'חינוך חברתי', 'מעורבות', 'תוכנית עבודה חברתית', 'מפגש חודשי'],
    roles: ['social_coordinator', 'deputy_principal', 'institution_manager'],
    summary: 'אחראי על קידום התחום החברתי־ערכי במסגרות הפורמליות והלא־פורמליות; מצופה להיות חבר/ת הנהלה.',
    points: [
      'שש משימות: תפיסת עולם חברתית־ערכית, ליווי הצוות החינוכי, מעורבות חברתית, שותפויות, תיעוד הפעילות, מרחבי למידה חברתיים.',
      'שתי סדירויות חודשיות: מפגש עם המנהל, ומפגש עם צוות המחנכים.',
      'תוכנית שנתית לפי שכבות, עם תקציב מוגדר: תשלומי הורים ותקציב שוטף.',
      'לבדוק מול המפקח: בעמוד ההגדרות מופיעה משרה של 0.5 ש״ש לכיתה + 4/5 וגמול 10%, ובעמוד התפקיד 0.4 שעות פרונטליות + 6% לכיתה.',
    ],
    source: verified('מרחב החינוך החברתי: תפקיד הרכז/ת', `${PMH}/chevrati-tafkid.html`),
  },
  {
    id: 'apprenticeship-coordinator', topic: 'role-apprenticeship', title: 'רכז/ת חניכות: תחום אחריות ובסיס חוקי',
    keywords: ['חניכות', 'מעסיק', 'מנטור', 'מנב״ס', 'ביטוח', 'עבודת נוער'],
    roles: ['apprenticeship_coordinator', 'institution_manager'],
    summary: 'מוביל פיתוח, שיבוץ, ליווי ובקרה של החניכות וההתנסות התעסוקתית, מול התלמידים והוריהם, המעסיקים וצוות בית הספר.',
    points: [
      'בסיס חוקי: חוק החניכות תשי״ג־1953, חוק עבודת הנוער ותקנותיו, ביטוח לאומי (פגיעה בעבודה), פוליסת תאונות אישיות 24/7.',
      'דיווח נתוני תעסוקת תלמידים במערכת מנב״ס.',
      'הנוהל בתוקף מתשפ״ז; עודכן באוגוסט 2026.',
    ],
    source: verified('נוהל רכז החניכות והתעסוקה (תשפ״ז)', `${PMH}/nohal-rakaz-chanichut.html`),
  },
  {
    id: 'pedagogical-toolbox', topic: 'role-pedagogical', title: 'ארגז הכלים של הרכז/ת הפדגוגי/ת',
    keywords: ['תוכנית עבודה שנתית', 'פריסת היבחנות', 'מיפוי בית ספרי', 'שאלון פדגוגיה', 'ועדה מלווה'],
    roles: ['pedagogical_coordinator', 'deputy_principal'],
    summary: 'שמונה כלים: תוכנית עבודה שנתית, תבנית תכנון לימודי, תוכנית פדגוגית פרטנית, פריסת היבחנות תלת־שנתית, מיפוי בית ספרי, חוברת שאלונים, ושאלוני פדגוגיה למורים ולתלמידים.',
    points: ['ועדה מלווה בית ספרית: פעמיים בשנה מול הפיקוח והרשת, עם שימוש בנתונים ובכלים.'],
    source: verified('ארגז הכלים של הרכז.ת הפדגוגי.ת', `${PMH}/rakaz-pedagogi-klim.html`),
  },
  // ---- Ministry of Education circulars: NOT yet read. Zoki must not answer from memory. ----
  { id: 'circular-trips', topic: 'trips', title: 'יציאה לטיולים ופעילות מחוץ לבית הספר',
    keywords: ['טיול', 'טיולים', 'יציאה', 'סיור', 'יום עיון', 'אישור הורים', 'מלווים', 'בטיחות'],
    roles: ['trips_coordinator', 'homeroom', 'institution_manager'],
    checklist: ['תכנון ואישור מנהל', 'אישורי הורים', 'מלווים ובטיחות', 'ביטוח', 'דיווח לגורמים הרלוונטיים'],
    summary: '', points: [], source: awaiting('חוזר מנכ״ל בנושא טיולים, סיורים ופעילות מחוץ לבית הספר', MANKAL) },
  { id: 'circular-suspension', topic: 'suspension', title: 'השעיית תלמידים',
    keywords: ['השעיה', 'להשעות', 'הרחקה', 'משמעת', 'שימוע', 'ועדת משמעת'],
    roles: ['discipline_climate_coordinator', 'institution_manager', 'deputy_principal'],
    checklist: ['תיעוד האירוע', 'הודעה והזמנה להורים', 'זכות טיעון/שימוע', 'החלטת מנהל ודיווח', 'מעקב והחזרה לשגרה'],
    summary: '', points: [], source: awaiting('חוזר מנכ״ל בנושא משמעת, השעיה והרחקה של תלמידים', MANKAL) },
  { id: 'circular-bagrut', topic: 'bagrut', title: 'בגרויות: חוזר מעודכן',
    keywords: ['בגרות', 'בגרויות', 'מועד', 'מועד ב', 'התאמות', 'זכאות', 'שאלון'],
    roles: ['bagrut_coordinator', 'pedagogical_coordinator', 'subject_coordinator'],
    checklist: ['מועדי הבחינות', 'התאמות בבחינה', 'תנאי זכאות', 'נהלי הרשמה'],
    summary: '', points: [], source: awaiting('חוזר מנכ״ל/הוראות על בחינות הבגרות (העדכני)', MANKAL) },
  { id: 'circular-curricula', topic: 'curricula', title: 'תוכניות לימודים ויעדי למידה',
    keywords: ['תוכנית לימודים', 'תכנית לימודים', 'יעדי למידה', 'סילבוס', 'תכנים'],
    roles: ['subject_coordinator', 'track_coordinator', 'pedagogical_coordinator', 'teacher'],
    checklist: ['תוכנית הלימודים הרשמית של המקצוע', 'יעדי הלימוד', 'מבחני גמר ובגרות'],
    summary: '', points: [], source: awaiting('תוכניות הלימודים ויעדי הלמידה', 'https://edu.gov.il/') },
  { id: 'circular-roles-all', topic: 'role-circulars', title: 'חוזרי מנכ״ל להגדרת התפקידים',
    keywords: ['הגדרת תפקיד', 'חוזר מנכ״ל', 'תפקידי חינוך'],
    roles: ['institution_manager', 'deputy_principal'],
    checklist: ['הגדרת התפקיד הרשמית', 'היקף משרה וגמול', 'הכשרה נדרשת'],
    summary: '', points: [], source: awaiting('חוזרי מנכ״ל על בעלי תפקידים בבית הספר', MANKAL) },
];

// Words shared by many role names carry no signal on their own.
const GENERIC_WORDS = new Set(['רכז', 'רכזת', 'רכז.ת', 'מורה', 'מורה/ית']);

// One verified entry per official role definition (11 complete, 5 summary-only).
const ROLE_ENTRIES = Object.entries(ROLE_DEFINITIONS).map(([roleId, def]) => {
  const label = SCHOOL_ROLES.find(role => role.id === roleId)?.label || def.title;
  const goals = def.sections.filter(section => /מטרות|תחומי אחריות|עיקרי הפעולות/.test(section.heading)).flatMap(section => section.items.slice(0, 5));
  return {
    id: `role-def-${roleId}`, topic: 'role-definition', title: `הגדרת תפקיד: ${label}`,
    keywords: [...new Set([label, def.title, ...label.split(/[\s/·,()]+/).filter(word => word.length > 2 && !GENERIC_WORDS.has(word))])],
    roles: [roleId, 'institution_manager', 'deputy_principal'],
    summary: def.summary, points: [...def.chips, ...goals].slice(0, 12), complete: def.complete,
    source: { name: ROLE_DEFINITIONS_SOURCE.name, url: def.link ? new URL(def.link, 'https://pedagogiamh.co.il/').href : ROLE_DEFINITIONS_SOURCE.page, retrieved: ROLE_DEFINITIONS_SOURCE.retrieved, status: 'verified' },
  };
});

export const KNOWLEDGE = Object.freeze([...STATIC_KNOWLEDGE, ...ROLE_ENTRIES]);

const normalize = text => String(text || '').toLowerCase().replace(/[֑-ׇ"׳'״]/gu, '').replace(/\s+/gu, ' ').trim();

export function searchKnowledge(query, { roleId = '', limit = 3 } = {}) {
  const text = normalize(query);
  if (!text) return [];
  return KNOWLEDGE.map(entry => {
    // A longer phrase ("נקודות זכות") is stronger evidence than a single word, so it weighs by its word count.
    const matched = [...new Set(entry.keywords)].filter(word => text.includes(normalize(word)));
    const hits = matched.reduce((sum, word) => sum + normalize(word).split(' ').length, 0);
    // A question about "the role of X" should reach X's official definition before a topic stub.
    const asksAboutRole = /תפקיד|הגדרה|אחריות|מה עושה|מה אחראי/.test(text);
    return { entry, score: hits * 2 + (hits && entry.roles.includes(roleId) ? 1 : 0) + (hits && asksAboutRole && entry.topic === 'role-definition' ? 3 : 0) };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(item => item.entry);
}

// What Zoki may say about an entry. Unverified entries never produce rule text.
export function answerPolicy(entry) {
  if (entry.source.status === 'verified') {
    return { mode: 'cite', text: [entry.summary, ...entry.points].filter(Boolean).join('\n'), source: entry.source };
  }
  return {
    mode: 'defer',
    text: `לא בדקתי עדיין את הנוסח העדכני של "${entry.source.name}", ולכן אינני מצטט ממנו כללים. כדאי לאמת מול המנהל או המפקח, או מול המקור הרשמי.`,
    checklist: entry.checklist || [], source: entry.source,
  };
}

// Prompt block injected into a role agent for the entries relevant to its role.
export function knowledgePromptFor(roleId) {
  const own = KNOWLEDGE.filter(entry => entry.roles.includes(roleId));
  const cites = own.filter(entry => entry.source.status === 'verified').map(entry => `• ${entry.title}: ${entry.summary} (מקור: ${entry.source.name})`);
  const open = own.filter(entry => entry.source.status !== 'verified').map(entry => entry.title);
  const brief = roleBrief(roleId);
  return [
    brief,
    cites.length ? `ידע מאומת:\n${cites.join('\n')}` : '',
    open.length ? `נושאים שעדיין לא נבדקו מול המקור הרשמי (${open.join(', ')}): אל תצטט כללים בהם. אמור שהנוסח לא נבדק, הצע רשימת בדיקה והפנה למנהל או למפקח.` : '',
    'כלל ברזל: אל תמציא חוזר מנכ״ל, מספר חוזר, סעיף, מועד או סכום. אם אין לך מקור מאומת, אמור זאת.',
  ].filter(Boolean).join('\n');
}
