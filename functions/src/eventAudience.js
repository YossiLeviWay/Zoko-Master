// Decides WHO an event or task is relevant to, so reminders reach only the
// people involved. Pure and deterministic: no model call, no network.
//
// event:  { kind, subject, grade, classIds[], roleIds[], userIds[], schoolWide }
// staff:  [{ id, roleIds[], subjects[], homeroomClassIds[], teachingClassIds[], grades[] }]
// classes:[{ id, grade }]
//
// Rules (a person is included when ANY applies, each with a reason):
//   - named directly (userIds)                         -> 'direct'
//   - holds a role listed in event.roleIds             -> 'role'
//   - is homeroom teacher of a targeted class/grade    -> 'homeroom'
//   - teaches the event subject in a targeted class    -> 'subject-teacher'
//   - coordinates the subject / track / grade targeted -> 'coordinator'
//   - management team always sees school-wide events   -> 'management'
// Exams (kind === 'exam') also notify the pedagogical coordinator.

const COORDINATOR_FOR = { subject: 'subject_coordinator', grade: 'grade_coordinator' };

export function eventTargets(event, classes = []) {
  const classIds = new Set(event.classIds || []);
  const grades = new Set(event.grade ? [event.grade] : []);
  for (const cls of classes) {
    if (classIds.has(cls.id) && cls.grade) grades.add(cls.grade);
    if (event.grade && cls.grade === event.grade) classIds.add(cls.id);
  }
  return { classIds, grades };
}

export function eventAudience(event, staff = [], classes = [], { managementRoleIds = [] } = {}) {
  const { classIds, grades } = eventTargets(event, classes);
  const wanted = new Set(event.roleIds || []);
  if (event.kind === 'exam') wanted.add('pedagogical_coordinator');
  const direct = new Set(event.userIds || []);
  const result = [];
  for (const person of staff) {
    const reasons = [];
    const roles = new Set(person.roleIds || []);
    if (direct.has(person.id)) reasons.push('direct');
    if ([...wanted].some(id => roles.has(id))) reasons.push('role');
    if ((person.homeroomClassIds || []).some(id => classIds.has(id))) reasons.push('homeroom');
    if (event.subject && (person.subjects || []).includes(event.subject) && (person.teachingClassIds || []).some(id => classIds.has(id))) reasons.push('subject-teacher');
    if (event.subject && roles.has(COORDINATOR_FOR.subject) && (person.subjects || []).includes(event.subject)) reasons.push('coordinator');
    if (grades.size && roles.has(COORDINATOR_FOR.grade) && (person.grades || []).some(grade => grades.has(grade))) reasons.push('coordinator');
    if (event.schoolWide && managementRoleIds.some(id => roles.has(id))) reasons.push('management');
    if (reasons.length) result.push({ id: person.id, reasons: [...new Set(reasons)] });
  }
  return result;
}
