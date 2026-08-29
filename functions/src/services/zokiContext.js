import { adminDb } from './firebaseAdmin.js';
import { buildPermissionContext, evaluatePermission, scopeAllows, withResourcePermissionContext } from './permissionEngine.js';
import { extractAuthorizedFileText, selectRelevantText } from './zokiFileText.js';
import { resolveActorRoleAuthority } from './roleAuthorization.js';
import { DIRECT_PERMISSION_DEFINITIONS } from '../permissionCatalog.js';
import { calendarEventVersion, normalizeCalendarEvent } from './calendarEventState.js';

const clean = (value, max = 240) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const list = value => Array.isArray(value) ? value.slice(0, 30) : [];
const lower = value => clean(value, 2000).toLocaleLowerCase('he-IL');

function words(value) {
  return [...new Set(lower(value).split(/[^\p{L}\p{N}]+/gu).filter(word => word.length > 1))];
}

function score(item, terms) {
  const haystack = lower(Object.values(item).flat().filter(value => ['string', 'number'].includes(typeof value)).join(' '));
  return terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
}

function relevant(items, question, limit = 12) {
  const terms = words(question);
  if (!terms.length) return items.slice(0, limit);
  const matches = items.map(item => ({ item, score: score(item, terms) }))
    .filter(entry => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(entry => entry.item);
  return matches.length ? matches : items.slice(0, limit);
}

async function collectionDocuments(paths, limit = 1000) {
  const snapshots = await Promise.all(paths.map(path => adminDb.collection(path).limit(limit).get().catch(() => null)));
  const merged = new Map();
  snapshots.filter(Boolean).forEach(snapshot => snapshot.docs.forEach(item => {
    if (!merged.has(item.id)) merged.set(item.id, { id: item.id, ...item.data() });
  }));
  return [...merged.values()];
}

async function organizationTaskDocuments(schoolId, limit = 2000) {
  const [nested, legacy] = await Promise.all([
    adminDb.collection(`schools/${schoolId}/tasks`).limit(limit).get().catch(() => null),
    adminDb.collection(`tasks_${schoolId}`).limit(limit).get().catch(() => null),
  ]);
  const merged = new Map();
  (nested?.docs || []).forEach(item => merged.set(item.id, { id: item.id, ...item.data(), _storageMode: 'nested' }));
  (legacy?.docs || []).forEach(item => {
    if (!merged.has(item.id)) merged.set(item.id, { id: item.id, ...item.data(), _storageMode: 'legacy' });
  });
  return [...merged.values()];
}

const CAPABILITY_ALIASES = Object.freeze({
  'staff.view': 'staff_view',
  'classes.view': 'classes_view',
  'students.view': 'students_view',
  'files.view': 'files_view',
  'calendar.view': 'calendar_view',
  'attendance.view': 'attendance_view',
  'tasks.viewOwn': 'tasks_view',
  'tasks.viewTeam': 'tasks_view',
  'students.viewSensitiveNotes': 'students_view_notes',
});

function decision(context, capability, resource = {}) {
  const request = {
    capability, accessLevel: 'view', resource,
    resourceType: resource.resourceType,
    resourceId: resource.resourceId,
  };
  const modern = evaluatePermission(context, request);
  const alias = CAPABILITY_ALIASES[capability];
  const aliased = modern.allowed || !alias
    ? modern
    : evaluatePermission(context, { ...request, capability: alias });
  if (aliased.allowed || Object.keys(resource).length > 0) return aliased;
  const capabilityNames = new Set([capability, alias].filter(Boolean));
  const grant = (context.capabilityGrants || []).find(item => capabilityNames.has(item.capability));
  return grant ? { allowed: true, capability, scope: grant.scope, source: grant.source, reason: 'scoped-capability-present' } : aliased;
}

function resourceDecision(context, capability, resource) {
  const result = decision(context, capability, resource);
  if (managerSubject(context) || !(context.resourceAcls || []).length) return result;
  const aclSource = typeof result.source === 'string' && (result.source.endsWith('-acl') || result.source === 'parent-acl');
  return result.allowed && aclSource
    ? result
    : { allowed: false, capability, source: 'resource-acl', reason: 'resource-acl-required' };
}

function source(type, item, label, route, fields) {
  return { id: `${type}:${item.id}`, type, label, route, fields };
}

function directUserAccess(resourceAcls = []) {
  return resourceAcls.filter(acl => {
    if (acl.active === false || acl.inheritedFrom || acl.principalType !== 'user') return false;
    const expiresAt = acl.expiresAt?.toMillis?.() || (acl.expiresAt ? Date.parse(acl.expiresAt) : 0);
    return !expiresAt || expiresAt > Date.now();
  }).map(acl => ({
    userId: clean(acl.principalId, 128),
    accessLevel: clean(acl.accessLevel, 20) || 'view',
    explicitDeny: acl.explicitDeny === true,
  })).filter(item => item.userId).slice(0, 100);
}

const INTENTS = Object.freeze({
  staff: /מורה|מורים|צוות|סגל|תפקיד|רכז|מנהלת|מנהל/u,
  classes: /כיתה|כיתות|שכבה|לומד|לומדת|שיבוץ/u,
  students: /תלמיד|תלמידה|תלמידים|תלמידות|לומד|לומדת/u,
  files: /קובץ|קבצים|מסמך|מסמכים|תיקייה/u,
  fileRename: /(?:שנה|שני|עדכן|עדכני|החלף|החליפי).{0,80}(?:שם).{0,120}(?:קובץ|מסמך|תיקי(?:יה|יה))|(?:קובץ|מסמך|תיקי(?:יה|יה)).{0,120}(?:שינוי|לשנות|להחליף).{0,60}(?:שם)/u,
  fileTrash: /(?:העבר|העבירי).{0,100}(?:קובץ|מסמך|תיקי(?:יה|יה)).{0,80}(?:לסל|למחזור)|(?:מחק|מחקי).{0,100}(?:קובץ|מסמך|תיקי(?:יה|יה))|(?:קובץ|מסמך|תיקי(?:יה|יה)).{0,100}(?:למחוק|לסל המחזור)/u,
  fileCreate: /(?:צור|צרי|פתח|פתחי|הוסף|הוסיפי).{0,140}(?:קובץ|מסמך|גיליון|תיקי(?:יה|יה))|(?:קובץ|מסמך|גיליון|תיקי(?:יה|יה)).{0,140}(?:ליצור|לפתוח|להוסיף)/u,
  fileRestore: /(?:שחזר|שחזרי|החזר|החזירי).{0,120}(?:קובץ|מסמך|תיקי(?:יה|יה))|(?:קובץ|מסמך|תיקי(?:יה|יה)).{0,120}(?:לשחזר|להחזיר).{0,60}(?:מהסל|מסל המחזור)?/u,
  fileMove: /(?:העבר|העבירי|הזז|הזיזי).{0,120}(?:קובץ|מסמך).{0,120}(?:לתיקי(?:יה|יה)|אל תיקי(?:יה|יה))|(?:קובץ|מסמך).{0,120}(?:להעביר|להזיז).{0,120}(?:לתיקי(?:יה|יה)|אל תיקי(?:יה|יה))/u,
  grades: /ציון|ציונים|מבחן|הערכה/u,
  gradeAction: /(?:הזן|הכנס|עדכן|שנה|קבע|תן|רשום).{0,100}(?:ציון|ציונים|מבחן|הערכה)|(?:ציון|ציונים).{0,100}(?:להזין|להכניס|לעדכן|לשנות|לקבוע|לרשום)/u,
  attendance: /נוכחות|חיסור|חיסורים|חסר|חסרה|חסרים|חסרות|איחור|איחורים|נעדר|נעדרה|הגיע|הגיעה|נכח|נכחה/u,
  attendanceAction: /(?:סמן|סמני|עדכן|עדכני|רשום|רשמי|קבע|קבעי).{0,120}(?:נוכחות|חיסור|חסר|חסרה|איחור|נעדר|נוכח|הגיע|מחלה)|(?:נוכחות|חיסור|חסר|חסרה|איחור).{0,120}(?:לסמן|לעדכן|לרשום|לקבוע)/u,
  tasks: /משימה|משימות|אחראי|לבצע|מה יש לי היום|מה עליי לעשות|מה צריך לעשות|הזמנה למשימה|הצעת משימה/u,
  taskStatusAction: /(?:סמן|סמני|עדכן|עדכני|העבר|העבירי|התחל|התחילי|השלם|השלימי|סיים|סיימי|פתח|פתחי).{0,140}(?:משימה|מטלה)|(?:משימה|מטלה).{0,140}(?:להתחיל|להשלים|לסיים|לפתוח מחדש|בביצוע|הושלמה|בוצעה)/u,
  taskAssignmentAction: /(?:הקצה|הקצי|שייך|שייכי|הוסף|הוסיפי|צרף|צרפי|הסר|הסירי|בטל|בטלי).{0,160}(?:משימה|מטלה|אחראי)|(?:משימה|מטלה|אחראי).{0,160}(?:להקצות|לשייך|להוסיף|לצרף|להסיר|לבטל)/u,
  taskDetailsAction: /(?:עדכן|עדכני|שנה|שני|ערוך|ערכי|דחה|דחי|הקדם|הקדימי).{0,160}(?:משימה|מטלה|כותרת|תיאור|עדיפות|תאריך יעד|מועד)|(?:משימה|מטלה).{0,160}(?:לעדכן|לשנות|לערוך|לדחות|להקדים|עדיפות|תאריך יעד|מועד)/u,
  organization: /צוות|צוותים|תפקיד|תפקידים|הרשאה|הרשאות|גישה|אחריות|אחראי|רכז/u,
  calendar: /לוח|אירוע|אירועים|תאריך|מועד|חופשה|חג|מה יש לי היום|מה יש היום|מחר|השבוע/u,
  calendarCreate: /(?:צור|צרי|הוסף|הוסיפי|קבע|קבעי|פתח|פתחי|שמור|שמרי).{0,120}(?:אירוע|פגישה|מועד|לוח)|(?:אירוע|פגישה|מועד).{0,120}(?:ליצור|להוסיף|לקבוע|לפתוח|לשמור)/u,
  calendarUpdate: /(?:עדכן|עדכני|שנה|שני|הזז|הזיזי|דחה|דחי|הקדם|הקדימי|ערוך|ערכי).{0,160}(?:אירוע|פגישה|מועד)|(?:אירוע|פגישה|מועד).{0,160}(?:לעדכן|לשנות|להזיז|לדחות|להקדים|לערוך)/u,
  calendarCancel: /(?:בטל|בטלי|מחק|מחקי|הסר|הסירי).{0,160}(?:אירוע|פגישה|מועד)|(?:אירוע|פגישה|מועד).{0,160}(?:לבטל|למחוק|להסיר)/u,
  contacts: /איש קשר|אנשי קשר|טלפון|דוא[״"]?ל|מייל|כתובת/u,
  contactCreate: /(?:צור|צרי|הוסף|הוסיפי|שמור|שמרי).{0,120}(?:איש קשר|אנשי קשר)|(?:איש קשר).{0,120}(?:ליצור|להוסיף|לשמור)/u,
  institutionalContactCreate: /(?:צור|צרי|הוסף|הוסיפי|שמור|שמרי).{0,160}(?:איש קשר).{0,80}(?:מוסדי|בית[־ -]?ספרי)|(?:איש קשר).{0,80}(?:מוסדי|בית[־ -]?ספרי).{0,160}(?:ליצור|להוסיף|לשמור)/u,
  initiatives: /תכנית|תכניות|תוכנית|תוכניות|יוזמה|מיזם|אבן דרך/u,
  personalFile: /תיק אישי|הסמכה|הסמכות|ניסיון|מיומנות|המלצה/u,
  cv: /קורות (?:ה)?חיים|קו[״"]ח/u,
  outcomes: /זכאות|תעודה|תוצאות|יעד לימודי/u,
  communications: /מעקב|מייל|דוא[״"]?ל שנשלח|טיוטת הודעה/u,
  directMessages: /הודעה פרטית|הודעות פרטיות|שיחה עם|שיחות עם|צ[׳']אט|כתב לי|כתבה לי|שלח לי|שלחה לי/u,
  announcements: /הכרזה|הכרזות|הודעה בית[־ -]?ספרית|הודעות כלליות|עדכון בית[־ -]?ספרי/u,
  notifications: /התראה|התראות|לא נקרא|לא נקראו/u,
  categories: /קטגוריה|קטגוריות/u,
  support: /פניית (?:ה)?תמיכה|פניות (?:ה)?תמיכה|קריאת שירות|תקלה שדיווחתי|פנייה שפתחתי/u,
  collectiveBrain: /מוח משותף|שאלה לצוות|שאלות לצוות|תשובות הצוות|איסוף תשובות/u,
  dataMapping: /מיפוי נתונים|טבלת מיפוי|גיליון מיפוי/u,
  academic: /שנת לימודים|שנה לימודית|מגמ(?:ה|ת|ות)|מסלול/u,
  studentHistory: /היסטוריית תלמיד|היסטוריה של|שינוי כיתה|מעבר כיתה|שיבוץ קודם|הערה|הערות/u,
  studentSensitive: /מספר זהות|תעודת זהות|פרטי זיהוי|טלפון[^\n]{0,80}תלמיד|טלפון[^\n]{0,80}הורה/u,
  studentTransfer: /(?:העבר|העביר|שבץ|שבצי|שנה|שני).{0,120}(?:כיתה|לכיתה|שיבוץ)|(?:מעבר|העברה|שינוי שיבוץ).{0,120}(?:כיתה|תלמיד)/u,
  studentTrackAction: /(?:הוסף|הוסיפי|שייך|שייכי|העבר|העביר|הסר|הסירי).{0,120}(?:מגמ(?:ה|ת|ות)|מסלול)|(?:מגמ(?:ה|ת|ות)|מסלול).{0,120}(?:להוסיף|לשייך|להעביר|להסיר)/u,
  studentNoteAction: /(?:הוסף|הוסיפי|כתוב|כתבי|רשום|רשמי|צור|צרי|שמור|שמרי).{0,120}(?:הערה|תיעוד)|(?:הערה|תיעוד).{0,120}(?:להוסיף|לכתוב|לרשום|ליצור|לשמור)/u,
  roleAssignment: /(?:תן|תני|הקצה|הקצי|שייך|שייכי|הוסף|הוסיפי|הסר|הסירי|בטל|בטלי).{0,120}(?:תפקיד|הרשאה|גישה)|(?:תפקיד|הרשאה|גישה).{0,120}(?:לתת|להקצות|לשייך|להוסיף|להסיר|לבטל)/u,
  permissionAction: /(?:תן|תני|אפשר|אפשרי|הענק|העניקי|הוסף|הוסיפי|הסר|הסירי|בטל|בטלי|חסום|חסמי).{0,140}(?:הרשא(?:ה|ת|ות)|גיש(?:ה|ת)|צפיי(?:ה|ת)|עריכ(?:ה|ת)|ניהול|יציר(?:ה|ת))|(?:הרשא(?:ה|ת|ות)|גיש(?:ה|ת)|צפיי(?:ה|ת)|עריכ(?:ה|ת)|ניהול|יציר(?:ה|ת)).{0,140}(?:לתת|לאפשר|להעניק|להוסיף|להסיר|לבטל|לחסום)/u,
  resourcePermissionAction: /(?:(?:תן|תני|אפשר|אפשרי|הענק|העניקי|הסר|הסירי|בטל|בטלי|חסום|חסמי|מנע|מנעי).{0,180}(?:קובץ|מסמך|תיקי(?:יה|יה|ות))|(?:קובץ|מסמך|תיקי(?:יה|יה|ות)).{0,180}(?:גישה|הרשא(?:ה|ת)|צפיי(?:ה|ת)|עריכ(?:ה|ת)|ניהול|חסום|חסמי|מנע|מנעי))/u,
  teamMembershipAction: /(?:הוסף|הוסיפי|צרף|צרפי|שייך|שייכי|הסר|הסירי|הוצא|הוציאי).{0,120}(?:לצוות|מהצוות|צוות)|(?:צוות).{0,120}(?:להוסיף|לצרף|לשייך|להסיר|להוציא)/u,
  teamManagerAction: /(?:מנה|מני|הפוך|הפכי|קבע|קבעי|הסר|הסירי).{0,140}(?:מנהל|מנהלת|ניהול).{0,80}(?:צוות)|(?:מנהל|מנהלת|ניהול).{0,100}(?:צוות).{0,120}(?:למנות|להפוך|לקבוע|להסיר)/u,
  teamCreate: /(?:צור|צרי|פתח|פתחי|הקם|הקימי).{0,120}(?:צוות)|(?:צוות).{0,120}(?:ליצור|לפתוח|להקים)/u,
  managerialAudit: /יומן פעילות|יומן מערכת|לוג פעילות|לוגים|היסטוריית כניסות|כניסות למערכת|מי נכנס|פעולות מערכת/u,
});

function requested(question, kind) {
  return INTENTS[kind].test(question);
}

function managerSubject(context) {
  return ['principal', 'institution_manager'].includes(context.subject?.systemRole);
}

function sheetSearchText(item, question) {
  let rows = [];
  try { rows = JSON.parse(item.rowsJson || '[]'); } catch { rows = Array.isArray(item.rows) ? item.rows : []; }
  const columns = Array.isArray(item.columns) ? item.columns : [];
  const value = [columns.join(' | '), ...rows.slice(0, 10_000).map(row => (Array.isArray(row) ? row : []).join(' | '))].join('\n');
  return selectRelevantText(value, question);
}

async function schoolUsers(schoolId) {
  const [modern, legacy] = await Promise.all([
    adminDb.collection('users').where('schoolIds', 'array-contains', schoolId).limit(1000).get().catch(() => null),
    adminDb.collection('users').where('schoolId', '==', schoolId).limit(1000).get().catch(() => null),
  ]);
  const merged = new Map();
  [modern, legacy].filter(Boolean).forEach(snapshot => snapshot.docs.forEach(item => merged.set(item.id, { id: item.id, ...item.data() })));
  return [...merged.values()];
}

function publicGuide(question) {
  const guides = [
    { id: 'dashboard', match: /דשבורד|מסך ראשי|עמוד ראשי/u, label: 'דשבורד', route: '/', text: 'הדשבורד מרכז משימות דחופות, אירועים ומידע זמין. לחיצה על כרטיס פותחת את האזור המתאים.' },
    { id: 'students', match: /תלמיד|כיתה|מגמה|תיק אישי|קורות חיים|ציון/u, label: 'ניהול תלמידים', route: '/students', text: 'במסך תלמידים מחפשים תלמיד, פותחים את הכרטיס שלו ובוחרים בלשונית המתאימה: פרטים, ציונים, נוכחות, תיק אישי או קורות חיים. מוצגים רק אזורים מורשים.' },
    { id: 'tasks', match: /משימה|מטלה|אחראי/u, label: 'ניהול משימות', route: '/tasks', text: 'במסך משימות יוצרים משימה ידנית ועורכים אחראים, תאריכים, שלבים וקבצים. ליצירה בעזרת הסוכן עוברים לזוקי ובוחרים “יצירת משימה”; הטיוטה נפתחת לעריכה לפני שמירה.' },
    { id: 'files', match: /קובץ|מסמך|תיקייה|גיליון/u, label: 'ניהול קבצים', route: '/files', text: 'במסך קבצים פותחים תיקייה ואז קובץ. בעלי הרשאה יכולים להעלות קובץ או ליצור מסמך וגיליון פנימיים; שמירה וייצוא זמינים מתוך עורך הקובץ.' },
    { id: 'attendance', match: /נוכחות|חיסור|איחור/u, label: 'ניהול נוכחות', route: '/files', text: 'גיליונות נוכחות נמצאים במסך קבצים. פותחים את גיליון הכיתה, בוחרים תאריך ומעדכנים סטטוס רק אם קיימת הרשאת עריכת נוכחות.' },
    { id: 'calendar', match: /לוח|אירוע|תאריך|מועד/u, label: 'לוח שנה', route: '/calendar', text: 'במסך לוח שנה רואים אירועים ומועדים. בעלי הרשאת עריכה יכולים ליצור או לשנות אירוע; קטגוריות מנוהלות במסך קטגוריות.' },
    { id: 'holidays', match: /חופשה|חג|יום חסום/u, label: 'חופשות וחגים', route: '/holidays', text: 'במסך חופשות וחגים רואים את הימים הרשמיים והחריגים. שינוי או חסימת יום דורשים הרשאה מתאימה.' },
    { id: 'staff', match: /סגל|מורה|עובד|איש צוות/u, label: 'סגל וקהילה', route: '/staff', text: 'במסך סגל וקהילה מחפשים איש צוות, רואים את תפקידיו ומנהלים שיוך והרשאות בהתאם לסמכות המשתמש.' },
    { id: 'permissions', match: /הרשאה|גישה|תפקיד/u, label: 'תפקידים והרשאות', route: '/staff', text: 'מנהל מוסד מגדיר תפקידים והיקפי גישה במסך סגל וקהילה. זוקי יכול להקצות או להסיר תפקיד קיים מאיש צוות רק לאחר תצוגה מקדימה, אישור מפורש ובדיקת סמכות מחודשת.' },
    { id: 'teams', match: /צוות|צוותים/u, label: 'ניהול צוותים', route: '/teams', text: 'במסך צוותים יוצרים צוות, מגדירים מנהלים וחברים ומעדכנים תחומי אחריות. הפעולות זמינות לפי הרשאת ניהול צוותים.' },
    { id: 'contacts', match: /איש קשר|אנשי קשר|טלפון|מייל/u, label: 'אנשי קשר', route: '/contacts', text: 'במסך אנשי קשר מוסיפים איש קשר פרטי או מוסדי, מחפשים לפי שם ופותחים את היסטוריית המעקב המורשית.' },
    { id: 'messages', match: /הודעה|שיחה|צ[׳']אט/u, label: 'הודעות', route: '/messages', text: 'במסך הודעות בוחרים שיחה קיימת או פותחים שיחה עם איש צוות. רק משתתפי השיחה יכולים לקרוא את תוכנה.' },
    { id: 'brain', match: /מוח משותף|שאלה לצוות|איסוף תשובות/u, label: 'מוח משותף', route: '/collective-brain', text: 'במוח המשותף פותחים שאלה לצוות, מגדירים קהל ומספר תשובות ואוספים תובנות. הרשאות ניהול קובעות מי יכול לפרסם או למתן.' },
    { id: 'forum', match: /פורום|דיון בין בתי ספר/u, label: 'פורום בתי הספר', route: '/forum', text: 'בפורום אפשר לקרוא דיונים ולפרסם לפי חברות והרשאות הפורום. זהו אזור נפרד מהמידע הפנימי של בית הספר.' },
    { id: 'support', match: /תמיכה|תקלה|בעיה באפליקציה/u, label: 'תמיכה', route: '/support', text: 'במסך תמיכה מתארים את הבעיה, מצרפים קובץ במידת הצורך ושולחים פנייה. ניתן לעקוב אחר מצב הפנייה באותו מסך.' },
    { id: 'settings', match: /הגדרות|חשבון|סיסמה/u, label: 'הגדרות', route: '/settings', text: 'במסך הגדרות רואים את פרטי החשבון והמוסד ומשנים אפשרויות זמינות. הגדרות מוסדיות מוגבלות למנהלים.' },
  ];
  return guides.filter(item => item.match.test(question)).map(item => source('guide', item, item.label, item.route, { text: item.text }));
}

function audienceAllows(entry, actor, context) {
  if (entry.validUntil && Date.parse(`${entry.validUntil}T23:59:59.999Z`) < Date.now()) return false;
  const audience = entry.audience || { type: 'school' };
  if (audience.type === 'school') return true;
  if (audience.type === 'roles') return list(audience.roleIds).some(id => context.subject.roleIds.includes(id));
  if (audience.type === 'users') return list(audience.userIds).includes(actor.uid);
  return false;
}

async function filteredBrain({ actor, schoolId, permissionContext }) {
  const snapshot = await adminDb.doc(`schools/${schoolId}/settings/zoki_brain`).get().catch(() => null);
  const data = snapshot?.data() || {};
  const entries = (Array.isArray(data.entries) ? data.entries : []).slice(0, 100)
    .filter(entry => entry.status === 'published' && audienceAllows(entry, actor, permissionContext))
    .map((entry, index) => ({ id: entry.id || `entry_${index}`, ...entry }));
  return { data, entries };
}

export async function loadZokiTaskGuidance({ actor, schoolId }) {
  const permissionContext = await buildPermissionContext({ userId: actor.uid, schoolId });
  const { entries } = await filteredBrain({ actor, schoolId, permissionContext });
  return {
    rules: entries.slice(0, 20).map(entry => {
      const title = clean(entry.title, 120);
      const body = clean(entry.body, 1200);
      return [title, body].filter(Boolean).join(': ');
    }).filter(Boolean),
  };
}

export async function loadZokiContext({ actor, schoolId, question, imageTextExtractor }) {
  const permissionContext = await buildPermissionContext({ userId: actor.uid, schoolId });
  const roleAuthority = await resolveActorRoleAuthority(actor, schoolId);
  const canAssignRoles = roleAuthority.unrestricted
    || roleAuthority.permissions.has('roles.assign')
    || roleAuthority.permissions.has('staff.assignRoles');
  const canManageDirectPermissions = roleAuthority.unrestricted;
  const canManageResourcePermissions = managerSubject(permissionContext)
    || decision(permissionContext, 'files.managePermissions').allowed;
  const canProposeResourcePermissions = canManageResourcePermissions
    && decision(permissionContext, 'files.view').allowed;
  const sources = publicGuide(question);
  const denied = [];
  const addDenied = (kind, capability) => { if (requested(question, kind)) denied.push({ kind, capability }); };

  const { data: brainData, entries: brainEntries } = await filteredBrain({ actor, schoolId, permissionContext });
  relevant(brainEntries, question, 8).forEach(entry => sources.push(source(
    'school_knowledge', entry, clean(entry.title, 120) || 'ידע בית־ספרי', '/zoki',
    { title: clean(entry.title, 120), body: clean(entry.body, 1600), category: clean(entry.category, 80), validUntil: clean(entry.validUntil, 20) },
  )));

  if (requested(question, 'staff') || requested(question, 'roleAssignment')
    || requested(question, 'permissionAction') || requested(question, 'resourcePermissionAction')
    || requested(question, 'taskAssignmentAction')) {
    const permission = decision(permissionContext, 'staff.view');
    if (!permission.allowed) addDenied('staff', 'staff.view');
    else {
      const [staffItems, teams, roles] = await Promise.all([
        schoolUsers(schoolId),
        collectionDocuments([`teams_${schoolId}`, `schools/${schoolId}/teams`]),
        collectionDocuments([`schools/${schoolId}/roleDefinitions`, `roles_${schoolId}`]),
      ]);
      const teamNames = new Map(teams.map(item => [item.id, clean(item.name || item.title, 120)]));
      const roleNames = new Map(roles.map(item => [item.id, clean(item.name || item.title, 120)]));
      const canInspectPermissions = managerSubject(permissionContext) || canAssignRoles;
      const staff = staffItems.filter(item => !['disabled', 'pending', 'deleting'].includes(item.accountStatus)).map(item => {
        const teamIds = list(item.teamIdsBySchool?.[schoolId] || item.teamIds);
        const roleIds = list(item.customRoleAssignments?.[schoolId] || item.customRoleIds);
        return {
          id: item.id,
          name: clean(item.fullName || item.displayName || item.name, 120),
          email: clean(item.email, 320), phone: clean(item.phone, 40), jobTitle: clean(item.jobTitle || item.roleName, 120),
          systemRole: clean(item.rolesBySchool?.[schoolId] || item.role, 60),
          teamNames: teamIds.map(id => teamNames.get(id)).filter(Boolean),
          roleNames: roleIds.map(id => roleNames.get(id)).filter(Boolean),
          ...(canInspectPermissions ? { roleIds } : {}),
          classIds: list(item.classIdsBySchool?.[schoolId] || item.classIds),
          accountStatus: clean(item.accountStatus, 40),
          ...(canInspectPermissions ? { enabledPermissions: Object.entries(item.permissions || {}).filter(([, enabled]) => enabled === true).map(([key]) => key).slice(0, 200) } : {}),
        };
      });
      relevant(staff, question, 15)
        .forEach(item => sources.push(source('staff', item, item.name || 'איש צוות', '/staff', item)));
    }
  }

  if (requested(question, 'permissionAction')) {
    if (!canManageDirectPermissions) addDenied('permissionAction', 'staff.edit');
    else {
      relevant(DIRECT_PERMISSION_DEFINITIONS.map(item => ({
        id: item.key,
        key: item.key,
        keys: item.keys,
        name: item.label,
        group: item.group,
      })), question, 15).forEach(item => sources.push(source(
        'permission', item, item.name || 'הרשאה', '/staff', item,
      )));
    }
  }

  if (requested(question, 'organization')) {
    const teamsPermission = decision(permissionContext, 'teams_view');
    const teamsEditPermission = decision(permissionContext, 'teams_edit');
    const rolesPermission = decision(permissionContext, 'roles.view');
    const canManageAllTeams = managerSubject(permissionContext) || teamsEditPermission.allowed;
    if (!teamsPermission.allowed && !rolesPermission.allowed && !requested(question, 'teamMembershipAction') && !requested(question, 'teamManagerAction') && !requested(question, 'teamCreate')) addDenied('organization', 'teams_view');
    if (requested(question, 'teamCreate') && !canManageAllTeams) addDenied('teamCreate', 'teams_edit');
    if (teamsPermission.allowed || requested(question, 'teamMembershipAction') || requested(question, 'teamManagerAction') || requested(question, 'teamCreate')) {
      const teams = await collectionDocuments([`teams_${schoolId}`, `schools/${schoolId}/teams`]);
      const visibleTeams = teamsPermission.allowed || canManageAllTeams
        ? teams : teams.filter(item => list(item.managerIds || item.leaderIds).includes(actor.uid));
      relevant(visibleTeams.map(item => ({
        id: item.id, name: clean(item.name || item.title, 120), description: clean(item.description || item.responsibility, 600),
        memberIds: list(item.memberIds), managerIds: list(item.managerIds || item.leaderIds),
        canManage: canManageAllTeams || list(item.managerIds || item.leaderIds).includes(actor.uid),
      })), question, 12)
        .forEach(item => sources.push(source('team', item, item.name || 'צוות', '/teams', item)));
      if (requested(question, 'teamMembershipAction') && !canManageAllTeams
        && !visibleTeams.some(item => list(item.managerIds || item.leaderIds).includes(actor.uid))) {
        addDenied('teamMembershipAction', 'teams_edit');
      }
      if (requested(question, 'teamManagerAction') && !canManageAllTeams
        && !visibleTeams.some(item => list(item.managerIds || item.leaderIds).includes(actor.uid))) {
        addDenied('teamManagerAction', 'teams_edit');
      }
      if (requested(question, 'teamCreate') && canManageAllTeams) {
        sources.push(source('team_config', { id: 'team_create' }, 'הגדרות יצירת צוות', '/teams', {
          existingNames: teams.map(item => clean(item.name || item.title, 120)).filter(Boolean).slice(0, 300),
        }));
      }
    }
    if (rolesPermission.allowed || (requested(question, 'roleAssignment') && canAssignRoles)) {
      const roles = await collectionDocuments([`schools/${schoolId}/roleDefinitions`, `roles_${schoolId}`]);
      relevant(roles.filter(item => item.status !== 'archived' && item.protected !== true).map(item => ({
        id: item.id, name: clean(item.name || item.title, 120), description: clean(item.description, 600),
        responsibilityAreas: list(item.responsibilityAreas), commonTaskTypes: list(item.commonTaskTypes),
        permissions: canAssignRoles
          ? Object.entries(item.permissions || {}).filter(([, enabled]) => enabled === true).map(([key]) => key).slice(0, 100)
          : [],
        accessScope: item.accessScope || item.scopes || { type: 'school', classIds: [] },
        delegable: item.delegable === true,
      })), question, 12)
        .forEach(item => sources.push(source('role', item, item.name || 'תפקיד', '/staff', item)));
    }
  }

  const classesPermission = decision(permissionContext, 'classes.view');
  const studentsPermission = decision(permissionContext, 'students.view');
  const classesRaw = requested(question, 'classes') || requested(question, 'students') || requested(question, 'grades') || requested(question, 'attendance') || requested(question, 'studentHistory') || requested(question, 'studentSensitive') || requested(question, 'studentTransfer') || requested(question, 'studentTrackAction') || requested(question, 'studentNoteAction')
    || requested(question, 'personalFile') || requested(question, 'cv') || requested(question, 'outcomes')
    ? await collectionDocuments([`schools/${schoolId}/classes`, `classes_${schoolId}`]) : [];
  const taughtClassIds = new Set(classesRaw.filter(item => item.teacherId === actor.uid).map(item => item.id));
  const allowedClasses = classesRaw.filter(item => decision(permissionContext, 'classes.view', { classId: item.id }).allowed);
  if (requested(question, 'classes') || requested(question, 'studentTransfer')) {
    if (!classesPermission.allowed) addDenied('classes', 'classes.view');
    relevant(allowedClasses.map(item => ({
      id: item.id, name: clean(item.name, 120), gradeLevel: clean(item.gradeLevel || item.grade, 40),
      academicYearId: clean(item.academicYearId, 128), academicYear: clean(item.academicYear || item.academicYearLabel, 80),
      teacherId: clean(item.teacherId, 128), status: clean(item.status, 30),
    })), question, 15)
      .forEach(item => sources.push(source('class', item, item.name || 'כיתה', '/students', item)));
  }

  let matchedStudents = [];
  if (requested(question, 'students') || requested(question, 'grades') || requested(question, 'attendance') || requested(question, 'studentHistory') || requested(question, 'studentSensitive') || requested(question, 'studentTransfer') || requested(question, 'studentTrackAction') || requested(question, 'studentNoteAction')
    || requested(question, 'personalFile') || requested(question, 'cv') || requested(question, 'outcomes')) {
    const attendanceStudentAccess = requested(question, 'attendance') && (
      decision(permissionContext, 'attendance.view').allowed
      || decision(permissionContext, 'attendance.edit').allowed
      || decision(permissionContext, 'attendance_edit').allowed
      || taughtClassIds.size > 0
    );
    if (!studentsPermission.allowed && !attendanceStudentAccess) addDenied('students', 'students.view');
    else {
      const students = await collectionDocuments([`schools/${schoolId}/students`, `students_${schoolId}`], 2500);
      const basicMatches = relevant(students.filter(item => (
        decision(permissionContext, 'students.view', { classId: item.classId }).allowed
        || (requested(question, 'attendance') && (
          decision(permissionContext, 'attendance.view', { classId: item.classId }).allowed
          || decision(permissionContext, 'attendance.edit', { classId: item.classId }).allowed
          || decision(permissionContext, 'attendance_edit', { classId: item.classId }).allowed
          || taughtClassIds.has(item.classId)
        ))
      )).map(item => ({
        id: item.id,
        fullName: clean(item.fullName || `${item.firstName || ''} ${item.lastName || ''}`, 120),
        classId: clean(item.classId, 128), className: clean(item.className, 120), gradeLevel: clean(item.gradeLevel, 40),
        trackIds: list(item.trackIds).map(id => clean(id, 128)), programTypes: list(item.programTypes).map(value => clean(value, 80)), status: clean(item.status, 30),
        phone: clean(item.phone, 40), parentPhone: clean(item.parentPhone, 40), legacyIdNumber: clean(item.idNumber, 40),
      })), question, 12);
      if (requested(question, 'studentSensitive')
        && basicMatches.some(item => !decision(permissionContext, 'students.viewSensitiveFields', { classId: item.classId }).allowed)) {
        addDenied('studentSensitive', 'students.viewSensitiveFields');
      }
      matchedStudents = await Promise.all(basicMatches.map(async item => {
        const sensitiveAllowed = decision(permissionContext, 'students.viewSensitiveFields', { classId: item.classId }).allowed;
        if (!sensitiveAllowed) {
          const publicFields = { ...item };
          delete publicFields.phone;
          delete publicFields.parentPhone;
          delete publicFields.legacyIdNumber;
          return publicFields;
        }
        const identity = await adminDb.doc(`schools/${schoolId}/students/${item.id}/sensitive/identity`).get().catch(() => null);
        return {
          ...item,
          idNumber: clean(identity?.data()?.idNumber || item.legacyIdNumber, 40),
          legacyIdNumber: undefined,
        };
      }));
      if (requested(question, 'students') || requested(question, 'studentTransfer') || requested(question, 'studentTrackAction') || requested(question, 'studentNoteAction')) matchedStudents.forEach(item => sources.push(source('student', item, item.fullName || 'תלמיד', `/students?student=${encodeURIComponent(item.id)}`, item)));
    }
  }

  if (requested(question, 'studentTransfer')
    && !decision(permissionContext, 'students.transferClass').allowed
    && !decision(permissionContext, 'students_transfer_class').allowed) {
    addDenied('studentTransfer', 'students.transferClass');
  }

  if (requested(question, 'studentTrackAction')
    && !decision(permissionContext, 'students.managePrograms').allowed
    && !decision(permissionContext, 'students_manage_programs').allowed) {
    addDenied('studentTrackAction', 'students.managePrograms');
  }

  if (requested(question, 'studentNoteAction')
    && !decision(permissionContext, 'students.addNotes').allowed
    && !decision(permissionContext, 'students_add_notes').allowed) {
    addDenied('studentNoteAction', 'students.addNotes');
  }

  if (requested(question, 'studentHistory') && studentsPermission.allowed) {
    const notesCapability = decision(permissionContext, 'students.viewSensitiveNotes');
    for (const student of matchedStudents.slice(0, 6)) {
      const notesAllowed = decision(permissionContext, 'students.viewSensitiveNotes', { classId: student.classId }).allowed;
      const [historySnapshot, enrollmentSnapshot, notesSnapshot] = await Promise.all([
        adminDb.collection(`schools/${schoolId}/students/${student.id}/history`).orderBy('createdAt', 'desc').limit(30).get().catch(() => null),
        adminDb.collection(`schools/${schoolId}/studentEnrollments`).where('studentId', '==', student.id).limit(30).get().catch(() => null),
        notesAllowed
          ? adminDb.collection(`schools/${schoolId}/students/${student.id}/notes`).orderBy('createdAt', 'desc').limit(30).get().catch(() => null)
          : Promise.resolve(null),
      ]);
      relevant((historySnapshot?.docs || []).map(item => {
        const data = item.data();
        return {
          id: `${student.id}_${item.id}`, studentName: student.fullName, type: clean(data.type || data.action, 80),
          summary: clean(data.summary || data.description || data.reason, 1000), effectiveDate: clean(data.effectiveDate || data.date, 30),
          fromClassName: clean(data.fromClassName, 120), toClassName: clean(data.toClassName, 120), createdAt: data.createdAt || null,
        };
      }), question, 8).forEach(item => sources.push(source('student_history', item, `היסטוריה — ${student.fullName}`, `/students?student=${encodeURIComponent(student.id)}`, item)));
      relevant((enrollmentSnapshot?.docs || []).map(item => {
        const data = item.data();
        return {
          id: `${student.id}_${item.id}`, studentName: student.fullName, academicYear: clean(data.academicYear || data.academicYearLabel, 80),
          classId: clean(data.classId, 128), className: clean(data.className, 120), gradeLevel: clean(data.gradeLevel, 40),
          trackIds: list(data.trackIds), programTypes: list(data.programTypes), status: clean(data.status, 40),
          startDate: clean(data.startDate, 30), endDate: clean(data.endDate, 30),
        };
      }), question, 8).forEach(item => sources.push(source('student_enrollment', item, `שיבוץ — ${student.fullName}`, `/students?student=${encodeURIComponent(student.id)}`, item)));
      relevant((notesSnapshot?.docs || []).map(item => {
        const data = item.data();
        return {
          id: `${student.id}_${item.id}`, studentName: student.fullName, content: clean(data.content, 2000),
          visibility: clean(data.visibility, 40), authorName: clean(data.authorName || data.createdByName, 120), createdAt: data.createdAt || null,
        };
      }), question, 8).forEach(item => sources.push(source('student_note', item, `הערה — ${student.fullName}`, `/students?student=${encodeURIComponent(student.id)}`, item)));
    }
    if (!notesCapability.allowed && /הערה|הערות/u.test(question)) addDenied('studentHistory', 'students.viewSensitiveNotes');
  }

  if (requested(question, 'files')) {
    const permission = decision(permissionContext, 'files.view');
    const canDeleteFiles = decision(permissionContext, 'files.delete').allowed;
    const canCreateResources = decision(permissionContext, 'files.create').allowed;
    if (requested(question, 'resourcePermissionAction') && !canProposeResourcePermissions) {
      addDenied('resourcePermissionAction', 'files.managePermissions');
    }
    if (!permission.allowed) addDenied('files', 'files.view');
    else {
      const files = relevant(await collectionDocuments([`schools/${schoolId}/files`, `files_${schoolId}`], 1500), question, 12);
      const visibleFiles = [];
      const fileContexts = new Map();
      for (const item of files) {
        const fileContext = await withResourcePermissionContext(permissionContext, { resourceType: 'file', resourceId: item.id, parentIds: [item.folderId].filter(Boolean) });
        const filePermission = resourceDecision(fileContext, 'files.view', { resourceType: 'file', resourceId: item.id, classId: item.classId });
        if (!filePermission.allowed) continue;
        fileContexts.set(item.id, fileContext);
        visibleFiles.push(item);
      }
      const allFolders = await collectionDocuments([`schools/${schoolId}/folders`, `folders_${schoolId}`], 1500);
      const requestedFolderIds = new Set(visibleFiles.map(item => item.folderId).filter(Boolean));
      const folderCandidatesById = new Map(allFolders.filter(item => requestedFolderIds.has(item.id)).map(item => [item.id, item]));
      if (/תיקי/u.test(question) || requested(question, 'fileCreate') || requested(question, 'fileMove')) {
        relevant(allFolders, question, 12).forEach(item => folderCandidatesById.set(item.id, item));
      }
      const folderCandidates = [...folderCandidatesById.values()];
      const visibleFolders = [];
      const folderContexts = new Map();
      for (const folder of folderCandidates) {
        const folderContext = await withResourcePermissionContext(permissionContext, { resourceType: 'folder', resourceId: folder.id });
        if (resourceDecision(folderContext, 'files.view', { resourceType: 'folder', resourceId: folder.id, classId: folder.classId }).allowed) {
          folderContexts.set(folder.id, folderContext);
          visibleFolders.push(folder);
        }
      }
      const folderNames = new Map(visibleFolders.map(folder => [folder.id, clean(folder.name || folder.title, 160)]));
      const fileTexts = await Promise.all(visibleFiles.slice(0, 8).map((item, index) => (
        item.trashedAt ? Promise.resolve('') : extractAuthorizedFileText({
          file: item, schoolId, question,
          // OCR is intentionally bounded: at most three already-authorized files
          // per question may be sent to the document-reading model.
          imageTextExtractor: index < 3 ? imageTextExtractor : undefined,
        })
      )));
      visibleFiles.forEach((item, index) => {
        const itemContext = fileContexts.get(item.id);
        const canRename = resourceDecision(itemContext, 'files.edit', {
          resourceType: 'file', resourceId: item.id, classId: item.classId,
        }).allowed;
        sources.push(source('file', item, clean(item.name, 160) || 'קובץ', `/files?file=${encodeURIComponent(item.id)}`, {
          id: item.id, resourceType: 'file', folderId: clean(item.folderId, 128), parentIds: [item.folderId].filter(Boolean),
          name: clean(item.name, 160), fileType: clean(item.fileType || item.type, 100), folderName: folderNames.get(item.folderId) || '',
          className: clean(item.className, 120), description: clean(item.description, 500),
          text: fileTexts[index] || '', updatedAt: item.updatedAt || item.lastModified || null,
          trashed: Boolean(item.trashedAt), canRename: canRename && !item.trashedAt,
          canTrash: canDeleteFiles && !item.trashedAt,
          canRestore: canDeleteFiles && Boolean(item.trashedAt), canMove: canRename && !item.trashedAt,
          ...(canProposeResourcePermissions ? { directUserAccess: directUserAccess(fileContexts.get(item.id)?.resourceAcls) } : {}),
        }));
      });
      visibleFolders.forEach(folder => {
        const folderContext = folderContexts.get(folder.id);
        const canRename = resourceDecision(folderContext, 'files.edit', {
          resourceType: 'folder', resourceId: folder.id, classId: folder.classId,
        }).allowed;
        sources.push(source('folder', folder, clean(folder.name || folder.title, 160) || 'תיקייה', `/files?folder=${encodeURIComponent(folder.id)}`, {
          id: folder.id, resourceType: 'folder', parentIds: [],
          name: clean(folder.name || folder.title, 160), className: clean(folder.className, 120), visibility: clean(folder.visibility, 60),
          trashed: Boolean(folder.trashedAt), canRename: canRename && !folder.trashedAt,
          canTrash: canDeleteFiles && !folder.trashedAt,
          canRestore: canDeleteFiles && Boolean(folder.trashedAt),
          canMoveInto: canRename && !folder.trashedAt,
          canCreateWithin: canCreateResources && !folder.trashedAt,
          ...(canProposeResourcePermissions ? { directUserAccess: directUserAccess(folderContext?.resourceAcls) } : {}),
        }));
      });
      const visibleFileIds = new Set(visibleFiles.map(item => item.id));
      const history = await collectionDocuments([`schools/${schoolId}/fileHistory`, `file_history_${schoolId}`], 200);
      relevant(history.filter(item => visibleFileIds.has(item.fileId)).map(item => ({
        id: item.id, fileId: clean(item.fileId, 128), fileName: clean(item.fileName, 160), editorName: clean(item.userName, 120),
        timestamp: item.timestamp || item.createdAt || null, summary: clean(item.summary, 300),
        changes: list(item.changes).map(change => ({ cell: clean(change.cell, 20), oldValue: clean(change.oldValue, 120), newValue: clean(change.newValue, 120) })),
      })), question, 6).forEach(item => sources.push(source('file_history', item, `היסטוריית ${item.fileName || 'קובץ'}`, `/files?file=${encodeURIComponent(item.fileId)}`, item)));
      if (requested(question, 'fileCreate') && canCreateResources) {
        sources.push(source('file_create_config', { id: 'resource_create' }, 'אפשרויות יצירת קבצים ותיקיות', '/files', {
          kinds: ['folder', 'document', 'spreadsheet'],
          folderVisibilities: ['all', 'principal_only'],
          canCreateFolder: true,
        }));
      }
      if (requested(question, 'fileCreate') && !canCreateResources) addDenied('fileCreate', 'files.create');
    }
  }

  if (requested(question, 'calendar')) {
    const permission = decision(permissionContext, 'calendar.view');
    const createPermission = decision(permissionContext, 'calendar.create');
    const editPermission = decision(permissionContext, 'calendar.edit');
    const legacyEditPermission = decision(permissionContext, 'calendar_edit');
    const canCreateCalendarEvent = createPermission.allowed || editPermission.allowed || legacyEditPermission.allowed;
    const canEditCalendarEvent = editPermission.allowed || legacyEditPermission.allowed;
    if (requested(question, 'calendarCreate') && !canCreateCalendarEvent) addDenied('calendarCreate', 'calendar.create');
    if ((requested(question, 'calendarUpdate') || requested(question, 'calendarCancel')) && !canEditCalendarEvent) addDenied('calendarEdit', 'calendar.edit');
    if (!permission.allowed && !canCreateCalendarEvent) addDenied('calendar', 'calendar.view');
    if (permission.allowed) {
      const items = await collectionDocuments([
        `schools/${schoolId}/events`, `events_${schoolId}`,
        `schools/${schoolId}/holidays`, `holidays_${schoolId}`,
      ]);
      relevant(items.map(item => ({ id: item.id, title: clean(item.title || item.name, 160), startDate: clean(item.startDate || item.date, 30), endDate: clean(item.endDate, 30), description: clean(item.description, 700), classId: clean(item.classId, 128), raw: item })), question, 15)
        .filter(item => decision(permissionContext, 'calendar.view', { classId: item.classId }).allowed)
        .forEach(item => {
          const normalized = normalizeCalendarEvent(item.raw, item.id);
          const actionable = !item.endDate && canEditCalendarEvent;
          sources.push(source(actionable ? 'calendar_event' : 'calendar', item, item.title || 'אירוע', '/calendar', {
            ...normalized, endDate: item.endDate, classId: item.classId,
            canEdit: actionable, version: actionable ? calendarEventVersion(item.raw, item.id) : '',
          }));
        });
    }
    if ((requested(question, 'calendarCreate') && canCreateCalendarEvent)
      || (requested(question, 'calendarUpdate') && canEditCalendarEvent)) {
      const [categories, teams] = await Promise.all([
        collectionDocuments([`schools/${schoolId}/categories`, `categories_${schoolId}`], 100),
        collectionDocuments([`teams_${schoolId}`, `schools/${schoolId}/teams`], 200),
      ]);
      const categoryNames = [...new Set(categories.map(item => clean(item.name || item.title, 80)).filter(Boolean))];
      sources.push(source('calendar_config', { id: 'event_create' }, 'הגדרות יצירת אירוע', '/calendar', {
        categories: categoryNames.length ? categoryNames : ['כללי'],
        teams: teams.filter(item => item.status !== 'archived').map(item => ({ id: item.id, name: clean(item.name || item.title, 120) })).filter(item => item.name).slice(0, 100),
        colors: ['#fecdd3', '#fed7aa', '#fef08a', '#bbf7d0', '#99f6e4', '#bae6fd', '#c4b5fd', '#e9d5ff', '#eadfe2', '#ffffff'],
      }));
    }
  }

  if (requested(question, 'contacts') && !requested(question, 'students') && !requested(question, 'studentSensitive')) {
    const viewPermission = decision(permissionContext, 'contacts.view');
    const createPermission = decision(permissionContext, 'contacts.create');
    if (!viewPermission.allowed && !requested(question, 'contactCreate')) addDenied('contacts', 'contacts.view');
    if (!createPermission.allowed) addDenied('institutionalContactCreate', 'contacts.create');
    const [institutional, privateItems] = await Promise.all([
      viewPermission.allowed
        ? collectionDocuments([`schools/${schoolId}/contactDirectory/institutional/items`])
        : Promise.resolve([]),
      collectionDocuments([`users/${actor.uid}/contactDirectory/private/items`]),
    ]);
    if (viewPermission.allowed || privateItems.length) {
      const visibleInstitutional = institutional.filter(item => item.visibility === 'institution'
        || item.createdBy === actor.uid || list(item.ownerStaffIds).includes(actor.uid)
        || decision(permissionContext, 'contacts.viewSharedHistory').allowed);
      relevant([...visibleInstitutional, ...privateItems].filter(item => item.archived !== true).map(item => ({
        id: item.id, scope: clean(item.scope, 30) || (item.ownerId ? 'private' : 'institutional'), fullName: clean(item.fullName, 160), organization: clean(item.organization, 160), jobTitle: clean(item.jobTitle, 120),
        primaryEmail: clean(item.primaryEmail, 320), phone: clean(item.phone, 40), category: clean(item.category, 80), notes: clean(item.notes, 700),
      })), question, 12).forEach(item => sources.push(source('contact', item, item.fullName || 'איש קשר', '/contacts', item)));
    }
    if (requested(question, 'contactCreate')) {
      const canViewStaff = decision(permissionContext, 'staff.view').allowed;
      const staff = createPermission.allowed && canViewStaff ? await schoolUsers(schoolId) : [];
      sources.push(source('contact_config', { id: 'contact_create' }, 'הגדרות יצירת איש קשר', '/contacts', {
        scopes: createPermission.allowed ? ['private', 'institutional'] : ['private'],
        visibilities: ['institution', 'responsible_staff'],
        responsibleStaff: staff.filter(item => item.accountStatus !== 'disabled' && item.status !== 'archived').map(item => ({
          id: item.id, name: clean(item.fullName || item.displayName || item.name, 120),
        })).filter(item => item.name).slice(0, 200),
      }));
    }
  }

  if (requested(question, 'initiatives')) {
    const canView = decision(permissionContext, 'initiatives.view').allowed;
    const canViewAll = decision(permissionContext, 'initiatives.viewAll').allowed;
    if (!canView && !canViewAll) addDenied('initiatives', 'initiatives.view');
    else {
      const initiatives = await collectionDocuments([`schools/${schoolId}/initiatives`]);
      const visible = initiatives.filter(item => canViewAll || item.ownerId === actor.uid || item.createdBy === actor.uid
        || list(item.participantIds || item.memberIds).includes(actor.uid)
        || list(item.teamIds).some(id => permissionContext.subject.teamIds.includes(id)));
      const matching = relevant(visible, question, 10);
      const details = await Promise.all(matching.map(async item => {
        const snapshots = await Promise.all(['milestones', 'updates', 'comments', 'activity'].map(name => (
          adminDb.collection(`schools/${schoolId}/initiatives/${item.id}/${name}`).limit(50).get().catch(() => null)
        )));
        return { item, snapshots };
      }));
      details.forEach(({ item, snapshots }) => {
        const initiative = { id: item.id, title: clean(item.title, 160), summary: clean(item.summary || item.description, 1000), status: clean(item.status, 40), health: clean(item.health, 40), startDate: clean(item.startDate, 20), endDate: clean(item.endDate, 20), ownerId: clean(item.ownerId, 128) };
        sources.push(source('initiative', initiative, initiative.title || 'תכנית', `/tasks?initiative=${encodeURIComponent(item.id)}`, initiative));
        relevant((snapshots[0]?.docs || []).map(entry => {
          const data = entry.data();
          return { id: `${item.id}_${entry.id}`, initiativeTitle: initiative.title, title: clean(data.title, 160), description: clean(data.description || data.requiredOutput, 1000), status: clean(data.status, 40), dueDate: clean(data.dueDate, 30), ownerId: clean(data.ownerId, 128), approverId: clean(data.approverId, 128) };
        }), question, 8).forEach(entry => sources.push(source('initiative_milestone', entry, `${initiative.title} — ${entry.title || 'אבן דרך'}`, `/tasks?initiative=${encodeURIComponent(item.id)}`, entry)));
        relevant((snapshots[1]?.docs || []).map(entry => {
          const data = entry.data();
          return { id: `${item.id}_${entry.id}`, initiativeTitle: initiative.title, type: clean(data.type, 60), content: clean(data.content || data.summary || data.description, 1600), milestoneId: clean(data.milestoneId, 128), createdByName: clean(data.createdByName || data.authorName, 120), createdAt: data.createdAt || null };
        }), question, 8).forEach(entry => sources.push(source('initiative_update', entry, `עדכון — ${initiative.title}`, `/tasks?initiative=${encodeURIComponent(item.id)}`, entry)));
        relevant((snapshots[2]?.docs || []).map(entry => {
          const data = entry.data();
          return { id: `${item.id}_${entry.id}`, initiativeTitle: initiative.title, content: clean(data.content || data.text, 1200), authorName: clean(data.authorName || data.createdByName, 120), createdAt: data.createdAt || null };
        }), question, 6).forEach(entry => sources.push(source('initiative_comment', entry, `תגובה — ${initiative.title}`, `/tasks?initiative=${encodeURIComponent(item.id)}`, entry)));
        relevant((snapshots[3]?.docs || []).map(entry => {
          const data = entry.data();
          return { id: `${item.id}_${entry.id}`, initiativeTitle: initiative.title, action: clean(data.action, 120), details: clean(data.details, 800), actorName: clean(data.actorName, 120), createdAt: data.createdAt || null };
        }), question, 6).forEach(entry => sources.push(source('initiative_activity', entry, `פעילות — ${initiative.title}`, `/tasks?initiative=${encodeURIComponent(item.id)}`, entry)));
      });
      const templates = await collectionDocuments([`schools/${schoolId}/initiativeTemplates`], 150);
      relevant(templates.filter(item => item.status !== 'archived').map(item => ({
        id: item.id, title: clean(item.title, 160), description: clean(item.description, 1000), category: clean(item.category, 80),
        goals: list(item.goals), milestoneTemplates: list(item.milestoneTemplates).map(milestone => ({
          title: clean(milestone?.title, 160), description: clean(milestone?.description, 800), priority: clean(milestone?.priority, 30),
          requiredOutput: clean(milestone?.requiredOutput, 500), requiresEvidence: milestone?.requiresEvidence === true,
        })),
      })), question, 8).forEach(item => sources.push(source('initiative_template', item, item.title || 'תבנית יוזמה', '/tasks?view=initiatives', item)));
    }
  }

  if (requested(question, 'grades')) {
    const permission = decision(permissionContext, 'grades.view');
    const editPermission = decision(permissionContext, 'grades.edit');
    if (requested(question, 'gradeAction') && !editPermission.allowed) addDenied('gradeAction', 'grades.edit');
    if (!permission.allowed) addDenied('grades', 'grades.view');
    else for (const student of matchedStudents.filter(item => decision(permissionContext, 'grades.view', { classId: item.classId }).allowed).slice(0, 5)) {
      const gradebooks = (await collectionDocuments([`schools/${schoolId}/gradebooks`], 100)).filter(item => item.classId === student.classId);
      for (const gradebook of gradebooks.slice(0, 8)) {
        const grade = await adminDb.doc(`schools/${schoolId}/gradebooks/${gradebook.id}/grades/${student.id}`).get().catch(() => null);
        const data = grade?.exists ? grade.data() : {};
        sources.push(source('grade', { id: `${gradebook.id}_${student.id}` }, `ציונים — ${student.fullName}`, `/students?student=${encodeURIComponent(student.id)}`, {
          gradebookId: gradebook.id, studentId: student.id, classId: student.classId,
          studentName: student.fullName, className: clean(gradebook.className, 120), subjects: list(gradebook.subjects), scores: data.scores || {}, calculated: data.calculated || {},
        }));
      }
    }
  }

  if (requested(question, 'attendance')) {
    const permission = decision(permissionContext, 'attendance.view');
    const editPermission = decision(permissionContext, 'attendance.edit');
    const legacyEditPermission = decision(permissionContext, 'attendance_edit');
    if (requested(question, 'attendanceAction') && !editPermission.allowed && !legacyEditPermission.allowed && taughtClassIds.size === 0) {
      addDenied('attendanceAction', 'attendance_edit');
    }
    if (!permission.allowed && !editPermission.allowed && !legacyEditPermission.allowed && taughtClassIds.size === 0) addDenied('attendance', 'attendance.view');
    else {
      const attendanceFiles = (await collectionDocuments([`schools/${schoolId}/files`], 120)).filter(item => item.fileType === 'attendance');
      const exactDate = question.match(/\b\d{4}-\d{2}-\d{2}\b/u)?.[0] || '';
      for (const student of matchedStudents.filter(item => (
        decision(permissionContext, 'attendance.view', { classId: item.classId }).allowed
        || decision(permissionContext, 'attendance.edit', { classId: item.classId }).allowed
        || decision(permissionContext, 'attendance_edit', { classId: item.classId }).allowed
        || taughtClassIds.has(item.classId)
      )).slice(0, 4)) {
        for (const file of attendanceFiles.filter(item => item.classId === student.classId).slice(0, 4)) {
          const [records, legendSnapshot, daySnapshot] = await Promise.all([
            adminDb.collection(`schools/${schoolId}/files/${file.id}/attendanceRecords`).where('studentId', '==', student.id).limit(40).get().catch(() => null),
            adminDb.collection(`schools/${schoolId}/files/${file.id}/attendanceLegend`).limit(30).get().catch(() => null),
            exactDate ? adminDb.doc(`schools/${schoolId}/files/${file.id}/attendanceDays/${exactDate}`).get().catch(() => null) : Promise.resolve(null),
          ]);
          if (!records) continue;
          const items = records.docs.map(doc => ({ dateKey: clean(doc.data().dateKey, 20), primaryStatusId: clean(doc.data().primaryStatusId, 60), actionIds: list(doc.data().actionIds), note: clean(doc.data().note, 300) }));
          const legend = (legendSnapshot?.docs || []).map(item => ({
            id: item.id, label: clean(item.data().label, 80), shortCode: clean(item.data().shortCode, 4),
            type: clean(item.data().type, 30), attendanceEffect: clean(item.data().attendanceEffect, 40), active: item.data().active !== false,
          })).filter(item => item.active && item.type === 'status');
          const day = daySnapshot?.exists ? {
            dateKey: clean(daySnapshot.data().dateKey, 20), blocked: daySnapshot.data().blocked === true,
            blockedReason: clean(daySnapshot.data().blockedReason, 300), scheduled: daySnapshot.data().scheduled !== false,
          } : null;
          sources.push(source('attendance', { id: `${file.id}_${student.id}` }, `נוכחות — ${student.fullName}`, `/files?file=${encodeURIComponent(file.id)}`, {
            fileId: file.id, classId: student.classId, studentId: student.id, studentName: student.fullName,
            sheetName: clean(file.name, 160), dateRange: file.dateRange || {}, legend, requestedDay: day, records: items,
          }));
        }
      }
    }
  }

  if (requested(question, 'personalFile') || requested(question, 'cv')) {
    const personalPermission = decision(permissionContext, 'personalFile.view');
    const cvPermission = decision(permissionContext, 'cv.view');
    if (requested(question, 'personalFile') && !personalPermission.allowed) addDenied('personalFile', 'personalFile.view');
    if (requested(question, 'cv') && !cvPermission.allowed) addDenied('cv', 'cv.view');
    for (const student of matchedStudents.slice(0, 5)) {
      if (personalPermission.allowed && decision(permissionContext, 'personalFile.view', { classId: student.classId }).allowed) {
        for (const kind of ['documents', 'credentials', 'experiences', 'skills', 'recommendations']) {
          const snapshot = await adminDb.collection(`schools/${schoolId}/personalFiles/${student.id}/${kind}`).limit(30).get().catch(() => null);
          if (!snapshot) continue;
          const items = snapshot.docs.map(item => ({ id: `${student.id}_${kind}_${item.id}`, studentName: student.fullName, ...item.data() })).filter(item => item.archived !== true);
          relevant(items, question, 6).forEach(item => sources.push(source('personal_file', item, `${student.fullName} — ${clean(item.title || item.name || item.label, 120) || kind}`, `/students?student=${encodeURIComponent(student.id)}`, {
            studentName: student.fullName, kind, title: clean(item.title || item.name || item.label, 160), description: clean(item.description || item.notes || item.summary, 1200), issuer: clean(item.issuer || item.organization, 160), date: clean(item.date || item.issuedAt || item.startDate, 30), attachmentName: clean(item.attachment?.originalName, 180),
          })));
        }
      }
      if (cvPermission.allowed && decision(permissionContext, 'cv.view', { classId: student.classId }).allowed) {
        const snapshot = await adminDb.collection(`schools/${schoolId}/personalFiles/${student.id}/cvDocuments`).limit(20).get().catch(() => null);
        for (const item of snapshot?.docs || []) {
          const data = item.data();
          if (data.status === 'archived') continue;
          sources.push(source('cv', { id: `${student.id}_${item.id}` }, `קורות חיים — ${student.fullName}`, `/students?student=${encodeURIComponent(student.id)}`, {
            studentName: student.fullName, title: clean(data.title, 160), status: clean(data.status, 40), summary: clean(data.summary || data.profile, 1200), updatedAt: data.updatedAt || null,
          }));
          const versions = await adminDb.collection(`schools/${schoolId}/personalFiles/${student.id}/cvDocuments/${item.id}/versions`).limit(20).get().catch(() => null);
          relevant((versions?.docs || []).map(version => {
            const value = version.data();
            return {
              id: `${student.id}_${item.id}_${version.id}`, studentName: student.fullName, title: clean(value.title || data.title, 160),
              versionNumber: Number(value.versionNumber || 0), status: clean(value.status, 40), purpose: clean(value.purpose, 500),
              snapshotText: clean(JSON.stringify(value.snapshot || {}), 4000), createdAt: value.createdAt || null,
            };
          }), question, 5).forEach(version => sources.push(source('cv_version', version, `גרסת קורות חיים — ${student.fullName}`, `/students?student=${encodeURIComponent(student.id)}`, version)));
        }
      }
    }
    if (requested(question, 'personalFile') && personalPermission.allowed) {
      const catalog = await collectionDocuments([`schools/${schoolId}/skillCatalog`], 500);
      relevant(catalog.filter(item => item.status !== 'archived').map(item => ({
        id: item.id, name: clean(item.name || item.title, 120), category: clean(item.category, 80), description: clean(item.description, 800), status: clean(item.status, 40),
      })), question, 12).forEach(item => sources.push(source('skill_catalog', item, item.name || 'מיומנות', '/students', item)));
    }
    if (requested(question, 'cv')) {
      const canViewTemplates = managerSubject(permissionContext)
        || decision(permissionContext, 'cvTemplates.view').allowed
        || decision(permissionContext, 'cvTemplates.create').allowed
        || decision(permissionContext, 'cvTemplates.update').allowed;
      if (canViewTemplates) {
        const templates = await collectionDocuments([`schools/${schoolId}/cvTemplates`], 150);
        relevant(templates.filter(item => item.status === 'active'
          && item.schoolId === schoolId
          && (item.scope === 'school' || item.createdBy === actor.uid)).map(item => ({
          id: item.id, name: clean(item.name || item.title, 160), description: clean(item.description, 800),
          type: clean(item.type, 40), scope: clean(item.scope, 30), content: clean(JSON.stringify(item.content || {}), 4000),
        })), question, 8).forEach(item => sources.push(source('cv_template', item, item.name || 'תבנית קורות חיים', '/students', item)));
      }
    }
  }

  if (requested(question, 'outcomes')) {
    const definitionPermission = decision(permissionContext, 'outcomes.view');
    const resultPermission = decision(permissionContext, 'outcomes.viewStudentResults');
    if (!definitionPermission.allowed && !resultPermission.allowed) addDenied('outcomes', 'outcomes.view');
    if (definitionPermission.allowed) {
      const [definitions, targets, summaries] = await Promise.all([
        collectionDocuments([`schools/${schoolId}/outcomeDefinitions`], 150),
        collectionDocuments([`schools/${schoolId}/classOutcomeTargets`], 300),
        collectionDocuments([`schools/${schoolId}/outcomeSummaries`], 150),
      ]);
      relevant(definitions.map(item => ({
        id: item.id, name: clean(item.name, 160), description: clean(item.description, 1000), academicYearId: clean(item.academicYearId, 128),
        active: item.active !== false, version: Number(item.version || 1), calculationMode: clean(item.calculationMode, 40),
        applicableGrades: list(item.applicableGrades), applicableTracks: list(item.applicableTracks), criteria: list(item.criteria),
      })), question, 10).forEach(item => sources.push(source('outcome_definition', item, item.name || 'הגדרת זכאות', '/students', item)));
      relevant(targets.filter(item => !item.classId || decision(permissionContext, 'classes.view', { classId: item.classId }).allowed).map(item => ({
        id: item.id, classId: clean(item.classId, 128), outcomeDefinitionId: clean(item.outcomeDefinitionId, 128),
        academicYearId: clean(item.academicYearId, 128), status: clean(item.status, 50), dueDate: clean(item.dueDate, 30),
      })), question, 10).forEach(item => sources.push(source('outcome_target', item, 'יעד זכאות לכיתה', '/students', item)));
      relevant(summaries.map(item => ({
        id: item.id, classId: clean(item.classId, 128), outcomeDefinitionId: clean(item.outcomeDefinitionId, 128),
        eligibleCount: Number(item.eligibleCount || 0), pendingCount: Number(item.pendingCount || 0), totalCount: Number(item.totalCount || 0), calculatedAt: item.calculatedAt || null,
      })), question, 8).forEach(item => sources.push(source('outcome_summary', item, 'סיכום זכאות', '/students', item)));
    }
    if (resultPermission.allowed) for (const student of matchedStudents.filter(item => decision(permissionContext, 'outcomes.viewStudentResults', { classId: item.classId }).allowed).slice(0, 5)) {
      const snapshot = await adminDb.collection(`schools/${schoolId}/studentOutcomeResults`).where('studentId', '==', student.id).limit(20).get().catch(() => null);
      snapshot?.docs.forEach(item => {
        const data = item.data();
        sources.push(source('outcome', { id: item.id }, `תוצאות זכאות — ${student.fullName}`, `/students?student=${encodeURIComponent(student.id)}`, {
          studentName: student.fullName, status: clean(data.status || data.result, 80), summary: clean(data.summary || data.explanation, 1200), calculatedAt: data.calculatedAt || null, criteria: data.criteriaResults || data.results || {},
        }));
      });
    }
  }

  if (requested(question, 'communications')) {
    const own = decision(permissionContext, 'communications.viewOwn').allowed;
    const team = decision(permissionContext, 'communications.viewTeam').allowed;
    const all = decision(permissionContext, 'communications.viewAll').allowed;
    if (!own && !team && !all && /מעקב|שנשלח|טיוטת הודעה/u.test(question)) addDenied('communications', 'communications.viewOwn');
    {
      const drafts = await collectionDocuments([`schools/${schoolId}/communicationDrafts`], 150);
      const visible = drafts.filter(item => all || (own && ([item.createdBy, item.ownerId, item.responsibleUserId, item.followUpAssigneeId].includes(actor.uid)
          || list(item.participantIds).includes(actor.uid)))
        || (team && list(item.teamIds || [item.teamId]).some(id => permissionContext.subject.teamIds.includes(id))));
      const matchingDrafts = relevant(visible.map(item => ({ id: item.id, subject: clean(item.subject || item.title, 180), status: clean(item.communicationStatus || item.status, 50), recipientName: clean(item.recipientName || item.contactName, 160), summary: clean(item.body || item.summary || item.description, 1200), dueDate: clean(item.followUpDate || item.dueDate, 30) })), question, 10);
      for (const item of matchingDrafts) {
        sources.push(source('communication', item, item.subject || 'מעקב תקשורת', '/tasks?view=communications', item));
        const events = await adminDb.collection(`schools/${schoolId}/communicationEvents`).where('draftId', '==', item.id).limit(40).get().catch(() => null);
        relevant((events?.docs || []).map(event => {
          const data = event.data();
          return { id: event.id, subject: item.subject, type: clean(data.type || data.eventType, 60), status: clean(data.status, 50), summary: clean(data.summary || data.description || data.message, 1200), actorName: clean(data.actorName, 120), createdAt: data.createdAt || null };
        }), question, 8).forEach(event => sources.push(source('communication_event', event, `אירוע — ${item.subject || 'תקשורת'}`, '/tasks?view=communications', event)));
      }
      const privateTemplates = await collectionDocuments([`users/${actor.uid}/communicationTemplates`], 100);
      relevant(privateTemplates.filter(item => item.schoolId === schoolId && item.archived !== true).map(item => ({
        id: `private_${item.id}`, name: clean(item.name, 120), category: clean(item.category, 80), subjectTemplate: clean(item.subjectTemplate, 300), bodyTemplate: clean(item.bodyTemplate, 2000), tone: clean(item.tone, 40), scope: 'private',
      })), question, 8).forEach(item => sources.push(source('communication_template', item, item.name || 'תבנית פרטית', '/tasks?view=communications', item)));
      const canReadInstitutionalTemplates = managerSubject(permissionContext)
        || decision(permissionContext, 'communications.create').allowed
        || decision(permissionContext, 'communications.useAgent').allowed
        || decision(permissionContext, 'communications.manageTemplates').allowed;
      if (canReadInstitutionalTemplates) {
        const templates = await collectionDocuments([`schools/${schoolId}/communicationTemplates`], 100);
        relevant(templates.filter(item => item.archived !== true && (!item.schoolId || item.schoolId === schoolId)).map(item => ({
          id: `institutional_${item.id}`, name: clean(item.name, 120), category: clean(item.category, 80), subjectTemplate: clean(item.subjectTemplate, 300), bodyTemplate: clean(item.bodyTemplate, 2000), tone: clean(item.tone, 40), scope: 'institutional',
        })), question, 8).forEach(item => sources.push(source('communication_template', item, item.name || 'תבנית מוסדית', '/tasks?view=communications', item)));
      }
    }
  }

  if (requested(question, 'directMessages')) {
    const conversationsSnapshot = await adminDb.collection('conversations').where('participants', 'array-contains', actor.uid).limit(60).get().catch(() => null);
    const staffIds = new Set((await schoolUsers(schoolId)).map(item => item.id));
    const conversations = (conversationsSnapshot?.docs || []).map(item => ({ id: item.id, ...item.data() })).filter(item => (
      item.schoolId === schoolId
      || (!item.schoolId && list(item.participants).every(participantId => participantId === actor.uid || staffIds.has(participantId)))
    ));
    const matchingConversations = relevant(conversations.map(item => ({
      ...item,
      participantLabel: Object.entries(item.participantNames || {}).filter(([id]) => id !== actor.uid).map(([, name]) => clean(name, 120)).filter(Boolean).join(', '),
      lastMessage: clean(item.lastMessage, 500),
    })), question, 8);
    const messageGroups = await Promise.all(matchingConversations.map(async conversation => {
      const snapshot = await adminDb.collection(`conversations/${conversation.id}/messages`).orderBy('createdAt', 'desc').limit(80).get().catch(() => null);
      const messages = relevant((snapshot?.docs || []).map(item => {
        const data = item.data();
        return {
          id: item.id, text: clean(data.text, 1200), senderName: clean(data.senderName, 120), senderId: clean(data.senderId, 128), createdAt: data.createdAt || null,
        };
      }), question, 20);
      return { conversation, messages };
    }));
    messageGroups.forEach(({ conversation, messages }) => sources.push(source(
      'conversation', conversation, conversation.participantLabel ? `שיחה עם ${conversation.participantLabel}` : 'שיחה פרטית', '/messages',
      { participantLabel: conversation.participantLabel, messages },
    )));
  }

  if (requested(question, 'announcements')) {
    const announcements = await collectionDocuments(['announcements', `announcements_${schoolId}`], 200);
    relevant(announcements.filter(item => item.schoolId === schoolId || item.target === 'all').map(item => ({
      id: item.id, title: clean(item.title, 180), text: clean(item.text || item.body || item.message, 1600),
      authorName: clean(item.authorName || item.senderName, 120), createdAt: item.createdAt || null,
    })), question, 12).forEach(item => sources.push(source('announcement', item, item.title || 'הודעה בית־ספרית', '/messages', item)));
  }

  if (requested(question, 'notifications')) {
    const snapshot = await adminDb.collection('notifications').where('userId', '==', actor.uid).limit(100).get().catch(() => null);
    relevant((snapshot?.docs || []).map(item => {
      const data = item.data();
      return {
        id: item.id, title: clean(data.title, 180), body: clean(data.body, 1000), type: clean(data.type, 60),
        read: data.read === true, createdAt: data.createdAt || null,
      };
    }), question, 15).forEach(item => sources.push(source('notification', item, item.title || 'התראה', '/notifications', item)));
  }

  if (requested(question, 'categories')) {
    const permission = decision(permissionContext, 'categories_view');
    if (!permission.allowed) addDenied('categories', 'categories_view');
    else {
      const categories = await collectionDocuments([`schools/${schoolId}/categories`, `categories_${schoolId}`]);
      relevant(categories.map(item => ({ id: item.id, name: clean(item.name || item.title, 120), color: clean(item.color, 30), order: Number(item.order || 0) })), question, 20)
        .forEach(item => sources.push(source('category', item, item.name || 'קטגוריה', '/categories', item)));
    }
  }

  if (requested(question, 'support')) {
    const snapshot = await adminDb.collection('supportTickets').where('schoolId', '==', schoolId).limit(100).get().catch(() => null);
    // Keep Zoki's support visibility identical to the client Firestore rule:
    // school managers can see the school's tickets; everyone else sees only
    // tickets they created. A broader catalog capability must not bypass that
    // resource-level rule through the server-side assistant.
    const canViewSchool = managerSubject(permissionContext);
    const tickets = (snapshot?.docs || []).map(item => ({ id: item.id, ...item.data() })).filter(item => canViewSchool || item.createdBy === actor.uid);
    relevant(tickets.map(item => ({
      id: item.id, title: clean(item.title, 180), description: clean(item.description, 1400), issueType: clean(item.issueType, 60),
      urgency: clean(item.urgency, 40), status: clean(item.status, 60), createdAt: item.createdAt || null,
    })), question, 12).forEach(item => sources.push(source('support_ticket', item, item.title || 'פניית תמיכה', '/support', item)));
  }

  if (requested(question, 'collectiveBrain')) {
    const canManage = managerSubject(permissionContext) || decision(permissionContext, 'collectiveBrain.manage').allowed;
    const boards = await collectionDocuments([`schools/${schoolId}/collectiveBrainBoards`], 150);
    const visibleBoards = boards.filter(item => canManage || (
      item.status !== 'deleted'
      && (item.audienceMode !== 'restricted' || list(item.audienceUserIds).includes(actor.uid))
    ));
    const matchingBoards = relevant(visibleBoards, question, 10);
    for (const board of matchingBoards) {
      const responseSnapshot = await adminDb.collection(`schools/${schoolId}/collectiveBrainBoards/${board.id}/responses`).limit(100).get().catch(() => null);
      const responses = (responseSnapshot?.docs || []).map(item => {
        const data = item.data();
        return { id: item.id, authorName: clean(data.authorName, 120), body: clean(data.body, 1600), status: clean(data.status, 30), createdAt: data.createdAt || null };
      }).filter(item => canManage || item.status === 'active');
      sources.push(source('collective_brain', board, clean(board.question, 240) || 'שאלה לצוות', `/collective-brain?board=${encodeURIComponent(board.id)}`, {
        question: clean(board.question, 300), description: clean(board.description, 1200), status: clean(board.status, 40),
        responses: relevant(responses, question, 20),
      }));
    }
  }

  if (requested(question, 'dataMapping')) {
    const permission = decision(permissionContext, 'data_mapping_view');
    if (!permission.allowed) addDenied('dataMapping', 'data_mapping_view');
    else {
      const sheets = await collectionDocuments([`schools/${schoolId}/sheets`, `sheets_${schoolId}`], 120);
      const canEdit = decision(permissionContext, 'data_mapping_edit').allowed;
      const visibleSheets = sheets.filter(item => canEdit || !list(item.sharedWith).length
        || list(item.sharedWith).includes(actor.uid)
        || list(item.sharedWith).some(id => permissionContext.subject.teamIds.includes(id)));
      relevant(visibleSheets, question, 10).forEach(item => sources.push(source('data_sheet', item, clean(item.name, 160) || 'טבלת מיפוי', '/files', {
        name: clean(item.name, 160), text: sheetSearchText(item, question), createdBy: clean(item.createdBy, 120), createdAt: item.createdAt || null,
      })));
    }
  }

  if (requested(question, 'academic')) {
    const yearPermission = decision(permissionContext, 'academicYears.view');
    if (yearPermission.allowed) {
      const years = await collectionDocuments([`schools/${schoolId}/academicYears`, `academic_years_${schoolId}`]);
      relevant(years.map(item => ({ id: item.id, label: clean(item.label || item.name, 80), startDate: clean(item.startDate, 30), endDate: clean(item.endDate, 30), status: clean(item.status, 40) })), question, 10)
        .forEach(item => sources.push(source('academic_year', item, item.label || 'שנת לימודים', '/students', item)));
    }
    if (studentsPermission.allowed) {
      const tracks = await collectionDocuments([`schools/${schoolId}/tracks`, `tracks_${schoolId}`]);
      relevant(tracks.map(item => ({ id: item.id, name: clean(item.name || item.title, 120), description: clean(item.description, 700), status: clean(item.status, 40) })), question, 10)
        .forEach(item => sources.push(source('track', item, item.name || 'מגמה', '/students', item)));
    }
  }

  if (requested(question, 'managerialAudit')) {
    const canViewAudit = managerSubject(permissionContext) || decision(permissionContext, 'institution.audit.view').allowed;
    if (!canViewAudit) addDenied('managerialAudit', 'institution.audit.view');
    else {
      const auditSnapshot = await adminDb.collection('auditLogs').where('schoolId', '==', schoolId).limit(300).get().catch(() => null);
      const audits = (auditSnapshot?.docs || []).map(item => ({ id: item.id, ...item.data() }));
      relevant(audits.map(item => ({
        id: item.id, action: clean(item.action, 160), targetType: clean(item.targetType, 80), targetId: clean(item.targetId, 160),
        actorUid: clean(item.actorUid, 128), actorRole: clean(item.actorRole, 80), createdAt: item.createdAt || null,
      })), question, 20).forEach(item => sources.push(source('audit_log', item, item.action || 'פעולת מערכת', '/settings', item)));
    }
    if (managerSubject(permissionContext)) {
      const staff = await schoolUsers(schoolId);
      const matchingStaff = relevant(staff.map(item => ({ id: item.id, name: clean(item.fullName || item.displayName || item.name, 120) })), question, 8);
      for (const person of matchingStaff) {
        const entries = await adminDb.collection(`schools/${schoolId}/loginActivity/${person.id}/entries`).orderBy('loggedInAt', 'desc').limit(10).get().catch(() => null);
        if (!entries?.docs.length) continue;
        sources.push(source('login_activity', person, `כניסות למערכת — ${person.name || 'איש צוות'}`, '/staff', {
          staffName: person.name, entries: entries.docs.map(item => ({ loggedInAt: item.data().loggedInAt || null, eventType: clean(item.data().eventType, 40) })),
        }));
      }
    }
  }

  if (requested(question, 'tasks')) {
    const own = decision(permissionContext, 'tasks.viewOwn').allowed;
    const team = decision(permissionContext, 'tasks.viewTeam').allowed;
    const all = decision(permissionContext, 'tasks.viewAll').allowed;
    const tasks = relevant(await organizationTaskDocuments(schoolId, 2000), question, 40);
    const editAll = evaluatePermission(permissionContext, { capability: 'tasks.editAll', accessLevel: 'edit', resource: {} }).allowed
      || evaluatePermission(permissionContext, { capability: 'tasks_edit', accessLevel: 'edit', resource: {} }).allowed;
    const canAssign = editAll
      || evaluatePermission(permissionContext, { capability: 'tasks.assign', accessLevel: 'edit', resource: {} }).allowed
      || evaluatePermission(permissionContext, { capability: 'tasks_assign', accessLevel: 'edit', resource: {} }).allowed;
    const canRemoveAssignment = editAll
      || evaluatePermission(permissionContext, { capability: 'tasks.manageAssignments', accessLevel: 'edit', resource: {} }).allowed;
    const evaluatedTasks = await Promise.all(tasks.map(async item => {
      const legacyVisible = all
        || (own && [item.createdBy, item.ownerId, item.assigneeId].includes(actor.uid))
        || (team && list(item.teamIds || [item.teamId]).some(id => permissionContext.subject.teamIds.includes(id)))
        || list(item.assigneeIds).includes(actor.uid);
      const taskContext = await withResourcePermissionContext(permissionContext, { resourceType: 'task', resourceId: item.id });
      const hasAcl = (taskContext.resourceAcls || []).length > 0;
      const aclVisible = resourceDecision(taskContext, 'tasks.viewOwn', { resourceType: 'task', resourceId: item.id }).allowed;
      return { item, visible: (hasAcl && aclVisible) || (!hasAcl && legacyVisible) };
    }));
    const visible = evaluatedTasks.filter(entry => entry.visible).map(entry => entry.item);
    const [personalSnapshot, invitationSnapshot] = await Promise.all([
      adminDb.collection(`users/${actor.uid}/personalTasks`).where('schoolId', '==', schoolId).limit(500).get().catch(() => null),
      adminDb.collection(`schools/${schoolId}/taskInvitations`).limit(200).get().catch(() => null),
    ]);
    const personalTasks = relevant((personalSnapshot?.docs || []).map(item => ({ id: item.id, ...item.data() })), question, 12);
    const invitations = relevant((invitationSnapshot?.docs || []).map(item => ({ id: item.id, ...item.data() }))
      .filter(item => item.recipientId === actor.uid || item.inviterId === actor.uid), question, 10);
    if (!visible.length && !personalTasks.length && !invitations.length && !own && !team && !all) addDenied('tasks', 'tasks.viewOwn');
    relevant(visible, question, 12).forEach(item => sources.push(source('task', item, clean(item.title, 160) || 'משימה', `/tasks?task=${encodeURIComponent(item.id)}`, {
        id: item.id, title: clean(item.title, 160), description: clean(item.description, 600), status: clean(item.status, 40) || 'todo', dueDate: clean(item.dueDate, 20), priority: clean(item.priority, 30),
        storageMode: item._storageMode || 'nested',
        canUpdateStatus: editAll || list(item.assigneeIds).includes(actor.uid) || list(item.participantIds).includes(actor.uid),
        assigneeIds: list(item.assigneeIds), canAssignStaff: canAssign, canRemoveAssignee: canRemoveAssignment,
        canEditDetails: editAll,
    })));
    personalTasks.forEach(item => sources.push(source('personal_task', { id: `personal_${item.id}` }, clean(item.title, 160) || 'משימה אישית', `/tasks?task=${encodeURIComponent(item.id)}`, {
      id: item.id, title: clean(item.title, 160), description: clean(item.description, 800), status: clean(item.status || item.taskStatus, 40) || 'todo',
      storageMode: 'personal', canUpdateStatus: true,
      canEditDetails: true,
      dueDate: clean(item.dueDate, 30), reminderAt: clean(item.reminderAt, 40), priority: clean(item.priority, 30), tags: list(item.tags),
    })));
    invitations.forEach(item => sources.push(source('task_invitation', item, clean(item.taskTitle || item.title, 160) || 'הזמנה למשימה', '/tasks', {
      taskTitle: clean(item.taskTitle || item.title, 160), status: clean(item.status, 40), inviterName: clean(item.inviterName, 120),
      recipientName: clean(item.recipientName, 120), message: clean(item.message, 800), createdAt: item.createdAt || null,
    })));
  }

  return {
    sources: sources.slice(0, 45),
    denied,
    adminInstructions: clean(brainData.instructions, 4000),
    capabilities: {
      canCreateTask: decision(permissionContext, 'tasks.useAssistant').allowed,
      canChangeTaskStatus: sources.some(item => ['task', 'personal_task'].includes(item.type) && item.fields?.canUpdateStatus),
      canChangeTaskAssignment: sources.some(item => item.type === 'task'
        && (item.fields?.canAssignStaff || item.fields?.canRemoveAssignee)),
      canEditTaskDetails: sources.some(item => ['task', 'personal_task'].includes(item.type) && item.fields?.canEditDetails),
      canEditGrades: decision(permissionContext, 'grades.edit').allowed,
      canTransferStudents: decision(permissionContext, 'students.transferClass').allowed
        || decision(permissionContext, 'students_transfer_class').allowed,
      canAssignRoles,
      canManageDirectPermissions,
      canManageResourcePermissions: canProposeResourcePermissions,
      canRenameResources: sources.some(item => ['file', 'folder'].includes(item.type) && item.fields?.canRename),
      canTrashResources: sources.some(item => ['file', 'folder'].includes(item.type) && item.fields?.canTrash),
      canCreateResources: decision(permissionContext, 'files.create').allowed,
      canRestoreResources: sources.some(item => ['file', 'folder'].includes(item.type) && item.fields?.canRestore),
      canMoveResources: sources.some(item => item.type === 'file' && item.fields?.canMove)
        && sources.some(item => item.type === 'folder' && item.fields?.canMoveInto),
      canManageStudentTracks: decision(permissionContext, 'students.managePrograms').allowed
        || decision(permissionContext, 'students_manage_programs').allowed,
      canEditAttendance: decision(permissionContext, 'attendance.edit').allowed
        || decision(permissionContext, 'attendance_edit').allowed || taughtClassIds.size > 0,
      canAddStudentNotes: decision(permissionContext, 'students.addNotes').allowed
        || decision(permissionContext, 'students_add_notes').allowed,
      canCreateCalendarEvent: decision(permissionContext, 'calendar.create').allowed
        || decision(permissionContext, 'calendar.edit').allowed
        || decision(permissionContext, 'calendar_edit').allowed,
      canEditCalendarEvent: decision(permissionContext, 'calendar.edit').allowed
        || decision(permissionContext, 'calendar_edit').allowed,
      canCreatePrivateContact: true,
      canCreateInstitutionalContact: decision(permissionContext, 'contacts.create').allowed,
      canManageTeamMembership: managerSubject(permissionContext)
        || decision(permissionContext, 'teams_edit').allowed
        || sources.some(item => item.type === 'team' && item.fields?.canManage === true),
      canManageTeamManagers: managerSubject(permissionContext)
        || decision(permissionContext, 'teams_edit').allowed
        || sources.some(item => item.type === 'team' && item.fields?.canManage === true),
      canCreateTeam: managerSubject(permissionContext) || decision(permissionContext, 'teams_edit').allowed,
    },
  };
}
