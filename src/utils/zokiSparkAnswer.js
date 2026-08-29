const normalize = value => String(value || '')
  .normalize('NFKC')
  .replace(/[\u0591-\u05C7]/gu, '')
  .replace(/[״”]/gu, '"')
  .replace(/[׳’]/gu, "'")
  .replace(/[^\p{L}\p{N}\s'"-]/gu, ' ')
  .replace(/\s+/gu, ' ')
  .trim()
  .toLocaleLowerCase('he-IL');

const CAPABILITY_QUESTION = /(?:מה|איך)\s+(?:אתה|את)\s+(?:יכול|יכולה)|במה\s+(?:אתה|את)\s+(?:יכול|יכולה)\s+לעזור|מה\s+אפשר\s+(?:לעשות|לשאול)/u;
const TASK_HELP_QUESTION = /איך\s+(?:יוצרים|יוצר|יוצרת|ליצור|פותחים|לפתוח)\s+משימה/u;
const COUNT_QUESTION = /כמה|מספר/u;
const STUDENT_TERMS = /תלמיד|תלמידה|תלמידים|תלמידות|לומד|לומדת/u;
const CLASS_TERMS = /כיתה|כיתות|שכבה|לומד|לומדת|מחנך|מחנכת/u;
const TRACK_TERMS = /מגמה|מגמות|מסלול|מסלולים/u;
const GRADE_TERMS = /ציון|ציונים|מבחן|הערכה/u;
const ATTENDANCE_TERMS = /נוכחות|חיסור|חיסורים|איחור|איחורים|נעדר|נעדרה/u;
const HISTORY_TERMS = /היסטוריה|היסטוריית|הערה|הערות|תיעוד/u;
const STAFF_TERMS = /מורה|מורים|צוות|סגל|עובד|עובדת|תפקיד/u;
const TASK_TERMS = /משימה|משימות|מטלה|מטלות/u;
const FILE_TERMS = /קובץ|קבצים|מסמך|מסמכים|תיקייה|תיקיות/u;
const TEAM_TERMS = /צוות|צוותים/u;
const EVENT_TERMS = /אירוע|אירועים|לוח|חופשה|חג|מועד/u;
const CONTACT_TERMS = /איש קשר|אנשי קשר|טלפון|מייל|דוא["']?ל/u;
const INITIATIVE_TERMS = /יוזמה|יוזמות|תכנית|תכניות|תוכנית|תוכניות|אבן דרך/u;
const KNOWLEDGE_TERMS = /נוהל|נהלים|כלל|כללים|חוק|חוקים|הנחיה|הנחיות|מדיניות|בית ספרי|מוסדי/u;

const array = value => Array.isArray(value) ? value : [];
const text = value => typeof value === 'string' ? value.trim() : '';
const unique = values => [...new Set(values.filter(Boolean))];
const MATCH_STOP_WORDS = new Set([
  'איזה', 'איזו', 'איך', 'איפה', 'אלה', 'אני', 'אנשי', 'את', 'בבקשה', 'בתוך',
  'האם', 'הוא', 'היא', 'זה', 'זאת', 'יש', 'כאן', 'כמה', 'מה', 'מי', 'של',
  'צוות', 'צוותים', 'חבר', 'חברי', 'חברים',
]);

function displayName(item, fallback = '') {
  return text(item?.fullName || item?.displayName || item?.name || item?.title) || fallback;
}

function fieldText(value) {
  return Array.isArray(value) ? value.map(fieldText).filter(Boolean).join(' ') : text(value);
}

function tokenForms(value) {
  const normalized = normalize(value);
  const forms = new Set([normalized]);
  if (normalized.length > 3 && /^[בלמהוכש]/u.test(normalized)) forms.add(normalized.slice(1));
  [...forms].forEach(form => {
    if (form.length > 4 && form.endsWith('ים')) forms.add(form.slice(0, -2));
    if (form.length > 4 && form.endsWith('ות')) forms.add(form.slice(0, -2));
  });
  return forms;
}

function meaningfulTokens(value) {
  return normalize(value).split(/\s+/u).filter(Boolean).filter(token => {
    const forms = tokenForms(token);
    return token.length > 1 && ![...forms].some(form => MATCH_STOP_WORDS.has(form));
  });
}

function tokenMatches(left, right) {
  const rightForms = tokenForms(right);
  return [...tokenForms(left)].some(form => rightForms.has(form));
}

function matchScore(question, item, fields = []) {
  const haystack = normalize(question);
  const labels = unique([displayName(item), ...fields.map(field => fieldText(item?.[field]))]).map(normalize);
  const exact = labels.filter(label => label.length >= 2 && haystack.includes(label));
  if (exact.length) return 100 + Math.max(...exact.map(label => label.length));

  const questionTokens = meaningfulTokens(question);
  let best = 0;
  labels.forEach(label => {
    const labelTokens = meaningfulTokens(label);
    const matches = labelTokens.filter(labelToken => questionTokens.some(questionToken => tokenMatches(labelToken, questionToken))).length;
    if (!matches) return;
    const coverage = matches / Math.max(1, labelTokens.length);
    best = Math.max(best, matches * 10 + coverage);
  });
  return best;
}

function bestMatch(question, items, fields = []) {
  return array(items)
    .map(item => ({ item, score: matchScore(question, item, fields) }))
    .filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score || normalize(displayName(right.item)).length - normalize(displayName(left.item)).length)[0]?.item || null;
}

function source(id, label, route) {
  return { id, label, route };
}

function studentName(student) {
  return displayName(student, text(`${student?.firstName || ''} ${student?.lastName || ''}`));
}

function classNameFor(student, classes) {
  return text(student?.className) || displayName(array(classes).find(item => item.id === student?.classId));
}

function trackNamesFor(student, tracks) {
  const ids = unique([...array(student?.trackIds), student?.trackId]);
  const names = ids.map(id => displayName(array(tracks).find(item => item.id === id))).filter(Boolean);
  return unique([...names, ...array(student?.programTypes).map(text), text(student?.programType)]);
}

function staffNameById(id, staff) {
  return displayName(array(staff).find(item => item.id === id), 'לא משויך');
}

function staffRoleNames(member, roles) {
  const roleIds = unique([...array(member?.roleIds), member?.roleId]);
  return unique([
    ...array(member?.roleNames),
    ...roleIds.map(id => displayName(array(roles).find(item => item.id === id))),
    text(member?.jobTitle),
    text(member?.roleName),
  ]);
}

function formatStudentDetails({ student, classes, tracks, canViewSensitive }) {
  const names = trackNamesFor(student, tracks);
  const parts = [
    classNameFor(student, classes) && `כיתה: ${classNameFor(student, classes)}`,
    text(student.gradeLevel) && `שכבה: ${student.gradeLevel}`,
    names.length && `מגמות/מסלולים: ${names.join(', ')}`,
    text(student.status) && `מצב: ${student.status}`,
    canViewSensitive && text(student.phone) && `טלפון: ${student.phone}`,
    canViewSensitive && text(student.parentPhone) && `טלפון הורה: ${student.parentPhone}`,
  ].filter(Boolean);
  return parts.length ? parts.join('\n') : 'לא נמצאו פרטים נוספים ברשומה.';
}

function formatGrades(details) {
  const books = array(details?.gradebooks);
  if (!books.length) return 'לא נמצאו ציונים זמינים לתלמיד/ה במיפויי הציונים המורשים.';
  const lines = [];
  books.forEach(book => array(book.subjects).forEach(subject => {
    const calculated = book.calculated?.[subject.id];
    const components = array(subject.components).map(component => {
      const value = book.scores?.[subject.id]?.[component.id];
      return value === '' || value === null || value === undefined ? '' : `${component.name || 'רכיב'}: ${value}`;
    }).filter(Boolean);
    const suffix = calculated === '' || calculated === null || calculated === undefined ? '' : `ציון סופי: ${calculated}`;
    lines.push(`${subject.name || 'מקצוע'} — ${[...components, suffix].filter(Boolean).join(', ') || 'ללא ציונים'}`);
  }));
  return lines.length ? lines.slice(0, 20).join('\n') : 'מיפוי הציונים קיים, אך עדיין לא הוזנו ציונים.';
}

function formatAttendance(details) {
  const sheets = array(details?.attendance);
  if (!sheets.length) return 'לא נמצאו נתוני נוכחות זמינים לתלמיד/ה בגיליונות המורשים.';
  const totals = new Map();
  let records = 0;
  sheets.forEach(sheet => array(sheet.records).forEach(record => {
    records += 1;
    const label = sheet.legend?.[record.primaryStatusId] || record.primaryStatusId || 'ללא סטטוס';
    totals.set(label, (totals.get(label) || 0) + 1);
  }));
  const summary = [...totals.entries()].map(([label, count]) => `${label}: ${count}`).join(', ');
  return records ? `${records} רישומי נוכחות — ${summary}` : 'נמצאו גיליונות נוכחות, אך אין בהם רישומים לתלמיד/ה.';
}

function formatHistory(details) {
  const lines = [
    ...array(details?.history).map(item => item.description || item.reason || item.type || 'שינוי ברשומה'),
    ...array(details?.notes).map(item => item.content || item.text || item.note || '').filter(Boolean),
  ];
  return lines.length ? lines.slice(0, 15).join('\n') : 'לא נמצאו היסטוריה או הערות שמותר לך לראות.';
}

function genericSearch(question, groups) {
  const terms = normalize(question).split(/\s+/u).filter(term => term.length > 1);
  const results = [];
  groups.forEach(group => array(group.items).forEach(item => {
    const label = displayName(item);
    const searchable = normalize([label, ...group.searchFields.map(field => {
      const value = item?.[field];
      return Array.isArray(value) ? value.join(' ') : String(value || '');
    })].join(' '));
    const score = terms.reduce((total, term) => total + (searchable.includes(term) ? 1 : 0), 0);
    if (score > 0 && label) results.push({ ...group, item, label, score });
  }));
  return results.sort((left, right) => right.score - left.score).slice(0, 8);
}

function knowledgeAnswer(question, { approvedRules, playbooks, brainEntries, brainInstructions }) {
  const words = normalize(question).split(/\s+/u).filter(word => word.length > 2 && !KNOWLEDGE_TERMS.test(word));
  const records = [
    ...array(brainEntries).filter(item => item.status !== 'draft').map(item => ({
      id: item.id, title: displayName(item, item.category || 'ידע מוסדי'), body: text(item.body),
    })),
    ...array(approvedRules).map((item, index) => ({ id: `rule_${index}`, title: 'כלל עבודה מוסדי', body: text(item) })),
    ...array(playbooks).map((item, index) => ({
      id: item.id || `playbook_${index}`, title: displayName(item, 'תהליך עבודה'),
      body: text(item.description || item.guidance || array(item.steps).map(step => displayName(step, text(step))).join('\n')),
    })),
  ].filter(item => item.body);
  if (text(brainInstructions)) records.push({ id: 'brain_instructions', title: 'הנחיות כלליות', body: text(brainInstructions) });
  const ranked = records.map(item => {
    const searchable = normalize(`${item.title} ${item.body}`);
    return {
      ...item,
      score: words.reduce((total, word) => total + (
        searchable.includes(word) || (word.length >= 4 && searchable.includes(word.slice(0, 4))) ? 1 : 0
      ), 0),
    };
  }).filter(item => item.score > 0).sort((left, right) => right.score - left.score).slice(0, 3);
  if (!ranked.length) return null;
  return {
    answer: ranked.map(item => `${item.title}:\n${item.body}`).join('\n\n'),
    sources: ranked.map(item => source(`knowledge_${item.id}`, item.title, '')),
  };
}

export async function answerZokiOnSpark({ question, data = {}, canViewSensitive = false, loadStudentDetails } = {}) {
  const normalizedQuestion = normalize(question);
  if (!normalizedQuestion) return null;
  const students = array(data.students);
  const classes = array(data.classes);
  const tracks = array(data.tracks);
  const staff = array(data.staff);
  const roles = array(data.roles);
  const teams = array(data.teams);
  const tasks = array(data.tasks);
  const files = array(data.files);
  const events = [...array(data.events), ...array(data.holidays)];
  const initiatives = array(data.initiatives);
  const contacts = array(data.contacts);

  if (KNOWLEDGE_TERMS.test(normalizedQuestion)) {
    const answer = knowledgeAnswer(question, data);
    if (answer) return answer;
  }

  if (CAPABILITY_QUESTION.test(normalizedQuestion)) return {
    answer: 'אני מחובר לנתונים שמותר לך לראות ב־Firebase ויכול לחפש תלמידים, כיתות, מגמות, צוות, משימות, קבצים, ציונים, נוכחות, אירועים, יוזמות ואנשי קשר. מידע שאין לך הרשאה אליו אינו נטען אליי.',
    sources: [],
  };
  if (TASK_HELP_QUESTION.test(normalizedQuestion)) return {
    answer: 'אפשר לכתוב איזו משימה ליצור, למי היא מיועדת ומה תאריך היעד. אכין הצעה מסודרת ואבקש אישור לפני שמירה.',
    sources: [],
  };

  const student = bestMatch(question, students, ['firstName', 'lastName']);
  const matchedClass = bestMatch(question, classes, ['className', 'gradeLevel']);
  const matchedTrack = bestMatch(question, tracks);

  if (student) {
    const name = studentName(student);
    if (GRADE_TERMS.test(normalizedQuestion)) {
      const details = loadStudentDetails ? await loadStudentDetails(student, question) : {};
      return { answer: `הציונים של ${name}:\n${formatGrades(details)}`, sources: [source(`student_${student.id}`, name, '/students')] };
    }
    if (ATTENDANCE_TERMS.test(normalizedQuestion)) {
      const details = loadStudentDetails ? await loadStudentDetails(student, question) : {};
      return { answer: `הנוכחות של ${name}:\n${formatAttendance(details)}`, sources: [source(`student_${student.id}`, name, '/students')] };
    }
    if (HISTORY_TERMS.test(normalizedQuestion)) {
      const details = loadStudentDetails ? await loadStudentDetails(student, question) : {};
      return { answer: `המידע ההיסטורי המורשה של ${name}:\n${formatHistory(details)}`, sources: [source(`student_${student.id}`, name, '/students')] };
    }
    if (TRACK_TERMS.test(normalizedQuestion)) {
      const names = trackNamesFor(student, tracks);
      return { answer: names.length ? `${name} משויך/ת ל${names.length > 1 ? 'מסלולים' : 'מסלול'}: ${names.join(', ')}.` : `${name} אינו/ה משויך/ת כרגע למגמה או למסלול.`, sources: [source(`student_${student.id}`, name, '/students')] };
    }
    if (CLASS_TERMS.test(normalizedQuestion)) {
      const nameOfClass = classNameFor(student, classes);
      return { answer: nameOfClass ? `${name} לומד/ת בכיתה ${nameOfClass}.` : `מצאתי את ${name}, אבל לא רשום כרגע שיוך לכיתה.`, sources: [source(`student_${student.id}`, name, '/students')] };
    }
    if (/טלפון|נייד|תעודת זהות|מספר זהות/u.test(normalizedQuestion) && !canViewSensitive) {
      return { answer: 'אין לך הרשאה לקבל את פרטי הזיהוי או הקשר המבוקשים.', sources: [] };
    }
    return { answer: `${name}:\n${formatStudentDetails({ student, classes, tracks, canViewSensitive })}`, sources: [source(`student_${student.id}`, name, '/students')] };
  }

  if (matchedClass && STUDENT_TERMS.test(normalizedQuestion)) {
    const classStudents = students.filter(item => item.classId === matchedClass.id || normalize(item.className) === normalize(displayName(matchedClass)));
    if (COUNT_QUESTION.test(normalizedQuestion)) return { answer: `בכיתה ${displayName(matchedClass)} יש ${classStudents.length} תלמידים שמותר לך לראות.`, sources: [source(`class_${matchedClass.id}`, displayName(matchedClass), '/students')] };
    return { answer: classStudents.length ? `התלמידים בכיתה ${displayName(matchedClass)}:\n${classStudents.map(studentName).sort((a, b) => a.localeCompare(b, 'he')).join('\n')}` : `לא נמצאו תלמידים בכיתה ${displayName(matchedClass)} בתוך המידע המורשה.`, sources: [source(`class_${matchedClass.id}`, displayName(matchedClass), '/students')] };
  }
  if (matchedClass) {
    const teacher = text(matchedClass.teacherName || matchedClass.homeroomTeacherName)
      || staffNameById(matchedClass.teacherId || matchedClass.homeroomTeacherId, staff);
    return { answer: `כיתה ${displayName(matchedClass)}\nשכבה: ${matchedClass.gradeLevel || 'לא צוינה'}\nמחנך/ת: ${teacher}\nשנת לימודים: ${matchedClass.academicYearLabel || matchedClass.academicYear || 'לא צוינה'}`, sources: [source(`class_${matchedClass.id}`, displayName(matchedClass), '/students')] };
  }
  if (matchedTrack) {
    const trackStudents = students.filter(item => unique([...array(item.trackIds), item.trackId]).includes(matchedTrack.id));
    if (COUNT_QUESTION.test(normalizedQuestion)) return { answer: `במגמת ${displayName(matchedTrack)} יש ${trackStudents.length} תלמידים שמותר לך לראות.`, sources: [source(`track_${matchedTrack.id}`, displayName(matchedTrack), '/students')] };
    return { answer: trackStudents.length ? `התלמידים במגמת ${displayName(matchedTrack)}:\n${trackStudents.map(studentName).sort((a, b) => a.localeCompare(b, 'he')).join('\n')}` : `לא נמצאו תלמידים במגמת ${displayName(matchedTrack)} בתוך המידע המורשה.`, sources: [source(`track_${matchedTrack.id}`, displayName(matchedTrack), '/students')] };
  }

  const team = bestMatch(question, teams, ['aliases', 'keywords', 'description', 'responsibility', 'responsibilityAreas', 'typicalTaskTypes']);
  if (team && TEAM_TERMS.test(normalizedQuestion)) {
    const memberNames = unique(array(team.memberIds).map(id => staffNameById(id, staff)));
    return { answer: `${displayName(team)}\n${team.description || team.responsibility || 'ללא תיאור'}\nחברים: ${memberNames.join(', ') || 'לא צוינו'}`, sources: [source(`team_${team.id}`, displayName(team), '/teams')] };
  }
  const staffMember = bestMatch(question, staff, ['jobTitle', 'email']);
  if (staffMember && (STAFF_TERMS.test(normalizedQuestion) || CONTACT_TERMS.test(normalizedQuestion))) {
    const roleNames = staffRoleNames(staffMember, roles);
    return { answer: `${displayName(staffMember)}\nתפקידים: ${roleNames.join(', ') || 'לא צוינו'}\nדוא״ל: ${staffMember.email || 'לא צוין'}\nטלפון: ${staffMember.phone || 'לא צוין'}`, sources: [source(`staff_${staffMember.id}`, displayName(staffMember), '/staff')] };
  }
  const task = bestMatch(question, tasks, ['description']);
  if (task && TASK_TERMS.test(normalizedQuestion)) return { answer: `${displayName(task)}\nמצב: ${task.status || 'לביצוע'}\nעדיפות: ${task.priority || 'רגילה'}\nתאריך יעד: ${task.dueDate || 'לא נקבע'}\n${task.description || ''}`.trim(), sources: [source(`task_${task.id}`, displayName(task), '/tasks')] };
  const file = bestMatch(question, files, ['description', 'className', 'fileType']);
  if (file && FILE_TERMS.test(normalizedQuestion)) return { answer: `${displayName(file)}\nסוג: ${file.fileType || file.type || 'קובץ'}\nכיתה: ${file.className || 'לא משויך לכיתה'}\n${file.description || ''}`.trim(), sources: [source(`file_${file.id}`, displayName(file), '/files')] };
  const event = bestMatch(question, events, ['description', 'date', 'startDate']);
  if (event && EVENT_TERMS.test(normalizedQuestion)) return { answer: `${displayName(event)}\nתאריך: ${event.date || event.startDate || event.dateKey || 'לא צוין'}\n${event.description || ''}`.trim(), sources: [source(`event_${event.id}`, displayName(event), '/calendar')] };
  const initiative = bestMatch(question, initiatives, ['description']);
  if (initiative && INITIATIVE_TERMS.test(normalizedQuestion)) return { answer: `${displayName(initiative)}\nמצב: ${initiative.status || 'לא צוין'}\n${initiative.description || ''}`.trim(), sources: [source(`initiative_${initiative.id}`, displayName(initiative), '/tasks')] };
  const contact = bestMatch(question, contacts, ['organization', 'primaryEmail', 'phone']);
  if (contact && CONTACT_TERMS.test(normalizedQuestion)) return { answer: `${displayName(contact)}\nארגון: ${contact.organization || 'לא צוין'}\nדוא״ל: ${contact.primaryEmail || 'לא צוין'}\nטלפון: ${contact.phone || 'לא צוין'}`, sources: [source(`contact_${contact.id}`, displayName(contact), '/contacts')] };

  if (COUNT_QUESTION.test(normalizedQuestion)) {
    const counts = [
      STUDENT_TERMS.test(normalizedQuestion) && `${students.length} תלמידים`,
      /כית/u.test(normalizedQuestion) && `${classes.length} כיתות`,
      STAFF_TERMS.test(normalizedQuestion) && `${staff.length} אנשי צוות`,
      TASK_TERMS.test(normalizedQuestion) && `${tasks.length} משימות`,
      FILE_TERMS.test(normalizedQuestion) && `${files.length} קבצים`,
      TEAM_TERMS.test(normalizedQuestion) && `${teams.length} צוותים`,
      EVENT_TERMS.test(normalizedQuestion) && `${events.length} אירועים ומועדים`,
    ].filter(Boolean);
    if (counts.length) return { answer: `במידע שמותר לך לראות יש ${counts.join(', ')}.`, sources: [] };
  }

  const matches = genericSearch(question, [
    { type: 'student', items: students, route: '/students', searchFields: ['className', 'gradeLevel', 'programTypes'] },
    { type: 'class', items: classes, route: '/students', searchFields: ['gradeLevel', 'academicYear'] },
    { type: 'staff', items: staff, route: '/staff', searchFields: ['jobTitle', 'email'] },
    { type: 'team', items: teams, route: '/teams', searchFields: ['aliases', 'keywords', 'description', 'responsibility', 'responsibilityAreas', 'typicalTaskTypes'] },
    { type: 'task', items: tasks, route: '/tasks', searchFields: ['description', 'status', 'dueDate'] },
    { type: 'file', items: files, route: '/files', searchFields: ['description', 'className', 'fileType'] },
    { type: 'event', items: events, route: '/calendar', searchFields: ['description', 'date', 'startDate'] },
    { type: 'initiative', items: initiatives, route: '/tasks', searchFields: ['description', 'status'] },
    { type: 'contact', items: contacts, route: '/contacts', searchFields: ['organization', 'primaryEmail'] },
  ]);
  if (matches.length) return {
    answer: `מצאתי במידע המורשה:\n${matches.map(item => `• ${item.label}`).join('\n')}`,
    sources: matches.slice(0, 5).map(item => source(`${item.type}_${item.item.id}`, item.label, item.route)),
  };
  return { answer: 'לא מצאתי תשובה מתאימה בתוך המידע שיש לך הרשאה לראות. אפשר לכתוב שם מלא או לציין אם מדובר בתלמיד, כיתה, מגמה, איש צוות, משימה, קובץ, ציון, נוכחות או אירוע.', sources: [] };
}
