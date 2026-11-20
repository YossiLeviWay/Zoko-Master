// The school year as a list of dated milestones and routines, for Zoki's proactive reminders.
//
// Sources (read on 2026-11-20):
//  - "היערכות לשנת הלימודים תשפ״ז" (Labor Ministry Vocational Training Administration): the year
//    journey and the standing routines. https://pedagogiamh.co.il/tashpaz.html
//  - The annual Bagrut circular for תשפ״ז (Ministry of Education, 3.9.2026): exact exam/report dates.
//  - The trips procedure (annual trips plan by 20.05) and the attendance procedure (monthly report).
// Dates are copied from those documents. `roles` (who should be reminded) is OUR proposal and is
// marked as such: the sources address "the principal / the school" in general.
// Months-only items cover the whole named month range of the school year 2026-27.

export const YEAR = Object.freeze({ id: '5787', start: '2026-09-01', end: '2027-08-31', label: 'תשפ״ז' });

const TASHPAZ = 'https://pedagogiamh.co.il/tashpaz.html';
const BAGRUT = 'https://meyda.education.gov.il/files/Exams/HozerYearTashpaz2027.pdf';
const TRIPS = 'https://pedagogiamh.co.il/tiyulim.html';
const ATTENDANCE = 'https://pedagogiamh.co.il/bikur-sadir.html';

const BUDGETS = 'https://pedagogiamh.co.il/takzivim.html';
const INCLUSION = 'https://pedagogiamh.co.il/hachala.html';
const TRACKS = 'https://pedagogiamh.co.il/bchirat-megama.html';
const ADMISSIONS = 'https://pedagogiamh.co.il/klita-miyun.html';

const MGR = ['institution_manager', 'deputy_principal'];
const item = (id, text, window, roles, source, extra = {}) => ({ id, text, from: window[0], to: window[1], roles, source, mandatory: false, ...extra });

