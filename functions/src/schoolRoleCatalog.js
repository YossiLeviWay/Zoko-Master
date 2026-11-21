// School role catalog. A role is a *template* of capabilities plus the
// responsibilities Zoki's matching sub-agent should help the holder with.
//
// SOURCE: role names, weekly hours, compensation and one-line definitions come
// from the Ministry of Labor Vocational Training Administration guideline
// "בעלי תפקידים מובילים: חלוקת שעות, גמולים ודגשים" (תשפ״ז, 20.7.26), as shown
// at https://pedagogiamh.co.il/tafkidim.html and baaley-tafkidim.html. The PDF
// linked there is the binding text. Capability templates and Zoki duties/reminders
// are our own proposal on top of it (`capabilitiesStatus: 'proposal'`) and must be
// approved by the institution manager. Hours/compensation can change each year.
//
// Role assignment itself (roles.*, staff.assignRoles, permissions.delegate) is
// never granted by any role here: only the protected institution manager can
// appoint role holders.

// Capabilities no catalog role may receive. Appointing roles, changing the
// institution, audit logs and the forum (separate approval) stay with the manager.
export const MANAGER_ONLY = Object.freeze([
  'roles.view', 'roles.create', 'roles.update', 'roles.assign', 'roles.archive', 'roles.manage', 'roles.delegateAssignments',
  'staff.assignRoles', 'permissions.delegate', 'institution.settings', 'institution.audit.view', 'institution.permissionPreview',
]);

export const ROLE_GROUPS = Object.freeze([
  { id: 'management', label: 'הנהלה ופדגוגיה' },
  { id: 'pedagogy', label: 'מקצוע ושכבה' },
  { id: 'social', label: 'חברה, ליווי והכלה' },
  { id: 'admin', label: 'ארגון ותפעול' },
]);

const weekly = title => ({ title, cadence: 'weekly' });
const monthly = title => ({ title, cadence: 'monthly' });
const yearly = title => ({ title, cadence: 'yearly' });
const SRC = 'https://pedagogiamh.co.il/baaley-tafkidim.html';

