// Tools the Worker may PROPOSE. The browser confirms and writes. Document text is not a user turn.
// People do not know record ids. Every id field has a name twin (className, staffName, taskTitle...);
// the browser, which reads the school's records with the user's own permissions, turns the name into the id.
export const NAME_FIELDS = Object.freeze({
  classId: 'className', taskId: 'taskTitle', assigneeId: 'assigneeName', ownerId: 'ownerName', teamId: 'teamName',
  userId: 'staffName', teacherId: 'teacherName', studentId: 'studentName', memberIds: 'memberNames', statusId: 'statusLabel', fileId: 'className',
});
const NAME_HINT = ' אפשר לזהות לפי שם (שדות שמסתיימים ב־Name / Title / Label) במקום מזהה. אין לבקש מהמשתמש מזהה.';
function withNames(tools) {
  return Object.fromEntries(Object.entries(tools).map(([name, spec]) => {
    const twins = Object.keys(spec.properties).filter(key => NAME_FIELDS[key]);
    if (!twins.length) return [name, spec];
    const properties = { ...spec.properties };
    for (const key of twins) properties[NAME_FIELDS[key]] ||= key === 'memberIds' ? { type: 'array', items: { type: 'string' } } : { type: 'string' };
    return [name, { ...spec, description: spec.description + NAME_HINT, properties, required: (spec.required || []).filter(key => !NAME_FIELDS[key]) }];
  }));
}

