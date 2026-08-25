const PRIORITY_ORDER = Object.freeze({ high: 0, medium: 1, low: 2 });

export const DASHBOARD_TASK_SORTS = Object.freeze({
  PRIORITY: 'priority',
  DUE_DATE: 'dueDate',
});

function dueDate(task) {
  return String(task?.dueDate || task?.dueAt || '').slice(0, 10);
}

function complete(task) {
  return ['done', 'completed'].includes(task?.status);
}

export function sortDashboardTasks(tasks, sortBy = DASHBOARD_TASK_SORTS.PRIORITY) {
  return [...(Array.isArray(tasks) ? tasks : [])]
    .filter(task => !complete(task))
    .sort((left, right) => {
      if (sortBy === DASHBOARD_TASK_SORTS.DUE_DATE) {
        return String(dueDate(left) || '9999-12-31').localeCompare(dueDate(right) || '9999-12-31')
          || (PRIORITY_ORDER[left.priority] ?? 1) - (PRIORITY_ORDER[right.priority] ?? 1);
      }
      return (PRIORITY_ORDER[left.priority] ?? 1) - (PRIORITY_ORDER[right.priority] ?? 1)
        || String(dueDate(left) || '9999-12-31').localeCompare(dueDate(right) || '9999-12-31');
    });
}

export function dashboardTaskStats(tasks, today) {
  const items = Array.isArray(tasks) ? tasks : [];
  const completed = items.filter(complete).length;
  const active = items.filter(task => !complete(task));
  return {
    total: items.length,
    pending: active.length,
    completed,
    overdue: active.filter(task => dueDate(task) && dueDate(task) < today).length,
  };
}
