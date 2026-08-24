import { useMemo, useState } from 'react';
import { Check, GripVertical, Search, UserPlus, Users, X } from 'lucide-react';
import { isTaskComplete, taskDueDate } from '../../services/firestore/taskRepository';

const staffId = member => String(member?.uid || member?.id || '');
const taskKey = task => `${task?._storageMode || 'nested'}:${task?.id || ''}`;

function dragData(event) {
  try { return JSON.parse(event.dataTransfer.getData('application/x-zoko-task')); } catch { return null; }
}

function dueLabel(task) {
  const dueDate = taskDueDate(task);
  return dueDate ? new Date(`${dueDate}T00:00:00`).toLocaleDateString('he-IL') : 'ללא מועד';
}

export default function TaskAssignmentBoard({ tasks, staff, savingKey, onAssignmentChange, onClose }) {
  const [search, setSearch] = useState('');
  const [selectedTaskKey, setSelectedTaskKey] = useState('');
  const [dragTarget, setDragTarget] = useState('');
  const query = search.trim().toLocaleLowerCase('he');

  const bankTasks = useMemo(() => [...tasks]
    .filter(task => task._source === 'organization' && task.workflowType !== 'external_email_followup')
    .filter(task => !query || `${task.title} ${task.description || ''}`.toLocaleLowerCase('he').includes(query))
    .sort((left, right) => Number(isTaskComplete(left)) - Number(isTaskComplete(right))
      || String(taskDueDate(left) || '9999').localeCompare(String(taskDueDate(right) || '9999'))
      || left.title.localeCompare(right.title, 'he')), [query, tasks]);

  const activeStaff = useMemo(() => [...staff]
    .filter(member => staffId(member) && !['pending', 'disabled', 'archived'].includes(member.accountStatus))
    .filter(member => !query || `${member.fullName || ''} ${member.jobTitle || member.roleName || ''}`.toLocaleLowerCase('he').includes(query)
      || bankTasks.some(task => task.assigneeIds?.includes(staffId(member))))
    .sort((left, right) => String(left.fullName || '').localeCompare(String(right.fullName || ''), 'he')), [bankTasks, query, staff]);

  const selectedTask = tasks.find(task => taskKey(task) === selectedTaskKey) || null;

  function startDrag(event, task, sourceStaffId = '') {
    const payload = { taskKey: taskKey(task), sourceStaffId };
    event.dataTransfer.effectAllowed = 'copyMove';
    event.dataTransfer.setData('application/x-zoko-task', JSON.stringify(payload));
    event.dataTransfer.setData('text/plain', task.title);
  }

  async function assignFromPayload(payload, targetStaffId) {
    const task = tasks.find(item => taskKey(item) === payload?.taskKey);
    if (!task || !targetStaffId || task.assigneeIds?.includes(targetStaffId)) return;
    await onAssignmentChange(task, targetStaffId, true);
  }

  async function removeFromPayload(payload) {
    const task = tasks.find(item => taskKey(item) === payload?.taskKey);
    if (!task || !payload?.sourceStaffId) return;
    await onAssignmentChange(task, payload.sourceStaffId, false);
  }

  return <section className="task-assignment-board" aria-labelledby="task-assignment-title">
    <header className="task-assignment-head">
      <div><span><Users size={16} /> ניהול הקצאות</span><h2 id="task-assignment-title">בנק משימות ואנשי צוות</h2><p>גרירה למורה מוסיפה שיוך. המשימה נשארת תמיד בבנק.</p></div>
      <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>חזרה לריכוז</button>
    </header>

    <label className="task-assignment-search"><Search size={16} /><span className="sr-only">חיפוש משימה או איש צוות</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="חיפוש משימה או איש צוות" /></label>

    <section className={`task-bank ${dragTarget === 'bank' ? 'is-drop-target' : ''}`} aria-labelledby="task-bank-title" onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragTarget('bank'); }} onDragLeave={() => setDragTarget('')} onDrop={event => { event.preventDefault(); setDragTarget(''); removeFromPayload(dragData(event)); }}>
      <header><div><h3 id="task-bank-title">בנק המשימות</h3><span>{bankTasks.length}</span></div><small>כדי להסיר שיוך, גררו משימה מכרטיס המורה בחזרה לבנק.</small></header>
      <div className="task-bank-list">
        {bankTasks.map(task => {
          const key = taskKey(task);
          const assignedCount = task.assigneeIds?.length || 0;
          return <button type="button" key={key} draggable onDragStart={event => startDrag(event, task)} onClick={() => setSelectedTaskKey(previous => previous === key ? '' : key)} className={`task-bank-card ${selectedTaskKey === key ? 'is-selected' : ''}`} aria-pressed={selectedTaskKey === key}>
            <GripVertical size={15} aria-hidden="true" /><span><strong>{task.title}</strong><small>{dueLabel(task)} · {assignedCount ? `${assignedCount} משויכים` : 'טרם שובצה'}</small></span>{isTaskComplete(task) && <Check size={14} aria-label="הושלמה" />}
          </button>;
        })}
        {bankTasks.length === 0 && <p className="task-assignment-empty">לא נמצאו משימות בבנק.</p>}
      </div>
    </section>

    {selectedTask && <div className="task-assignment-selection" role="status"><span>נבחרה: <strong>{selectedTask.title}</strong></span><span>לחצו על הפלוס ליד איש צוות או גררו את הכרטיס.</span><button type="button" onClick={() => setSelectedTaskKey('')} aria-label="ביטול בחירת משימה"><X size={14} /></button></div>}

    <div className="task-staff-board" aria-label="הקצאות לפי אנשי צוות">
      {activeStaff.map(member => {
        const memberId = staffId(member);
        const assignedTasks = tasks.filter(task => task._source === 'organization' && task.assigneeIds?.includes(memberId));
        const targetActive = dragTarget === memberId;
        const canAddSelected = selectedTask && !selectedTask.assigneeIds?.includes(memberId);
        return <article key={memberId} className={`task-staff-lane ${targetActive ? 'is-drop-target' : ''}`} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDragTarget(memberId); }} onDragLeave={() => setDragTarget('')} onDrop={event => { event.preventDefault(); setDragTarget(''); assignFromPayload(dragData(event), memberId); }}>
          <header><div className="task-staff-avatar" aria-hidden="true">{String(member.fullName || '?').trim().charAt(0)}</div><div><h3>{member.fullName || 'איש צוות'}</h3><p>{member.jobTitle || member.roleName || 'צוות המוסד'}</p></div><span>{assignedTasks.length}</span>{canAddSelected && <button type="button" disabled={Boolean(savingKey)} onClick={() => onAssignmentChange(selectedTask, memberId, true)} aria-label={`שיוך ${selectedTask.title} אל ${member.fullName}`}><UserPlus size={15} /></button>}</header>
          <div className="task-staff-tasks">
            {assignedTasks.map(task => {
              const key = `${taskKey(task)}:${memberId}`;
              return <div key={key} className="task-staff-task" draggable onDragStart={event => startDrag(event, task, memberId)}>
                <GripVertical size={13} aria-hidden="true" /><span><strong>{task.title}</strong><small>{dueLabel(task)}</small></span><button type="button" disabled={savingKey === key} onClick={() => onAssignmentChange(task, memberId, false)} aria-label={`הסרת ${task.title} מ${member.fullName}`}><X size={14} /></button>
              </div>;
            })}
            {assignedTasks.length === 0 && <p>גררו לכאן משימה</p>}
          </div>
        </article>;
      })}
      {activeStaff.length === 0 && <p className="task-assignment-empty">לא נמצאו אנשי צוות.</p>}
    </div>
  </section>;
}
