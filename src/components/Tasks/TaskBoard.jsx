import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Clock,
  CopyPlus,
  Edit3,
  FileEdit,
  FileText,
  Filter,
  Link2,
  Lock,
  MessageSquare,
  Paperclip,
  Pin,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  User,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../firebase';
import { usePermissions } from '../../hooks/usePermissions';
import {
  convertPersonalTask,
  createOrganizationTask,
  createPersonalFollowUp,
  createPersonalTask,
  deleteTask,
  isTaskComplete,
  subscribeOrganizationTasks,
  subscribePersonalTasks,
  TASK_SCOPES,
  taskDueDate,
  toggleTaskPin,
  updateTask,
  updateTaskStatus,
} from '../../services/firestore/taskRepository';
import { schoolCollection } from '../../services/firestore/paths';
import { createNotifications } from '../../utils/notifications';
import Header from '../Layout/Header';
import PagePermissionsPanel from '../Shared/PagePermissionsPanel';
import DocumentEditor from '../Files/DocumentEditor';
import SpreadsheetEditor from '../Files/SpreadsheetEditor';
import ChatPanel from './ChatPanel';
import '../Gantt/Gantt.css';
import './Tasks.css';

const PRIORITY_CONFIG = {
  high: { label: 'גבוהה', icon: AlertCircle, color: '#ef4444', bg: '#fef2f2' },
  medium: { label: 'בינונית', icon: AlertTriangle, color: '#f59e0b', bg: '#fffbeb' },
  low: { label: 'נמוכה', icon: Clock, color: '#22c55e', bg: '#f0fdf4' },
};

const STATUS_CONFIG = {
  todo: { label: 'לביצוע', color: '#64748b' },
  in_progress: { label: 'בתהליך', color: '#2563eb' },
  done: { label: 'הושלם', color: '#22c55e' },
};

const TAB_LABELS = {
  mine: 'המשימות שלי',
  team: 'משימות צוות',
  created: 'משימות שיצרתי',
};

const GROUP_LABELS = {
  overdue: 'באיחור',
  today: 'להיום',
  upcoming: 'בקרוב',
  no_date: 'ללא תאריך',
  completed: 'הושלמו',
};

function emptyForm(scope = TASK_SCOPES.PERSONAL) {
  return {
    title: '',
    description: '',
    priority: 'medium',
    status: 'todo',
    dueDate: '',
    reminderAt: '',
    tagsText: '',
    scope,
    assigneeIds: [],
    teamId: '',
    attachedFileId: '',
    attachedFileName: '',
  };
}

function formFromTask(task) {
  return {
    ...emptyForm(task.scope),
    title: task.title || '',
    description: task.description || '',
    priority: task.priority || 'medium',
    status: isTaskComplete(task) ? 'done' : task.status || 'todo',
    dueDate: taskDueDate(task),
    reminderAt: task.reminderAt || '',
    tagsText: Array.isArray(task.tags) ? task.tags.join(', ') : '',
    scope: task.scope,
    assigneeIds: task.assigneeIds || [],
    teamId: task.teamId || task.assigneeTeamId || '',
    attachedFileId: task.attachedFileId || '',
    attachedFileName: task.attachedFileName || '',
  };
}