export const MILESTONES = Object.freeze([
  // ---- September (opening)
  item('sep-school-file', 'התיק הבית־ספרי מלא, מעודכן ונגיש: כלי העבודה מול הפיקוח', ['2026-09-01', '2026-09-30'], MGR, TASHPAZ),
  item('sep-schedule', 'מערכת שעות לפי האוגדן והמסלול הנבחר; כל שינוי באישור המפקח הפדגוגי', ['2026-09-01', '2026-09-30'], ['institution_manager', 'deputy_principal', 'schedule_coordinator'], TASHPAZ),
  item('sep-assessment-components', 'כל מורה מציג לתלמידים את רכיבי ההערכה בתחילת השנה', ['2026-09-01', '2026-09-30'], ['teacher', 'homeroom', 'subject_coordinator'], TASHPAZ),
  item('sep-remote-and-zelach', 'הגשת תוכנית ללמידה מרחוק או היברידית, תיק צל״ח מעודכן ופגישת צוות צל״ח', ['2026-09-01', '2026-09-30'], [...MGR, 'security_coordinator'], TASHPAZ),
  item('sep-inter-professional-teams', 'הקמת צוותים בין־מקצועיים וישיבות התנעה, כולל תוכניות עבודה שנתיות: נוכחות ונשירה, אקלים, הכלה ושילוב, צל״ח', ['2026-09-01', '2026-09-30'], [...MGR, 'discipline_climate_coordinator', 'inclusion_coordinator'], TASHPAZ),
  item('sep-distress-questionnaires', 'העברת שאלוני איתור מצוקה והגברת נוכחות', ['2026-09-01', '2026-09-30'], ['counselor', 'homeroom', ...MGR], TASHPAZ),
  item('sep-20-remove-nonstarters', 'גריעת תלמידים שלא התחילו את השנה, עד 20.9 ובהתאם להנחיות', ['2026-09-01', '2026-09-20'], [...MGR, 'discipline_climate_coordinator'], TASHPAZ, { mandatory: true }),
  item('sep-roles-approval', 'כל קליטה של בעל תפקיד מעודכנת ומאושרת בפיקוח, ונספח בעלי התפקידים מוגש למפקח', ['2026-09-01', '2026-09-30'], MGR, 'https://pedagogiamh.co.il/baaley-tafkidim.html', { mandatory: true }),
  // ---- Oct-Nov
  item('oct-nov-first-persistence', 'ועדת התמדה ראשונה, בתיאום מראש מול המפקח והקב״ס', ['2026-10-01', '2026-11-30'], [...MGR, 'discipline_climate_coordinator', 'counselor'], TASHPAZ),
  item('oct-nov-parents-meeting', 'אסיפת הורים', ['2026-10-01', '2026-11-30'], ['homeroom', ...MGR], TASHPAZ),
  item('oct-nov-distress-analysis', 'ישיבה בין־מקצועית לניתוח ומסקנות מדו״ח המצוקה הבית־ספרי', ['2026-10-01', '2026-11-30'], [...MGR, 'counselor'], TASHPAZ),
  item('nov-principals-conference', 'כנס מנהלים ארצי', ['2026-11-01', '2026-11-30'], ['institution_manager'], TASHPAZ),
  item('oct-may-institutional-trainings', 'ההשתלמויות המוסדיות פתוחות (אוקטובר עד מאי), לפי היעד הפדגוגי שנבחר', ['2026-10-01', '2027-05-31'], MGR, TASHPAZ),
  // ---- Dec-Jan
  item('dec-jan-climate-questionnaires', 'שאלוני אקלים לצוות ולתלמידים, חלון ההעברה דצמבר עד ינואר, יעד: 100% מילוי', ['2026-12-01', '2027-01-31'], [...MGR, 'pedagogical_coordinator', 'counselor'], TASHPAZ),
  item('dec-accompanying-committee-start', 'הוועדה המלווה של תחילת השנה: המועד האחרון בדצמבר', ['2026-09-01', '2026-12-31'], ['institution_manager', 'pedagogical_coordinator'], TASHPAZ, { mandatory: true }),
  item('dec-jun-principal-training', 'השתלמות המנהלים השנתית: 30 שעות, דצמבר עד יוני', ['2026-12-01', '2027-06-30'], ['institution_manager'], TASHPAZ),
  item('jan-poland-scholarship', 'פרסום הנחיות המלגות למשלחות לפולין', ['2027-01-01', '2027-01-31'], ['institution_manager', 'social_coordinator'], TASHPAZ),
  item('jan-questionnaire-followup', 'בעקבות שאלוני האקלים: פגישת למידה עם המפקח, ישיבה עם הצוות הטיפולי המורחב ושיקוף לצוות', ['2027-01-01', '2027-02-28'], [...MGR, 'pedagogical_coordinator', 'counselor'], TASHPAZ),
  // ---- Feb-Apr
  item('feb-apr-second-persistence', 'ועדת התמדה שנייה', ['2027-02-01', '2027-04-30'], [...MGR, 'discipline_climate_coordinator', 'counselor'], TASHPAZ),
  item('feb-apr-parents-and-pedagogical', 'ישיבות פדגוגיות וימי הורים (2–3 בשנה)', ['2027-02-01', '2027-04-30'], [...MGR, 'pedagogical_coordinator', 'homeroom'], TASHPAZ),
  item('feb-apr-midyear-check', 'בדיקת אמצע שנה: התקדמות מול היעדים המדידים של תוכנית העבודה', ['2027-02-01', '2027-04-30'], MGR, TASHPAZ),
  item('feb-apr-remote-practice', 'תרגול למידה מרחוק: אפשר לתאם עד 5 ימי לימוד מרחוק במהלך השנה', ['2027-02-01', '2027-04-30'], MGR, TASHPAZ),
  // ---- May-Jul
  item('may-20-trips-plan', 'הגשת תוכנית הטיולים השנתית לאישור ועדת הטיולים הארצית והמפקח הכולל, עד 20.05', ['2027-04-20', '2027-05-20'], ['trips_coordinator', 'institution_manager'], TRIPS, { mandatory: true }),
  item('may-jul-accompanying-committee-end', 'הוועדה המלווה: מפגש סיום שנה (מאי עד יולי)', ['2027-05-01', '2027-07-31'], ['institution_manager', 'pedagogical_coordinator'], TASHPAZ),
  item('may-jul-annual-grades', 'קביעת ציונים שנתיים (גמר ובגרות) לפי המחוון: מתועד ושקוף', ['2027-05-01', '2027-07-31'], ['bagrut_coordinator', 'subject_coordinator', 'track_coordinator', 'pedagogical_coordinator'], TASHPAZ),
  item('may-jul-third-persistence', 'ועדת התמדה שלישית, וסיכום נתוני התמדה ונשירה', ['2027-05-01', '2027-07-31'], [...MGR, 'discipline_climate_coordinator', 'counselor'], TASHPAZ),
  item('may-jul-lessons-and-next-year', 'הפקת לקחים ותכנון שנת תשפ״ח', ['2027-06-01', '2027-07-31'], MGR, TASHPAZ),
  // ---- Labor Ministry procedures (dates from the published procedures)
  item('dec-1-roster-close', 'סגירת מצבת התלמידים תשפ״ז, ב־1.12.2026: המצבת קובעת את תקציב הבסיס', ['2026-11-01', '2026-12-01'], [...MGR, 'secretary'], BUDGETS, { mandatory: true }),
  item('nov-30-inclusion-tahi', 'תח״י חתום ואישור התוכנית הבית־ספרית להכלה, עד 30.11', ['2026-09-01', '2026-11-30'], ['inclusion_coordinator', 'learning_function_specialist', ...MGR], INCLUSION, { mandatory: true }),
  item('feb-28-inclusion-formative', 'הערכה מעצבת של תוכניות ההכלה והתח״י, ב־28.2', ['2027-02-01', '2027-02-28'], ['inclusion_coordinator', 'learning_function_specialist'], INCLUSION, { mandatory: true }),
  item('jun-30-inclusion-summative', 'הערכה מסכמת של תוכנית ההכלה, עד 30.6; ובקשת סלי שילוב לוותיקים עד 30.6', ['2027-04-01', '2027-06-30'], ['inclusion_coordinator', 'learning_function_specialist', ...MGR], INCLUSION, { mandatory: true }),
  item('aug-31-inclusion-plan', 'תוכנית הכלה בית־ספרית וקליטת זכאים חדשים, עד 31.8', ['2027-07-01', '2027-08-31'], ['inclusion_coordinator', ...MGR], INCLUSION, { mandatory: true }),
  item('dec-feb-track-decision-table', 'שולחן ההחלטה לפתיחת מגמות מתכנס בשבוע הראשון של דצמבר ושל פברואר', ['2026-11-15', '2026-12-10'], ['institution_manager', 'track_coordinator'], TRACKS),
  item('admissions-grade-10-11-dec-31', 'קליטת תלמידים לכיתות י׳–י״א עד 31.12 (אחר כך רק באישור המפקח הפדגוגי)', ['2026-09-01', '2026-12-31'], [...MGR, 'counselor', 'secretary'], ADMISSIONS, { mandatory: true }),
  item('admissions-grade-9-mar-31', 'קליטת תלמידים לכיתות ט׳ עד 31.3 (אחר כך רק באישור המפקח הפדגוגי)', ['2027-01-01', '2027-03-31'], [...MGR, 'counselor', 'secretary'], ADMISSIONS, { mandatory: true }),
  // ---- Bagrut annual circular (exact dates)
  item('bagrut-winter-order', 'הזמנת שאלונים למועד חורף (בגרות)', ['2026-09-06', '2026-11-01'], ['bagrut_coordinator'], BAGRUT, { mandatory: true }),
  item('bagrut-winter-exceptions', 'בקשות לוועדת חריגים: מועד חורף', ['2026-09-06', '2026-11-15'], ['bagrut_coordinator', 'inclusion_coordinator', 'learning_function_specialist'], BAGRUT, { mandatory: true }),
  item('bagrut-winter-accommodations-report', 'דיווח התאמות: מועד חורף', ['2026-09-06', '2026-12-13'], ['bagrut_coordinator', 'inclusion_coordinator', 'learning_function_specialist'], BAGRUT, { mandatory: true }),
  item('bagrut-winter-alt-grades', 'דיווח ציוני הערכה חלופית ופנימית: מועד חורף', ['2026-10-19', '2027-02-15'], ['bagrut_coordinator', 'subject_coordinator'], BAGRUT, { mandatory: true }),
  item('bagrut-winter-exams', 'מועד חורף של בחינות הבגרות (28.12.2026 עד 4.2.2027)', ['2026-12-28', '2027-02-04'], ['bagrut_coordinator', 'institution_manager'], BAGRUT),
  item('bagrut-summer-order', 'הזמנת שאלונים למועד קיץ (בגרות)', ['2026-12-13', '2027-02-01'], ['bagrut_coordinator'], BAGRUT, { mandatory: true }),
  item('bagrut-overlap-requests', 'בקשות לבחינות חופפות: עד 4.3.2027 דרך מערכת הבגרויות', ['2027-02-01', '2027-03-04'], ['bagrut_coordinator'], BAGRUT, { mandatory: true }),
  item('bagrut-summer-exceptions', 'בקשות לוועדת חריגים: מועד קיץ', ['2026-12-01', '2027-03-15'], ['bagrut_coordinator', 'inclusion_coordinator', 'learning_function_specialist'], BAGRUT, { mandatory: true }),
  item('bagrut-summer-alt-grades', 'דיווח ציוני הערכה חלופית ופנימית: מועד קיץ', ['2027-03-07', '2027-07-15'], ['bagrut_coordinator', 'subject_coordinator'], BAGRUT, { mandatory: true }),
  item('bagrut-summer-accommodations-report', 'דיווח התאמות: מועד קיץ', ['2026-12-06', '2027-04-13'], ['bagrut_coordinator', 'inclusion_coordinator', 'learning_function_specialist'], BAGRUT, { mandatory: true }),
  item('bagrut-flexible-approval', 'בגרות גמישה: המנהל מאשר את ציוני משימות הביצוע עד 20.6.2027', ['2027-05-01', '2027-06-20'], ['institution_manager', 'bagrut_coordinator'], BAGRUT, { mandatory: true }),
]);

