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
  updateTaskAssignee,
  updateTaskStatus,
} from '../../services/firestore/taskRepository';
import { schoolCollection, schoolDoc } from '../../services/firestore/paths';
import { subscribeAcademicYears } from '../../services/firestore/academicYearRepository';
import { subscribeInitiatives } from '../../services/firestore/initiativeRepository';
import { createNotification, createNotifications } from '../../utils/notifications';
import {
  createMandatoryTask,
  inviteTaskCollaborators,
  respondTaskInvitation,
} from '../../services/adminUserService';
import Header from '../Layout/Header';
import PagePermissionsPanel from '../Shared/PagePermissionsPanel';
import PermissionsMenu from '../Shared/PermissionsMenu';
import DocumentEditor from '../Files/DocumentEditor';
import SpreadsheetEditor from '../Files/SpreadsheetEditor';
import ChatPanel from './ChatPanel';
import InitiativePanel from './InitiativePanel';
import CommunicationComposer from './CommunicationComposer';
import CommunicationDashboard from './CommunicationDashboard';
import TaskAssistantEntry from './TaskAssistantEntry';
import TaskPatternReviewPanel from './TaskPatternReviewPanel';
import TaskAssignmentBoard from './TaskAssignmentBoard';
import {
  markCommunicationReminderNotified,
  subscribeCommunicationDrafts,
} from '../../services/firestore/communicationRepository';
import { communicationSourceFromContext, normalizeCommunicationContext } from '../../utils/communicationContext';
import { assignmentMutationForTask } from '../../utils/taskAssignmentBoard';
import {
  overdueDayCount,
  taskDateBucket,
  TASK_GROUP_ORDER,
} from '../../utils/taskDashboardView';
import {
  findHolidayConflict,
  proposalToTaskForm,
  resolveTaskAssistantProposal,
} from '../../utils/taskAssistant';
import { startTaskAssistantStage } from '../../services/taskAssistantPerformance';
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

function emptyForm(scope = TASK_SCOPES.PERSONAL) {
  return {
    currentUserId: '',
    mandatory: false,
    title: '',
    description: '',
    priority: 'medium',
    status: 'todo',
    dueDate: '',
    reminderAt: '',
    legacyTags: [],
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
    responsibleIds: [],
    partnerIds: [],
    informedIds: [],
    classIds: [],
    subtasks: [],
    workPlanSteps: [],
    completionCriteria: '',
    nextAction: '',
    creationSource: 'manual',
    agentSessionId: '',
    suggestedInviteIds: [],
  };
}

function formFromTask(task, currentUserId = '') {
  const legacySteps = Array.isArray(task.subtasks) && !task.workPlanSteps?.length
    ? task.subtasks.map((title, index) => ({ id: `legacy_subtask_${index + 1}`, title, dueDate: '', status: 'todo', responsibleIds: [], teamId: '', dependencyStepId: '', order: index }))
    : [];
  return {
    ...emptyForm(task.scope),
    currentUserId,
    title: task.title || '',
    description: task.description || '',
    priority: task.priority || 'medium',
    status: isTaskComplete(task) ? 'done' : task.status || 'todo',
    dueDate: taskDueDate(task),
    startDate: task.startDate || '',
    endDate: task.endDate || '',
    completionCriteria: task.completionCriteria || '',
    reminderAt: task.reminderAt || '',
    legacyTags: Array.isArray(task.tags) ? task.tags : [],
    scope: task.scope,
    assigneeIds: task.assigneeIds || [],
    memberIds: task.participantIds || [],
    responsibleIds: task.responsibleIds || [],
    partnerIds: task.partnerIds || [],
    informedIds: task.informedIds || [],
    teamId: task.teamId || task.assigneeTeamId || '',
    attachedFileId: task.attachedFileId || '',
    attachedFileName: task.attachedFileName || '',
    initiativeId: task.initiativeId || '',
    milestoneId: task.milestoneId || '',
    workPlanSteps: task.workPlanSteps?.length ? task.workPlanSteps : legacySteps,
    creationSource: task.creationSource === 'agent' ? 'agent' : 'manual',
    agentSessionId: task.agentSessionId || '',
  };
}