function taskInput(form) {
  return {
    ...form,
    tags: form.tagsText.split(',').map(tag => tag.trim()).filter(Boolean),
  };
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function taskDateGroup(task) {
  if (isTaskComplete(task)) return 'completed';
  const dueDate = taskDueDate(task);
  if (!dueDate) return 'no_date';
  const key = String(dueDate).slice(0, 10);
  const today = localDateKey();
  if (key < today) return 'overdue';
  if (key === today) return 'today';
  return 'upcoming';
}

function timestampMillis(value) {
  if (value?.toMillis) return value.toMillis();
  if (typeof value === 'string') return Date.parse(value) || 0;
  return 0;
}

export default function TaskBoard() {
  const { userData, selectedSchool, currentUser } = useAuth();
  const { permissions } = usePermissions();
  const navigate = useNavigate();
  const uid = currentUser?.uid;
  const schoolId = selectedSchool || userData?.schoolId;
  const canEditOrganizationTasks = permissions.tasks_edit;
  const canAssignTasks = permissions.tasks_assign || permissions.tasks_edit;

  const [personalTasks, setPersonalTasks] = useState([]);
  const [organizationTasks, setOrganizationTasks] = useState([]);
  const [staff, setStaff] = useState([]);
  const [teams, setTeams] = useState([]);
  const [allFiles, setAllFiles] = useState([]);
  const [allFolders, setAllFolders] = useState([]);
  const [activeTab, setActiveTab] = useState('mine');
  const [mineFilter, setMineFilter] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');
  const [filterTeam, setFilterTeam] = useState('all');
  const [filterDate, setFilterDate] = useState('all');
  const [quickTitle, setQuickTitle] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingTask, setEditingTask] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [conversionTask, setConversionTask] = useState(null);
  const [conversion, setConversion] = useState({ scope: TASK_SCOPES.ASSIGNED, assigneeId: '', teamId: '' });
  const [chatTask, setChatTask] = useState(null);
  const [previewFile, setPreviewFile] = useState(null);
  const [showPermissionsPanel, setShowPermissionsPanel] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const teamIds = useMemo(() => {
    const ids = new Set(userData?.teamIds || []);
    teams.forEach(team => {
      if (team.memberIds?.includes(uid)) ids.add(team.id);
    });
    return [...ids];
  }, [teams, uid, userData?.teamIds]);

  useEffect(() => {
    if (!schoolId || !uid) return;
    setLoading(true);
    let personalReady = false;
    let organizationReady = false;
    const markReady = type => {
      if (type === 'personal') personalReady = true;
      if (type === 'organization') organizationReady = true;
      if (personalReady && organizationReady) setLoading(false);
    };
    const onSubscriptionError = () => {
      setError('לא ניתן לטעון את כל המשימות כרגע.');
      setLoading(false);
    };
    const unsubscribePersonal = subscribePersonalTasks({
      db,
      uid,
      schoolId,
      onData: items => { setPersonalTasks(items); markReady('personal'); },
      onError: onSubscriptionError,
    });
    const unsubscribeOrganization = subscribeOrganizationTasks({
      db,
      uid,
      schoolId,
      teamIds,
      canViewAll: canEditOrganizationTasks,
      onData: items => { setOrganizationTasks(items); markReady('organization'); },
      onError: onSubscriptionError,
    });
    return () => {
      unsubscribePersonal();
      unsubscribeOrganization();
    };
  }, [canEditOrganizationTasks, schoolId, teamIds, uid]);

  useEffect(() => {
    if (!schoolId) return;
    async function loadStaff() {
      const users = new Map();
      try {
        const bySchools = await getDocs(query(collection(db, 'users'), where('schoolIds', 'array-contains', schoolId)));
        bySchools.docs.forEach(item => users.set(item.id, { id: item.id, ...item.data() }));
        const byLegacySchool = await getDocs(query(collection(db, 'users'), where('schoolId', '==', schoolId)));
        byLegacySchool.docs.forEach(item => users.set(item.id, { id: item.id, ...item.data() }));
      } catch {
        setError('לא ניתן לטעון את רשימת העובדים.');
      }
      setStaff([...users.values()].filter(user => user.accountStatus !== 'pending'));
    }
    loadStaff();
    const unsubscribeTeams = onSnapshot(
      schoolCollection(db, schoolId, 'teams'),
      snapshot => setTeams(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))),
      () => setTeams([]),
    );
    const unsubscribeFiles = onSnapshot(
      schoolCollection(db, schoolId, 'files'),
      snapshot => setAllFiles(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))),
      () => setAllFiles([]),
    );
    const unsubscribeFolders = onSnapshot(
      schoolCollection(db, schoolId, 'folders'),
      snapshot => setAllFolders(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))),
      () => setAllFolders([]),
    );
    return () => {
      unsubscribeTeams();
      unsubscribeFiles();
      unsubscribeFolders();
    };
  }, [schoolId]);

  const tabTasks = useMemo(() => {
    if (activeTab === 'mine') {
      return [
        ...personalTasks,
        ...organizationTasks.filter(task => task.scope === TASK_SCOPES.ASSIGNED && task.assigneeIds?.includes(uid)),
      ];
    }
    if (activeTab === 'created') {
      return organizationTasks.filter(task => task.createdBy === uid);
    }
    return organizationTasks.filter(task => (
      task.scope !== TASK_SCOPES.ASSIGNED || canEditOrganizationTasks
    ));
  }, [activeTab, canEditOrganizationTasks, organizationTasks, personalTasks, uid]);

  const filteredTasks = useMemo(() => tabTasks.filter(task => {
    if (activeTab === 'mine' && mineFilter === 'personal' && task.scope !== TASK_SCOPES.PERSONAL) return false;
    if (activeTab === 'mine' && mineFilter === 'assigned' && task.scope !== TASK_SCOPES.ASSIGNED) return false;
    if (filterStatus !== 'all') {
      const status = isTaskComplete(task) ? 'done' : task.status || 'todo';
      if (status !== filterStatus) return false;
    }
    if (filterPriority !== 'all' && task.priority !== filterPriority) return false;
    if (filterTeam !== 'all' && (task.teamId || task.assigneeTeamId) !== filterTeam) return false;
    if (filterDate !== 'all' && taskDateGroup(task) !== filterDate) return false;
    if (searchText.trim()) {
      const needle = searchText.trim().toLowerCase();
      const tags = Array.isArray(task.tags) ? task.tags.join(' ') : '';
      if (![task.title, task.description, tags].some(value => String(value || '').toLowerCase().includes(needle))) return false;
    }
    return true;
  }).sort((a, b) => {
    const pinDifference = Number(!a.pinnedBy?.includes(uid)) - Number(!b.pinnedBy?.includes(uid));
    if (pinDifference) return pinDifference;
    const dateA = taskDueDate(a) || '9999-12-31';
    const dateB = taskDueDate(b) || '9999-12-31';
    if (dateA !== dateB) return String(dateA).localeCompare(String(dateB));
    return timestampMillis(b.createdAt) - timestampMillis(a.createdAt);
  }), [activeTab, filterDate, filterPriority, filterStatus, filterTeam, mineFilter, searchText, tabTasks, uid]);

  const groupedMineTasks = useMemo(() => {
    const groups = { overdue: [], today: [], upcoming: [], no_date: [], completed: [] };
    filteredTasks.forEach(task => groups[taskDateGroup(task)].push(task));
    return groups;
  }, [filteredTasks]);

  function showMessage(text) {
    setMessage(text);
    window.setTimeout(() => setMessage(''), 2500);
  }

  function setGeneralError() {
    setError('הפעולה לא הושלמה. נסו שוב.');
  }

  function handleFormChange(setter, event) {
    const { name, value } = event.target;
    setter(previous => ({ ...previous, [name]: value }));
  }

  function handleAttachment(setter, fileId) {
    const file = allFiles.find(item => item.id === fileId);
    setter(previous => ({ ...previous, attachedFileId: fileId, attachedFileName: file?.name || '' }));
  }

  function validateAssignment(value) {
    if (value.scope === TASK_SCOPES.ASSIGNED && value.assigneeIds.length !== 1) return false;
    if (value.scope === TASK_SCOPES.TEAM && !value.teamId) return false;
    return true;
  }

  async function notifyAssignment(input, taskId) {
    const options = {
      schoolId,
      title: `משימה חדשה: ${input.title}`,
      body: input.description?.slice(0, 80) || '',
      type: 'task',
      link: `/tasks?task=${taskId}`,
    };
    if (input.scope === TASK_SCOPES.ASSIGNED) {
      const recipients = input.assigneeIds.filter(id => id !== uid);
      if (recipients.length) await createNotifications(recipients, options);
    } else if (input.scope === TASK_SCOPES.TEAM) {
      const team = teams.find(item => item.id === input.teamId);
      const recipients = (team?.memberIds || []).filter(id => id !== uid);
      if (recipients.length) await createNotifications(recipients, options);
    }
  }

  async function handleCreate(event) {
    event.preventDefault();
    const input = taskInput(form);
    if (!input.title.trim() || !schoolId || !uid) return;
    if (input.scope !== TASK_SCOPES.PERSONAL && (!canAssignTasks || !validateAssignment(input))) {
      setError('יש לבחור יעד תקין למשימה.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (input.scope === TASK_SCOPES.PERSONAL) {
        await createPersonalTask({ db, schoolId, user: { uid, fullName: userData?.fullName }, input });
      } else {
        const created = await createOrganizationTask({ db, schoolId, user: { uid, fullName: userData?.fullName }, input });
        await notifyAssignment(input, created.id);
      }
      setForm(emptyForm());
      setShowForm(false);
      setActiveTab(input.scope === TASK_SCOPES.PERSONAL ? 'mine' : 'created');
      showMessage('המשימה נוצרה בהצלחה.');
    } catch {
      setGeneralError();
    } finally {
      setSaving(false);
    }
  }

  async function handleQuickAdd(event) {
    event.preventDefault();
    if (!quickTitle.trim() || !schoolId || !uid) return;
    setSaving(true);
    setError('');
    try {
      await createPersonalTask({
        db,
        schoolId,
        user: { uid, fullName: userData?.fullName },
        input: { ...emptyForm(), title: quickTitle.trim() },
      });
      setQuickTitle('');
      showMessage('משימה אישית נוספה.');
    } catch {
      setGeneralError();
    } finally {
      setSaving(false);
    }
  }

  function startEdit(task) {
    setEditingTask(task);
    setEditForm(formFromTask(task));
  }

  async function saveEdit() {
    if (!editingTask || !editForm?.title.trim()) return;
    if (editingTask._source === 'organization' && !validateAssignment(editForm)) {
      setError('יש לבחור יעד תקין למשימה.');
      return;
    }
    setSaving(true);
    try {
      await updateTask({ db, schoolId, uid, task: editingTask, input: taskInput(editForm) });
      setEditingTask(null);
      setEditForm(null);
      showMessage('המשימה עודכנה.');
    } catch {
      setGeneralError();
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(task, status) {
    try {
      await updateTaskStatus({ db, schoolId, uid, task, status });
      showMessage(status === 'done' ? 'המשימה הושלמה.' : 'המשימה הוחזרה לביצוע.');
    } catch {
      setGeneralError();
    }
  }

  async function removeTask(task) {
    if (!window.confirm('האם למחוק משימה זו?')) return;
    try {
      await deleteTask({ db, schoolId, uid, task });
      showMessage('המשימה נמחקה.');
    } catch {
      setGeneralError();
    }
  }

  async function pinTask(task) {
    try {
      await toggleTaskPin({ db, schoolId, uid, task, isPinned: task.pinnedBy?.includes(uid) });
    } catch {
      setGeneralError();
    }
  }

  async function createFollowUp(task) {
    try {
      await createPersonalFollowUp({ db, schoolId, user: { uid, fullName: userData?.fullName }, task });
      setActiveTab('mine');
      showMessage('נוצרה משימת המשך אישית.');
    } catch {
      setGeneralError();
    }
  }

  async function confirmConversion() {
    if (!conversionTask || !canAssignTasks) return;
    const assignment = conversion.scope === TASK_SCOPES.ASSIGNED
      ? { scope: TASK_SCOPES.ASSIGNED, assigneeIds: conversion.assigneeId ? [conversion.assigneeId] : [] }
      : { scope: TASK_SCOPES.TEAM, teamId: conversion.teamId };
    if (!validateAssignment({ ...assignment, teamId: assignment.teamId || '' })) {
      setError('יש לבחור אדם או צוות לפני האישור.');
      return;
    }
    if (!window.confirm('לאחר ההמרה המשימה לא תהיה פרטית. להמשיך?')) return;
    setSaving(true);
    try {
      await convertPersonalTask({ db, schoolId, user: { uid, fullName: userData?.fullName }, task: conversionTask, assignment });
      await notifyAssignment({ ...conversionTask, ...assignment }, conversionTask.id);
      setConversionTask(null);
      setActiveTab('created');
      showMessage('המשימה הפכה למשימה ארגונית.');
    } catch {
      setGeneralError();
    } finally {
      setSaving(false);
    }
  }

  function getAssigneeDisplay(task) {
    if (task.scope === TASK_SCOPES.PERSONAL) return 'אישית';
    if (task.scope === TASK_SCOPES.ASSIGNED || task.assigneeType === 'individual') {
      const names = (task.assigneeIds || []).map(id => staff.find(user => (user.uid || user.id) === id)?.fullName || 'עובד');
      return names.join(', ');
    }
    if (task.assigneeType === 'all_school') return 'כל בית הספר';
    const team = teams.find(item => item.id === (task.teamId || task.assigneeTeamId));
    return team?.name || 'צוות';
  }

  function canChangeStatus(task) {
    return task._source === 'personal'
      || canEditOrganizationTasks
      || (task.scope === TASK_SCOPES.ASSIGNED && task.assigneeIds?.includes(uid));
  }

  function canEditDetails(task) {
    return task._source === 'personal' || canEditOrganizationTasks;
  }

  function renderAssignmentFields(value, setter, allowScopeChange = true) {
    if (value.scope === TASK_SCOPES.PERSONAL) {
      return <p className="personal-task-note"><Lock size={14} /> המשימה פרטית ורק אתה יכול לראות אותה</p>;
    }
    return (
      <>
        {!allowScopeChange && <input type="hidden" value={value.scope} readOnly />}
        {value.scope === TASK_SCOPES.ASSIGNED && (
          <div className="form-group">
            <label>עובד</label>
            <select
              value={value.assigneeIds[0] || ''}
              onChange={event => setter(previous => ({ ...previous, assigneeIds: event.target.value ? [event.target.value] : [] }))}
              required
            >
              <option value="">בחרו עובד</option>
              {staff.filter(user => (user.uid || user.id) !== uid).map(user => (
                <option key={user.id} value={user.uid || user.id}>{user.fullName}</option>
              ))}
            </select>
          </div>
        )}
        {value.scope === TASK_SCOPES.TEAM && (
          <div className="form-group">
            <label>צוות</label>
            <select name="teamId" value={value.teamId} onChange={event => handleFormChange(setter, event)} required>
              <option value="">בחרו צוות</option>
              {teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </div>
        )}
      </>
    );
  }

  function renderFormFields(value, setter, editing = false) {
    return (
      <>
        {!editing && (
          <div className="task-scope-picker" role="group" aria-label="סוג משימה">
            <button type="button" className={value.scope === TASK_SCOPES.PERSONAL ? 'active' : ''} onClick={() => setter(previous => ({ ...previous, scope: TASK_SCOPES.PERSONAL, assigneeIds: [], teamId: '' }))}>
              <Lock size={15} /> לעצמי
            </button>
            {canAssignTasks && (
              <>
                <button type="button" className={value.scope === TASK_SCOPES.ASSIGNED ? 'active' : ''} onClick={() => setter(previous => ({ ...previous, scope: TASK_SCOPES.ASSIGNED, assigneeIds: [], teamId: '' }))}>
                  <User size={15} /> לאדם
                </button>
                <button type="button" className={value.scope === TASK_SCOPES.TEAM ? 'active' : ''} onClick={() => setter(previous => ({ ...previous, scope: TASK_SCOPES.TEAM, assigneeIds: [], teamId: '' }))}>
                  <Users size={15} /> לצוות
                </button>
              </>
            )}
          </div>
        )}
        {editing && value.scope !== TASK_SCOPES.PERSONAL && canEditOrganizationTasks && (
          <div className="task-scope-picker" role="group" aria-label="יעד משימה ארגונית">
            <button type="button" className={value.scope === TASK_SCOPES.ASSIGNED ? 'active' : ''} onClick={() => setter(previous => ({ ...previous, scope: TASK_SCOPES.ASSIGNED, assigneeIds: [], teamId: '' }))}><User size={15} /> לאדם</button>
            <button type="button" className={value.scope === TASK_SCOPES.TEAM ? 'active' : ''} onClick={() => setter(previous => ({ ...previous, scope: TASK_SCOPES.TEAM, assigneeIds: [], teamId: '' }))}><Users size={15} /> לצוות</button>
          </div>
        )}
        <div className="form-group">
          <label>כותרת</label>
          <input name="title" value={value.title} onChange={event => handleFormChange(setter, event)} required autoFocus />
        </div>
        <div className="form-group">
          <label>תיאור</label>
          <textarea name="description" value={value.description} onChange={event => handleFormChange(setter, event)} rows={3} />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>עדיפות</label>
            <select name="priority" value={value.priority} onChange={event => handleFormChange(setter, event)}>
              {Object.entries(PRIORITY_CONFIG).map(([key, config]) => <option key={key} value={key}>{config.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>סטטוס</label>
            <select name="status" value={value.status} onChange={event => handleFormChange(setter, event)}>
              {Object.entries(STATUS_CONFIG).map(([key, config]) => <option key={key} value={key}>{config.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>תאריך יעד</label>
            <input name="dueDate" type="date" value={value.dueDate} onChange={event => handleFormChange(setter, event)} dir="ltr" />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>תזכורת</label>
            <input name="reminderAt" type="datetime-local" value={value.reminderAt} onChange={event => handleFormChange(setter, event)} dir="ltr" />
          </div>
          <div className="form-group">
            <label>תגיות</label>
            <input name="tagsText" value={value.tagsText} onChange={event => handleFormChange(setter, event)} placeholder="מופרדות בפסיקים" />
          </div>
        </div>
        {renderAssignmentFields(value, setter, !editing)}
        <div className="form-group">
          <label><Paperclip size={12} /> קובץ מצורף</label>
          <select value={value.attachedFileId} onChange={event => handleAttachment(setter, event.target.value)}>
            <option value="">ללא קובץ</option>
            {allFiles.filter(file => ['spreadsheet', 'document'].includes(file.fileType)).map(file => (
              <option key={file.id} value={file.id}>{file.name}</option>
            ))}
          </select>
        </div>
      </>
    );
  }

  function renderTask(task) {
    const priority = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.medium;
    const PriorityIcon = priority.icon;
    const status = STATUS_CONFIG[isTaskComplete(task) ? 'done' : task.status] || STATUS_CONFIG.todo;
    const overdue = taskDateGroup(task) === 'overdue';
    const pinned = task.pinnedBy?.includes(uid);
    return (
      <article key={task._key} className={`task-row ${overdue ? 'task-row--overdue' : ''} ${task.scope === TASK_SCOPES.PERSONAL ? 'task-row--personal' : ''}`}>
        <div className="task-priority" style={{ background: priority.bg }}><PriorityIcon size={16} color={priority.color} /></div>
        <div className="task-main">
          <div className="task-title-line">
            <span className="task-title">{task.title}</span>
            {task.scope === TASK_SCOPES.PERSONAL && <span className="personal-task-badge"><Lock size={11} /> אישית</span>}
          </div>
          {task.description && <div className="task-desc">{task.description}</div>}
          <div className="task-meta">
            <span className="task-priority-badge" style={{ background: priority.bg, color: priority.color }}>{priority.label}</span>
            <span className="task-assignee">{task.scope === TASK_SCOPES.PERSONAL ? <Lock size={11} /> : <Users size={11} />}{getAssigneeDisplay(task)}</span>
            {taskDueDate(task) && <span className={`task-due ${overdue ? 'task-due--late' : ''}`}>{new Date(`${String(taskDueDate(task)).slice(0, 10)}T00:00:00`).toLocaleDateString('he-IL')}</span>}
            {task.sourceTaskId && <span className="task-source"><Link2 size={11} /> משימת המשך</span>}
          </div>
        </div>
        <div className="task-status-wrap">
          {canChangeStatus(task) ? (
            <select className="task-status-select" value={isTaskComplete(task) ? 'done' : task.status || 'todo'} onChange={event => changeStatus(task, event.target.value)} style={{ color: status.color, borderColor: status.color }} aria-label={`שינוי סטטוס של ${task.title}`}>
              {Object.entries(STATUS_CONFIG).map(([key, config]) => <option key={key} value={key}>{config.label}</option>)}
            </select>
          ) : <span className="task-status-badge" style={{ color: status.color, borderColor: status.color }}>{status.label}</span>}
        </div>
        <div className="task-actions">
          <button className="icon-btn" onClick={() => changeStatus(task, isTaskComplete(task) ? 'todo' : 'done')} disabled={!canChangeStatus(task)} aria-label={isTaskComplete(task) ? `החזרת ${task.title} לביצוע` : `השלמת ${task.title}`} title={isTaskComplete(task) ? 'החזרה לביצוע' : 'סימון כהושלמה'}>
            {isTaskComplete(task) ? <RotateCcw size={15} /> : <Check size={15} />}
          </button>
          {canEditDetails(task) && <button className="icon-btn" onClick={() => pinTask(task)} aria-label={`${pinned ? 'ביטול הצמדת' : 'הצמדת'} ${task.title}`} title={pinned ? 'ביטול הצמדה' : 'הצמדה'}><Pin size={15} color={pinned ? '#2563eb' : undefined} /></button>}
          {canEditDetails(task) && <button className="icon-btn" onClick={() => startEdit(task)} aria-label={`עריכת ${task.title}`} title="עריכה"><Edit3 size={15} /></button>}
          {task._source === 'organization' && <button className="icon-btn" onClick={() => setChatTask(task)} aria-label={`פתיחת תגובות עבור ${task.title}`} title="תגובות"><MessageSquare size={15} /></button>}
          {task._source === 'organization' && <button className="icon-btn" onClick={() => createFollowUp(task)} aria-label={`יצירת משימת המשך אישית עבור ${task.title}`} title="צור לי משימת המשך אישית"><CopyPlus size={15} /></button>}
          {task._source === 'personal' && canAssignTasks && <button className="icon-btn" onClick={() => { setConversionTask(task); setConversion({ scope: TASK_SCOPES.ASSIGNED, assigneeId: '', teamId: '' }); }} aria-label={`הפיכת ${task.title} למשימה ארגונית`} title="הפוך למשימה ארגונית"><Users size={15} /></button>}
          {task.attachedFileId && <button className="icon-btn" onClick={() => setPreviewFile(task)} aria-label={`פתיחת הקובץ של ${task.title}`} title="קובץ מצורף"><Paperclip size={15} /></button>}
          {canEditDetails(task) && <button className="icon-btn icon-btn--danger" onClick={() => removeTask(task)} aria-label={`מחיקת ${task.title}`} title="מחיקה"><Trash2 size={15} /></button>}
        </div>
      </article>
    );
  }

  return (
    <div className="page">
      <Header title="משימות" onPermissions={() => setShowPermissionsPanel(true)} />
      {showPermissionsPanel && <PagePermissionsPanel feature="tasks" onClose={() => setShowPermissionsPanel(false)} />}
      <div className="page-content">
        <div className="task-tabs" role="tablist" aria-label="תצוגת משימות">
          {Object.entries(TAB_LABELS).map(([key, label]) => (
            <button key={key} role="tab" aria-selected={activeTab === key} className={activeTab === key ? 'active' : ''} onClick={() => setActiveTab(key)}>{label}</button>
          ))}
        </div>

        {message && <div className="task-feedback task-feedback--success" role="status">{message}</div>}
        {error && <div className="task-feedback task-feedback--error" role="alert">{error}<button onClick={() => setError('')} aria-label="סגירת הודעת שגיאה"><X size={14} /></button></div>}

        {activeTab === 'mine' && (
          <form className="quick-task-form" onSubmit={handleQuickAdd}>
            <Lock size={16} />
            <input value={quickTitle} onChange={event => setQuickTitle(event.target.value)} placeholder="הוספת משימה אישית מהירה..." aria-label="כותרת משימה אישית מהירה" />
            <button className="btn btn-primary btn-sm" type="submit" disabled={!quickTitle.trim() || saving}><Plus size={15} /> הוספה</button>
          </form>
        )}

        <div className="page-toolbar task-toolbar">
          <button className="btn btn-primary" onClick={() => { setForm(emptyForm()); setShowForm(true); }}><Plus size={16} /> משימה חדשה</button>
          <div className="task-filters">
            <div className="search-bar"><Search size={14} /><input value={searchText} onChange={event => setSearchText(event.target.value)} placeholder="חיפוש משימות..." aria-label="חיפוש משימות" /></div>
            {activeTab === 'mine' && <select value={mineFilter} onChange={event => setMineFilter(event.target.value)} aria-label="סינון סוג משימה"><option value="all">הכול</option><option value="personal">אישיות</option><option value="assigned">הוקצו לי</option></select>}
            <select value={filterStatus} onChange={event => setFilterStatus(event.target.value)} aria-label="סינון סטטוס"><option value="all">כל הסטטוסים</option>{Object.entries(STATUS_CONFIG).map(([key, config]) => <option key={key} value={key}>{config.label}</option>)}</select>
            <select value={filterPriority} onChange={event => setFilterPriority(event.target.value)} aria-label="סינון עדיפות"><option value="all">כל העדיפויות</option>{Object.entries(PRIORITY_CONFIG).map(([key, config]) => <option key={key} value={key}>{config.label}</option>)}</select>
            <select value={filterDate} onChange={event => setFilterDate(event.target.value)} aria-label="סינון תאריך"><option value="all">כל התאריכים</option>{Object.entries(GROUP_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
            {teams.length > 0 && <select value={filterTeam} onChange={event => setFilterTeam(event.target.value)} aria-label="סינון צוות"><option value="all">כל הצוותים</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select>}
            <span className="task-stats"><Filter size={13} /> {filteredTasks.length} משימות</span>
          </div>
        </div>

        {showForm && (
          <div className="card form-card">
            <form onSubmit={handleCreate} className="task-form">
              {renderFormFields(form, setForm)}
              <div className="form-actions"><button className="btn btn-primary" type="submit" disabled={saving}>שמירה</button><button className="btn btn-secondary" type="button" onClick={() => setShowForm(false)}>ביטול</button></div>
            </form>
          </div>
        )}

        {loading ? <div className="empty-state"><p>טוען משימות...</p></div> : activeTab === 'mine' ? (
          <div className="personal-task-groups">
            {Object.keys(GROUP_LABELS).map(group => groupedMineTasks[group].length > 0 && (
              <section key={group} className="task-group">
                <h3>{GROUP_LABELS[group]} <span>{groupedMineTasks[group].length}</span></h3>
                <div className="task-list">{groupedMineTasks[group].map(renderTask)}</div>
              </section>
            ))}
            {filteredTasks.length === 0 && <div className="empty-state"><Lock size={30} /><p>עדיין אין לך משימות אישיות. אפשר ליצור כאן משימה שרק אתה תראה.</p></div>}
          </div>
        ) : (
          <div className="task-list">
            {filteredTasks.map(renderTask)}
            {filteredTasks.length === 0 && <div className="empty-state"><p>אין משימות להצגה.</p></div>}
          </div>
        )}
      </div>

      {editingTask && editForm && (
        <div className="task-edit-overlay" onClick={() => setEditingTask(null)}>
          <div className="task-edit-modal" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="עריכת משימה">
            <div className="task-edit-header"><h3>עריכת משימה</h3><button className="icon-btn" onClick={() => setEditingTask(null)} aria-label="סגירת חלון עריכה"><X size={18} /></button></div>
            <div className="task-form">{renderFormFields(editForm, setEditForm, true)}<div className="form-actions"><button className="btn btn-primary" onClick={saveEdit} disabled={saving}>שמירה</button><button className="btn btn-secondary" onClick={() => setEditingTask(null)}>ביטול</button></div></div>
          </div>
        </div>
      )}

      {conversionTask && (
        <div className="task-edit-overlay" onClick={() => setConversionTask(null)}>
          <div className="task-edit-modal" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="הפיכת משימה לארגונית">
            <div className="task-edit-header"><h3>הפוך למשימה ארגונית</h3><button className="icon-btn" onClick={() => setConversionTask(null)} aria-label="סגירה"><X size={18} /></button></div>
            <div className="task-warning"><AlertTriangle size={18} /> לאחר האישור המשימה לא תהיה פרטית.</div>
            <div className="task-scope-picker"><button type="button" className={conversion.scope === TASK_SCOPES.ASSIGNED ? 'active' : ''} onClick={() => setConversion({ scope: TASK_SCOPES.ASSIGNED, assigneeId: '', teamId: '' })}><User size={15} /> לאדם</button><button type="button" className={conversion.scope === TASK_SCOPES.TEAM ? 'active' : ''} onClick={() => setConversion({ scope: TASK_SCOPES.TEAM, assigneeId: '', teamId: '' })}><Users size={15} /> לצוות</button></div>
            {conversion.scope === TASK_SCOPES.ASSIGNED ? <div className="form-group"><label>עובד</label><select value={conversion.assigneeId} onChange={event => setConversion(previous => ({ ...previous, assigneeId: event.target.value }))}><option value="">בחרו עובד</option>{staff.filter(user => (user.uid || user.id) !== uid).map(user => <option key={user.id} value={user.uid || user.id}>{user.fullName}</option>)}</select></div> : <div className="form-group"><label>צוות</label><select value={conversion.teamId} onChange={event => setConversion(previous => ({ ...previous, teamId: event.target.value }))}><option value="">בחרו צוות</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></div>}
            <div className="form-actions"><button className="btn btn-primary" onClick={confirmConversion} disabled={saving}>אישור והמרה</button><button className="btn btn-secondary" onClick={() => setConversionTask(null)}>ביטול</button></div>
          </div>
        </div>
      )}

      {chatTask && <ChatPanel task={chatTask} schoolId={schoolId} currentUser={userData} onClose={() => setChatTask(null)} />}

      {previewFile?.attachedFileId && (() => {
        const file = allFiles.find(item => item.id === previewFile.attachedFileId);
        if (!file) return null;
        const folder = allFolders.find(item => item.id === file.folderId);
        const hasAccess = !folder || folder.visibility === 'all' || folder.allowedUsers?.includes(uid) || permissions.files_upload;
        return (
          <div className="task-edit-overlay" onClick={() => setPreviewFile(null)}>
            <div className="task-file-preview-modal" onClick={event => event.stopPropagation()}>
              <div className="task-file-preview-header"><span><FileText size={16} /> {file.name}</span><div><button className="btn btn-primary btn-sm" onClick={() => navigate(`/files?openFile=${file.id}`)} disabled={!hasAccess}><FileEdit size={13} /> פתיחה</button><button className="icon-btn" onClick={() => setPreviewFile(null)} aria-label="סגירת תצוגה מקדימה"><X size={18} /></button></div></div>
              <div className="task-file-preview-content">{!hasAccess ? <div className="empty-state"><Lock size={28} /><p>אין הרשאה לצפות בקובץ.</p></div> : file.fileType === 'spreadsheet' ? <SpreadsheetEditor data={file.content} readOnly /> : <DocumentEditor content={file.content} readOnly />}</div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
