import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
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
  Flag,
  Lock,
  MailPlus,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Pin,
  Plus,
  RotateCcw,
  Search,
  Shield,
  Sparkles,
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
  subscribeTaskChatReceipts,
  TASK_SCOPES,
  taskChatReceiptId,
  taskDueDate,
  toggleTaskPin,
  updateTask,
  updateTaskStatus,
} from '../../services/firestore/taskRepository';
import { schoolCollection } from '../../services/firestore/paths';
import { subscribeAcademicYears } from '../../services/firestore/academicYearRepository';
import {
  createInitiative,
  createMilestone,
  subscribeInitiatives,
} from '../../services/firestore/initiativeRepository';
import { createNotification, createNotifications } from '../../utils/notifications';
import {
  createMandatoryTask,
  inviteTaskCollaborators,
  respondTaskInvitation,
} from '../../services/adminUserService';
import Header from '../Layout/Header';
import SegmentedControl from '../Common/SegmentedControl';
import PagePermissionsPanel from '../Shared/PagePermissionsPanel';
import PermissionsMenu from '../Shared/PermissionsMenu';
import DocumentEditor from '../Files/DocumentEditor';
import SpreadsheetEditor from '../Files/SpreadsheetEditor';
import ChatPanel from './ChatPanel';
import InitiativePanel from './InitiativePanel';
import CommunicationComposer from './CommunicationComposer';
import CommunicationDashboard from './CommunicationDashboard';
import TaskAssistantEntry from './TaskAssistantEntry';
import {
  markCommunicationReminderNotified,
  subscribeCommunicationDrafts,
} from '../../services/firestore/communicationRepository';
import { communicationSourceFromContext, normalizeCommunicationContext } from '../../utils/communicationContext';
import {
  belongsToTaskView,
  overdueDayCount,
  taskDateBucket,
  TASK_GROUP_ORDER,
} from '../../utils/taskDashboardView';
import {
  findHolidayConflict,
  proposalToTaskForm,
  resolveTaskAssistantProposal,
} from '../../utils/taskAssistant';
import '../Gantt/Gantt.css';
import './Tasks.css';

const PRIORITY_CONFIG = {
  high: { label: 'גבוהה', icon: AlertCircle, color: '#ef4444', bg: '#fef2f2' },
  medium: { label: 'בינונית', icon: AlertTriangle, color: '#f59e0b', bg: '#fffbeb' },
  low: { label: 'נמוכה', icon: Clock, color: '#22c55e', bg: '#f0fdf4' },
};

const STATUS_CONFIG = {
  todo: { label: 'לביצוע', color: '#765968' },
  in_progress: { label: 'בתהליך', color: '#870335' },
  done: { label: 'הושלם', color: '#22c55e' },
};

const GROUP_LABELS = {
  overdue: 'באיחור',
  today: 'להיום',
  upcoming: 'בקרוב',
  no_date: 'ללא תאריך',
  completed: 'הושלמו',
};

const WORK_VIEW_OPTIONS = [
  { value: 'mine', label: 'שלי' },
  { value: 'teams', label: 'צוותים' },
  { value: 'plans', label: 'תכניות' },
];

const SCOPE_FILTER_LABELS = {
  personal: 'אישיות',
  assigned: 'מוקצות לי',
  shared: 'משותפות',
  team: 'צוות ומוסד',
  mandatory: 'מחייבות',
  created: 'שיצרתי',
};

function emptyForm(scope = TASK_SCOPES.PERSONAL) {
  return {
    creationKind: 'task',
    mandatory: false,
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
    initiativeId: '',
    milestoneId: '',
    startDate: '',
    endDate: '',
    recipientIds: [],
    memberIds: [],
    classIds: [],
    subtasks: [],
    completionCriteria: '',
    nextAction: '',
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
    initiativeId: task.initiativeId || '',
    milestoneId: task.milestoneId || '',
  };
}