// Routines that repeat all year. `cadence` is as written in the sources.
export const ROUTINES = Object.freeze([
  { id: 'attendance-every-lesson', cadence: 'daily', text: 'דיווח נוכחות בכל שיעור, במערכת הממוחשבת', roles: ['teacher', 'homeroom'], source: TASHPAZ },
  { id: 'homeroom-absence-followup', cadence: 'daily', text: 'מחנך מברר כל היעדרות ביום הראשון, ומעדכן את היועץ אחרי יומיים', roles: ['homeroom'], source: ATTENDANCE },
  { id: 'monthly-attendance-report', cadence: 'monthly', text: 'דו״ח נוכחות חודשי של המחנך, ודו״ח תלמידים בהיעדרות מעל 7 ימים (טופס 8.1) בסוף החודש', roles: ['homeroom', ...MGR, 'discipline_climate_coordinator'], source: ATTENDANCE },
  { id: 'monthly-dropout-risk', cadence: 'monthly', text: 'דו״ח תלמידים בסכנת נשירה: טופס מעקב במייל למפקחת המערך הטיפולי, למפקח בית הספר ולמחוז', roles: [...MGR, 'counselor', 'discipline_climate_coordinator'], source: TASHPAZ },
  { id: 'monthly-apprenticeship-report', cadence: 'monthly', text: 'דיווח חניכות במערכת המשרד', roles: ['apprenticeship_coordinator', 'institution_manager'], source: TASHPAZ },
  { id: 'supervisor-visit', cadence: 'monthly', text: 'ביקור פיקוח: אחת לחודש עד חודש וחצי', roles: ['institution_manager'], source: TASHPAZ },
  { id: 'management-meeting', cadence: 'biweekly', text: 'ישיבת הנהלה לפחות פעם בשבועיים', roles: MGR, source: TASHPAZ },
  { id: 'staff-meeting', cadence: 'weekly', text: 'ישיבת צוות והשתלמות צוות אחת לשבוע, לאחר שעות הלימודים', roles: ['institution_manager', 'deputy_principal', 'teacher'], source: TASHPAZ },
  { id: 'personal-staff-talks', cadence: 'twice-a-year', text: 'שיחות אישיות עם אנשי הצוות, לפחות פעמיים בשנה', roles: ['institution_manager', 'deputy_principal'], source: TASHPAZ },
]);

