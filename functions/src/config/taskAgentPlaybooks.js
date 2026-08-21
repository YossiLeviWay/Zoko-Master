export const BUILT_IN_TASK_PATTERNS = Object.freeze([
  {
    id: 'baseline_exams', domain: 'exams', pattern: /מבחן|מבחנים|בחינה|בחינות|הערכה/u,
    commonDocuments: ['לוח מבחנים', 'טופס התאמות', 'מחוון בדיקה'],
    steps: [
      { title: 'הגדרת מועד והיקף המבחן', phase: 'תכנון' },
      { title: 'תיאום עם מחנכי הכיתות', phase: 'תיאום' },
      { title: 'הכנת חומרי המבחן וההתאמות', phase: 'הכנה' },
    ],
  },
  {
    id: 'baseline_trip', domain: 'trips', pattern: /טיול|סיור|מסע/u,
    commonDocuments: ['אישור יציאה', 'רשימת ציוד', 'רשימת קשר לשעת חירום'],
    steps: [{ title: 'אישור מועד ומסלול', phase: 'תכנון' }, { title: 'ריכוז אישורים ותיאומים', phase: 'הכנה' }, { title: 'תדרוך הצוות והמשתתפים', phase: 'ביצוע' }],
  },
  {
    id: 'baseline_event', domain: 'events', pattern: /טקס|אירוע|מסיבה/u,
    commonDocuments: ['לוח זמנים', 'רשימת תפקידים'],
    steps: [{ title: 'הגדרת מטרת האירוע והקהל', phase: 'תכנון' }, { title: 'חלוקת אחריות', phase: 'תיאום' }, { title: 'בדיקת מוכנות', phase: 'ביצוע' }],
  },
  {
    id: 'baseline_parents', domain: 'parents', pattern: /הורה|הורים|אסיפת הורים/u,
    commonDocuments: ['הודעה להורים', 'רשימת נושאים'],
    steps: [{ title: 'הגדרת מטרת הפנייה', phase: 'תכנון' }, { title: 'תיאום עם הצוות הרלוונטי', phase: 'תיאום' }, { title: 'שליחה ומעקב', phase: 'ביצוע' }],
  },
  {
    id: 'baseline_safety', domain: 'safety', pattern: /בטיחות|חירום|ביטחון/u,
    commonDocuments: ['נוהל בטיחות', 'רשימת אנשי קשר'],
    steps: [{ title: 'בדיקת הנוהל והאחראים', phase: 'בדיקה' }, { title: 'חלוקת תפקידים', phase: 'תיאום' }, { title: 'תדרוך ובקרת ביצוע', phase: 'ביצוע' }],
  },
]);

export function builtInTaskPattern(request = '') {
  return BUILT_IN_TASK_PATTERNS.find(item => item.pattern.test(request)) || null;
}