// `grant: 'all-except-manager'` expands to every capability minus MANAGER_ONLY.
// official: { hours, compensation, credits } are quoted from the guideline.
const ROLE_DEFS = [
  { id: 'deputy_principal', label: 'סגן/ית מנהל', group: 'management', managementTeam: true, appendix: true, grant: 'all-except-manager',
    official: { hours: '', compensation: '25.4% לפי גודל בית הספר' },
    description: 'ניהול שוטף לצד המנהל; בעל תפקיד מוביל, ללא מינוי בעלי תפקידים',
    duties: ['מעקב אחר ביצוע משימות המוסד', 'תיאום בין הרכזים', 'טיפול באירועים חריגים'],
    reminders: [weekly('סקירת משימות פתוחות של בעלי התפקידים'), monthly('בדיקת התקדמות מול הגאנט')] },
  { id: 'pedagogical_coordinator', label: 'רכז/ת פדגוגי/ת', group: 'management', managementTeam: true, appendix: true, grant: 'all-except-manager',
    official: { hours: '0.5 ש״ש לכיתה + 4/5 ש״ש', compensation: '8%', credits: 2.5 },
    description: 'הובלת החזון הפדגוגי, פדגוגיה דואלית, חדשנות והערכה מבוססת נתונים; כל ההרשאות מלבד מינוי בעלי תפקידים',
    duties: ['הובלת תוכנית עבודה שנתית פדגוגית', 'פריסת היבחנות תלת־שנתית ומיפוי בית ספרי', 'שאלוני פדגוגיה למורים ולתלמידים', 'ועדה מלווה בית ספרית פעמיים בשנה'],
    reminders: [weekly('בדיקת מבחנים מתוכננים לשבוע הקרוב'), monthly('עדכון הגאנט מול מורים'), yearly('הכנת תוכנית עבודה פדגוגית ופריסת היבחנות')] },
  { id: 'social_coordinator', label: 'רכז/ת חינוך חברתי', group: 'management', managementTeam: true, appendix: true,
    official: { hours: '0.5 ש״ש לכיתה + 4/5 ש״ש', compensation: '10% + תוספת לפי גודל בית הספר', credits: 3 },
    description: 'חינוך ערכי־חברתי, מעורבות ומנהיגות תלמידים, אקלים; מצופה להיות חבר.ת הנהלה',
    school: ['calendar.view', 'calendar.create', 'calendar.edit', 'tasks.viewTeam', 'tasks.assign', 'classes.view', 'contacts.view', 'files.view', 'files.create', 'files.share'],
    duties: ['מפגש חודשי עם המנהל.ת ועם צוות המחנכים', 'תוכנית עבודה חברתית שנתית לפי שכבות', 'ימי שיא, טקסים ואירועים', 'תיעוד הפעילות החברתית'],
    reminders: [monthly('מפגש חודשי עם המנהל.ת'), monthly('מפגש חודשי עם המחנכים'), weekly('בדיקת אירועים חברתיים קרובים')] },
  { id: 'apprenticeship_coordinator', label: 'רכז/ת חניכות', group: 'pedagogy', appendix: true,
    official: { hours: '5.5 ש״ש (כיתות יא׳–יב׳); מינימום 4 שעות הוראה צמודות', compensation: 'תשלום בית־ספרי' },
    description: 'שותפויות עם מעסיקים, ליווי תלמידים ומנטורים ובקרת רצף החניכות',
    school: ['calendar.view', 'calendar.create', 'classes.view', 'students.view', 'students.addNotes', 'contacts.view', 'contacts.create', 'contacts.edit', 'communications.create', 'communications.viewOwn', 'files.view', 'files.create'],
    duties: ['פיתוח ושיבוץ מקומות חניכות', 'ליווי תלמידים ומנטורים אצל מעסיקים', 'בקרה ודיווח נתוני תעסוקה (מנב״ס)', 'טפסי משוב מעסיק'],
    reminders: [weekly('מעקב חניכים ומעסיקים'), monthly('דיווח נתוני תעסוקה')] },
  { id: 'young_team_coordinator', label: 'רכז/ת צוות צעיר', group: 'social', appendix: true,
    official: { hours: '', compensation: '' },
    description: 'ריכוז תחום בני ובנות השירות (הצוות הצעיר) בבית הספר',
    school: ['calendar.view', 'calendar.create', 'tasks.viewTeam', 'staff.view', 'contacts.view'],
    duties: ['ליווי בני ובנות השירות', 'תיאום משימות הצוות הצעיר'], reminders: [monthly('סיכום פעילות הצוות הצעיר')] },
  { id: 'learning_function_specialist', label: 'מת״ל/ית (תפקודי למידה)', group: 'social', appendix: true,
    official: { hours: '2.2 ש״ש לכיתה', compensation: '6%' },
    description: 'מעריך.ה ומקדם.ת תפקודי למידה: מיפוי, תיקי התאמות והדרכת צוותים',
    school: ['calendar.view', 'classes.view', 'students.view', 'students.addNotes', 'students.managePrograms', 'personalFile.view', 'personalFile.manage', 'personalFile.upload', 'grades.view'],
    duties: ['מיפוי תלמידים וניהול תיקי התאמות', 'ישיבות משולש ומודל RTI', 'התאמות בדרכי היבחנות', 'הדרכת צוותים ועבודה עם הורים'],
    reminders: [weekly('מעקב תלמידים במעקב תפקודי למידה'), monthly('עדכון תיקי התאמות'), yearly('הגשת בקשות התאמה לבחינות')] },
  { id: 'inclusion_coordinator', label: 'רכז/ת הכלה ושילוב', group: 'social', appendix: true, pick6: true,
    official: { hours: '0.5 ש״ש לכיתה', compensation: '6%', credits: 2.5 },
    description: 'מיפוי תלמידים, תוכניות התערבות, שילוב חינוך מיוחד והדרכת צוותים',
    school: ['calendar.view', 'classes.view', 'students.view', 'students.addNotes', 'students.managePrograms', 'personalFile.view', 'personalFile.manage', 'personalFile.upload'],
    duties: ['מיפוי ותוכניות התערבות', 'שילוב תלמידי חינוך מיוחד', 'הדרכת צוותים'], reminders: [monthly('בדיקת עדכון תוכניות התערבות')] },
  { id: 'counselor', label: 'יועץ/ת חינוכי/ת', group: 'social', appendix: true,
    official: { hours: '4 ש״ש; מינימום 4 שעות הוראה צמודות', compensation: '12%–18%', credits: 2.5 },
    description: 'מענה רגשי־מערכתי, אקלים, ליווי תלמידים הורים וצוותים. מידע רגיש לפי הצורך',
    school: ['calendar.view', 'classes.view', 'students.view', 'students.addNotes', 'students.viewSensitiveNotes', 'personalFile.view', 'personalFile.manage', 'contacts.view'],
    duties: ['ליווי אישי וקבוצתי', 'שמירת תיעוד רגיש', 'שיתוף פעולה עם מחנכים והורים'],
    reminders: [weekly('מעקב תלמידים בליווי'), monthly('סיכום פעילות')] },
  { id: 'asa_coordinator', label: 'רכז/ת אס״א (אלכוהול, סמים ואלימות)', group: 'social', appendix: true,
    official: { hours: '', compensation: '6%' },
    description: 'תוכנית בית־ספרית למניעת אלימות והתנהגויות סיכון, חוסן ואקלים',
    school: ['calendar.view', 'calendar.create', 'classes.view', 'students.view', 'students.addNotes', 'contacts.view'],
    duties: ['תוכנית בית־ספרית למניעת אלימות וסמים', 'הדרכות תוכן וליווי המדריכה'], reminders: [monthly('בדיקת התקדמות תוכנית אס״א')] },
  { id: 'track_coordinator', label: 'רכז/ת מגמה', group: 'pedagogy', appendix: true,
    official: { hours: '2 ש״ש לכל מגמה', compensation: '' },
    description: 'המגמה המקצועית: תוכניות לימוד, חניכות, פרויקטים ומבחני גמר, קשר עם מפקח המקצוע',
    school: ['calendar.view', 'calendar.create', 'calendar.edit', 'tasks.assign', 'tasks.viewTeam', 'classes.view', 'students.view', 'grades.view', 'grades.edit', 'files.view', 'files.create', 'files.share'],
    duties: ['תוכניות לימוד המגמה', 'פרויקטים ומבחני גמר', 'הזמנת ציוד למגמה', 'קשר עם מפקח המקצוע'],
    reminders: [weekly('מעקב פרויקטים ומבחני גמר'), yearly('הזמנת ציוד לשנה הבאה')] },
  { id: 'subject_coordinator', label: 'רכז/ת מקצוע (מתמטיקה/אנגלית)', group: 'pedagogy', appendix: true,
    official: { hours: '1 ש״ש למקצוע', compensation: '9%', credits: 3 },
    description: 'ריכוז המקצוע: ליווי מורים, תוכניות ייעודיות, מעקב הישגים וקשר עם המדריך הפדגוגי',
    school: ['calendar.view', 'calendar.create', 'tasks.assign', 'tasks.viewTeam', 'classes.view', 'grades.view', 'files.view', 'files.create', 'files.share'],
    duties: ['ליווי מורי המקצוע', 'מעקב הישגים', 'תיאום מועדי מבחנים במקצוע'], reminders: [weekly('עדכון מורי המקצוע על מבחנים קרובים')] },
  { id: 'tech_coordinator', label: 'רכז/ת תקשוב וטכנולוגיות', group: 'admin', appendix: true, pick6: true,
    official: { hours: '', compensation: '2.5 נקודות זכות', credits: 2.5 },
    description: 'הטמעת תקשוב ובינה מלאכותית בהוראה, הדרכת צוות ותשתית דיגיטלית',
    school: ['calendar.view', 'tasks.viewTeam', 'files.view', 'files.create', 'files.share', 'collectiveBrain.manage'],
    duties: ['הדרכת צוות בכלי AI ותקשוב', 'מדיניות AI בית־ספרית'], reminders: [monthly('הדרכת צוות בכלי דיגיטל')] },
  { id: 'grade_coordinator', label: 'רכז/ת שכבה', group: 'pedagogy', appendix: true,
    official: { hours: '1 ש״ש לכיתה + 0.5', compensation: '', credits: 4 },
    description: 'הובלת השכבה: תיאום מחנכים, מעקב התקדמות ואקלים',
    school: ['calendar.view', 'calendar.create', 'tasks.viewTeam', 'tasks.assign', 'classes.view', 'students.view', 'students.update', 'attendance_view', 'attendance_edit', 'grades.view'],
    duties: ['תיאום מחנכי השכבה', 'מעקב נוכחות והתקדמות', 'אירועי שכבה'], reminders: [weekly('סקירת נוכחות ואירועי השכבה'), monthly('פגישת מחנכי שכבה')] },
  { id: 'security_coordinator', label: 'רכז/ת ביטחון', group: 'admin', appendix: true,
    official: { hours: '', compensation: '6%' },
    description: 'ביטחון, בטיחות והיערכות לחירום: תרגילים, הדרכות ונהלים',
    school: ['calendar.view', 'calendar.create', 'contacts.view', 'files.view', 'files.create'],
    duties: ['תרגילי חירום והדרכות', 'נהלי בטיחות', 'תיאום מול גורמי ביטחון'], reminders: [monthly('בדיקת מוכנות וחירום'), yearly('תרגיל חירום שנתי')] },
  { id: 'trips_coordinator', label: 'רכז/ת טיולים', group: 'admin', appendix: true, pick6: true,
    official: { hours: '', compensation: '6%', credits: 2.5 },
    description: 'מערך הטיולים, הסיורים וימי העיון — בטיחות, נהלים ושילוב בתוכנית החינוכית',
    school: ['calendar.view', 'calendar.create', 'calendar.edit', 'contacts.view', 'communications.create', 'files.view', 'files.create'],
    duties: ['תכנון טיולים וסיורים', 'אישורים ובטיחות'], reminders: [monthly('תכנון טיולים קרובים')] },
  { id: 'mentor_teacher', label: 'מורה חונך/ת', group: 'pedagogy', appendix: true,
    official: { hours: '', compensation: '2.4%' },
    description: 'ליווי מורה חדש בקליטה: התפתחות מקצועית ופדגוגית ושייכות לצוות',
    school: ['calendar.view', 'tasks.viewTeam', 'files.view'],
    duties: ['ליווי מורה מתמחה', 'טופסי משוב אמצע שנה וסיום התמחות'], reminders: [monthly('מפגש ליווי עם המתמחה')] },
  { id: 'bagrut_coordinator', label: 'רכז/ת בגרות', group: 'pedagogy', pick6: true,
    official: { hours: '', compensation: '6%', credits: 2.5 },
    description: 'מועדי בגרות ובחינות, ציונים ותוצרי הערכה',
    school: ['calendar.view', 'calendar.create', 'calendar.edit', 'classes.view', 'students.view', 'grades.view', 'grades.edit', 'gradebooks.manage', 'outcomes.view', 'outcomes.manageDefinitions', 'outcomes.assignToClass', 'outcomes.calculate', 'outcomes.viewStudentResults', 'files.view', 'files.create'],
    duties: ['מעקב מועדי בגרות', 'בקרת ציונים והשלמות', 'הכנה לבחינות'], reminders: [weekly('בדיקת מועדי בחינות קרובים'), monthly('בקרת ציונים והשלמות')] },
  { id: 'discipline_climate_coordinator', label: 'רכז/ת משמעת ואקלים', group: 'social', pick6: true,
    official: { hours: '', compensation: '6%', credits: 2.5 },
    description: 'משמעת, נוכחות ואקלים חינוכי',
    school: ['calendar.view', 'classes.view', 'students.view', 'attendance_view', 'attendance_create', 'attendance_edit', 'contacts.view', 'communications.create', 'communications.viewOwn'],
    duties: ['מעקב היעדרויות ואיחורים', 'פנייה להורים', 'דוחות נוכחות'], reminders: [weekly('סיכום נוכחות שבועי'), monthly('דוח נוכחות לפי כיתה')] },
  { id: 'schedule_coordinator', label: 'רכז/ת מערכת', group: 'admin', pick6: true,
    official: { hours: '', compensation: '6%', credits: 2.5 },
    description: 'בניית מערכת השעות ועדכונה',
    school: ['calendar.view', 'calendar.create', 'calendar.edit', 'calendar.manageSchoolCalendar', 'classes.view', 'staff.view'],
    duties: ['בניית מערכת שעות', 'החלפות וארגון שוטף'], reminders: [yearly('בניית מערכת לשנה חדשה')] },
  { id: 'assessment_coordinator', label: 'רכז/ת הערכה ומדידה', group: 'pedagogy',
    official: { hours: '', compensation: '', credits: 2.5 },
    description: 'הערכה ומדידה בית־ספרית, ניתוח נתונים',
    school: ['calendar.view', 'classes.view', 'students.view', 'grades.view', 'outcomes.view', 'outcomes.calculate', 'outcomes.viewStudentResults'],
    duties: ['ניתוח נתוני הישגים', 'שאלוני פדגוגיה'], reminders: [monthly('דוח הערכה חודשי')] },
  { id: 'secretary', label: 'מזכירות', group: 'admin',
    description: 'רישום, אנשי קשר ותקשורת מנהלתית',
    school: ['calendar.view', 'staff.view', 'classes.view', 'students.view', 'students.create', 'students.edit', 'contacts.view', 'contacts.create', 'contacts.edit', 'files.view', 'files.create', 'communications.create', 'communications.viewOwn', 'communications.useAgent'],
    duties: ['רישום ועדכון פרטי תלמידים', 'ניהול אנשי קשר', 'דיוור והודעות מנהלתיות'], reminders: [weekly('בדיקת פניות פתוחות')] },
];

export const SCHOOL_ROLES = Object.freeze(ROLE_DEFS.map(role => Object.freeze({
  ...role, official: Object.freeze({ ...(role.official || {}) }),
  source: role.official ? SRC : '', capabilitiesStatus: 'proposal', canAppointRoles: false,
})));

export const MANAGEMENT_TEAM_ROLE_IDS = Object.freeze(SCHOOL_ROLES.filter(role => role.managementTeam).map(role => role.id));
// Ministry rule: the school appoints all appendix roles and picks 4 of the 6%-compensation roles.
export const APPENDIX_ROLE_IDS = Object.freeze(SCHOOL_ROLES.filter(role => role.appendix).map(role => role.id));
export const PICK_FOUR_OF_SIX_IDS = Object.freeze(SCHOOL_ROLES.filter(role => role.pick6).map(role => role.id));