const day = value => new Date(`${value}T12:00:00Z`).getTime();
const DAY = 86400000;

// Milestones that are running today or begin within `horizonDays`, for one role (or everyone when roleId is empty).
// Items already past their window are not returned. We cannot know whether a task was completed.
export function milestonesFor({ today, roleId = '', horizonDays = 30 } = {}) {
  const now = day(today);
  return MILESTONES
    .filter(entry => !roleId || entry.roles.includes(roleId))
    .map(entry => {
      const from = day(entry.from), to = day(entry.to);
      if (now > to + DAY - 1) return null;
      if (now >= from) return { ...entry, state: 'active', daysLeft: Math.max(0, Math.round((to - now) / DAY)) };
      if (from - now <= horizonDays * DAY) return { ...entry, state: 'upcoming', startsInDays: Math.round((from - now) / DAY) };
      return null;
    })
    .filter(Boolean)
    // Sooner deadlines first; mandatory ones ahead of the rest.
    .sort((a, b) => (b.mandatory - a.mandatory) || ((a.daysLeft ?? 999) - (b.daysLeft ?? 999)) || ((a.startsInDays ?? 0) - (b.startsInDays ?? 0)));
}

export function routinesFor(roleId = '') {
  return ROUTINES.filter(entry => !roleId || entry.roles.includes(roleId));
}

// A compact Hebrew text for a prompt or a reminder card.
export function remindersText({ today, roleId = '', limit = 6 } = {}) {
  const list = milestonesFor({ today, roleId }).slice(0, limit).map(entry => entry.state === 'active'
    ? `• ${entry.text} (עד ${entry.to.split('-').reverse().join('.')}${entry.mandatory ? ', מועד מחייב' : ''})`
    : `• בעוד ${entry.startsInDays} ימים: ${entry.text}`);
  return list.length ? `אבני דרך קרובות לתפקיד (תשפ״ז):\n${list.join('\n')}` : '';
}
