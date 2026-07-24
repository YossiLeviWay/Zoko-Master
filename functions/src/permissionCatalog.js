export const PERMISSION_GROUPS = Object.freeze([
  Object.freeze({ id: 'staff', label: 'אנשי צוות והזמנות', permissions: [
    ['staff.invite', 'שליחת הזמנות לאנשי צוות'],
    ['staff.viewJoinRequests', 'צפייה בבקשות הצטרפות'],
    ['staff.reviewJoinRequests', 'טיפול בבקשות הצטרפות'],
    ['staff.resetPassword', 'שליחת קישור איפוס סיסמה'],
  ] }),
  Object.freeze({ id: 'tasks', label: 'משימות ושיתופים', permissions: [
    ['tasks.inviteCollaborators', 'הזמנת שותפים למשימה אישית'],
    ['tasks.assignMandatory', 'הקצאת משימה מחייבת'],
    ['tasks.manageAssignments', 'ביטול ושינוי הקצאות משימה'],
  ] }),
  Object.freeze({ id: 'academicYears', label: 'שנות לימודים', permissions: [
    ['academicYears.view', 'צפייה בשנות לימודים'],
    ['academicYears.manage', 'ניהול שנות לימודים'],
  ] }),
  Object.freeze({ id: 'classes', label: 'כיתות', permissions: [
    ['classes.view', 'צפייה בכיתות'],
    ['classes.create', 'יצירת כיתות'],
    ['classes.update', 'עריכת כיתות'],
    ['classes.archive', 'ארכוב ושחזור כיתות'],
    ['classes.assignTeacher', 'שיוך מחנך וצוות'],
    ['classes.promote', 'העלאת כיתה לשנה חדשה'],
  ] }),
  Object.freeze({ id: 'students', label: 'תלמידים', permissions: [
    ['students.view', 'צפייה בתלמידים'],
    ['students.create', 'יצירת תלמידים'],
    ['students.update', 'עריכת תלמידים'],
    ['students.archive', 'ארכוב תלמידים'],
    ['students.transferClass', 'העברה בין כיתות'],
    ['students.promote', 'העלאה לשנה חדשה'],
    ['students.markGraduate', 'סימון כבוגר'],
    ['students.markWithdrawn', 'סימון כפורש או עבר מוסד'],
    ['students.markDropout', 'סימון כנושר'],
    ['students.restore', 'החזרה לפעילות'],
    ['students.managePrograms', 'ניהול מגמות ותוכניות לימוד'],
    ['students.addNotes', 'הוספת הערות'],
    ['students.viewSensitiveNotes', 'צפייה בהערות רגישות'],
  ] }),
  Object.freeze({ id: 'grades', label: 'ציונים ומיפויים', permissions: [
    ['grades.view', 'צפייה בציונים'],
    ['grades.edit', 'עריכת ציוני תלמידים'],
    ['gradebooks.manage', 'ניהול מקצועות, רכיבים ונוסחאות'],
  ] }),
  Object.freeze({ id: 'personalFile', label: 'תיק אישי', permissions: [
    ['personalFile.view', 'צפייה בתיק אישי'],
    ['personalFile.manage', 'ניהול תיק אישי'],
    ['personalFile.upload', 'העלאת מסמכים'],
    ['personalFile.archiveDocuments', 'ארכוב מסמכים'],
  ] }),
  Object.freeze({ id: 'cv', label: 'קורות חיים', permissions: [
    ['cv.view', 'צפייה בקורות חיים'],
    ['cv.create', 'יצירת קורות חיים'],
    ['cv.edit', 'עריכת קורות חיים'],
    ['cv.deleteDraft', 'מחיקת טיוטה'],
    ['cv.finalize', 'סימון גרסה כסופית'],
    ['cv.exportPdf', 'הפקת PDF'],
    ['cv.manageSkills', 'ניהול מיומנויות'],
    ['cv.manageExperience', 'ניהול ניסיון'],
    ['cv.manageRecommendations', 'ניהול המלצות'],
    ['cv.manageCredentials', 'ניהול הסמכות'],
    ['cv.bulkGenerate', 'יצירה מרוכזת לכיתה'],
  ] }),
  Object.freeze({ id: 'cvTemplates', label: 'תבניות קורות חיים', permissions: [
    ['cvTemplates.view', 'צפייה בתבניות'],
    ['cvTemplates.create', 'יצירת תבניות'],
    ['cvTemplates.update', 'עריכת תבניות'],
    ['cvTemplates.archive', 'ארכוב תבניות'],
    ['cvTemplates.manageSchoolTemplates', 'ניהול תבניות מוסדיות'],
  ] }),
  Object.freeze({ id: 'roles', label: 'תפקידים והרשאות', permissions: [
    ['roles.view', 'צפייה בתפקידים'],
    ['roles.create', 'יצירת תפקידים'],
    ['roles.update', 'עריכת והעתקת תפקידים'],
    ['roles.assign', 'שיוך תפקידים למשתמשים'],
    ['roles.archive', 'ארכוב תפקידים'],
    ['permissions.delegate', 'האצלת הרשאות מאושרות'],
  ] }),
]);

export const GRANULAR_PERMISSION_KEYS = Object.freeze(
  PERMISSION_GROUPS.flatMap(group => group.permissions.map(([key]) => key)),
);

export const LEGACY_PERMISSION_KEYS = Object.freeze([
  'calendar_view', 'calendar_edit', 'categories_view', 'categories_edit',
  'staff_view', 'staff_edit', 'staff_delete', 'tasks_view', 'tasks_edit', 'tasks_assign',
  'teams_view', 'teams_edit', 'files_view', 'files_upload', 'files_delete',
  'messages_send', 'messages_delete', 'holidays_view', 'holidays_edit',
  'data_mapping_view', 'data_mapping_edit', 'classes_view', 'classes_create',
  'classes_update', 'classes_archive', 'classes_assign_teacher', 'students_view',
  'students_edit', 'students_create', 'students_update', 'students_archive',
  'students_transfer_class', 'students_manage_programs', 'students_add_notes',
  'students_view_notes', 'attendance_create', 'attendance_view', 'attendance_edit',
  'attendance_manage_legend', 'attendance_manage_dates', 'attendance_block_days',
  'schools_manage', 'settings_edit',
]);

export const ALL_PERMISSION_KEYS = Object.freeze([
  ...new Set([...LEGACY_PERMISSION_KEYS, ...GRANULAR_PERMISSION_KEYS]),
]);
