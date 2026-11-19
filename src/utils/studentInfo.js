// What a student card should contain. Used to show a small "missing info" triangle.
export function missingStudentInfo(student = {}) {
  const missing = [];
  if (!String(student.parentPhone || '').trim()) missing.push('טלפון הורה');
  if (!String(student.phone || '').trim()) missing.push('טלפון תלמיד');
  if (!student.joinedAt) missing.push('תאריך הצטרפות');
  if (!(student.trackIds?.length || student.trackId)) missing.push('מגמה');
  return missing;
}