function taskInput(form) {
  return {
    ...form,
    tags: form.tagsText.split(',').map(tag => tag.trim()).filter(Boolean),
    subtasks: Array.isArray(form.subtasks) ? form.subtasks.map(item => item.trim()).filter(Boolean).slice(0, 20) : [],
  };
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function taskDateGroup(task) {
  return taskDateBucket(
    { ...task, dueDate: taskDueDate(task) },
    localDateKey(),
    isTaskComplete(task),
  );
}

function academicYearIdForTask(task) {
  const dueDate = taskDueDate(task);
  if (!dueDate) return '';
  const date = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  const start = date.getMonth() >= 8 ? date.getFullYear() : date.getFullYear() - 1;
  return `year_${start}_${start + 1}`;
}

function timestampMillis(value) {
  if (value?.toMillis) return value.toMillis();
  if (typeof value === 'string') return Date.parse(value) || 0;
  return 0;
}

function displayText(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function idList(value) {
  return Array.isArray(value)
    ? value.filter(item => typeof item === 'string' || typeof item === 'number').map(String)
    : [];
}

export default function TaskBoard() {
  const { userData, selectedSchool, currentUser } = useAuth();
  const { permissions } = usePermissions();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const uid = currentUser?.uid;
  const schoolId = selectedSchool || userData?.schoolId;
  const canEditOrganizationTasks = permissions.tasks_edit;
  const canAssignTasks = permissions.tasks_assign || permissions.tasks_edit;
  const canAssignMandatory = permissions['tasks.assignMandatory']
    || ['principal', 'institution_manager', 'global_admin', 'platform_admin'].includes(userData?.role);
  const isInitiativeManager = ['principal', 'institution_manager', 'global_admin', 'platform_admin'].includes(userData?.role);
  const canCreateInitiative = permissions['initiatives.create'] || isInitiativeManager;
  const canManageAssignments = permissions['tasks.manageAssignments'] || canAssignMandatory;
  const canManageTaskPermissions = permissions['tasks.managePermissions'] || canAssignMandatory;
  const canCreateCommunication = permissions['communications.create'] || isInitiativeManager;
  const canUseTaskAssistant = permissions['tasks.useAssistant'] || isInitiativeManager;
  const communicationPermissions = {
    reassign: permissions['communications.reassign'] === true,
    close: permissions['communications.close'] === true,
    viewAll: permissions['communications.viewAll'] === true,
    useAgent: isInitiativeManager || permissions['communications.useAgent'] === true,
    manageTemplates: isInitiativeManager || permissions['communications.manageTemplates'] === true,
  };
  const contactPermissions = {
    view: isInitiativeManager || permissions['contacts.view'] === true,
    create: isInitiativeManager || permissions['contacts.create'] === true,
    edit: isInitiativeManager || permissions['contacts.edit'] === true,
    archive: isInitiativeManager || permissions['contacts.archive'] === true,
    merge: isInitiativeManager || permissions['contacts.merge'] === true,
  };
  const canViewAllInitiatives = permissions['initiatives.viewAll'] || isInitiativeManager;
  const initiativePermissions = isInitiativeManager ? {
    ...permissions,
    'initiatives.view': true,
    'initiatives.viewAll': true,
    'initiatives.create': true,
    'initiatives.edit': true,
    'initiatives.manageParticipants': true,
    'initiatives.createMilestones': true,
    'initiatives.approveMilestones': true,
    'initiatives.changeHealth': true,
    'initiatives.createTemplate': true,
    'initiatives.duplicate': true,
    'initiatives.archive': true,
  } : permissions;

  const [personalTasks, setPersonalTasks] = useState([]);
  const [organizationTasks, setOrganizationTasks] = useState([]);
  const [communicationDrafts, setCommunicationDrafts] = useState([]);
  const [taskInvitations, setTaskInvitations] = useState([]);
  const [staff, setStaff] = useState([]);
  const [teams, setTeams] = useState([]);
  const [allFiles, setAllFiles] = useState([]);
  const [allFolders, setAllFolders] = useState([]);
  const [classes, setClasses] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [academicYears, setAcademicYears] = useState([]);
  const [initiatives, setInitiatives] = useState([]);
  const [activeTab, setActiveTab] = useState(() => searchParams.get('view') === 'communications' ? 'communications' : 'dashboard');
  const [workView, setWorkView] = useState(() => searchParams.get('initiative') ? 'plans' : 'mine');
  const communicationReminderInFlight = useRef(new Set());
  const [scopeFilter, setScopeFilter] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');
  const [filterTeam, setFilterTeam] = useState('all');
  const [filterDate, setFilterDate] = useState('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterAcademicYear, setFilterAcademicYear] = useState('all');
  const [filterOwner, setFilterOwner] = useState('all');
  const [filterInitiative, setFilterInitiative] = useState('all');
  const [showCompleted, setShowCompleted] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingTask, setEditingTask] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [conversionTask, setConversionTask] = useState(null);
  const [conversion, setConversion] = useState({ scope: TASK_SCOPES.ASSIGNED, assigneeId: '', teamId: '' });
  const [chatTask, setChatTask] = useState(null);
  const [previewFile, setPreviewFile] = useState(null);
  const [showPermissionsPanel, setShowPermissionsPanel] = useState(false);
  const [permissionTask, setPermissionTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [assistantMeta, setAssistantMeta] = useState(null);
  const [assistantFeedback, setAssistantFeedback] = useState(false);
  const [collaborationTask, setCollaborationTask] = useState(null);
  const [collaborationRecipients, setCollaborationRecipients] = useState([]);
  const [collaborationMessage, setCollaborationMessage] = useState('');
  const [invitationResponse, setInvitationResponse] = useState('');
  const [chatReceipts, setChatReceipts] = useState({});
  const [initiativeAttentionOnly, setInitiativeAttentionOnly] = useState(false);
  const [initiativeDetailOpen, setInitiativeDetailOpen] = useState(false);
  const [communicationTask, setCommunicationTask] = useState(null);
  const [communicationReturnTo, setCommunicationReturnTo] = useState('');

  function openCommunicationContext(context, returnTo = '') {
    setCommunicationTask(communicationSourceFromContext(normalizeCommunicationContext(context)));
    setCommunicationReturnTo(returnTo);
    setActiveTab('communications');
  }

  function closeCommunication() {
    setCommunicationTask(null);
    if (communicationReturnTo) {
      const target = communicationReturnTo;
      setCommunicationReturnTo('');
      navigate(target);
    }
  }

  useEffect(() => {
    if (!showFilters) return undefined;
    const closeTransientPanels = event => {
      if (event.key !== 'Escape') return;
      setShowFilters(false);
    };
    window.addEventListener('keydown', closeTransientPanels);
    return () => window.removeEventListener('keydown', closeTransientPanels);
  }, [showFilters]);

  useEffect(() => {
    if (!location.state?.communicationContext) return;
    openCommunicationContext(location.state.communicationContext, location.state.communicationReturnTo || '');
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [location.pathname, location.search, location.state, navigate]);

  const teamIds = useMemo(() => {
    const ids = new Set(Array.isArray(userData?.teamIds) ? userData.teamIds : []);
    teams.forEach(team => {
      if (Array.isArray(team.memberIds) && team.memberIds.includes(uid)) ids.add(team.id);
    });
    return [...ids];
  }, [teams, uid, userData?.teamIds]);

  useEffect(() => subscribeInitiatives({
    db,
    schoolId,
    uid,
    teamIds,
    canViewAll: canViewAllInitiatives,
    onData: setInitiatives,
    onError: () => setInitiatives([]),
  }), [canViewAllInitiatives, schoolId, teamIds, uid]);

  useEffect(() => {
    if (!schoolId) return undefined;
    return subscribeAcademicYears({ db, schoolId, onData: setAcademicYears, onError: () => setAcademicYears([]) });
  }, [schoolId]);

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
    if (!schoolId || !uid) return undefined;
    return subscribeCommunicationDrafts({
      db,
      schoolId,
      uid,
      canViewAll: communicationPermissions.viewAll,
      onData: setCommunicationDrafts,
      onError: () => setError('לא ניתן לטעון את המיילים והמעקבים כרגע.'),
    });
  }, [communicationPermissions.viewAll, schoolId, uid]);

  useEffect(() => {
    if (!schoolId || !uid) return;
    const today = localDateKey();
    communicationDrafts
      .filter(draft => draft.followUpAssigneeId === uid
        && !['awaiting_send', 'resolved', 'closed_without_reply', 'cancelled'].includes(draft.communicationStatus)
        && draft.nextFollowUpAt?.slice(0, 10) <= today
        && draft.reminderNotifiedFor !== draft.nextFollowUpAt?.slice(0, 10))
      .forEach(draft => {
        const key = `${draft.communicationDraftId}:${draft.nextFollowUpAt?.slice(0, 10)}`;
        if (communicationReminderInFlight.current.has(key)) return;
        communicationReminderInFlight.current.add(key);
        createNotification(uid, {
          schoolId,
          title: `הגיע מועד מעקב: ${draft.communicationSubject}`,
          body: `האם התקבלה תשובה מ־${draft.externalRecipientLabel || 'הנמען'}?`,
          type: 'communication',
          link: '/tasks?view=communications',
        }).then(created => created && markCommunicationReminderNotified({
          db,
          schoolId,
          actorId: uid,
          draft: { ...draft, id: draft.communicationDraftId, taskId: draft.id },
        })).catch(() => undefined).finally(() => communicationReminderInFlight.current.delete(key));
      });
  }, [communicationDrafts, schoolId, uid]);

  useEffect(() => {
    if (!schoolId) return;
    async function loadStaff() {
      const users = new Map();
      try {
        const bySchools = await getDocs(query(collection(db, 'users'), where('schoolIds', 'array-contains', schoolId)));
        bySchools.docs.forEach(item => {
          const data = item.data();
          users.set(item.id, { ...data, id: item.id, fullName: displayText(data.fullName), email: displayText(data.email) });
        });
        const byLegacySchool = await getDocs(query(collection(db, 'users'), where('schoolId', '==', schoolId)));
        byLegacySchool.docs.forEach(item => {
          const data = item.data();
          users.set(item.id, { ...data, id: item.id, fullName: displayText(data.fullName), email: displayText(data.email) });
        });
      } catch {
        setError('לא ניתן לטעון את רשימת העובדים.');
      }
      setStaff([...users.values()].filter(user => user.accountStatus !== 'pending'));
    }
    loadStaff();
    const unsubscribeTeams = onSnapshot(
      schoolCollection(db, schoolId, 'teams'),
      snapshot => setTeams(snapshot.docs.map(item => {
        const data = item.data();
        return { ...data, id: item.id, name: displayText(data.name, 'צוות'), memberIds: idList(data.memberIds) };
      })),
      () => setTeams([]),
    );
    const unsubscribeFiles = onSnapshot(
      schoolCollection(db, schoolId, 'files'),
      snapshot => setAllFiles(snapshot.docs.map(item => {
        const data = item.data();
        return { ...data, id: item.id, name: displayText(data.name, 'קובץ'), folderId: displayText(data.folderId) };
      })),
      () => setAllFiles([]),
    );
    const unsubscribeFolders = onSnapshot(
      schoolCollection(db, schoolId, 'folders'),
      snapshot => setAllFolders(snapshot.docs.map(item => {
        const data = item.data();
        return { ...data, id: item.id, visibility: displayText(data.visibility), allowedUsers: idList(data.allowedUsers) };
      })),
      () => setAllFolders([]),
    );
    const unsubscribeClasses = onSnapshot(
      schoolCollection(db, schoolId, 'classes'),
      snapshot => setClasses(snapshot.docs.map(item => ({ id: item.id, ...item.data() })).filter(item => item.status !== 'archived')),
      () => setClasses([]),
    );
    const unsubscribeHolidays = onSnapshot(
      schoolCollection(db, schoolId, 'holidays'),
      snapshot => setHolidays(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))),
      () => setHolidays([]),
    );
    return () => {
      unsubscribeTeams();
      unsubscribeFiles();
      unsubscribeFolders();
      unsubscribeClasses();
      unsubscribeHolidays();
    };
  }, [schoolId]);

  useEffect(() => {
    if (!schoolId || !uid) return;
    // Invitations are server-managed and exist only in the tenant-scoped
    // collection. Do not let the global legacy data-mode redirect this read to
    // a non-existent top-level collection.
    const invitationRef = schoolCollection(db, schoolId, 'taskInvitations', 'nested');
    const sets = new Map();
    const emit = () => {
      const merged = new Map();
      sets.forEach(items => items.forEach(item => merged.set(item.id, item)));
      setTaskInvitations([...merged.values()]);
    };
    const unsubscribers = [
      query(invitationRef, where('recipientId', '==', uid)),
      query(invitationRef, where('inviterId', '==', uid)),
    ].map((invitationQuery, index) => onSnapshot(invitationQuery, snapshot => {
      sets.set(index, snapshot.docs.map(item => {
        const data = item.data();
        return {
          ...data,
          id: item.id,
          title: displayText(data.title, 'הזמנה למשימה'),
          description: displayText(data.description),
          inviterName: displayText(data.inviterName),
          message: displayText(data.message),
          response: displayText(data.response),
        };
      }));
      emit();
    }, () => setTaskInvitations([])));
    return () => unsubscribers.forEach(unsubscribe => unsubscribe());
  }, [schoolId, uid]);

  useEffect(() => subscribeTaskChatReceipts({
    db,
    uid,
    onData: setChatReceipts,
    onError: () => setChatReceipts({}),
  }), [uid]);

  const tabTasks = useMemo(() => {
    if (activeTab === 'invitations') return [];
    const tasks = [...personalTasks, ...organizationTasks];
    if (activeTab === 'communications') return tasks.filter(task => task.workflowType === 'external_email_followup');
    return tasks.filter(task => task.workflowType !== 'external_email_followup');
  }, [activeTab, organizationTasks, personalTasks]);

  const viewTasks = useMemo(() => activeTab === 'dashboard'
    ? tabTasks.filter(task => belongsToTaskView(task, workView, uid))
    : tabTasks, [activeTab, tabTasks, uid, workView]);

  const filteredTasks = useMemo(() => viewTasks.filter(task => {
    if (scopeFilter === 'personal' && task.scope !== TASK_SCOPES.PERSONAL) return false;
    if (scopeFilter === 'shared' && task.scope !== 'shared') return false;
    if (scopeFilter === 'assigned' && !task.assigneeIds?.includes(uid)) return false;
    if (scopeFilter === 'team' && task.scope !== TASK_SCOPES.TEAM && task.assigneeType !== 'all_school') return false;
    if (scopeFilter === 'mandatory' && !task.mandatory) return false;
    if (scopeFilter === 'created' && task.createdBy !== uid) return false;
    const complete = isTaskComplete(task);
    if (complete && !showCompleted && filterStatus !== 'done' && filterDate !== 'completed') return false;
    if (filterStatus !== 'all') {
      const status = complete ? 'done' : task.status || 'todo';
      if (status !== filterStatus) return false;
    }
    if (filterPriority !== 'all' && task.priority !== filterPriority) return false;
    if (filterTeam !== 'all' && (task.teamId || task.assigneeTeamId) !== filterTeam) return false;
    if (filterDate !== 'all' && taskDateGroup(task) !== filterDate) return false;
    if (filterInitiative !== 'all' && task.initiativeId !== filterInitiative) return false;
    if (filterOwner !== 'all' && task.createdBy !== filterOwner && !task.assigneeIds?.includes(filterOwner)) return false;
    const dueDate = String(taskDueDate(task) || '').slice(0, 10);
    if (filterDateFrom && (!dueDate || dueDate < filterDateFrom)) return false;
    if (filterDateTo && (!dueDate || dueDate > filterDateTo)) return false;
    if (filterAcademicYear !== 'all') {
      const initiativeYear = initiatives.find(item => item.id === task.initiativeId)?.academicYearId;
      if ((initiativeYear || academicYearIdForTask(task)) !== filterAcademicYear) return false;
    }
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [chatReceipts, filterAcademicYear, filterDate, filterDateFrom, filterDateTo, filterInitiative, filterOwner, filterPriority, filterStatus, filterTeam, initiatives, schoolId, scopeFilter, searchText, showCompleted, uid, viewTasks]);

  const groupedMineTasks = useMemo(() => {
    const groups = { overdue: [], today: [], upcoming: [], no_date: [], completed: [] };
    filteredTasks.forEach(task => groups[taskDateGroup(task)].push(task));
    return groups;
  }, [filteredTasks]);

  function isTaskChatUnread(task) {
    if (task._source !== 'organization' || !task.lastChatMessageAt || task.lastChatMessageBy === uid) return false;
    const receipt = chatReceipts[taskChatReceiptId(schoolId, task)];
    return timestampMillis(task.lastChatMessageAt) > timestampMillis(receipt?.readAt);
  }

  const dashboardStats = useMemo(() => {
    const allTasks = [...personalTasks, ...organizationTasks]
      .filter(task => task.workflowType !== 'external_email_followup')
      .filter(task => belongsToTaskView(task, 'mine', uid));
    return {
      today: allTasks.filter(task => taskDateGroup(task) === 'today').length,
      overdue: allTasks.filter(task => taskDateGroup(task) === 'overdue').length,
      waiting: taskInvitations.filter(item => item.recipientId === uid && item.status === 'pending').length,
    };
  // Chat receipts intentionally refresh the unread summary without rebuilding task subscriptions.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatReceipts, organizationTasks, personalTasks, schoolId, taskInvitations, uid]);

  const activeFilterCount = [
    scopeFilter !== 'all', filterStatus !== 'all', filterPriority !== 'all', filterTeam !== 'all',
    filterDate !== 'all', Boolean(filterDateFrom), Boolean(filterDateTo), filterAcademicYear !== 'all',
    filterOwner !== 'all', filterInitiative !== 'all', showCompleted,
  ].filter(Boolean).length;
  const activeFilterChips = [];
  if (scopeFilter !== 'all') activeFilterChips.push({ key: 'scope', label: `סוג: ${SCOPE_FILTER_LABELS[scopeFilter] || scopeFilter}`, clear: () => setScopeFilter('all') });
  if (filterStatus !== 'all') activeFilterChips.push({ key: 'status', label: `סטטוס: ${STATUS_CONFIG[filterStatus]?.label || filterStatus}`, clear: () => setFilterStatus('all') });
  if (filterPriority !== 'all') activeFilterChips.push({ key: 'priority', label: `עדיפות: ${PRIORITY_CONFIG[filterPriority]?.label || filterPriority}`, clear: () => setFilterPriority('all') });
  if (filterTeam !== 'all') activeFilterChips.push({ key: 'team', label: `צוות: ${teams.find(item => item.id === filterTeam)?.name || 'נבחר'}`, clear: () => setFilterTeam('all') });
  if (filterDate !== 'all') activeFilterChips.push({ key: 'date', label: `מועד: ${GROUP_LABELS[filterDate] || filterDate}`, clear: () => setFilterDate('all') });
  if (filterDateFrom || filterDateTo) activeFilterChips.push({ key: 'range', label: `טווח: ${filterDateFrom || 'התחלה'}–${filterDateTo || 'המשך'}`, clear: () => { setFilterDateFrom(''); setFilterDateTo(''); } });
  if (filterAcademicYear !== 'all') activeFilterChips.push({ key: 'year', label: `שנה: ${academicYears.find(item => item.id === filterAcademicYear)?.hebrewLabel || 'נבחרה'}`, clear: () => setFilterAcademicYear('all') });
  if (filterOwner !== 'all') activeFilterChips.push({ key: 'owner', label: `אחראי: ${staff.find(item => (item.uid || item.id) === filterOwner)?.fullName || 'נבחר'}`, clear: () => setFilterOwner('all') });
  if (filterInitiative !== 'all') activeFilterChips.push({ key: 'initiative', label: `תכנית: ${initiatives.find(item => item.id === filterInitiative)?.title || 'נבחרה'}`, clear: () => setFilterInitiative('all') });
  if (showCompleted) activeFilterChips.push({ key: 'completed', label: 'כולל משימות שהושלמו', clear: () => setShowCompleted(false) });

  function clearAllFilters() {
    setScopeFilter('all');
    setFilterStatus('all');
    setFilterPriority('all');
    setFilterTeam('all');
    setFilterDate('all');
    setFilterDateFrom('');
    setFilterDateTo('');
    setFilterAcademicYear('all');
    setFilterOwner('all');
    setFilterInitiative('all');
    setShowCompleted(false);
  }

  function selectWorkView(view) {
    setWorkView(view);
    setActiveTab('dashboard');
    setInitiativeDetailOpen(false);
    setInitiativeAttentionOnly(false);
    setFilterDate('all');
  }

  function openMetric(dateFilter) {
    setActiveTab('dashboard');
    setWorkView('mine');
    setInitiativeDetailOpen(false);
    setFilterStatus('all');
    setFilterDate(dateFilter);
    if (dateFilter !== 'completed') setShowCompleted(false);
  }

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

  function openTaskForm(scope, context = {}) {
    setForm({
      ...emptyForm(scope),
      ...(scope === TASK_SCOPES.TEAM && teams[0] ? { teamId: teams[0].id } : {}),
      initiativeId: context.initiativeId || '',
      milestoneId: context.milestoneId || '',
      creationKind: context.creationKind || 'task',
    });
    setAssistantMeta(null);
    setShowForm(true);
  }

  function applyAssistantProposal(proposal) {
    const resolved = resolveTaskAssistantProposal({
      proposal,
      staff,
      teams,
      classes,
      initiatives,
      canAssign: canAssignTasks,
      canCreateInitiative,
      canAssignMandatory,
    });
    const nextForm = proposalToTaskForm(resolved, emptyForm());
    const holiday = findHolidayConflict(nextForm.dueDate || nextForm.endDate, holidays);
    setForm(nextForm);
    setAssistantMeta({
      reasoningSummary: resolved.reasoningSummary,
      holidayName: holiday?.name || holiday?.title || '',
      unresolved: [
        resolved.assigneeSuggestions.length > 0 && !resolved.assignee ? 'האחראי שהוצע לא נמצא ברשימה המורשית' : '',
        resolved.teamSuggestions.length > 0 && !resolved.team ? 'הצוות שהוצע לא נמצא ברשימה המורשית' : '',
      ].filter(Boolean),
    });
    setShowForm(true);
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
      const recipients = (Array.isArray(team?.memberIds) ? team.memberIds : []).filter(id => id !== uid);
      if (recipients.length) await createNotifications(recipients, options);
    }
  }

  async function handleCreate(event) {
    event.preventDefault();
    const input = taskInput(form);
    if (!input.title.trim() || !schoolId || !uid) return;
    if (input.creationKind === 'initiative' && !canCreateInitiative) {
      setError('אין הרשאה ליצור תכנית ארוכת טווח.');
      return;
    }
    if (input.mandatory && (!canAssignMandatory || input.recipientIds.length === 0)) {
      setError('יש לבחור לפחות מקבל אחד למשימה המחייבת.');
      return;
    }
    if (!input.mandatory && input.scope !== TASK_SCOPES.PERSONAL && (!canAssignTasks || !validateAssignment(input))) {
      setError('יש לבחור יעד תקין למשימה.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (input.creationKind === 'initiative') {
        const activeYear = academicYears.find(item => item.isActive) || academicYears[0];
        if (!activeYear) throw new Error('NO_ACADEMIC_YEAR');
        const ownerId = input.assigneeIds[0] || uid;
        const owner = staff.find(item => (item.uid || item.id) === ownerId);
        const initiativeId = await createInitiative({
          db,
          schoolId,
          actor: { uid, fullName: userData?.fullName || '' },
          input: {
            title: input.title,
            description: input.description,
            academicYearId: activeYear.id,
            academicYearLabel: activeYear.hebrewLabel || activeYear.label || '',
            category: 'תכנית מוסדית',
            startDate: input.startDate,
            endDate: input.endDate || input.dueDate,
            ownerId,
            ownerName: owner?.fullName || userData?.fullName || '',
            memberIds: input.memberIds,
            teamIds: input.teamId ? [input.teamId] : [],
            classIds: input.classIds,
            fileIds: input.attachedFileId ? [input.attachedFileId] : [],
            goals: input.completionCriteria ? [input.completionCriteria] : [],
            nextAction: input.nextAction || input.subtasks[0] || '',
            status: 'active',
          },
        });
        await Promise.all(input.subtasks.map((title, index) => createMilestone({
          db,
          schoolId,
          initiativeId,
          actor: { uid, fullName: userData?.fullName || '' },
          input: {
            title,
            description: '',
            ownerId,
            participantIds: input.memberIds,
            status: 'not_started',
            priority: input.priority,
            weight: 1,
            dateType: input.endDate || input.dueDate ? 'exact' : 'unset',
            startDate: input.endDate || input.dueDate,
            order: index + 1,
          },
        })));
        const recipients = [...new Set([ownerId, ...input.memberIds].filter(id => id && id !== uid))];
        if (recipients.length) await createNotifications(recipients, { schoolId, title: `צורפת לתכנית: ${input.title}`, body: input.description?.slice(0, 80) || '', type: 'initiative', link: `/tasks?initiative=${initiativeId}` });
      } else if (input.mandatory) {
        await createMandatoryTask({ schoolId, title: input.title, description: input.description, dueDate: input.dueDate, priority: input.priority, recipientIds: input.recipientIds });
      } else {
        const creator = input.scope === TASK_SCOPES.PERSONAL ? createPersonalTask : createOrganizationTask;
        const created = await creator({ db, schoolId, user: { uid, fullName: userData?.fullName }, input });
        if (input.scope !== TASK_SCOPES.PERSONAL) await notifyAssignment(input, created.id);
        await Promise.all(input.subtasks.map(title => creator({
          db,
          schoolId,
          user: { uid, fullName: userData?.fullName },
          input: { ...input, title, description: '', sourceTaskId: created.id, subtasks: [] },
        })));
      }
      setForm(emptyForm());
      setShowForm(false);
      setActiveTab('dashboard');
      setWorkView(input.creationKind === 'initiative' ? 'plans' : input.scope === TASK_SCOPES.TEAM ? 'teams' : 'mine');
      setScopeFilter(input.scope === TASK_SCOPES.PERSONAL ? 'all' : 'created');
      setAssistantFeedback(Boolean(assistantMeta));
      setAssistantMeta(null);
      showMessage(input.creationKind === 'initiative' ? 'התכנית ואבני הדרך נוצרו בהצלחה.' : 'המשימה נוצרה בהצלחה.');
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
      setActiveTab('dashboard');
      setScopeFilter('mine');
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
      setActiveTab('dashboard');
      setScopeFilter('created');
      showMessage('המשימה הפכה למשימה ארגונית.');
    } catch {
      setGeneralError();
    } finally {
      setSaving(false);
    }
  }

  async function sendCollaborationInvitations() {
    if (!collaborationTask || collaborationRecipients.length === 0) return;
    if (!window.confirm('המשימה לא תהיה עוד פרטית לחלוטין. מי שיאשר את ההזמנה יוכל לראות את תוכנה. להמשיך?')) return;
    setSaving(true);
    setError('');
    try {
      await inviteTaskCollaborators({
        schoolId,
        personalTaskId: collaborationTask.id,
        recipientIds: collaborationRecipients,
        message: collaborationMessage,
      });
      setCollaborationTask(null);
      setCollaborationRecipients([]);
      setCollaborationMessage('');
      showMessage('הזמנות השיתוף נשלחו.');
    } catch {
      setGeneralError();
    } finally {
      setSaving(false);
    }
  }

  async function handleTaskInvitation(invitation, action) {
    setSaving(true);
    setError('');
    try {
      await respondTaskInvitation({ schoolId, invitationId: invitation.id, action, response: invitationResponse });
      setInvitationResponse('');
      showMessage(action === 'accept' ? 'ההזמנה התקבלה והמשימה נוספה למשימות המשותפות.' : action === 'decline' ? 'ההזמנה נדחתה.' : 'ההזמנה בוטלה.');
    } catch {
      setGeneralError();
    } finally {
      setSaving(false);
    }
  }

  function getAssigneeDisplay(task) {
    if (task.scope === TASK_SCOPES.PERSONAL) return 'אישית';
    if (task.scope === 'shared') return 'משותפת';
    if (task.scope === TASK_SCOPES.ASSIGNED || task.assigneeType === 'individual') {
      const names = (task.assigneeIds || []).map(id => staff.find(user => (user.uid || user.id) === id)?.fullName || 'עובד');
      return names.join(', ');
    }
    if (task.assigneeType === 'all_school') return 'כל בית הספר';
    const team = teams.find(item => item.id === (task.teamId || task.assigneeTeamId));
    return team?.name || 'צוות';
  }

  function canChangeStatus(task) {
    if (task.workflowType === 'external_email_followup') return false;
    return task._source === 'personal'
      || canEditOrganizationTasks
      || (task.scope === TASK_SCOPES.ASSIGNED && task.assigneeIds?.includes(uid));
  }

  function canEditDetails(task) {
    if (task.workflowType === 'external_email_followup') return false;
    if (task._source === 'personal') return true;
    if (task.mandatory) return task.createdBy === uid || canManageAssignments;
    return canEditOrganizationTasks || (task.scope === 'shared' && task.createdBy === uid);
  }

  function canDeleteTask(task) {
    if (task.workflowType === 'external_email_followup') return false;
    if (task._source === 'personal') return true;
    if (task.mandatory) return task.createdBy === uid || canManageAssignments;
    return canEditDetails(task);
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
        {!editing && <div className="task-creation-kind" role="group" aria-label="מבנה העבודה">
          <button type="button" className={value.creationKind === 'task' ? 'active' : ''} onClick={() => setter(previous => ({ ...previous, creationKind: 'task', mandatory: false }))}>משימה רגילה</button>
          {canCreateInitiative && <button type="button" className={value.creationKind === 'initiative' ? 'active' : ''} onClick={() => setter(previous => ({ ...previous, creationKind: 'initiative', mandatory: false }))}><Flag size={15} /> תכנית ארוכת טווח</button>}
        </div>}
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
          {value.creationKind !== 'initiative' && <div className="form-group">
            <label>סטטוס</label>
            <select name="status" value={value.status} onChange={event => handleFormChange(setter, event)}>
              {Object.entries(STATUS_CONFIG).map(([key, config]) => <option key={key} value={key}>{config.label}</option>)}
            </select>
          </div>}
          {value.creationKind !== 'initiative' && <div className="form-group">
            <label>תאריך יעד</label>
            <input name="dueDate" type="date" value={value.dueDate} onChange={event => handleFormChange(setter, event)} dir="ltr" />
          </div>}
        </div>
        {value.creationKind === 'initiative' && <div className="form-row"><div className="form-group"><label>תאריך התחלה</label><input name="startDate" type="date" value={value.startDate} onChange={event => handleFormChange(setter, event)} /></div><div className="form-group"><label>תאריך סיום</label><input name="endDate" type="date" min={value.startDate || undefined} value={value.endDate} onChange={event => handleFormChange(setter, event)} /></div></div>}
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
        {value.creationKind !== 'initiative' && initiatives.length > 0 && <div className="form-row task-initiative-link-fields">
          <div className="form-group"><label>תכנית ארוכת טווח (אופציונלי)</label><select value={value.initiativeId || ''} onChange={event => setter(previous => ({ ...previous, initiativeId: event.target.value, milestoneId: '' }))}><option value="">ללא תכנית</option>{initiatives.filter(item => item.status !== 'archived').map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></div>
          {value.milestoneId && <div className="form-group"><label>אבן דרך</label><div className="task-context-value"><Flag size={14} /> משימה שנוצרה מתוך אבן דרך</div></div>}
        </div>}
        {!value.mandatory && renderAssignmentFields(value, setter, !editing)}
        {!editing && value.creationKind === 'task' && canAssignMandatory && <label className="task-mandatory-toggle"><input type="checkbox" checked={value.mandatory} onChange={event => setter(previous => ({ ...previous, mandatory: event.target.checked, scope: event.target.checked ? TASK_SCOPES.ASSIGNED : previous.scope, assigneeIds: [] }))} /> משימה מחייבת שלא ניתן להסיר</label>}
        {!editing && value.mandatory && <div className="form-group"><label>מקבלים</label><div className="task-recipient-list">{staff.filter(user => (user.uid || user.id) !== uid).map(user => { const userId = user.uid || user.id; return <label key={userId}><input type="checkbox" checked={value.recipientIds.includes(userId)} onChange={event => setter(previous => ({ ...previous, recipientIds: event.target.checked ? [...previous.recipientIds, userId] : previous.recipientIds.filter(id => id !== userId) }))} /> {user.fullName || user.email}</label>; })}</div></div>}
        {!editing && value.creationKind === 'initiative' && <div className="initiative-selection-grid task-unified-participants"><fieldset><legend>משתתפים</legend>{staff.filter(item => (item.uid || item.id) !== uid).map(item => { const id = item.uid || item.id; return <label key={id}><input type="checkbox" checked={value.memberIds.includes(id)} onChange={event => setter(previous => ({ ...previous, memberIds: event.target.checked ? [...new Set([...previous.memberIds, id])] : previous.memberIds.filter(itemId => itemId !== id) }))} /> {item.fullName}</label>; })}</fieldset><fieldset><legend>כיתות קשורות</legend>{classes.map(item => <label key={item.id}><input type="checkbox" checked={value.classIds.includes(item.id)} onChange={event => setter(previous => ({ ...previous, classIds: event.target.checked ? [...new Set([...previous.classIds, item.id])] : previous.classIds.filter(itemId => itemId !== item.id) }))} /> {item.name}</label>)}</fieldset></div>}
        {!editing && <div className="task-subtasks-editor"><div className="task-subtasks-head"><label>{value.creationKind === 'initiative' ? 'אבני דרך' : 'תתי־משימות'}</label><button type="button" className="btn btn-secondary btn-sm" onClick={() => setter(previous => ({ ...previous, subtasks: [...previous.subtasks, ''] }))}><Plus size={13} /> הוספה</button></div>{value.subtasks.map((subtask, index) => <div key={`subtask-${index}`}><input value={subtask} maxLength={180} placeholder={value.creationKind === 'initiative' ? 'שם אבן הדרך' : 'שם תת־המשימה'} onChange={event => setter(previous => ({ ...previous, subtasks: previous.subtasks.map((item, itemIndex) => itemIndex === index ? event.target.value : item) }))} /><button type="button" className="icon-btn" onClick={() => setter(previous => ({ ...previous, subtasks: previous.subtasks.filter((_, itemIndex) => itemIndex !== index) }))} aria-label="הסרת שורה"><X size={14} /></button></div>)}</div>}
        {!editing && <div className="form-row"><div className="form-group"><label>תנאי לסיום</label><input name="completionCriteria" value={value.completionCriteria} onChange={event => handleFormChange(setter, event)} maxLength={800} /></div>{value.creationKind === 'initiative' && <div className="form-group"><label>הפעולה הבאה</label><input name="nextAction" value={value.nextAction} onChange={event => handleFormChange(setter, event)} maxLength={300} /></div>}</div>}
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
    const status = STATUS_CONFIG[isTaskComplete(task) ? 'done' : task.status] || STATUS_CONFIG.todo;
    const overdue = taskDateGroup(task) === 'overdue';
    const daysLate = overdue ? overdueDayCount({ dueDate: taskDueDate(task) }, localDateKey()) : 0;
    const pinned = task.pinnedBy?.includes(uid);
    const unreadChat = isTaskChatUnread(task);
    const closeAndRun = (event, action) => {
      event.currentTarget.closest('details')?.removeAttribute('open');
      action();
    };
    return (
      <article key={task._key} className={`task-row task-work-card ${overdue ? 'task-row--overdue' : ''}`}>
        <div className="task-main">
          <div className="task-title-line">
            <span className="task-title">{task.title}</span>
            {(task.mandatory || !canDeleteTask(task)) && <span className="task-restriction" title={task.mandatory ? 'משימה מחייבת — ההגבלות שהוגדרו נשמרות' : 'אין הרשאה למחוק משימה זו'} aria-label={task.mandatory ? 'משימה מחייבת' : 'משימה מוגנת'}><Lock size={12} /></span>}
            {task.priority === 'high' && <span className="task-urgency"><AlertCircle size={11} /> דחוף</span>}
            {overdue && <span className="task-overdue-badge">באיחור</span>}
          </div>
          {task.description && <div className="task-desc">{task.description}</div>}
          <div className="task-meta">
            <span className="task-assignee">{task.scope === TASK_SCOPES.PERSONAL ? <Lock size={11} /> : <Users size={11} />}{getAssigneeDisplay(task)}</span>
            {taskDueDate(task) ? <span className={`task-due ${overdue ? 'task-due--late' : ''}`}>{new Date(`${String(taskDueDate(task)).slice(0, 10)}T00:00:00`).toLocaleDateString('he-IL')}{daysLate > 0 ? ` · ${daysLate} ימים` : ''}</span> : <span className="task-due">ללא תאריך</span>}
            <span className={`task-status-badge task-status-badge--${isTaskComplete(task) ? 'done' : task.status || 'todo'}`}>{status.label}</span>
          </div>
        </div>
        <button className="task-complete-action" type="button" onClick={() => changeStatus(task, isTaskComplete(task) ? 'todo' : 'done')} disabled={!canChangeStatus(task)} aria-label={isTaskComplete(task) ? `החזרת ${task.title} לביצוע` : `סימון ${task.title} כהושלם`}>
          {isTaskComplete(task) ? <RotateCcw size={15} /> : <Check size={15} />}<span>{isTaskComplete(task) ? 'החזרה לביצוע' : 'סימון כהושלם'}</span>
        </button>
        <details className="task-actions-menu">
          <summary aria-label={`פעולות נוספות עבור ${task.title}`} title="פעולות נוספות"><MoreHorizontal size={18} />{unreadChat && <span className="task-menu-unread" aria-label="יש הודעות חדשות">!</span>}</summary>
          <div role="menu">
            {canEditDetails(task) && <button role="menuitem" onClick={event => closeAndRun(event, () => startEdit(task))}><Edit3 size={15} /> עריכה</button>}
            {task._source === 'organization' && <button role="menuitem" onClick={event => closeAndRun(event, () => setChatTask(task))}><MessageSquare size={15} /> {unreadChat ? 'תגובה — הודעה חדשה' : 'תגובה'}</button>}
            {canEditDetails(task) && <button role="menuitem" onClick={event => closeAndRun(event, () => pinTask(task))}><Pin size={15} /> {pinned ? 'ביטול הצמדה' : 'הצמדת משימה'}</button>}
            {task.attachedFileId && <button role="menuitem" onClick={event => closeAndRun(event, () => setPreviewFile(task))}><Paperclip size={15} /> פתיחת קובץ</button>}
            {canEditDetails(task) && <button role="menuitem" onClick={event => closeAndRun(event, () => startEdit(task))}><Paperclip size={15} /> {task.attachedFileId ? 'החלפת קובץ' : 'הוספת קובץ'}</button>}
            {task._source === 'organization' && <button role="menuitem" onClick={event => closeAndRun(event, () => createFollowUp(task))}><CopyPlus size={15} /> יצירת משימת המשך</button>}
            {canCreateCommunication && task.workflowType !== 'external_email_followup' && <button role="menuitem" onClick={event => closeAndRun(event, () => setCommunicationTask(task))}><MailPlus size={15} /> יצירת מייל ומעקב</button>}
            {task.workflowType === 'external_email_followup' && task.communicationStatus === 'awaiting_send' && <button role="menuitem" onClick={event => closeAndRun(event, () => setCommunicationTask(task))}><MailPlus size={15} /> פתיחת טיוטת המייל</button>}
            {task._source === 'personal' && <button role="menuitem" onClick={event => closeAndRun(event, () => { setCollaborationTask(task); setCollaborationRecipients([]); setCollaborationMessage(''); })}><User size={15} /> הזמנת שותפים</button>}
            {task._source === 'personal' && canAssignTasks && <button role="menuitem" onClick={event => closeAndRun(event, () => { setConversionTask(task); setConversion({ scope: TASK_SCOPES.ASSIGNED, assigneeId: '', teamId: '' }); })}><Users size={15} /> העברת אחריות</button>}
            {task._source === 'organization' && canManageTaskPermissions && <button role="menuitem" onClick={event => closeAndRun(event, () => setPermissionTask({ task, position: { x: Math.max(16, window.innerWidth / 2 - 180), y: Math.max(16, window.innerHeight / 2 - 260) } }))}><Shield size={15} /> הרשאות נקודתיות</button>}
            {canDeleteTask(task) && <button className="is-danger" role="menuitem" onClick={event => closeAndRun(event, () => removeTask(task))}><Trash2 size={15} /> מחיקה</button>}
          </div>
        </details>
      </article>
    );
  }

  return (
    <div className="page">
      <Header title="משימות" onPermissions={() => setShowPermissionsPanel(true)} />
      {showPermissionsPanel && <PagePermissionsPanel feature="tasks" onClose={() => setShowPermissionsPanel(false)} />}
      <div className="page-content task-page-content">
        {message && <div className="task-feedback task-feedback--success" role="status">{message}</div>}
        {error && <div className="task-feedback task-feedback--error" role="alert">{error}<button onClick={() => setError('')} aria-label="סגירת הודעת שגיאה"><X size={14} /></button></div>}

        {activeTab === 'dashboard' ? <>
          <section className="task-dashboard-head" aria-labelledby="task-dashboard-title">
            <h1 id="task-dashboard-title">המשימות שלי</h1>
            <label className="task-compact-search"><Search size={16} aria-hidden="true" /><span className="sr-only">חיפוש משימות</span><input value={searchText} onChange={event => setSearchText(event.target.value)} placeholder="חיפוש" /></label>
            <button type="button" className="btn task-create-primary" onClick={() => openTaskForm(TASK_SCOPES.PERSONAL)}><Plus size={16} /> יצירה חדשה</button>
          </section>

          {canUseTaskAssistant && <TaskAssistantEntry uid={uid} onManual={() => openTaskForm(TASK_SCOPES.PERSONAL)} onProposal={applyAssistantProposal} />}

          <section className="task-action-metrics" aria-label="מה דורש טיפול">
            <button type="button" className={filterDate === 'today' && workView === 'mine' ? 'active' : ''} onClick={() => openMetric('today')}><span>להיום</span><strong>{dashboardStats.today}</strong></button>
            <button type="button" className={filterDate === 'overdue' && workView === 'mine' ? 'active is-overdue' : 'is-overdue'} onClick={() => openMetric('overdue')}><span>באיחור</span><strong>{dashboardStats.overdue}</strong></button>
            <button type="button" className={dashboardStats.waiting ? 'has-unread' : ''} onClick={() => { setActiveTab('invitations'); setFilterDate('all'); }}><span>ממתין לי</span><strong>{dashboardStats.waiting}</strong></button>
          </section>

          <section className="task-view-layer" aria-label="בחירת תצוגה">
            <SegmentedControl value={workView} onChange={selectWorkView} label="בחירת סוג העבודה" options={WORK_VIEW_OPTIONS} />
            <div className="task-view-tools">{workView !== 'plans' && <button type="button" className="task-filter-trigger" onClick={() => setShowFilters(true)} aria-label={`פתיחת מסננים${activeFilterCount ? `, ${activeFilterCount} פעילים` : ''}`}><Filter size={15} /> סינון{activeFilterCount > 0 && <span>{activeFilterCount}</span>}</button>}<details className="task-tools-menu"><summary aria-label="כלים נוספים"><MoreHorizontal size={17} /> כלים</summary><div>{canCreateCommunication && <button type="button" onClick={() => openCommunicationContext({ type: 'general', id: 'task_panel', label: 'פאנל המשימות' })}><MailPlus size={14} /> מייל ומעקב חדש</button>}<button type="button" onClick={() => setActiveTab('communications')}><MailPlus size={14} /> מרכז מיילים ומעקבים</button><button type="button" onClick={() => setActiveTab('invitations')}><Users size={14} /> הזמנות ושיתופים{dashboardStats.waiting > 0 ? ` (${dashboardStats.waiting})` : ''}</button></div></details></div>
          </section>

          {workView !== 'plans' && <section className="task-work-list-head" aria-label="מסננים פעילים">
            <span className="task-stats">{filteredTasks.length} משימות</span>
            {activeFilterChips.length > 0 && <div className="task-active-filters">{activeFilterChips.map(chip => <button type="button" key={chip.key} onClick={chip.clear} aria-label={`הסרת מסנן ${chip.label}`}>{chip.label}<X size={12} aria-hidden="true" /></button>)}<button type="button" className="task-clear-filters" onClick={clearAllFilters}>נקה הכול</button></div>}
          </section>}
        </> : <section className="task-secondary-head"><div><button type="button" className="btn btn-secondary btn-sm" onClick={() => setActiveTab('dashboard')}>חזרה למשימות</button><h1>{activeTab === 'communications' ? 'מיילים ומעקבים' : 'הזמנות ושיתופים'}</h1></div>{activeTab === 'communications' && canCreateCommunication && <button type="button" className="btn task-create-primary" onClick={() => openCommunicationContext({ type: 'general', id: 'task_panel', label: 'פאנל המשימות' })}><Plus size={15} /> מייל ומעקב חדש</button>}</section>}

        {showForm && !initiativeDetailOpen && (
          <div className="card form-card">
            <form onSubmit={handleCreate} className="task-form">
              <header className="task-unified-form-head"><div><span>טיוטה לפני יצירה</span><h2>{form.creationKind === 'initiative' ? 'תכנית ארוכת טווח חדשה' : 'משימה חדשה'}</h2><p>כל סוגי המשימות נוצרים מכאן. בדקו וערכו את הפרטים לפני השמירה.</p></div><button type="button" className="icon-btn" onClick={() => setShowForm(false)} aria-label="סגירת טופס היצירה"><X size={18} /></button></header>
              {assistantMeta && <div className="task-assistant-proposal-note"><Sparkles size={16} /><div>{assistantMeta.reasoningSummary && <p>{assistantMeta.reasoningSummary}</p>}{assistantMeta.holidayName && <p><strong>בדיקת לוח:</strong> המועד חופף ל־{assistantMeta.holidayName}. כדאי לבחור מועד אחר.</p>}{assistantMeta.unresolved.map(item => <p key={item}>{item}. אפשר לבחור ידנית מהרשימה.</p>)}</div><button type="button" className="btn btn-link" onClick={() => { setShowForm(false); document.getElementById('task-assistant-request')?.focus(); }}>חזרה לסוכן</button></div>}
              {renderFormFields(form, setForm)}
              <div className="form-actions"><button className="btn btn-primary" type="submit" disabled={saving}>{saving ? 'יוצר…' : form.creationKind === 'initiative' ? 'יצירת התכנית' : 'יצירת המשימה'}</button><button className="btn btn-secondary" type="button" onClick={() => setShowForm(false)}>ביטול</button></div>
            </form>
          </div>
        )}

        {assistantFeedback && <div className="task-assistant-feedback" role="status"><span>האם הצעת הסוכן הייתה מועילה?</span><button type="button" className="btn btn-link" onClick={() => setAssistantFeedback(false)}>כן</button><button type="button" className="btn btn-link" onClick={() => { const note = window.prompt('מה היה צריך להיות שונה?'); if (note?.trim()) window.localStorage.setItem(`zoko-task-agent-feedback:${uid}`, note.trim().slice(0, 500)); setAssistantFeedback(false); }}>לא מדויקת</button></div>}

        {activeTab === 'dashboard' && workView === 'plans' && <InitiativePanel
          schoolId={schoolId}
          actor={{ uid, fullName: userData?.fullName || '', role: userData?.role || '' }}
          initiatives={initiatives}
          staff={staff}
          teams={teams}
          classes={classes}
          files={allFiles}
          holidays={holidays}
          academicYears={academicYears}
          tasks={[...personalTasks, ...organizationTasks]}
          permissions={initiativePermissions}
          initialInitiativeId={searchParams.get('initiative') || ''}
          attentionOnly={initiativeAttentionOnly}
          onClearAttention={() => setInitiativeAttentionOnly(false)}
          onDetailChange={setInitiativeDetailOpen}
          onMessage={showMessage}
          onError={setError}
          onCreateCommunication={canCreateCommunication ? openCommunicationContext : undefined}
          onRequestCreate={() => openTaskForm(TASK_SCOPES.PERSONAL, { creationKind: 'initiative' })}
        />}

        {activeTab === 'communications' ? <CommunicationDashboard
          tasks={[...personalTasks, ...organizationTasks, ...communicationDrafts]}
          staff={staff}
          onOpen={setCommunicationTask}
          onCreate={() => openCommunicationContext({ type: 'general', id: 'task_panel', label: 'פאנל המשימות' })}
        /> : activeTab === 'invitations' ? (
          <div className="task-invitations-list">
            {[...taskInvitations].sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt)).map(invitation => (
              <article className="card task-invitation-card" key={invitation.id}>
                <div><h3>{invitation.title}</h3><p>{invitation.description || 'ללא תיאור'}</p><div className="task-meta"><span>מזמין: {invitation.inviterName || 'איש צוות'}</span>{invitation.dueDate && <span>יעד: {new Date(`${invitation.dueDate}T00:00:00`).toLocaleDateString('he-IL')}</span>}<span>סטטוס: {invitation.status === 'pending' ? 'ממתינה' : invitation.status === 'accepted' ? 'התקבלה' : invitation.status === 'declined' ? 'נדחתה' : 'בוטלה'}</span></div>{invitation.message && <blockquote>{invitation.message}</blockquote>}</div>
                {invitation.status === 'pending' && invitation.recipientId === uid && <div className="task-invitation-response"><textarea value={invitationResponse} onChange={event => setInvitationResponse(event.target.value)} placeholder="תגובה או בקשת הבהרה (אופציונלי)" maxLength={1000} /><div><button className="btn btn-primary btn-sm" disabled={saving} onClick={() => handleTaskInvitation(invitation, 'accept')}>קבלה</button><button className="btn btn-secondary btn-sm" disabled={saving} onClick={() => handleTaskInvitation(invitation, 'decline')}>סירוב</button></div></div>}
                {invitation.status === 'pending' && invitation.inviterId === uid && <button className="btn btn-secondary btn-sm" disabled={saving} onClick={() => handleTaskInvitation(invitation, 'cancel')}>ביטול הזמנה</button>}
              </article>
            ))}
            {taskInvitations.length === 0 && <div className="empty-state"><p>אין הצעות או הזמנות להצגה.</p></div>}
          </div>
        ) : initiativeDetailOpen ? null : loading ? <div className="empty-state"><p>טוען משימות...</p></div> : activeTab === 'dashboard' ? (
          workView === 'plans' ? null : <div className="personal-task-groups">
            {TASK_GROUP_ORDER.map(group => groupedMineTasks[group].length > 0 && (
              <section key={group} className="task-group">
                <h3>{GROUP_LABELS[group]} <span>{groupedMineTasks[group].length}</span></h3>
                <div className="task-list">{groupedMineTasks[group].map(renderTask)}</div>
              </section>
            ))}
            {filteredTasks.length === 0 && <div className="empty-state"><Filter size={30} /><p>אין משימות שמתאימות לסינון הנוכחי.</p></div>}
          </div>
        ) : (
          <div className="task-list">
            {filteredTasks.map(renderTask)}
            {filteredTasks.length === 0 && <div className="empty-state"><p>אין משימות להצגה.</p></div>}
          </div>
        )}
      </div>

      {showFilters && <div className="task-filter-overlay" onClick={() => setShowFilters(false)}>
        <section className="task-filter-drawer" role="dialog" aria-modal="true" aria-labelledby="task-filter-title" onClick={event => event.stopPropagation()}>
          <header><div><h2 id="task-filter-title">סינון משימות</h2><p>רק המסננים שנבחרו ישפיעו על הרשימה.</p></div><button type="button" className="icon-btn" onClick={() => setShowFilters(false)} aria-label="סגירת המסננים"><X size={18} /></button></header>
          <div className="task-filter-fields">
            <label>אחראי<select value={filterOwner} onChange={event => setFilterOwner(event.target.value)}><option value="all">כל האחראים</option>{staff.map(item => <option key={item.uid || item.id} value={item.uid || item.id}>{item.fullName}</option>)}</select></label>
            <label>צוות<select value={filterTeam} onChange={event => setFilterTeam(event.target.value)}><option value="all">כל הצוותים</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
            <label>סטטוס<select value={filterStatus} onChange={event => setFilterStatus(event.target.value)}><option value="all">כל הסטטוסים</option>{Object.entries(STATUS_CONFIG).map(([key, config]) => <option key={key} value={key}>{config.label}</option>)}</select></label>
            <label>עדיפות<select value={filterPriority} onChange={event => setFilterPriority(event.target.value)}><option value="all">כל העדיפויות</option>{Object.entries(PRIORITY_CONFIG).map(([key, config]) => <option key={key} value={key}>{config.label}</option>)}</select></label>
            <label>שנת לימודים<select value={filterAcademicYear} onChange={event => setFilterAcademicYear(event.target.value)}><option value="all">כל שנות הלימודים</option>{academicYears.map(item => <option key={item.id} value={item.id}>{item.hebrewLabel || item.label}</option>)}</select></label>
            <label>תכנית<select value={filterInitiative} onChange={event => setFilterInitiative(event.target.value)}><option value="all">כל התכניות</option>{initiatives.filter(item => item.status !== 'archived').map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
            <label>מועד<select value={filterDate} onChange={event => setFilterDate(event.target.value)}><option value="all">כל המועדים</option><option value="overdue">באיחור</option><option value="today">להיום</option><option value="upcoming">קרובות</option><option value="no_date">ללא תאריך</option><option value="completed">הושלמו</option></select></label>
            <label>סוג משימה<select value={scopeFilter} onChange={event => setScopeFilter(event.target.value)}><option value="all">כל הסוגים</option>{Object.entries(SCOPE_FILTER_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <fieldset className="task-date-range"><legend>טווח תאריכים</legend><label>מתאריך<input type="date" value={filterDateFrom} onChange={event => setFilterDateFrom(event.target.value)} /></label><label>עד תאריך<input type="date" value={filterDateTo} min={filterDateFrom || undefined} onChange={event => setFilterDateTo(event.target.value)} /></label></fieldset>
            <label className="task-completed-toggle"><input type="checkbox" checked={showCompleted} onChange={event => setShowCompleted(event.target.checked)} /> הצגת משימות שהושלמו</label>
          </div>
          <footer><button type="button" className="btn btn-secondary" onClick={clearAllFilters}>נקה הכול</button><button type="button" className="btn btn-primary" onClick={() => setShowFilters(false)}>הצגת התוצאות</button></footer>
        </section>
      </div>}

      {editingTask && editForm && (
        <div className="task-edit-overlay" onClick={() => setEditingTask(null)}>
          <div className="task-edit-modal" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="עריכת משימה">
            <div className="task-edit-header"><h3>עריכת משימה</h3><button className="icon-btn" onClick={() => setEditingTask(null)} aria-label="סגירת חלון עריכה"><X size={18} /></button></div>
            <div className="task-form">{renderFormFields(editForm, setEditForm, true)}<div className="form-actions"><button className="btn btn-primary" onClick={saveEdit} disabled={saving}>שמירה</button><button className="btn btn-secondary" onClick={() => setEditingTask(null)}>ביטול</button></div></div>
          </div>
        </div>
      )}

      {collaborationTask && (
        <div className="task-edit-overlay" onClick={() => setCollaborationTask(null)}>
          <div className="task-edit-modal" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="הזמנת שותפים למשימה">
            <div className="task-edit-header"><h3>הזמנת שותפים</h3><button className="icon-btn" onClick={() => setCollaborationTask(null)} aria-label="סגירה"><X size={18} /></button></div>
            <div className="task-warning"><AlertTriangle size={18} /> המשימה לא תהיה עוד פרטית לחלוטין. משתמשים שיאשרו יוכלו לראות את תוכנה.</div>
            <div className="form-group"><label>אנשי צוות</label><div className="task-recipient-list">{staff.filter(user => (user.uid || user.id) !== uid).map(user => { const userId = user.uid || user.id; return <label key={userId}><input type="checkbox" checked={collaborationRecipients.includes(userId)} onChange={event => setCollaborationRecipients(previous => event.target.checked ? [...previous, userId] : previous.filter(id => id !== userId))} /> {user.fullName || user.email}</label>; })}</div></div>
            <div className="form-group"><label>הודעה (אופציונלי)</label><textarea value={collaborationMessage} onChange={event => setCollaborationMessage(event.target.value)} maxLength={1000} /></div>
            <div className="form-actions"><button className="btn btn-primary" onClick={sendCollaborationInvitations} disabled={saving || collaborationRecipients.length === 0}>שליחת הזמנה</button><button className="btn btn-secondary" onClick={() => setCollaborationTask(null)}>ביטול</button></div>
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

      {communicationTask && <CommunicationComposer
        schoolId={schoolId}
        user={{ uid, fullName: userData?.fullName || '' }}
        staff={staff}
        files={allFiles}
        contactPermissions={contactPermissions}
        communicationPermissions={communicationPermissions}
        task={communicationTask}
        onClose={closeCommunication}
        onSuccess={showMessage}
        onError={setError}
      />}

      {permissionTask && <PermissionsMenu
        resourceType="task"
        resourceId={permissionTask.task.id}
        resourceName={permissionTask.task.title}
        schoolId={schoolId}
        position={permissionTask.position}
        onClose={() => setPermissionTask(null)}
      />}

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