function taskInput(form) {
  const workPlanSteps = Array.isArray(form.workPlanSteps) ? form.workPlanSteps
    .map((step, index) => ({
      id: displayText(step?.id, `step_${index + 1}`).slice(0, 60),
      phase: displayText(step?.phase, 'ביצוע').slice(0, 80),
      title: displayText(step?.title).trim().slice(0, 180),
      party: displayText(step?.party).slice(0, 80),
      dueDate: displayText(step?.dueDate).slice(0, 10),
      status: ['todo', 'in_progress', 'done'].includes(step?.status) ? step.status : 'todo',
      responsibleIds: idList(step?.responsibleIds).slice(0, 10),
      teamId: displayText(step?.teamId).slice(0, 128),
      dependencyStepId: displayText(step?.dependencyStepId).slice(0, 60),
      order: index,
      relativeDays: Number.isFinite(Number(step?.relativeDays)) ? Math.max(-365, Math.min(365, Math.round(Number(step.relativeDays)))) : 0,
      suggestedParties: Array.isArray(step?.suggestedParties) ? step.suggestedParties.slice(0, 10).map(party => ({
        id: displayText(party?.id).slice(0, 128),
        name: displayText(party?.name).slice(0, 120),
        jobTitle: displayText(party?.jobTitle).slice(0, 120),
        source: party?.source === 'team' ? 'team' : 'staff',
      })).filter(party => party.id && party.name) : [],
    })).filter(step => step.title).slice(0, 30) : [];
  const leadIds = idList(form.responsibleIds);
  const sharedPeople = [...new Set([
    ...leadIds,
    ...idList(form.partnerIds),
    ...idList(form.informedIds),
    ...idList(form.memberIds),
  ])];
  const scope = form.scope === TASK_SCOPES.INSTITUTION ? TASK_SCOPES.INSTITUTION
    : form.teamId ? TASK_SCOPES.TEAM
    : (form.scope === TASK_SCOPES.ASSIGNED || sharedPeople.some(id => id !== form.currentUserId)) ? TASK_SCOPES.ASSIGNED
      : TASK_SCOPES.PERSONAL;
  const effectiveLeadIds = leadIds.length ? leadIds : (scope === TASK_SCOPES.ASSIGNED && form.currentUserId ? [form.currentUserId] : []);
  const existingAssigneeIds = idList(form.assigneeIds);
  return {
    ...form,
    scope,
    responsibleIds: effectiveLeadIds,
    assigneeIds: scope === TASK_SCOPES.ASSIGNED
      ? (existingAssigneeIds.length > 1 ? existingAssigneeIds.slice(0, 50) : effectiveLeadIds.length ? effectiveLeadIds.slice(0, 1) : existingAssigneeIds.slice(0, 1))
      : [],
    tags: Array.isArray(form.legacyTags) ? form.legacyTags : [],
    subtasks: [],
    workPlanSteps,
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
  const canManageAssignmentBoard = userData?.role !== 'platform_admin'
    && (isInitiativeManager || (canEditOrganizationTasks && canAssignTasks));
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
  const [roles, setRoles] = useState([]);
  const [taskAgentSettings, setTaskAgentSettings] = useState({ approvedRules: [], taskPlaybooks: [] });
  const [allFiles, setAllFiles] = useState([]);
  const [allFolders, setAllFolders] = useState([]);
  const [classes, setClasses] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [academicYears, setAcademicYears] = useState([]);
  const [initiatives, setInitiatives] = useState([]);
  const [activeTab, setActiveTab] = useState(() => searchParams.get('view') === 'communications' ? 'communications' : 'dashboard');
  const [workView, setWorkView] = useState(() => searchParams.get('initiative') ? 'plans' : 'mine');
  const communicationReminderInFlight = useRef(new Set());
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
  const [peopleSearch, setPeopleSearch] = useState('');
  const [collaborationTask, setCollaborationTask] = useState(null);
  const [collaborationRecipients, setCollaborationRecipients] = useState([]);
  const [collaborationMessage, setCollaborationMessage] = useState('');
  const [invitationResponse, setInvitationResponse] = useState('');
  const [chatReceipts, setChatReceipts] = useState({});
  const [initiativeAttentionOnly, setInitiativeAttentionOnly] = useState(false);
  const [initiativeDetailOpen, setInitiativeDetailOpen] = useState(false);
  const [communicationTask, setCommunicationTask] = useState(null);
  const [communicationReturnTo, setCommunicationReturnTo] = useState('');
  const [showPatternReview, setShowPatternReview] = useState(false);
  const [contextTaskMenu, setContextTaskMenu] = useState(null);
  const [showAssignmentBoard, setShowAssignmentBoard] = useState(false);
  const [assignmentSavingKey, setAssignmentSavingKey] = useState('');

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
    if (!showFilters && !showForm && !showPatternReview && !contextTaskMenu && !showAssignmentBoard) return undefined;
    const closeTransientPanels = event => {
      if (event.key !== 'Escape') return;
      setShowFilters(false);
      setShowForm(false);
      setShowPatternReview(false);
      setContextTaskMenu(null);
      setShowAssignmentBoard(false);
    };
    window.addEventListener('keydown', closeTransientPanels);
    return () => window.removeEventListener('keydown', closeTransientPanels);
  }, [showFilters, showForm, showPatternReview, contextTaskMenu, showAssignmentBoard]);

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
      canViewAll: canEditOrganizationTasks || canManageAssignmentBoard,
      onData: items => { setOrganizationTasks(items); markReady('organization'); },
      onError: onSubscriptionError,
    });
    return () => {
      unsubscribePersonal();
      unsubscribeOrganization();
    };
  }, [canEditOrganizationTasks, canManageAssignmentBoard, schoolId, teamIds, uid]);

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
      const finishStaffLoad = startTaskAssistantStage('staffLoad');
      const users = new Map();
      try {
        const [bySchools, byLegacySchool] = await Promise.all([
          getDocs(query(collection(db, 'users'), where('schoolIds', 'array-contains', schoolId))),
          getDocs(query(collection(db, 'users'), where('schoolId', '==', schoolId))),
        ]);
        bySchools.docs.forEach(item => {
          const data = item.data();
          users.set(item.id, { ...data, id: item.id, fullName: displayText(data.fullName), email: displayText(data.email) });
        });
        byLegacySchool.docs.forEach(item => {
          const data = item.data();
          users.set(item.id, { ...data, id: item.id, fullName: displayText(data.fullName), email: displayText(data.email) });
        });
      } catch {
        setError('לא ניתן לטעון את רשימת העובדים.');
      } finally {
        finishStaffLoad();
      }
      setStaff([...users.values()].filter(user => user.accountStatus !== 'pending'));
    }
    loadStaff();
    const finishTeamsLoad = startTaskAssistantStage('teamsLoad');
    const finishClassesLoad = startTaskAssistantStage('classesLoad');
    let teamsReady = false;
    let classesReady = false;
    const unsubscribeTeams = onSnapshot(
      schoolCollection(db, schoolId, 'teams'),
      snapshot => {
        setTeams(snapshot.docs.map(item => {
          const data = item.data();
          return { ...data, id: item.id, name: displayText(data.name, 'צוות'), memberIds: idList(data.memberIds) };
        }));
        if (!teamsReady) { teamsReady = true; finishTeamsLoad(); }
      },
      () => { setTeams([]); if (!teamsReady) { teamsReady = true; finishTeamsLoad(); } },
    );
    const unsubscribeRoles = onSnapshot(
      schoolCollection(db, schoolId, 'roles'),
      snapshot => setRoles(snapshot.docs.map(item => ({ id: item.id, ...item.data() })).filter(item => item.status !== 'archived')),
      () => setRoles([]),
    );
    const unsubscribeTaskAgentSettings = onSnapshot(
      schoolDoc(db, schoolId, 'settings', 'task_agent'),
      snapshot => {
        const data = snapshot.data() || {};
        setTaskAgentSettings({
          approvedRules: Array.isArray(data.approvedRules) ? data.approvedRules : [],
          taskPlaybooks: Array.isArray(data.taskPlaybooks) ? data.taskPlaybooks : [],
        });
      },
      () => setTaskAgentSettings({ approvedRules: [], taskPlaybooks: [] }),
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
      snapshot => {
        setClasses(snapshot.docs.map(item => ({ id: item.id, ...item.data() })).filter(item => item.status !== 'archived'));
        if (!classesReady) { classesReady = true; finishClassesLoad(); }
      },
      () => { setClasses([]); if (!classesReady) { classesReady = true; finishClassesLoad(); } },
    );
    const unsubscribeHolidays = onSnapshot(
      schoolCollection(db, schoolId, 'holidays'),
      snapshot => setHolidays(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))),
      () => setHolidays([]),
    );
    return () => {
      unsubscribeTeams();
      unsubscribeRoles();
      unsubscribeTaskAgentSettings();
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

  const initiativeItems = useMemo(() => initiatives.map(item => ({
    ...item,
    _kind: 'initiative',
    _key: `initiative:${item.id}`,
    title: item.title || 'תכנית ללא שם',
    description: item.description || item.summary || '',
    dueDate: item.endDate || '',
    status: item.status === 'completed' ? 'done' : 'todo',
    priority: item.health === 'at_risk' ? 'high' : 'medium',
    createdBy: item.ownerId || item.createdBy || '',
    assigneeIds: item.ownerId ? [item.ownerId] : [],
    teamId: item.teamIds?.[0] || '',
  })), [initiatives]);

  const viewTasks = useMemo(() => activeTab === 'dashboard' && workView !== 'plans'
    ? [...tabTasks, ...initiativeItems]
    : tabTasks, [activeTab, initiativeItems, tabTasks, workView]);

  const taskAssistantSchoolContext = useMemo(() => ({
    capabilities: { canAssign: canAssignTasks },
    // These flags only limit the already-authorized data loaded by Firestore.
    // They do not grant read or write access and cannot bypass security rules.
    permissions: {
      'tasks.useAssistant': true,
      tasks_view: true,
      staff_view: true,
      teams_view: true,
      classes_view: true,
      calendar_view: true,
      'initiatives.view': true,
    },
    sources: {
      staff,
      teams,
      roles,
      classes,
      events: [],
      holidays,
      initiatives,
      // Personal preferences are learned from the user's own task history.
      // Other users' unapproved organizational patterns are never sent to Gemini.
      tasks: [
        ...personalTasks,
        ...organizationTasks.filter(task => task.createdBy === uid),
      ],
      approvedRules: taskAgentSettings.approvedRules,
      playbooks: taskAgentSettings.taskPlaybooks,
    },
  }), [
    canAssignTasks,
    classes,
    holidays,
    initiatives,
    organizationTasks,
    personalTasks,
    roles,
    staff,
    taskAgentSettings.approvedRules,
    taskAgentSettings.taskPlaybooks,
    teams,
    uid,
  ]);

  const filteredTasks = useMemo(() => viewTasks.filter(task => {
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
  }), [chatReceipts, filterAcademicYear, filterDate, filterDateFrom, filterDateTo, filterInitiative, filterOwner, filterPriority, filterStatus, filterTeam, initiatives, schoolId, searchText, showCompleted, uid, viewTasks]);

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
      .filter(task => task.workflowType !== 'external_email_followup');
    return {
      today: allTasks.filter(task => taskDateGroup(task) === 'today').length,
      overdue: allTasks.filter(task => taskDateGroup(task) === 'overdue').length,
      waiting: taskInvitations.filter(item => item.recipientId === uid && item.status === 'pending').length,
    };
  // Chat receipts intentionally refresh the unread summary without rebuilding task subscriptions.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatReceipts, organizationTasks, personalTasks, schoolId, taskInvitations, uid]);

  const activeFilterCount = [
    filterStatus !== 'all', filterPriority !== 'all', filterTeam !== 'all',
    filterDate !== 'all', Boolean(filterDateFrom), Boolean(filterDateTo), filterAcademicYear !== 'all',
    filterOwner !== 'all', filterInitiative !== 'all', showCompleted,
  ].filter(Boolean).length;
  const activeFilterChips = [];
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
    const defaultTeam = scope === TASK_SCOPES.TEAM ? teams[0] : null;
    setForm({
      ...emptyForm(scope),
      currentUserId: uid,
      ...(defaultTeam ? { teamId: defaultTeam.id } : {}),
      initiativeId: context.initiativeId || '',
      milestoneId: context.milestoneId || '',
    });
    setAssistantMeta(null);
    setShowForm(true);
  }

  function applyAssistantProposal(proposal, context = {}) {
    const finishMatching = startTaskAssistantStage('nameMatching');
    const resolved = resolveTaskAssistantProposal({
      proposal,
      staff,
      teams,
      classes,
      initiatives,
      request: context.request || '',
      canAssign: canAssignTasks || context.capabilities?.collaborationMode === 'invite',
      canCreateInitiative,
      canAssignMandatory,
      canCreateTeam: false,
    });
    finishMatching();
    const nextForm = proposalToTaskForm(resolved, emptyForm());
    nextForm.currentUserId = uid;
    nextForm.creationSource = context.sessionId ? 'agent' : 'manual';
    nextForm.agentSessionId = context.sessionId || '';
    const inviteOnly = context.capabilities?.collaborationMode === 'invite' || !canAssignTasks;
    if (inviteOnly) {
      nextForm.suggestedInviteIds = [...new Set(Object.values(resolved.assignmentPlan || {}).flatMap(items => items.filter(item => item.source === 'staff').map(item => item.id)))];
      nextForm.scope = TASK_SCOPES.PERSONAL;
      nextForm.assigneeIds = [];
      nextForm.teamId = '';
      nextForm.responsibleIds = [];
      nextForm.partnerIds = [];
      nextForm.informedIds = [];
      nextForm.memberIds = [];
    }
    const holiday = findHolidayConflict(nextForm.dueDate || nextForm.endDate, holidays);
    setForm(nextForm);
    setAssistantMeta({
      reasoningSummary: resolved.reasoningSummary,
      confidence: resolved.confidence,
      domain: resolved.domain,
      assignmentPlan: resolved.assignmentPlan,
      workPlanSteps: resolved.workPlanSteps,
      holidayName: holiday?.name || holiday?.title || '',
      unresolved: [
        ...(resolved.taskType === 'assigned' || resolved.assigneeCandidates.length > 0
          ? resolved.unresolvedAssigneeSuggestions.map(name => `לא נמצאה התאמה חד־משמעית לאיש הצוות „${name}”`)
          : []),
        ...(!resolved.proposedTeam ? resolved.unresolvedTeamSuggestions.map(name => `לא נמצא צוות מתאים להצעה „${name}”`) : []),
      ].filter(Boolean),
      proposedTeam: resolved.proposedTeam,
      membershipProposal: resolved.team && resolved.missingTeamMembers.length > 0
        ? { team: resolved.team, members: resolved.missingTeamMembers }
        : null,
      capabilities: context.capabilities || { canAssign: canAssignTasks, collaborationMode: canAssignTasks ? 'assign' : 'invite' },
      degraded: context.degraded === true,
    });
    const finishProposalDisplay = startTaskAssistantStage('proposalDisplay');
    setShowForm(true);
    window.requestAnimationFrame(() => finishProposalDisplay());
  }

  function validateAssignment(value) {
    if (value.scope === TASK_SCOPES.ASSIGNED && value.assigneeIds.length < 1) return false;
    if (value.scope === TASK_SCOPES.TEAM && !value.teamId) return false;
    if (value.scope === TASK_SCOPES.INSTITUTION && !canManageAssignments) return false;
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
      const recipients = [...new Set([
        ...input.assigneeIds,
        ...(input.partnerIds || []),
        ...(input.informedIds || []),
        ...(input.memberIds || []),
      ])].filter(id => id !== uid);
      if (recipients.length) await createNotifications(recipients, options);
    } else if (input.scope === TASK_SCOPES.TEAM) {
      const team = teams.find(item => item.id === input.teamId);
      const recipients = [...new Set([
        ...(Array.isArray(team?.memberIds) ? team.memberIds : []),
        ...(input.partnerIds || []),
        ...(input.informedIds || []),
      ])].filter(id => id !== uid);
      if (recipients.length) await createNotifications(recipients, options);
    } else if (input.scope === TASK_SCOPES.INSTITUTION) {
      const recipients = staff.map(member => member.uid || member.id).filter(id => id && id !== uid);
      if (recipients.length) await createNotifications(recipients, options);
    }
  }

  async function handleCreate(event) {
    event.preventDefault();
    const input = taskInput(form);
    if (!input.title.trim() || !schoolId || !uid) return;
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
    let invitationWarning = false;
    try {
      if (input.mandatory) {
        await createMandatoryTask({
          schoolId,
          title: input.title,
          description: input.description,
          dueDate: input.dueDate,
          startDate: input.startDate,
          endDate: input.endDate,
          reminderAt: input.reminderAt,
          completionCriteria: input.completionCriteria,
          workPlanSteps: input.workPlanSteps.map((step, order) => ({
            id: step.id,
            title: step.title,
            dueDate: step.dueDate,
            status: step.status,
            responsibleIds: step.responsibleIds,
            teamId: step.teamId,
            dependencyStepId: step.dependencyStepId,
            order,
          })),
          priority: input.priority,
          recipientIds: input.recipientIds,
        });
      } else {
        const creator = input.scope === TASK_SCOPES.PERSONAL ? createPersonalTask : createOrganizationTask;
        const created = await creator({ db, schoolId, user: { uid, fullName: userData?.fullName }, input });
        if (input.scope !== TASK_SCOPES.PERSONAL) await notifyAssignment(input, created.id);
        if (input.scope === TASK_SCOPES.PERSONAL && input.suggestedInviteIds?.length) {
          try {
            await inviteTaskCollaborators({ schoolId, personalTaskId: created.id, recipientIds: input.suggestedInviteIds, message: 'הוזמנת לשיתוף פעולה במשימה.' });
          } catch {
            invitationWarning = true;
          }
        }
      }
      setForm(emptyForm());
      setShowForm(false);
      setActiveTab('dashboard');
      setWorkView([TASK_SCOPES.TEAM, TASK_SCOPES.INSTITUTION].includes(input.scope) ? 'teams' : 'mine');
      setAssistantMeta(null);
      showMessage(invitationWarning ? 'המשימה נוצרה, אך חלק מהזמנות השיתוף לא נשלחו.' : input.workPlanSteps.length ? 'המשימה והשלבים נשמרו בהצלחה.' : 'המשימה נוצרה בהצלחה.');
    } catch {
      setGeneralError();
    } finally {
      setSaving(false);
    }
  }

  function startEdit(task) {
    setEditingTask(task);
    setEditForm(formFromTask(task, uid));
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

  async function changeTaskAssignment(task, memberId, assigned) {
    const key = `${task._storageMode || 'nested'}:${task.id}:${memberId}`;
    setAssignmentSavingKey(key);
    setError('');
    try {
      const mutation = assignmentMutationForTask(task, memberId, assigned);
      if (!mutation) return;
      if (mutation.kind === 'convert') {
        const { assignment } = mutation;
        await convertPersonalTask({
          db,
          schoolId,
          user: { uid, fullName: userData?.fullName },
          task,
          assignment,
        });
        try {
          await notifyAssignment({ ...task, ...assignment }, task.id);
        } catch {
          // The assignment itself is authoritative; a notification failure must
          // not make a successful drag-and-drop operation look unsuccessful.
        }
        showMessage('המשימה הועברה לבנק המוסדי ושויכה לאיש הצוות.');
      } else {
        await updateTaskAssignee({ db, schoolId, task, staffId: mutation.staffId, assigned: mutation.assigned, actorId: uid });
        showMessage(assigned ? 'המשימה שויכה לאיש הצוות.' : 'השיוך הוסר. המשימה נשארה בבנק.');
      }
    } catch {
      setError('לא ניתן לעדכן את השיוך. בדקו את ההרשאה ונסו שוב.');
    } finally {
      setAssignmentSavingKey('');
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
    if (task.scope === TASK_SCOPES.INSTITUTION || task.assigneeType === 'all_school') return 'כל המוסד';
    if (task.scope === TASK_SCOPES.ASSIGNED || task.assigneeType === 'individual') {
      const names = (task.assigneeIds || []).map(id => staff.find(user => (user.uid || user.id) === id)?.fullName || 'עובד');
      return names.join(', ');
    }
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
            <select
              name="teamId"
              value={value.teamId}
              onChange={event => {
                const selectedTeam = teams.find(team => team.id === event.target.value);
                setter(previous => ({
                  ...previous,
                  teamId: event.target.value,
                  memberIds: idList(selectedTeam?.memberIds),
                }));
              }}
              required
            >
              <option value="">בחרו צוות</option>
              {teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </div>
        )}
        {value.scope === TASK_SCOPES.INSTITUTION && (
          <p className="personal-task-note"><Users size={14} /> כל אנשי הצוות הפעילים במוסד יוכלו לראות את המשימה</p>
        )}
      </>
    );
  }

  function renderLegacyFormFields(value, setter, editing = false) {
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
                {canManageAssignments && <button type="button" className={value.scope === TASK_SCOPES.INSTITUTION ? 'active' : ''} onClick={() => setter(previous => ({ ...previous, scope: TASK_SCOPES.INSTITUTION, assigneeIds: [], teamId: '' }))}>
                  <Users size={15} /> גלויה לכל המוסד
                </button>}
              </>
            )}
          </div>
        )}
        {editing && value.scope !== TASK_SCOPES.PERSONAL && canEditOrganizationTasks && (
          <div className="task-scope-picker" role="group" aria-label="יעד משימה ארגונית">
            <button type="button" className={value.scope === TASK_SCOPES.ASSIGNED ? 'active' : ''} onClick={() => setter(previous => ({ ...previous, scope: TASK_SCOPES.ASSIGNED, assigneeIds: [], teamId: '' }))}><User size={15} /> לאדם</button>
            <button type="button" className={value.scope === TASK_SCOPES.TEAM ? 'active' : ''} onClick={() => setter(previous => ({ ...previous, scope: TASK_SCOPES.TEAM, assigneeIds: [], teamId: '' }))}><Users size={15} /> לצוות</button>
            {canManageAssignments && <button type="button" className={value.scope === TASK_SCOPES.INSTITUTION ? 'active' : ''} onClick={() => setter(previous => ({ ...previous, scope: TASK_SCOPES.INSTITUTION, assigneeIds: [], teamId: '' }))}><Users size={15} /> לכל המוסד</button>}
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
        {!editing && assistantMeta && <details className="task-assistant-assignment-editor" open>
          <summary>אחריות ושיתוף — אפשר לערוך לפני השמירה</summary>
          <div className="task-assistant-assignment-levels">
            {[['responsibleIds', 'אחראי'], ['partnerIds', 'שותפים'], ['informedIds', 'לעדכון']].map(([field, label]) => <fieldset key={field}><legend>{label}</legend>{staff.map(member => { const memberId = member.uid || member.id; return <label key={memberId}><input type="checkbox" checked={value[field].includes(memberId)} onChange={event => setter(previous => ({ ...previous, [field]: event.target.checked ? [...new Set([...previous[field], memberId])] : previous[field].filter(id => id !== memberId) }))} /> {member.fullName}</label>; })}</fieldset>)}
          </div>
          <small>אחראי מוביל את הביצוע; שותפים מבצעים שלבים; אנשי „לעדכון” מקבלים גישה ועדכון אך אינם מוגדרים כאחראים.</small>
        </details>}
        {!editing && value.creationKind === 'task' && canAssignMandatory && <label className="task-mandatory-toggle"><input type="checkbox" checked={value.mandatory} onChange={event => setter(previous => ({ ...previous, mandatory: event.target.checked, scope: event.target.checked ? TASK_SCOPES.ASSIGNED : previous.scope, assigneeIds: [] }))} /> משימה מחייבת שלא ניתן להסיר</label>}
        {!editing && value.mandatory && <div className="form-group"><label>מקבלים</label><div className="task-recipient-list">{staff.filter(user => (user.uid || user.id) !== uid).map(user => { const userId = user.uid || user.id; return <label key={userId}><input type="checkbox" checked={value.recipientIds.includes(userId)} onChange={event => setter(previous => ({ ...previous, recipientIds: event.target.checked ? [...previous.recipientIds, userId] : previous.recipientIds.filter(id => id !== userId) }))} /> {user.fullName || user.email}</label>; })}</div></div>}
        {!editing && value.creationKind === 'initiative' && <div className="initiative-selection-grid task-unified-participants"><fieldset><legend>משתתפים</legend>{staff.filter(item => (item.uid || item.id) !== uid).map(item => { const id = item.uid || item.id; return <label key={id}><input type="checkbox" checked={value.memberIds.includes(id)} onChange={event => setter(previous => ({ ...previous, memberIds: event.target.checked ? [...new Set([...previous.memberIds, id])] : previous.memberIds.filter(itemId => itemId !== id) }))} /> {item.fullName}</label>; })}</fieldset><fieldset><legend>כיתות קשורות</legend>{classes.map(item => <label key={item.id}><input type="checkbox" checked={value.classIds.includes(item.id)} onChange={event => setter(previous => ({ ...previous, classIds: event.target.checked ? [...new Set([...previous.classIds, item.id])] : previous.classIds.filter(itemId => itemId !== item.id) }))} /> {item.name}</label>)}</fieldset></div>}
        {!editing && value.workPlanSteps.length > 0 && <div className="task-work-plan-editor"><div className="task-subtasks-head"><label>תכנית עבודה מוצעת</label><span>{value.workPlanSteps.length} שלבים</span></div>{value.workPlanSteps.map((step, index) => { const selectedParty = step.suggestedParties?.[0]; const selectedValue = selectedParty ? `${selectedParty.source}:${selectedParty.id}` : ''; return <div className="task-work-plan-row" key={step.id}><span>{step.phase}</span><input value={step.title} maxLength={180} onChange={event => setter(previous => ({ ...previous, workPlanSteps: previous.workPlanSteps.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item) }))} /><select aria-label={`גורם מוצע לשלב ${step.title}`} value={selectedValue} onChange={event => { const [source, id] = event.target.value.split(':'); const candidate = source === 'team' ? teams.find(item => item.id === id) : staff.find(item => (item.uid || item.id) === id); setter(previous => ({ ...previous, workPlanSteps: previous.workPlanSteps.map((item, itemIndex) => itemIndex === index ? { ...item, suggestedParties: candidate ? [{ id, name: candidate.name || candidate.fullName, jobTitle: candidate.jobTitle || '', source }] : [] } : item) })); }}><option value="">ללא שיבוץ</option>{teams.map(team => <option key={`team:${team.id}`} value={`team:${team.id}`}>{team.name}</option>)}{staff.map(member => <option key={`staff:${member.uid || member.id}`} value={`staff:${member.uid || member.id}`}>{member.fullName}</option>)}</select><button type="button" className="icon-btn" onClick={() => setter(previous => ({ ...previous, workPlanSteps: previous.workPlanSteps.filter((_, itemIndex) => itemIndex !== index) }))} aria-label="הסרת שלב"><X size={14} /></button></div>; })}</div>}
        {!editing && value.workPlanSteps.length === 0 && <div className="task-subtasks-editor"><div className="task-subtasks-head"><label>{value.creationKind === 'initiative' ? 'אבני דרך' : 'תתי־משימות'}</label><button type="button" className="btn btn-secondary btn-sm" onClick={() => setter(previous => ({ ...previous, subtasks: [...previous.subtasks, ''] }))}><Plus size={13} /> הוספה</button></div>{value.subtasks.map((subtask, index) => <div key={`subtask-${index}`}><input value={subtask} maxLength={180} placeholder={value.creationKind === 'initiative' ? 'שם אבן הדרך' : 'שם תת־המשימה'} onChange={event => setter(previous => ({ ...previous, subtasks: previous.subtasks.map((item, itemIndex) => itemIndex === index ? event.target.value : item) }))} /><button type="button" className="icon-btn" onClick={() => setter(previous => ({ ...previous, subtasks: previous.subtasks.filter((_, itemIndex) => itemIndex !== index) }))} aria-label="הסרת שורה"><X size={14} /></button></div>)}</div>}
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

  void renderLegacyFormFields;

  function renderFormFields(value, setter, editing = false) {
    const staffId = member => member.uid || member.id;
    const visibleStaff = staff.filter(member => {
      const needle = peopleSearch.trim().toLocaleLowerCase('he');
      if (!needle) return true;
      return `${member.fullName || ''} ${member.jobTitle || member.roleName || ''}`.toLocaleLowerCase('he').includes(needle);
    });
    const setPerson = (field, id, checked) => setter(previous => ({
      ...previous,
      [field]: checked ? [...new Set([...(previous[field] || []), id])] : (previous[field] || []).filter(item => item !== id),
    }));
    const updateStep = (index, patch) => setter(previous => ({
      ...previous,
      workPlanSteps: previous.workPlanSteps.map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step),
    }));
    const addStep = () => setter(previous => ({
      ...previous,
      workPlanSteps: [...previous.workPlanSteps, {
        id: `step_${Date.now()}`,
        phase: 'ביצוע',
        title: '',
        dueDate: '',
        status: 'todo',
        responsibleIds: [],
        teamId: '',
        dependencyStepId: '',
        order: previous.workPlanSteps.length,
        suggestedParties: [],
      }],
    }));
    const moveStep = (index, direction) => setter(previous => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= previous.workPlanSteps.length) return previous;
      const steps = [...previous.workPlanSteps];
      [steps[index], steps[nextIndex]] = [steps[nextIndex], steps[index]];
      return { ...previous, workPlanSteps: steps.map((step, order) => ({ ...step, order })) };
    });
    const leadId = value.responsibleIds?.[0] || value.assigneeIds?.[0] || '';

    return <div className="task-unified-fields">
      <section className="task-form-section task-form-primary" aria-labelledby="task-what-title">
        <h3 id="task-what-title" className="sr-only">המשימה</h3>
        <div className="form-group"><label htmlFor="task-title">מה המשימה?</label><input id="task-title" name="title" value={value.title} onChange={event => handleFormChange(setter, event)} required autoFocus={!editing} maxLength={180} placeholder="כתבו משימה קצרה וברורה" /></div>
      </section>

      <details className="task-form-section task-form-accordion">
        <summary><span><Users size={17} /> מי מעורב</span><small>{[...(value.responsibleIds || []), ...(value.partnerIds || []), ...(value.informedIds || []), ...(value.suggestedInviteIds || [])].length ? `${[...new Set([...(value.responsibleIds || []), ...(value.partnerIds || []), ...(value.informedIds || []), ...(value.suggestedInviteIds || [])])].length} אנשים` : 'ללא שיוך'}</small></summary>
        <div className="task-form-accordion-body">
        {canAssignTasks ? <>
          <div className="form-row">
            <div className="form-group"><label>צוות אחראי</label><select value={value.teamId || ''} onChange={event => setter(previous => ({ ...previous, teamId: event.target.value, scope: event.target.value ? TASK_SCOPES.TEAM : previous.scope }))}><option value="">ללא צוות אחראי</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></div>
            <div className="form-group"><label>אחראי מוביל</label><select value={leadId} onChange={event => setter(previous => ({ ...previous, responsibleIds: event.target.value ? [event.target.value] : [], assigneeIds: event.target.value ? [event.target.value] : [], scope: previous.teamId ? TASK_SCOPES.TEAM : event.target.value && event.target.value !== uid ? TASK_SCOPES.ASSIGNED : previous.scope }))}><option value="">ללא אחראי מוביל</option>{staff.map(member => <option key={staffId(member)} value={staffId(member)}>{member.fullName} {member.jobTitle ? `— ${member.jobTitle}` : ''}</option>)}</select></div>
          </div>
        </> : assistantMeta?.assignmentPlan ? <p className="personal-task-note"><Users size={14} /> האנשים שיוצעו יקבלו הזמנה לשיתוף לאחר יצירת המשימה.</p> : <p className="personal-task-note"><Lock size={14} /> המשימה תישמר כמשימה אישית.</p>}
        <div className="task-selected-people">
          {[
            ['responsibleIds', 'אחראי'], ['partnerIds', 'שותף'], ['informedIds', 'לעדכון'], ['suggestedInviteIds', 'הזמנה'],
          ].flatMap(([field, label]) => (value[field] || []).map(id => {
            const member = staff.find(item => staffId(item) === id);
            return member ? <button type="button" className="task-person-chip" key={`${field}-${id}`} onClick={() => setPerson(field, id, false)} title="הסרה"><span>{member.fullName}</span><small>{label}</small><X size={12} /></button> : null;
          }))}
        </div>
        <div className="form-group task-people-search"><label htmlFor="task-people-search">הוספת איש צוות</label><input id="task-people-search" value={peopleSearch} onChange={event => setPeopleSearch(event.target.value)} placeholder="חיפוש לפי שם או תפקיד" /></div>
        {peopleSearch.trim() && <div className="task-people-results">{visibleStaff.slice(0, 8).map(member => { const id = staffId(member); const target = canAssignTasks ? 'partnerIds' : 'suggestedInviteIds'; const selected = (value[target] || []).includes(id); return <button type="button" key={id} disabled={selected} onClick={() => setPerson(target, id, true)}><strong>{member.fullName}</strong><small>{member.jobTitle || member.roleName || 'איש צוות'}</small>{selected ? <Check size={14} /> : <Plus size={14} />}</button>; })}</div>}
        </div>
      </details>

      <details className="task-form-section task-form-accordion">
        <summary><span><Clock size={17} /> מתי</span><small>{value.dueDate ? new Date(`${value.dueDate}T00:00:00`).toLocaleDateString('he-IL') : 'ללא מועד'}</small></summary>
        <div className="task-form-accordion-body">
        <div className="form-row"><div className="form-group"><label>תאריך יעד</label><input name="dueDate" type="date" value={value.dueDate} onChange={event => handleFormChange(setter, event)} dir="ltr" /></div><div className="form-group"><label>תזכורת</label><input name="reminderAt" type="datetime-local" value={value.reminderAt} onChange={event => handleFormChange(setter, event)} dir="ltr" /></div></div>
        <div className="form-row"><div className="form-group"><label>תחילת טווח (אופציונלי)</label><input name="startDate" type="date" value={value.startDate} onChange={event => handleFormChange(setter, event)} /></div><div className="form-group"><label>סיום טווח (אופציונלי)</label><input name="endDate" type="date" min={value.startDate || undefined} value={value.endDate} onChange={event => handleFormChange(setter, event)} /></div></div>
        {findHolidayConflict(value.dueDate, holidays) && <p className="task-date-warning"><AlertTriangle size={14} /> תאריך היעד חופף לחופשה: {findHolidayConflict(value.dueDate, holidays).name || findHolidayConflict(value.dueDate, holidays).title}</p>}
        </div>
      </details>

      <details className="task-form-section task-form-accordion">
        <summary><span><Flag size={17} /> שלבים</span><small>{value.workPlanSteps.length ? `${value.workPlanSteps.length} שלבים` : 'משימה מהירה'}</small></summary>
        <div className="task-form-accordion-body"><button type="button" className="btn btn-secondary btn-sm task-add-stage" onClick={addStep}><Plus size={14} /> הוספת שלב</button>
        <div className="task-stage-list">
          {value.workPlanSteps.map((step, index) => <details className="task-stage-row" key={step.id || index}>
            <summary>
              <input type="checkbox" checked={step.status === 'done'} onClick={event => event.stopPropagation()} onChange={event => updateStep(index, { status: event.target.checked ? 'done' : 'todo' })} aria-label={`סימון השלב ${step.title || index + 1} כהושלם`} />
              <span className="task-stage-title">{step.title || 'שלב חדש'}</span>
              <time>{step.dueDate ? new Date(`${step.dueDate}T00:00:00`).toLocaleDateString('he-IL') : 'ללא תאריך'}</time>
              <span>{step.teamId ? teams.find(team => team.id === step.teamId)?.name : staff.find(member => step.responsibleIds?.includes(staffId(member)))?.fullName || 'ללא אחראי'}</span>
              <span className="task-stage-actions" onClick={event => event.preventDefault()}><button type="button" onClick={() => moveStep(index, -1)} disabled={index === 0} aria-label="הזזת שלב למעלה">↑</button><button type="button" onClick={() => moveStep(index, 1)} disabled={index === value.workPlanSteps.length - 1} aria-label="הזזת שלב למטה">↓</button><button type="button" onClick={() => setter(previous => ({ ...previous, workPlanSteps: previous.workPlanSteps.filter((_, itemIndex) => itemIndex !== index) }))} aria-label="מחיקת שלב"><Trash2 size={13} /></button></span>
            </summary>
            <div className="task-stage-details">
              <div className="form-group"><label>שם השלב</label><input value={step.title} maxLength={180} onChange={event => updateStep(index, { title: event.target.value })} /></div>
              <div className="form-row"><div className="form-group"><label>תאריך אופציונלי</label><input type="date" value={step.dueDate || ''} onChange={event => updateStep(index, { dueDate: event.target.value })} /></div><div className="form-group"><label>סטטוס</label><select value={step.status || 'todo'} onChange={event => updateStep(index, { status: event.target.value })}>{Object.entries(STATUS_CONFIG).map(([key, config]) => <option key={key} value={key}>{config.label}</option>)}</select></div></div>
              <div className="form-row"><div className="form-group"><label>אחראי</label><select value={step.responsibleIds?.[0] || ''} onChange={event => updateStep(index, { responsibleIds: event.target.value ? [event.target.value] : [], teamId: '' })}><option value="">ללא אחראי</option>{staff.map(member => <option key={staffId(member)} value={staffId(member)}>{member.fullName}</option>)}</select></div><div className="form-group"><label>או צוות</label><select value={step.teamId || ''} onChange={event => updateStep(index, { teamId: event.target.value, responsibleIds: [] })}><option value="">ללא צוות</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></div></div>
              <div className="form-group"><label>תלות בשלב קודם</label><select value={step.dependencyStepId || ''} onChange={event => updateStep(index, { dependencyStepId: event.target.value })}><option value="">ללא תלות</option>{value.workPlanSteps.filter((_, optionIndex) => optionIndex !== index).map(option => <option key={option.id} value={option.id}>{option.title || 'שלב ללא שם'}</option>)}</select></div>
            </div>
          </details>)}
          {value.workPlanSteps.length === 0 && <p className="task-stages-empty">זו תהיה משימה פשוטה ללא שלבים.</p>}
        </div>
        </div>
      </details>

      <details className="task-more-options"><summary>אפשרויות נוספות</summary><div>
        <div className="form-group"><label htmlFor="task-description">תיאור</label><textarea id="task-description" name="description" value={value.description} onChange={event => handleFormChange(setter, event)} rows={2} maxLength={2000} /></div>
        <div className="form-group"><label htmlFor="task-completion">תנאי לסיום</label><input id="task-completion" name="completionCriteria" value={value.completionCriteria} onChange={event => handleFormChange(setter, event)} maxLength={800} /></div>
        <div className="form-row"><div className="form-group"><label>עדיפות</label><select name="priority" value={value.priority} onChange={event => handleFormChange(setter, event)}>{Object.entries(PRIORITY_CONFIG).map(([key, config]) => <option key={key} value={key}>{config.label}</option>)}</select></div><div className="form-group"><label>סטטוס</label><select name="status" value={value.status} onChange={event => handleFormChange(setter, event)}>{Object.entries(STATUS_CONFIG).map(([key, config]) => <option key={key} value={key}>{config.label}</option>)}</select></div><div className="form-group"><label>מי יכול לראות</label><select value={value.scope} onChange={event => setter(previous => ({ ...previous, scope: event.target.value, teamId: event.target.value === TASK_SCOPES.TEAM ? previous.teamId : '', assigneeIds: event.target.value === TASK_SCOPES.ASSIGNED ? previous.assigneeIds : [] }))}><option value={TASK_SCOPES.PERSONAL}>רק אני</option>{canAssignTasks && <option value={TASK_SCOPES.ASSIGNED}>אדם שנבחר</option>}{canAssignTasks && <option value={TASK_SCOPES.TEAM}>צוות שנבחר</option>}{canManageAssignments && <option value={TASK_SCOPES.INSTITUTION}>כל אנשי המוסד</option>}</select></div></div>
        {initiatives.length > 0 && <div className="form-group"><label>קישור לתכנית ישנה (תאימות)</label><select value={value.initiativeId || ''} onChange={event => setter(previous => ({ ...previous, initiativeId: event.target.value, milestoneId: '' }))}><option value="">ללא קישור</option>{initiatives.filter(item => item.status !== 'archived').map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></div>}
        {!editing && canAssignMandatory && <label className="task-mandatory-toggle"><input type="checkbox" checked={value.mandatory} onChange={event => setter(previous => ({ ...previous, mandatory: event.target.checked, scope: event.target.checked ? TASK_SCOPES.ASSIGNED : previous.scope }))} /> משימה מחייבת שלא ניתן להסיר</label>}
        {!editing && value.mandatory && <div className="form-group"><label>מקבלי משימה מחייבת</label><div className="task-recipient-list">{staff.filter(member => staffId(member) !== uid).map(member => <label key={staffId(member)}><input type="checkbox" checked={value.recipientIds.includes(staffId(member))} onChange={event => setPerson('recipientIds', staffId(member), event.target.checked)} /> {member.fullName}</label>)}</div></div>}
        <div className="form-group"><label><Paperclip size={12} /> קובץ מצורף</label><select value={value.attachedFileId} onChange={event => handleAttachment(setter, event.target.value)}><option value="">ללא קובץ</option>{allFiles.filter(file => ['spreadsheet', 'document'].includes(file.fileType)).map(file => <option key={file.id} value={file.id}>{file.name}</option>)}</select></div>
        {editing && value.legacyTags?.length > 0 && <p className="task-legacy-tags">תגיות ישנות נשמרות לתאימות: {value.legacyTags.join(', ')}</p>}
      </div></details>
    </div>;
  }

  function renderTask(task) {
    if (task._kind === 'initiative') {
      const overdue = taskDateGroup(task) === 'overdue';
      const owner = staff.find(member => (member.uid || member.id) === task.createdBy)?.fullName || 'ללא מוביל';
      return <article key={task._key} className={`task-row task-work-card task-work-card--initiative ${overdue ? 'task-row--overdue' : ''}`}>
        <div className="task-main"><div className="task-title-line"><Flag size={15} /><span className="task-title">{task.title}</span><span className="task-kind-badge">תכנית</span>{overdue && <span className="task-overdue-badge">באיחור</span>}</div>{task.description && <div className="task-desc">{task.description}</div>}<div className="task-meta"><span className="task-assignee"><User size={11} />{owner}</span><span className="task-due">{task.dueDate ? new Date(`${task.dueDate}T00:00:00`).toLocaleDateString('he-IL') : 'ללא מועד'}</span></div></div>
        <button type="button" className="task-open-initiative" onClick={() => { setWorkView('plans'); navigate(`/tasks?initiative=${task.id}`); }} aria-label={`פתיחת התכנית ${task.title}`}>פתיחה</button>
      </article>;
    }
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
      <article key={task._key} className={`task-row task-work-card ${overdue ? 'task-row--overdue' : ''}`} onContextMenu={event => {
        event.preventDefault();
        const menuWidth = 230;
        const menuHeight = 330;
        setContextTaskMenu({
          task,
          x: Math.max(12, Math.min(event.clientX, window.innerWidth - menuWidth - 12)),
          y: Math.max(12, Math.min(event.clientY, window.innerHeight - menuHeight - 12)),
        });
      }}>
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
          {!showAssignmentBoard && <section className="task-dashboard-head" aria-labelledby="task-dashboard-title">
            <h1 id="task-dashboard-title">משימות</h1>
            <label className="task-compact-search"><Search size={16} aria-hidden="true" /><span className="sr-only">חיפוש משימות</span><input value={searchText} onChange={event => setSearchText(event.target.value)} placeholder="חיפוש" /></label>
            <div className="task-dashboard-actions">{canManageAssignmentBoard && <button type="button" className="btn btn-secondary" onClick={() => setShowAssignmentBoard(true)}><Users size={16} /> ניהול הקצאות</button>}<button type="button" className="btn task-create-primary" onClick={() => openTaskForm(TASK_SCOPES.PERSONAL)}><Plus size={16} /> יצירה חדשה</button></div>
          </section>}

          {!showAssignmentBoard && canUseTaskAssistant && <TaskAssistantEntry uid={uid} schoolId={schoolId} schoolContext={taskAssistantSchoolContext} onManual={() => openTaskForm(TASK_SCOPES.PERSONAL)} onProposal={applyAssistantProposal} />}

          {!showAssignmentBoard && <section className="task-action-metrics" aria-label="מה דורש טיפול">
            <button type="button" className={filterDate === 'today' ? 'active' : ''} onClick={() => openMetric('today')}><span>להיום</span><strong>{dashboardStats.today}</strong></button>
            <button type="button" className={filterDate === 'overdue' ? 'active is-overdue' : 'is-overdue'} onClick={() => openMetric('overdue')}><span>באיחור</span><strong>{dashboardStats.overdue}</strong></button>
            <button type="button" className={dashboardStats.waiting ? 'has-unread' : ''} onClick={() => { setActiveTab('invitations'); setFilterDate('all'); }}><span>ממתין לי</span><strong>{dashboardStats.waiting}</strong></button>
          </section>}

          {!showAssignmentBoard && <section className="task-view-layer" aria-label="בחירת תצוגה">
            <div className="task-view-tools"><button type="button" className="task-filter-trigger" onClick={() => setShowFilters(true)} aria-label={`פתיחת מסננים${activeFilterCount ? `, ${activeFilterCount} פעילים` : ''}`}><Filter size={15} /> סינון{activeFilterCount > 0 && <span>{activeFilterCount}</span>}</button><details className="task-tools-menu"><summary aria-label="כלים נוספים"><MoreHorizontal size={17} /> כלים</summary><div>{canManageAssignmentBoard && <button type="button" onClick={() => setShowAssignmentBoard(true)}><Users size={14} /> ניהול הקצאות</button>}{isInitiativeManager && <button type="button" onClick={() => setShowPatternReview(true)}><Sparkles size={14} /> למידת הסוכן</button>}{canCreateCommunication && <button type="button" onClick={() => openCommunicationContext({ type: 'general', id: 'task_panel', label: 'פאנל המשימות' })}><MailPlus size={14} /> מייל ומעקב חדש</button>}<button type="button" onClick={() => setActiveTab('communications')}><MailPlus size={14} /> מרכז מיילים ומעקבים</button><button type="button" onClick={() => setActiveTab('invitations')}><Users size={14} /> הזמנות ושיתופים{dashboardStats.waiting > 0 ? ` (${dashboardStats.waiting})` : ''}</button></div></details></div>
          </section>}

          {!showAssignmentBoard && workView !== 'plans' && <section className="task-work-list-head" aria-label="מסננים פעילים">
            <span className="task-stats">{filteredTasks.length} משימות</span>
            {activeFilterChips.length > 0 && <div className="task-active-filters">{activeFilterChips.map(chip => <button type="button" key={chip.key} onClick={chip.clear} aria-label={`הסרת מסנן ${chip.label}`}>{chip.label}<X size={12} aria-hidden="true" /></button>)}<button type="button" className="task-clear-filters" onClick={clearAllFilters}>נקה הכול</button></div>}
          </section>}
        </> : <section className="task-secondary-head"><div><button type="button" className="btn btn-secondary btn-sm" onClick={() => setActiveTab('dashboard')}>חזרה למשימות</button><h1>{activeTab === 'communications' ? 'מיילים ומעקבים' : 'הזמנות ושיתופים'}</h1></div>{activeTab === 'communications' && canCreateCommunication && <button type="button" className="btn task-create-primary" onClick={() => openCommunicationContext({ type: 'general', id: 'task_panel', label: 'פאנל המשימות' })}><Plus size={15} /> מייל ומעקב חדש</button>}</section>}

        {showForm && !initiativeDetailOpen && (
          <div className="task-create-overlay" onClick={() => setShowForm(false)}>
          <div className="card form-card" role="dialog" aria-modal="true" aria-labelledby="task-create-title" onClick={event => event.stopPropagation()}>
            <form onSubmit={handleCreate} className="task-form">
              <header className="task-unified-form-head"><div><h2 id="task-create-title">משימה חדשה</h2></div><button type="button" className="icon-btn" onClick={() => setShowForm(false)} aria-label="סגירת טופס היצירה"><X size={18} /></button></header>
              {assistantMeta && <div className="task-assistant-proposal-note" title={assistantMeta.reasoningSummary || 'הצעה לפי ההקשר המוסדי'}><Sparkles size={16} /><strong>הסוכן מילא הצעה שאפשר לשנות</strong><span>{assistantMeta.capabilities?.collaborationMode === 'invite' ? 'השמות המוצעים יקבלו הזמנה לשיתוף' : 'השיוכים ניתנים לעריכה'}</span>{assistantMeta.holidayName && <span className="task-date-warning">המועד חופף ל־{assistantMeta.holidayName}</span>}</div>}
              {renderFormFields(form, setForm)}
              <div className="form-actions"><button className="btn btn-primary" type="submit" disabled={saving}>{saving ? 'יוצר…' : 'יצירת המשימה'}</button><button className="btn btn-secondary" type="button" onClick={() => setShowForm(false)}>ביטול</button></div>
            </form>
          </div>
          </div>
        )}

        {activeTab === 'dashboard' && workView === 'plans' && <>
          <InitiativePanel
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
          onRequestCreate={() => openTaskForm(TASK_SCOPES.PERSONAL)}
          />
        </>}

        {activeTab === 'dashboard' && showAssignmentBoard ? <TaskAssignmentBoard tasks={[...personalTasks, ...organizationTasks]} staff={staff} savingKey={assignmentSavingKey} onAssignmentChange={changeTaskAssignment} onClose={() => setShowAssignmentBoard(false)} /> : activeTab === 'communications' ? <CommunicationDashboard
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
            <fieldset className="task-date-range"><legend>טווח תאריכים</legend><label>מתאריך<input type="date" value={filterDateFrom} onChange={event => setFilterDateFrom(event.target.value)} /></label><label>עד תאריך<input type="date" value={filterDateTo} min={filterDateFrom || undefined} onChange={event => setFilterDateTo(event.target.value)} /></label></fieldset>
            <label className="task-completed-toggle"><input type="checkbox" checked={showCompleted} onChange={event => setShowCompleted(event.target.checked)} /> הצגת משימות שהושלמו</label>
          </div>
          <footer><button type="button" className="btn btn-secondary" onClick={clearAllFilters}>נקה הכול</button><button type="button" className="btn btn-primary" onClick={() => setShowFilters(false)}>הצגת התוצאות</button></footer>
        </section>
      </div>}

      {showPatternReview && <TaskPatternReviewPanel schoolId={schoolId} onClose={() => setShowPatternReview(false)} />}

      {contextTaskMenu && <div className="task-context-menu-backdrop" onPointerDown={() => setContextTaskMenu(null)}>
        <div className="task-context-menu" role="menu" aria-label={`ניהול ${contextTaskMenu.task.title}`} style={{ left: contextTaskMenu.x, top: contextTaskMenu.y }} onPointerDown={event => event.stopPropagation()}>
          {canEditDetails(contextTaskMenu.task) && <button role="menuitem" onClick={() => { startEdit(contextTaskMenu.task); setContextTaskMenu(null); }}><Edit3 size={15} /> עריכה</button>}
          <button role="menuitem" disabled={!canChangeStatus(contextTaskMenu.task)} onClick={() => { changeStatus(contextTaskMenu.task, isTaskComplete(contextTaskMenu.task) ? 'todo' : 'done'); setContextTaskMenu(null); }}>{isTaskComplete(contextTaskMenu.task) ? <RotateCcw size={15} /> : <Check size={15} />} {isTaskComplete(contextTaskMenu.task) ? 'החזרה לביצוע' : 'סימון כהושלם'}</button>
          {canEditDetails(contextTaskMenu.task) && <button role="menuitem" onClick={() => { pinTask(contextTaskMenu.task); setContextTaskMenu(null); }}><Pin size={15} /> {contextTaskMenu.task.pinnedBy?.includes(uid) ? 'ביטול הצמדה' : 'הצמדת משימה'}</button>}
          {contextTaskMenu.task._source === 'organization' && <button role="menuitem" onClick={() => { setChatTask(contextTaskMenu.task); setContextTaskMenu(null); }}><MessageSquare size={15} /> תגובה</button>}
          {contextTaskMenu.task._source === 'personal' && <button role="menuitem" onClick={() => { setCollaborationTask(contextTaskMenu.task); setCollaborationRecipients([]); setCollaborationMessage(''); setContextTaskMenu(null); }}><User size={15} /> הזמנת שותפים</button>}
          {canDeleteTask(contextTaskMenu.task) && <button className="is-danger" role="menuitem" onClick={() => { const task = contextTaskMenu.task; setContextTaskMenu(null); removeTask(task); }}><Trash2 size={15} /> מחיקה</button>}
        </div>
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
