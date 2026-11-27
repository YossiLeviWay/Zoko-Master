// What a student card should contain. Used to show a small "missing info" triangle.
export function missingStudentInfo(student = {}) {
  const missing = [];
  if (!String(student.parentPhone || '').trim()) missing.push('טלפון הורה');
  if (!String(student.phone || '').trim()) missing.push('טלפון תלמיד');
  if (!student.joinedAt) missing.push('תאריך הצטרפות');
  if (!(student.trackIds?.length || student.trackId)) missing.push('מגמה');
  return missing;
}

// The one gap worth flagging in a list: nobody to call, neither the student nor a parent.
export function hasNoContactPhone(student = {}) {
  return !String(student.parentPhone || '').trim() && !String(student.phone || '').trim();
}