export const V1_TOOLS = Object.freeze(withNames({
  create_personal_task: { write: true, keys: ['tasks.create'], description: 'הצע משימה אישית. לא שומר כלום.', properties: { title: { type: 'string' }, dueDate: { type: 'string' }, description: { type: 'string' } }, required: ['title'] },
  create_school_task: { write: true, keys: ['tasks.create'], description: 'הצע משימת מוסד לאדם אחד או לצוות. לא שומר כלום.', properties: { title: { type: 'string' }, dueDate: { type: 'string' }, description: { type: 'string' }, assigneeId: { type: 'string' }, teamId: { type: 'string' } }, required: ['title'] },
  update_task_fields: { write: true, keys: ['tasks.editAll', 'tasks.create'], description: 'הצע עדכון כותרת, תיאור או תאריך של משימה אחת.', properties: { taskId: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, dueDate: { type: 'string' } }, required: ['taskId'] },
  set_task_status: { write: true, keys: ['tasks.editAll', 'tasks.viewOwn'], description: 'הצע שינוי סטטוס של משימה אחת.', properties: { taskId: { type: 'string' }, status: { type: 'string', enum: ['todo', 'in_progress', 'done'] } }, required: ['taskId', 'status'] },
  set_task_assignee: { write: true, keys: ['tasks.assign'], description: 'הצע שיוך אחראי אחד למשימה.', properties: { taskId: { type: 'string' }, assigneeId: { type: 'string' }, assigned: { type: 'boolean' } }, required: ['taskId', 'assigneeId'] },
  read_attendance: { write: false, keys: ['attendance_view', 'attendance_edit'], description: 'הצע לקרוא נוכחות של תלמיד אחד בטווח תאריכים, כולל קודים והערות.', properties: { studentId: { type: 'string' }, studentName: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, classId: { type: 'string' } }, required: ['from', 'to'] },
  edit_attendance_cell: { write: true, keys: ['attendance_edit'], description: 'הצע עדכון סטטוס של תא נוכחות אחד. לא סימון קבוצתי.', properties: { fileId: { type: 'string' }, studentId: { type: 'string' }, dateKey: { type: 'string' }, statusId: { type: 'string' } }, required: ['fileId', 'studentId', 'dateKey'] },
  edit_attendance_note: { write: true, keys: ['attendance_edit'], description: 'הצע הוספה או עריכה של הערה בתא נוכחות אחד, בלי לשנות את הסטטוס.', properties: { fileId: { type: 'string' }, studentId: { type: 'string' }, dateKey: { type: 'string' }, note: { type: 'string' } }, required: ['fileId', 'studentId', 'dateKey', 'note'] },
  read_calendar: { write: false, keys: ['calendar.view', 'calendar_view'], description: 'הצע לקרוא אירועי גאנט בטווח תאריכים.', properties: { from: { type: 'string' }, to: { type: 'string' }, grade: { type: 'string' } }, required: ['from', 'to'] },
  create_calendar_event: { write: true, keys: ['calendar.create', 'calendar.edit', 'calendar_edit'], description: 'הצע יצירת אירוע אחד בגאנט. certainty confirmed כברירת מחדל, tentative הוא לא סגור.', properties: { title: { type: 'string' }, date: { type: 'string' }, category: { type: 'string' }, description: { type: 'string' }, grade: { type: 'string' }, certainty: { type: 'string', enum: ['confirmed', 'tentative'] } }, required: ['title', 'date'] },
  create_follow_up: { write: true, keys: ['tasks.create'], description: 'הצע מעקב (פולו-אפ) למשימה או לאירוע: סטטוס, אחראי, תאריך, צעד הבא, הערות.', properties: { title: { type: 'string' }, sourceType: { type: 'string', enum: ['task', 'event'] }, sourceId: { type: 'string' }, status: { type: 'string' }, ownerId: { type: 'string' }, dueDate: { type: 'string' }, nextStep: { type: 'string' }, notes: { type: 'string' } }, required: ['title', 'dueDate'] },
  create_class: { write: true, keys: ['classes.create', 'classes_create'], description: 'הצע יצירת כיתה אחת.', properties: { name: { type: 'string' }, gradeLevel: { type: 'string' }, academicYear: { type: 'string' } }, required: ['name'] },
  update_class: { write: true, keys: ['classes.update', 'classes_update'], description: 'הצע עדכון שם, שכבה או מחנך של כיתה אחת.', properties: { classId: { type: 'string' }, name: { type: 'string' }, gradeLevel: { type: 'string' }, teacherId: { type: 'string' } }, required: ['classId'] },
  create_team: { write: true, keys: ['teams_edit'], description: 'הצע יצירת צוות אחד.', properties: { name: { type: 'string' }, description: { type: 'string' } }, required: ['name'] },
  add_team_members: { write: true, keys: ['teams_edit'], description: 'הצע הוספת חברים לצוות, בלי להחליף את הרשימה.', properties: { teamId: { type: 'string' }, memberIds: { type: 'array', items: { type: 'string' } } }, required: ['teamId', 'memberIds'] },
  add_staff: { write: true, keys: ['staff_edit'], description: 'הצע הזמנת איש צוות. לא שומר סיסמה ולא מוחק.', properties: { fullName: { type: 'string' }, email: { type: 'string' }, role: { type: 'string', enum: ['viewer', 'editor'] } }, required: ['fullName', 'email'] },
  update_staff: { write: true, keys: ['staff_edit'], description: 'הצע עדכון שם, טלפון או תפקיד תיאורי של איש צוות.', properties: { userId: { type: 'string' }, fullName: { type: 'string' }, phone: { type: 'string' }, jobTitle: { type: 'string' } }, required: ['userId'] },
  set_staff_role: { write: true, keys: ['staff_edit'], description: 'הצע שינוי תפקיד מערכת לצופה או עורך בלבד.', properties: { userId: { type: 'string' }, role: { type: 'string', enum: ['viewer', 'editor'] } }, required: ['userId', 'role'] },
  set_staff_permission: { write: true, keys: ['staff_edit'], description: 'הצע מתן או הסרה של הרשאה אחת.', properties: { userId: { type: 'string' }, permission: { type: 'string' }, granted: { type: 'boolean' } }, required: ['userId', 'permission'] },
  deactivate_staff: { write: true, keys: ['staff_edit'], description: 'הצע השבתה או הפעלה. אין מחיקת משתמש.', properties: { userId: { type: 'string' }, active: { type: 'boolean' } }, required: ['userId'] },
  set_dashboard_layout: { write: true, keys: ['tasks.viewOwn'], description: 'הצע שינוי סידור הדשבורד של המשתמש עצמו בלבד: הוספה, הסרה, הזזה או גודל.', properties: { op: { type: 'string', enum: ['add', 'remove', 'move', 'resize'] }, type: { type: 'string' }, path: { type: 'string' }, size: { type: 'string', enum: ['half', 'full'] }, index: { type: 'number' }, direction: { type: 'string', enum: ['up', 'down'] } }, required: ['op'] },
}));

const WRITE_ASK = /(?:סמן|עדכן|עדכני|צור|צרי|הוסף|הוסיפי|תעד|תעדי|שנה|שני|קבע|קבעי|הכן|הכיני|פתח|פתחי|רשום|רשמי|ערוך|ערכי|תיצור|תפתח|\bcreate\b|\badd\b|\bupdate\b)/iu;
const READ_ASK = /(?:מה |איך |סכם|סכמי|הצג|הראה|כמה |נוכחות|אירוע|גאנט|לוח|מקרא)/u;

// A tool call is kept only when the person asked for it. Text inside a file or a task is not a request.
// `earlierText` is the user's previous message: an answer to Zoki's clarifying question
// ("the class is called X") continues the request that came before it.
export function guardProposals(userText, proposals = [], earlierText = '') {
  const text = String(userText || '');
  const write = WRITE_ASK.test(text) || WRITE_ASK.test(String(earlierText || ''));
  const read = write || READ_ASK.test(text);
  return proposals.filter(item => {
    const spec = V1_TOOLS[item?.tool];
    if (!spec) return false;
    return spec.write ? write : read;
  }).slice(0, 1);
}

export function v1ToolsFor(heldKeys = []) {
  const held = new Set(heldKeys);
  return Object.entries(V1_TOOLS).filter(([, spec]) => spec.keys.some(key => held.has(key))).map(([name]) => name);
}
