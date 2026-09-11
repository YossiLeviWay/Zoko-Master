export const staffSchoolIds = user => [...new Set([user.schoolId, ...(user.schoolIds || [])].filter(Boolean))];
export const schoolJobTitle = (user, schoolId) => user.jobTitlesBySchool?.[schoolId] ?? user.jobTitle ?? '';
const protectedRoles = ['principal', 'institution_manager', 'global_admin', 'platform_admin'];
export function canManageStaffMember(actor, target, schoolId) {
  return actor.uid !== target.uid && staffSchoolIds(actor).includes(schoolId)
    && ['principal', 'institution_manager'].includes(actor.rolesBySchool?.[schoolId] || actor.role)
    && staffSchoolIds(target).includes(schoolId)
    && !protectedRoles.includes(target.role) && !protectedRoles.includes(target.rolesBySchool?.[schoolId]);
}

export function staffMutation(target, schoolId, operation, title) {
  if (operation === 'jobTitle') {
    const value = String(title || '').trim();
    if (!value || value.length > 160) throw new Error('invalid-input');
    return { jobTitlesBySchool: { ...target.jobTitlesBySchool, [schoolId]: value },
      ...(staffSchoolIds(target).length === 1 ? { jobTitle: value } : {}) };
  }
  if (operation !== 'remove') throw new Error('invalid-input');
  const schoolIds = staffSchoolIds(target).filter(id => id !== schoolId);
  return { schoolIds, schoolId: target.schoolId === schoolId ? schoolIds[0] || '' : target.schoolId || '',
    pendingSchools: (target.pendingSchools || []).filter(id => id !== schoolId),
    accountStatus: schoolIds.length ? target.accountStatus || 'active' : 'pending' };
}

export function staffChangeError(error) {
  if (error?.code === 'stale-proposal' || error?.message === 'stale-proposal') return 'התפקיד השתנה מאז פתיחת ההצעה. פתחו הצעה חדשה לפני השמירה.';
  if (error?.code === 'permission-denied' || error?.message === 'permission-denied') return 'אין הרשאה לביצוע השינוי, או שכללי הגישה המעודכנים עדיין לא פורסמו. לא בוצע שינוי.';
  return 'השינוי לא נשמר. נסו שוב; הפרטים נשארו פתוחים.';
}

// Only school directory information may enter the assistant's source catalog.
export function zokiStaffFields(user, schoolId) {
  if (!user || !staffSchoolIds(user).includes(schoolId) || (user.accountStatus && user.accountStatus !== 'active')) return null;
  return { fullName: user.fullName || '', jobTitle: schoolJobTitle(user, schoolId) };
}
