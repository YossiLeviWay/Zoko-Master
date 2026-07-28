export const INITIATIVE_STATUSES = Object.freeze({
  active: 'פעילה',
  completed: 'הושלמה',
  archived: 'בארכיון',
  cancelled: 'בוטלה',
});

export const INITIATIVE_HEALTH = Object.freeze({
  on_track: 'במסלול',
  attention: 'דורשת תשומת לב',
  at_risk: 'בסיכון',
  completed: 'הושלמה',
});

export const MILESTONE_STATUSES = Object.freeze({
  not_started: 'טרם התחיל',
  in_progress: 'בתהליך',
  waiting_external: 'ממתין לגורם חיצוני',
  blocked: 'חסום',
  completed: 'הושלם',
  cancelled: 'בוטל',
});

export const MILESTONE_DATE_TYPES = Object.freeze({
  exact: 'תאריך מדויק',
  range: 'טווח תאריכים',
  proposed: 'תאריך מוצע',
  unset: 'טרם נקבע',
});

export const UPDATE_TYPES = Object.freeze({
  progress: 'התקדמות',
  decision: 'החלטה',
  blocker: 'חסם',
  achievement: 'הישג',
  help: 'בקשה לעזרה',
  meeting: 'סיכום מפגש',
});

export function safeInitiativeIdList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()))];
}

export function milestoneDate(milestone) {
  if (!milestone || milestone.dateType === 'unset') return '';
  if (milestone.dateType === 'proposed') return milestone.proposedDate || '';
  if (milestone.dateType === 'range') return milestone.endDate || milestone.startDate || '';
  return milestone.startDate || '';
}

export function initiativeProgress(milestones = []) {
  const active = milestones.filter(item => item.status !== 'cancelled');
  if (active.length === 0) {
    return { percent: null, completed: 0, total: 0, completedWeight: 0, totalWeight: 0, label: 'לא הוגדרו אבני דרך' };
  }
  const weight = item => Number.isFinite(Number(item.weight)) && Number(item.weight) > 0 ? Number(item.weight) : 1;
  const totalWeight = active.reduce((sum, item) => sum + weight(item), 0);
  const completedItems = active.filter(item => item.status === 'completed');
  const completedWeight = completedItems.reduce((sum, item) => sum + weight(item), 0);
  return {
    percent: Math.round((completedWeight / totalWeight) * 100),
    completed: completedItems.length,
    total: active.length,
    completedWeight,
    totalWeight,
    label: `${completedItems.length} מתוך ${active.length} אבני דרך הושלמו`,
  };
}

export function nextInitiativeMilestone(milestones = [], today = new Date()) {
  const todayKey = today.toISOString().slice(0, 10);
  return [...milestones]
    .filter(item => !['completed', 'cancelled'].includes(item.status))
    .map(item => ({ ...item, _date: milestoneDate(item) }))
    .filter(item => item._date && item._date >= todayKey)
    .sort((left, right) => left._date.localeCompare(right._date))[0] || null;
}

export function deriveInitiativeHealth({ initiative, milestones = [], updates = [], today = new Date() }) {
  if (initiative?.healthOverride && initiative?.healthOverrideReason) return initiative.healthOverride;
  const progress = initiativeProgress(milestones);
  if (progress.total > 0 && progress.completed === progress.total) return 'completed';
  const todayKey = today.toISOString().slice(0, 10);
  const attentionLimit = new Date(today);
  attentionLimit.setDate(attentionLimit.getDate() + 14);
  const attentionKey = attentionLimit.toISOString().slice(0, 10);
  const activeMilestones = milestones.filter(item => !['completed', 'cancelled'].includes(item.status));
  const hasOpenBlocker = updates.some(item => item.type === 'blocker' && item.blockerStatus !== 'resolved');
  const overdue = activeMilestones.some(item => {
    const date = milestoneDate(item);
    return item.dateType !== 'proposed' && date && date < todayKey;
  });
  if (hasOpenBlocker || overdue || activeMilestones.some(item => item.status === 'blocked')) return 'at_risk';
  const needsAttention = activeMilestones.some(item => {
    const date = milestoneDate(item);
    return date && date <= attentionKey && (!item.ownerId || item.status === 'not_started');
  });
  return needsAttention ? 'attention' : 'on_track';
}

export function findHolidayConflict(dateKey, holidays = []) {
  if (!dateKey) return null;
  return holidays.find(item => {
    const start = item.startDate || '';
    const end = item.endDate || start;
    return item.isVacation !== false && item.isSchoolDay !== true && start <= dateKey && dateKey <= end;
  }) || null;
}

export function nextAvailableSchoolDate(dateKey, holidays = [], maxDays = 45) {
  if (!dateKey) return '';
  const candidate = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(candidate.getTime())) return '';
  for (let offset = 1; offset <= maxDays; offset += 1) {
    candidate.setDate(candidate.getDate() + 1);
    const key = candidate.toISOString().slice(0, 10);
    if (candidate.getDay() === 6) continue;
    if (!findHolidayConflict(key, holidays)) return key;
  }
  return '';
}

export function buildInitiativeClone(source, {
  academicYearId,
  academicYearLabel,
  includeOwners = false,
  includeFiles = false,
  includeDates = false,
} = {}) {
  return {
    title: source.title ? `${source.title} — עותק` : 'תכנית משוכפלת',
    description: source.description || '',
    academicYearId: academicYearId || source.academicYearId || '',
    academicYearLabel: academicYearLabel || source.academicYearLabel || '',
    category: source.category || '',
    startDate: includeDates ? source.startDate || '' : '',
    endDate: includeDates ? source.endDate || '' : '',
    ownerId: includeOwners ? source.ownerId || '' : '',
    memberIds: includeOwners ? safeInitiativeIdList(source.memberIds) : [],
    teamIds: includeOwners ? safeInitiativeIdList(source.teamIds) : [],
    classIds: safeInitiativeIdList(source.classIds),
    goals: Array.isArray(source.goals) ? source.goals.slice(0, 20) : [],
    fileIds: includeFiles ? safeInitiativeIdList(source.fileIds) : [],
    status: 'active',
    health: 'on_track',
    nextAction: '',
  };
}
