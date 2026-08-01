import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { collection, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Clock,
  CopyPlus,
  ChevronDown,
  Edit3,
  FileEdit,
  FileText,
  Filter,
  Flag,
  Link2,
  Lock,
  MailPlus,
  MessageSquare,
  Paperclip,
  Pin,
  Plus,
  RotateCcw,
  Search,
  Shield,
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
import { subscribeInitiatives } from '../../services/firestore/initiativeRepository';
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
import {
  markCommunicationReminderNotified,
  subscribeCommunicationDrafts,
} from '../../services/firestore/communicationRepository';
import { communicationSourceFromContext, normalizeCommunicationContext } from '../../utils/communicationContext';
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

const TAB_LABELS = {
  dashboard: 'כל המשימות',
  communications: 'מיילים ומעקבים',
  invitations: 'הזמנות ושיתופים',
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
    initiativeId: '',
    milestoneId: '',
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
  const communicationPermissions = {
    reassign: permissions['communications.reassign'] === true,
    close: permissions['communications.close'] === true,
    viewAll: permissions['communications.viewAll'] === true,
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
  const communicationReminderInFlight = useRef(new Set());
  const [scopeFilter, setScopeFilter] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterTeam, setFilterTeam] = useState('all');
  const [filterDate, setFilterDate] = useState('all');
  const [filterAcademicYear, setFilterAcademicYear] = useState('all');
  const [filterOwner, setFilterOwner] = useState('all');
  const [filterInitiative, setFilterInitiative] = useState('all');
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
  const [permissionTask, setPermissionTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [collaborationTask, setCollaborationTask] = useState(null);
  const [collaborationRecipients, setCollaborationRecipients] = useState([]);
  const [collaborationMessage, setCollaborationMessage] = useState('');
  const [invitationResponse, setInvitationResponse] = useState('');
  const [showMandatoryForm, setShowMandatoryForm] = useState(false);
  const [mandatoryForm, setMandatoryForm] = useState({ ...emptyForm(TASK_SCOPES.ASSIGNED), recipientIds: [] });
  const [chatReceipts, setChatReceipts] = useState({});
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [initiativeCreateRequest, setInitiativeCreateRequest] = useState(0);
  const [initiativeAttentionOnly, setInitiativeAttentionOnly] = useState(false);
  const [initiativeDetailOpen, setInitiativeDetailOpen] = useState(false);
  const [communicationTask, setCommunicationTask] = useState(null);
  const [communicationReturnTo, setCommunicationReturnTo] = useState('');

  function openCommunicationContext(context, returnTo = '') {
    setCommunicationTask(communicationSourceFromContext(normalizeCommunicationContext(context)));
    setCommunicationReturnTo(returnTo);
    setActiveTab('communications');
    setCreateMenuOpen(false);
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

  const filteredTasks = useMemo(() => tabTasks.filter(task => {
    if (scopeFilter === 'mine' && task._source === 'organization'
      && !task.assigneeIds?.includes(uid) && !task.participantIds?.includes(uid)) return false;
    if (scopeFilter === 'personal' && task.scope !== TASK_SCOPES.PERSONAL) return false;
    if (scopeFilter === 'shared' && task.scope !== 'shared') return false;
    if (scopeFilter === 'assigned' && !task.assigneeIds?.includes(uid)) return false;
    if (scopeFilter === 'team' && task.scope !== TASK_SCOPES.TEAM && task.assigneeType !== 'all_school') return false;
    if (scopeFilter === 'created' && task.createdBy !== uid) return false;
    if (filterStatus !== 'all') {
      const status = isTaskComplete(task) ? 'done' : task.status || 'todo';
      if (status !== filterStatus) return false;
    }
    if (filterTeam !== 'all' && (task.teamId || task.assigneeTeamId) !== filterTeam) return false;
    if (filterDate !== 'all' && taskDateGroup(task) !== filterDate) return false;
    if (filterInitiative !== 'all' && task.initiativeId !== filterInitiative) return false;
    if (filterOwner !== 'all' && task.createdBy !== filterOwner && !task.assigneeIds?.includes(filterOwner)) return false;
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
  }), [chatReceipts, filterAcademicYear, filterDate, filterInitiative, filterOwner, filterStatus, filterTeam, initiatives, schoolId, scopeFilter, searchText, tabTasks, uid]);

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
    const allTasks = [...personalTasks, ...organizationTasks];
    return {
      today: allTasks.filter(task => taskDateGroup(task) === 'today').length,
      overdue: allTasks.filter(task => taskDateGroup(task) === 'overdue').length,
      waiting: taskInvitations.filter(item => item.recipientId === uid && item.status === 'pending').length,
      initiatives: initiatives.filter(item => ['attention', 'at_risk'].includes(item.health)).length,
    };
  // Chat receipts intentionally refresh the unread summary without rebuilding task subscriptions.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatReceipts, initiatives, organizationTasks, personalTasks, schoolId, taskInvitations, uid]);

  const actionItems = useMemo(() => {
    const urgentTasks = [...personalTasks, ...organizationTasks]
      .filter(task => ['today', 'overdue'].includes(taskDateGroup(task)))
      .map(task => ({ id: task._key, type: 'task', title: task.title, detail: taskDateGroup(task) === 'overdue' ? 'עבר מועד הביצוע' : 'מועד הביצוע היום' }));
    const invitations = taskInvitations
      .filter(item => item.recipientId === uid && item.status === 'pending')
      .map(item => ({ id: item.id, type: 'invitation', title: item.title, detail: 'הזמנה שממתינה לתגובה שלך' }));
    return [...urgentTasks, ...invitations].slice(0, 8);
  }, [organizationTasks, personalTasks, taskInvitations, uid]);

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
    });
    setCreateMenuOpen(false);
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
      setActiveTab('dashboard');
      setScopeFilter(input.scope === TASK_SCOPES.PERSONAL ? 'mine' : 'created');
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

  async function submitMandatoryTask(event) {
    event.preventDefault();
    if (!mandatoryForm.title.trim() || mandatoryForm.recipientIds.length === 0) return;
    setSaving(true);
    setError('');
    try {
      await createMandatoryTask({
        schoolId,
        title: mandatoryForm.title,
        description: mandatoryForm.description,
        dueDate: mandatoryForm.dueDate,
        priority: mandatoryForm.priority,
        recipientIds: mandatoryForm.recipientIds,
      });
      setMandatoryForm({ ...emptyForm(TASK_SCOPES.ASSIGNED), recipientIds: [] });
      setShowMandatoryForm(false);
      setActiveTab('dashboard');
      setScopeFilter('created');
      showMessage('המשימה המחייבת הוקצתה ונשלחה התראה.');
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
        {initiatives.length > 0 && <div className="form-row task-initiative-link-fields">
          <div className="form-group"><label>תכנית ארוכת טווח (אופציונלי)</label><select value={value.initiativeId || ''} onChange={event => setter(previous => ({ ...previous, initiativeId: event.target.value, milestoneId: '' }))}><option value="">ללא תכנית</option>{initiatives.filter(item => item.status !== 'archived').map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></div>
          {value.milestoneId && <div className="form-group"><label>אבן דרך</label><div className="task-context-value"><Flag size={14} /> משימה שנוצרה מתוך אבן דרך</div></div>}
        </div>}
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
    const unreadChat = isTaskChatUnread(task);
    return (
      <article key={task._key} className={`task-row ${overdue ? 'task-row--overdue' : ''} ${task.scope === TASK_SCOPES.PERSONAL ? 'task-row--personal' : ''}`}>
        <div className="task-priority" style={{ background: priority.bg }}><PriorityIcon size={16} color={priority.color} /></div>
        <div className="task-main">
          <div className="task-title-line">
            <span className="task-title">{task.title}</span>
            {task.scope === TASK_SCOPES.PERSONAL && <span className="personal-task-badge"><Lock size={11} /> אישית</span>}
            {task.scope === 'shared' && <span className="shared-task-badge"><Users size={11} /> משותפת</span>}
            {task.mandatory && <span className="mandatory-task-badge"><AlertCircle size={11} /> משימה מחייבת</span>}
          </div>
          {task.description && <div className="task-desc">{task.description}</div>}
          <div className="task-meta">
            <span className="task-priority-badge" style={{ background: priority.bg, color: priority.color }}>{priority.label}</span>
            <span className="task-assignee">{task.scope === TASK_SCOPES.PERSONAL ? <Lock size={11} /> : <Users size={11} />}{getAssigneeDisplay(task)}</span>
            {taskDueDate(task) && <span className={`task-due ${overdue ? 'task-due--late' : ''}`}>{new Date(`${String(taskDueDate(task)).slice(0, 10)}T00:00:00`).toLocaleDateString('he-IL')}</span>}
            {task.sourceTaskId && <span className="task-source"><Link2 size={11} /> משימת המשך</span>}
            {task.workflowType === 'external_email_followup' && <span className="task-source"><MailPlus size={11} /> {task.communicationStatus === 'awaiting_reply' ? 'ממתין לתשובה' : task.communicationStatus === 'cancelled' ? 'מעקב בוטל' : 'ממתין לשליחה'}</span>}
            {task.initiativeId && <span className="task-source"><Flag size={11} /> {initiatives.find(item => item.id === task.initiativeId)?.title || 'תכנית ארוכת טווח'}</span>}
            {task.mandatory && <span className="task-source">הוקצתה על ידי: {task.assignedByName || 'בעל הרשאה'}</span>}
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
          {canEditDetails(task) && <button className="icon-btn" onClick={() => pinTask(task)} aria-label={`${pinned ? 'ביטול הצמדת' : 'הצמדת'} ${task.title}`} title={pinned ? 'ביטול הצמדה' : 'הצמדה'}><Pin size={15} color={pinned ? '#870335' : undefined} /></button>}
          {canEditDetails(task) && <button className="icon-btn" onClick={() => startEdit(task)} aria-label={`עריכת ${task.title}`} title="עריכה"><Edit3 size={15} /></button>}
          {task._source === 'organization' && <button className={`icon-btn task-chat-button ${unreadChat ? 'task-chat-button--unread' : ''}`} onClick={() => setChatTask(task)} aria-label={`פתיחת צ׳אט עבור ${task.title}${unreadChat ? ' — יש הודעות חדשות' : ''}`} title={unreadChat ? 'הודעות חדשות בצ׳אט' : 'צ׳אט משימה'}><MessageSquare size={16} />{unreadChat && <span className="task-chat-alert" aria-hidden="true">!</span>}</button>}
          {task._source === 'organization' && <button className="icon-btn" onClick={() => createFollowUp(task)} aria-label={`יצירת משימת המשך אישית עבור ${task.title}`} title="צור לי משימת המשך אישית"><CopyPlus size={15} /></button>}
          {canCreateCommunication && task.workflowType !== 'external_email_followup' && <button className="icon-btn task-email-button" onClick={() => setCommunicationTask(task)} aria-label={`יצירת טיוטת מייל ומעקב מתוך ${task.title}`} title="יצירת מייל ומעקב"><MailPlus size={16} /></button>}
          {task.workflowType === 'external_email_followup' && task.communicationStatus === 'awaiting_send' && <button className="icon-btn task-email-button" onClick={() => setCommunicationTask(task)} aria-label={`פתיחת טיוטת המייל של ${task.title}`} title="פתיחת טיוטת המייל מחדש"><MailPlus size={16} /></button>}
          {task._source === 'personal' && <button className="icon-btn" onClick={() => { setCollaborationTask(task); setCollaborationRecipients([]); setCollaborationMessage(''); }} aria-label={`הזמנת שותפים אל ${task.title}`} title="הזמנת שותפים"><User size={15} /></button>}
          {task._source === 'personal' && canAssignTasks && <button className="icon-btn" onClick={() => { setConversionTask(task); setConversion({ scope: TASK_SCOPES.ASSIGNED, assigneeId: '', teamId: '' }); }} aria-label={`הפיכת ${task.title} למשימה ארגונית`} title="הפוך למשימה ארגונית"><Users size={15} /></button>}
          {task.attachedFileId && <button className="icon-btn" onClick={() => setPreviewFile(task)} aria-label={`פתיחת הקובץ של ${task.title}`} title="קובץ מצורף"><Paperclip size={15} /></button>}
          {task._source === 'organization' && canManageTaskPermissions && <button className="icon-btn" onClick={event => setPermissionTask({ task, position: { x: Math.max(16, event.clientX - 360), y: Math.max(16, Math.min(window.innerHeight - 540, event.clientY + 8)) } })} aria-label={`ניהול הרשאות של ${task.title}`} title="הרשאות נקודתיות"><Shield size={15} /></button>}
          {canDeleteTask(task) && <button className="icon-btn icon-btn--danger" onClick={() => removeTask(task)} aria-label={`מחיקת ${task.title}`} title="מחיקה"><Trash2 size={15} /></button>}
        </div>
      </article>
    );
  }

  return (
    <div className="page">
      <Header title="פאנל משימות" onPermissions={() => setShowPermissionsPanel(true)} />
      {showPermissionsPanel && <PagePermissionsPanel feature="tasks" onClose={() => setShowPermissionsPanel(false)} />}
      <div className="page-content">
        <div className="task-tabs">
          <SegmentedControl
            value={activeTab}
            onChange={setActiveTab}
            label="תצוגת משימות"
            options={Object.entries(TAB_LABELS).map(([value, label]) => ({
              value,
              label,
              ...(value === 'invitations' ? { count: taskInvitations.filter(item => item.recipientId === uid && item.status === 'pending').length } : {}),
            }))}
          />
        </div>

        {message && <div className="task-feedback task-feedback--success" role="status">{message}</div>}
        {error && <div className="task-feedback task-feedback--error" role="alert">{error}<button onClick={() => setError('')} aria-label="סגירת הודעת שגיאה"><X size={14} /></button></div>}

        {activeTab === 'dashboard' && <section className="task-dashboard-summary" aria-label="סיכום משימות">
          <button type="button" onClick={() => { setFilterStatus('all'); setFilterDate('today'); }}><strong>{dashboardStats.today}</strong><span>להיום</span></button>
          <button type="button" className={dashboardStats.overdue ? 'is-urgent' : ''} onClick={() => { setFilterStatus('all'); setFilterDate('overdue'); }}><strong>{dashboardStats.overdue}</strong><span>באיחור</span></button>
          <button type="button" className={dashboardStats.waiting ? 'has-unread' : ''} onClick={() => { setActiveTab('invitations'); setFilterDate('all'); }}><strong>{dashboardStats.waiting}</strong><span>ממתין לתגובה שלי</span></button>
          <button type="button" className={dashboardStats.initiatives ? 'is-urgent' : ''} onClick={() => { setInitiativeAttentionOnly(true); setActiveTab('dashboard'); }}><strong>{dashboardStats.initiatives}</strong><span>תכניות הדורשות תשומת לב</span></button>
        </section>}

        {activeTab === 'dashboard' && !initiativeDetailOpen && (
          <form className="quick-task-form" onSubmit={handleQuickAdd}>
            <Lock size={16} />
            <input value={quickTitle} onChange={event => setQuickTitle(event.target.value)} placeholder="הוספת משימה אישית מהירה..." aria-label="כותרת משימה אישית מהירה" />
            <button className="btn btn-primary btn-sm" type="submit" disabled={!quickTitle.trim() || saving}><Plus size={15} /> הוספה</button>
          </form>
        )}

        {activeTab === 'dashboard' && !initiativeDetailOpen && <div className="page-toolbar task-toolbar">
          <div className="task-toolbar-actions">
            <div className="task-create-menu-wrap"><button className="btn btn-primary" onClick={() => setCreateMenuOpen(value => !value)}><Plus size={16} /> יצירה חדשה <ChevronDown size={14} /></button>{createMenuOpen && <div className="task-create-menu"><button onClick={() => openTaskForm(TASK_SCOPES.PERSONAL)}><Lock size={15} /> משימה אישית</button><button onClick={() => openTaskForm(TASK_SCOPES.TEAM)} disabled={!canAssignTasks}><Users size={15} /> משימת צוות</button><button onClick={() => { setInitiativeCreateRequest(value => value + 1); setCreateMenuOpen(false); }} disabled={!canCreateInitiative}><Flag size={15} /> תכנית ארוכת טווח</button>{canCreateCommunication && <button onClick={() => openCommunicationContext({ type: 'general', id: 'task_panel', label: 'פאנל המשימות' })}><MailPlus size={15} /> מייל ומעקב</button>}</div>}</div>
            {canAssignMandatory && <button className="btn btn-secondary" onClick={() => setShowMandatoryForm(true)}><AlertCircle size={15} /> משימה מחייבת</button>}
          </div>
          <div className="task-filters">
            <div className="search-bar"><Search size={14} /><input value={searchText} onChange={event => setSearchText(event.target.value)} placeholder="חיפוש משימות..." aria-label="חיפוש משימות" /></div>
            {academicYears.length > 0 && <select value={filterAcademicYear} onChange={event => setFilterAcademicYear(event.target.value)} aria-label="סינון שנת לימודים"><option value="all">כל שנות הלימודים</option>{academicYears.map(item => <option key={item.id} value={item.id}>{item.hebrewLabel || item.label}</option>)}</select>}
            {staff.length > 0 && <select value={filterOwner} onChange={event => setFilterOwner(event.target.value)} aria-label="סינון אחראי"><option value="all">כל האחראים</option>{staff.map(item => <option key={item.uid || item.id} value={item.uid || item.id}>{item.fullName}</option>)}</select>}
            <select value={filterStatus} onChange={event => setFilterStatus(event.target.value)} aria-label="סינון סטטוס"><option value="all">כל הסטטוסים</option>{Object.entries(STATUS_CONFIG).map(([key, config]) => <option key={key} value={key}>{config.label}</option>)}</select>
            <select value={filterDate} onChange={event => setFilterDate(event.target.value)} aria-label="סינון מועד"><option value="all">כל המועדים</option><option value="overdue">באיחור</option><option value="today">להיום</option><option value="upcoming">קרובות</option><option value="no_date">ללא מועד</option><option value="completed">הושלמו</option></select>
            {teams.length > 0 && <select value={filterTeam} onChange={event => setFilterTeam(event.target.value)} aria-label="סינון צוות"><option value="all">כל הצוותים</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select>}
            {initiatives.length > 0 && <select value={filterInitiative} onChange={event => setFilterInitiative(event.target.value)} aria-label="סינון תכנית"><option value="all">כל התכניות</option>{initiatives.filter(item => item.status !== 'archived').map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select>}
            {activeTab === 'dashboard' && <select value={scopeFilter} onChange={event => setScopeFilter(event.target.value)} aria-label="סינון שיוך משימה"><option value="all">כל המשימות</option><option value="mine">באחריותי</option><option value="personal">אישיות</option><option value="assigned">הוקצו לי</option><option value="shared">משותפות</option><option value="team">צוות ומוסד</option><option value="created">שיצרתי</option></select>}
            <span className="task-stats"><Filter size={13} /> {filteredTasks.length} משימות</span>
          </div>
        </div>}

        {showForm && !initiativeDetailOpen && (
          <div className="card form-card">
            <form onSubmit={handleCreate} className="task-form">
              {renderFormFields(form, setForm)}
              <div className="form-actions"><button className="btn btn-primary" type="submit" disabled={saving}>שמירה</button><button className="btn btn-secondary" type="button" onClick={() => setShowForm(false)}>ביטול</button></div>
            </form>
          </div>
        )}

        {activeTab === 'dashboard' && <InitiativePanel
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
          createRequest={initiativeCreateRequest}
          initialInitiativeId={searchParams.get('initiative') || ''}
          attentionOnly={initiativeAttentionOnly}
          onClearAttention={() => setInitiativeAttentionOnly(false)}
          onDetailChange={setInitiativeDetailOpen}
          onMessage={showMessage}
          onError={setError}
          onCreateCommunication={canCreateCommunication ? openCommunicationContext : undefined}
        />}

        {activeTab === 'dashboard' && !initiativeDetailOpen && actionItems.length > 0 && <section className="task-action-required"><div><h2>דורש ממני פעולה</h2><p>רק פריטים שממתינים לפעולה שלך</p></div><div>{actionItems.map(item => <button key={item.id} onClick={() => item.type === 'invitation' ? setActiveTab('invitations') : setSearchText(item.title)}><span>{item.title}</span><small>{item.detail}</small></button>)}</div></section>}

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
          <div className="personal-task-groups">
            {Object.keys(GROUP_LABELS).map(group => groupedMineTasks[group].length > 0 && (
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

      {showMandatoryForm && (
        <div className="task-edit-overlay" onClick={() => setShowMandatoryForm(false)}>
          <div className="task-edit-modal" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="יצירת משימה מחייבת">
            <div className="task-edit-header"><h3>משימה מחייבת</h3><button className="icon-btn" onClick={() => setShowMandatoryForm(false)} aria-label="סגירה"><X size={18} /></button></div>
            <form className="task-form" onSubmit={submitMandatoryTask}>
              <div className="task-warning"><AlertCircle size={18} /> המשימה תיכנס אוטומטית לרשימת המקבלים והם לא יוכלו למחוק אותה או להסיר את השיוך.</div>
              <div className="form-group"><label>כותרת</label><input value={mandatoryForm.title} onChange={event => setMandatoryForm(previous => ({ ...previous, title: event.target.value }))} required /></div>
              <div className="form-group"><label>תיאור</label><textarea value={mandatoryForm.description} onChange={event => setMandatoryForm(previous => ({ ...previous, description: event.target.value }))} /></div>
              <div className="form-row"><div className="form-group"><label>עדיפות</label><select value={mandatoryForm.priority} onChange={event => setMandatoryForm(previous => ({ ...previous, priority: event.target.value }))}>{Object.entries(PRIORITY_CONFIG).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></div><div className="form-group"><label>תאריך יעד</label><input type="date" value={mandatoryForm.dueDate} onChange={event => setMandatoryForm(previous => ({ ...previous, dueDate: event.target.value }))} /></div></div>
              <div className="form-group"><label>מקבלים</label><div className="task-recipient-list">{staff.filter(user => (user.uid || user.id) !== uid).map(user => { const userId = user.uid || user.id; return <label key={userId}><input type="checkbox" checked={mandatoryForm.recipientIds.includes(userId)} onChange={event => setMandatoryForm(previous => ({ ...previous, recipientIds: event.target.checked ? [...previous.recipientIds, userId] : previous.recipientIds.filter(id => id !== userId) }))} /> {user.fullName || user.email}</label>; })}</div></div>
              <div className="form-actions"><button className="btn btn-primary" disabled={saving || mandatoryForm.recipientIds.length === 0}>הקצאה מחייבת</button><button type="button" className="btn btn-secondary" onClick={() => setShowMandatoryForm(false)}>ביטול</button></div>
            </form>
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
