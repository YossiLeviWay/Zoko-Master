// Tools the Worker may PROPOSE. The browser confirms and writes. Document text is not a user turn.
export const V1_TOOLS = Object.freeze({
  create_personal_task: { write: true, keys: ['tasks.create'], description: 'הצע משימה אישית. לא שומר כלום.', properties: { title: { type: 'string' }, dueDate: { type: 'string' }, description: { type: 'string' } }, required: ['title'] },
  create_school_task: { write: true, keys: ['tasks.create'], description: 'הצע משימת מוסד לאדם אחד או לצוות. לא שומר כלום.', properties: { title: { type: 'string' }, dueDate: { type: 'string' }, description: { type: 'string' }, assigneeId: { type: 'string' }, teamId: { type: 'string' } }, required: ['title'] },
  update_task_fields: { write: true, keys: ['tasks.editAll', 'tasks.create'], description: 'הצע עדכון כותרת, תיאור או תאריך של משימה אחת.', properties: { taskId: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, dueDate: { type: 'string' } }, required: ['taskId'] },
  set_task_status: { write: true, keys: ['tasks.editAll', 'tasks.viewOwn'], description: 'הצע שינוי סטטוס של משימה אחת.', properties: { taskId: { type: 'string' }, status: { type: 'string', enum: ['todo', 'in_progress', 'done'] } }, required: ['taskId', 'status'] },
  set_task_assignee: { write: true, keys: ['tasks.assign'], description: 'הצע שיוך אחראי אחד למשימה.', properties: { taskId: { type: 'string' }, assigneeId: { type: 'string' }, assigned: { type: 'boolean' } }, required: ['taskId', 'assigneeId'] },
  read_attendance: { write: false, keys: ['attendance_view', 'attendance_edit'], description: 'הצע לקרוא נוכחות של תלמיד אחד בטווח תאריכים, כולל קודים והערות.', properties: { studentId: { type: 'string' }, studentName: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, classId: { type: 'string' } }, required: ['from', 'to'] },
  edit_attendance_cell: { write: true, keys: ['attendance_edit'], description: 'הצע עדכון סטטוס של תא נוכחות אחד. לא סימון קבוצתי.', properties: { fileId: { type: 'string' }, studentId: { type: 'string' }, dateKey: { type: 'string' }, statusId: { type: 'string' } }, required: ['fileId', 'studentId', 'dateKey'] },
  edit_attendance_note: { write: true, keys: ['attendance_edit'], description: 'הצע הוספה או עריכה של הערה בתא נוכחות אחד, בלי לשנות את הסטטוס.', properties: { fileId: { type: 'string' }, studentId: { type: 'string' }, dateKey: { type: 'string' }, note: { type: 'string' } }, required: ['fileId', 'studentId', 'dateKey', 'note'] },
  read_calendar: { write: false, keys: ['calendar.view', 'calendar_view'], description: 'הצע לקרוא אירועי גאנט בטווח תאריכים.', properties: { from: { type: 'string' }, to: { type: 'string' }, grade: { type: 'string' } }, required: ['from', 'to'] },
  create_calendar_event: { write: true, keys: ['calendar.create', 'calendar.edit', 'calendar_edit'], description: 'הצע יצירת אירוע אחד בגאנט.', properties: { title: { type: 'string' }, date: { type: 'string' }, category: { type: 'string' }, description: { type: 'string' }, grade: { type: 'string' } }, required: ['title', 'date'] },
  create_follow_up: { write: true, keys: ['tasks.create'], description: 'הצע מעקב (פולו-אפ) למשימה או לאירוע: סטטוס, אחראי, תאריך, צעד הבא, הערות.', properties: { title: { type: 'string' }, sourceType: { type: 'string', enum: ['task', 'event'] }, sourceId: { type: 'string' }, status: { type: 'string' }, ownerId: { type: 'string' }, dueDate: { type: 'string' }, nextStep: { type: 'string' }, notes: { type: 'string' } }, required: ['title', 'dueDate'] },
  create_class: { write: true, keys: ['classes.create', 'classes_create'], description: 'הצע יצירת כיתה אחת.', properties: { name: { type: 'string' }, gradeLevel: { type: 'string' }, academicYear: { type: 'string' } }, required: ['name'] },
  update_class: { write: true, keys: ['classes.update', 'classes_update'], description: 'הצע עדכון שם, שכבה או מחנך של כיתה אחת.', properties: { classId: { type: 'string' }, name: { type: 'string' }, gradeLevel: { type: 'string' }, teacherId: { type: 'string' } }, required: ['classId'] },
  create_team: { write: true, keys: ['teams_edit'], description: 'הצע יצירת צוות אחד.', properties: { name: { type: 'string' }, description: { type: 'string' } }, required: ['name'] },
  add_team_members: { write: true, keys: ['teams_edit'], description: 'הצע הוספת חברים לצוות, בלי להחליף את הרשימה.', properties: { teamId: { type: 'string' }, memberIds: { type: 'array', items: { type: 'string' } } }, required: ['teamId', 'memberIds'] },
});

const WRITE_ASK = /(?:סמן|עדכן|עדכני|צור|צרי|הוסף|הוסיפי|תעד|תעדי|שנה|שני|קבע|קבעי|הכן|הכיני|פתח|פתחי|רשום|רשמי|ערוך|ערכי|תיצור|תפתח|\bcreate\b|\badd\b|\bupdate\b)/iu;
const READ_ASK = /(?:מה |איך |סכם|סכמי|הצג|הראה|כמה |נוכחות|אירוע|גאנט|לוח|מקרא)/u;

// A tool call is kept only when the person asked for it. Text inside a file or a task is not a request.
export function guardProposals(userText, proposals = []) {
  const text = String(userText || '');
  const write = WRITE_ASK.test(text);
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
