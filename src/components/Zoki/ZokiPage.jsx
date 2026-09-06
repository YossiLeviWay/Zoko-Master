import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDocs, query, where } from 'firebase/firestore';
import { ArrowDown, BookOpen, CheckCircle2, CircleStop, ExternalLink, Minus, Pencil, Plus, Save, Send, Settings2, ShieldCheck, Trash2, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { db } from '../../firebase.js';
import { callableReason, executeZokiAttendance, executeZokiCalendarEvent, executeZokiCalendarEventCancel, executeZokiCalendarEventUpdate, executeZokiContact, executeZokiDirectPermission, executeZokiGrade, executeZokiResourceAccess, executeZokiResourceCreate, executeZokiResourceMove, executeZokiResourceRename, executeZokiRoleAssignment, executeZokiStudentNote, executeZokiStudentTrack, executeZokiStudentTransfer, executeZokiTask, executeZokiTaskAssignment, executeZokiTaskDetails, executeZokiTaskStatus, executeZokiTeamCreate, executeZokiTeamManager, executeZokiTeamMembership, fileTrashAction } from '../../services/adminUserService.js';
import { saveZokiBrain, subscribeZokiBrain } from '../../services/firestore/zokiBrainRepository.js';
import { listSchoolStaff, subscribeStudents } from '../../services/firestore/classStudentRepository.js';
import { subscribeContacts } from '../../services/firestore/contactRepository.js';
import { schoolCollection } from '../../services/firestore/paths.js';
import { useTaskAssistantContext } from '../../hooks/useTaskAssistantContext.js';
import { usePermissions } from '../../hooks/usePermissions.js';
import { taskAssistantErrorMessage } from '../../services/firebaseAiTaskService.js';
import { normalizeZokiConversationState } from '../../utils/zokiConversation.js';
import { loadAuthorizedStudentDetails } from '../../services/zokiSparkDataService.js';
import { answerZokiOnSpark } from '../../utils/zokiSparkAnswer.js';
import { sendZokiTaskWorkflowCommand, ZOKI_TASK_WORKFLOW_UPDATE } from '../../utils/zokiTaskWorkflowBridge.js';
import zokiAvatar from '../../assets/zoki-avatar-minimal.svg';
import './Zoki.css';
import ZokiPersonalSettings from './ZokiPersonalSettings.jsx';
import { isZokiAgentConfigured, zokiRequest, zokiSourcePaths, syncPersonalAgentConversation } from '../../services/zokiAgentService.js';

const STARTERS = [
  'באיזו כיתה לומד תלמיד מסוים?',
  'איפה נמצא קובץ מסוים?',
  'איך יוצרים משימה חדשה?',
  'מה הנוהל הבית־ספרי בנושא טיולים?',
];

const EMPTY_ENTRY = { title: '', body: '', category: 'נוהל', validUntil: '', status: 'published', audience: { type: 'school', roleIds: [], userIds: [] } };
const NOTE_TYPE_LABELS = { general: 'כללית', academic: 'לימודית', behavior: 'התנהגותית', welfare: 'רווחה' };
const RESOURCE_ACCESS_LEVEL_LABELS = { view: 'צפייה', comment: 'תגובה', edit: 'עריכה', manage: 'ניהול ושיתוף' };
const TASK_STATUS_LABELS = { todo: 'לביצוע', in_progress: 'בביצוע', done: 'הושלמה', completed: 'הושלמה' };
const TASK_DETAIL_LABELS = { title: 'כותרת', description: 'תיאור', priority: 'עדיפות', dueDate: 'תאריך יעד' };

function taskDetailValue(field, value) {
  if (field === 'priority') return value === 'high' ? 'גבוהה' : value === 'low' ? 'נמוכה' : 'רגילה';
  return value || 'ללא ערך';
}

function errorMessage(error) {
  const reason = callableReason(error);
  if (reason === 'zoki-not-configured') return 'העוזר אינו זמין כרגע. מנהל המערכת קיבל הנחיה לטפל בכך.';
  if (reason === 'permission-denied') return 'אין לך הרשאה לקבל את המידע הזה.';
  if (reason === 'not-found') return 'שירות התשובות עדיין אינו פעיל. מנהל המערכת קיבל הנחיה לטפל בכך.';
  if (reason === 'unauthenticated') return 'החיבור פג. התחברו מחדש ונסו שוב.';
  if (reason === 'app-check-failed') return 'אימות האפליקציה נכשל. רעננו את הדף ונסו שוב.';
  if (reason === 'resource-exhausted') return 'נשלחו הרבה שאלות בזמן קצר. אפשר לנסות שוב בעוד כמה דקות.';
  if (reason === 'unavailable' || reason === 'deadline-exceeded') return 'שירות התשובות אינו זמין כרגע. אפשר לנסות שוב בעוד רגע.';
  return 'לא הצלחתי לענות כרגע. אפשר לנסות שוב.';
}

function displayName(item, fallback) {
  return item.fullName || item.displayName || item.name || item.title || fallback;
}

const TASK_CREATION_REQUEST = /(?:צור|צרי|תיצור|תיצרי|פתח|פתחי|תפתח|תפתחי|הכן|הכיני|תכין|תכיני|בנה|בני|תבנה|תבני)\s+(?:לי\s+)?משימה|(?:אני\s+רוצה|צריך|צריכה)\s+(?:ליצור|לפתוח|להכין)\s+משימה/u;
const END_CONVERSATION_REQUEST = /^(?:סיים|סיימי|לסיים|סיום)\s+(?:את\s+)?השיחה[.!]?$/u;
const ROLE_TARGET_HINT = /(?:עבור|בשביל|אל|ל)\s+(ה?(?:רכז(?:ת)?|מנהל(?:ת)?|מחנכ(?:ת)?|יועצ(?:ת)?|מזכיר(?:ה)?|סגנ(?:ית)?)(?:\s+[\p{L}״׳'-]+){0,3}?)(?=\s+(?:להכ(?:ין|נת)|לבצע|לעשות|ליצור|לבנות|לתכנן|כדי|שי|שת)|[.,!?]|$)/u;

function taskTargetHint(request) {
  const label = request.match(ROLE_TARGET_HINT)?.[1]?.trim() || '';
  return label ? { type: 'role', label } : {};
}

export default function ZokiPage({ embedded = false, onMinimize = () => undefined }) {
  const { userData, currentUser, selectedSchool, isPrincipal, isGlobalAdmin } = useAuth();
  const navigate = useNavigate();
  const schoolId = selectedSchool || userData?.schoolId;
  const canManage = isPrincipal() || isGlobalAdmin();
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState([]);
  const [conversationReady, setConversationReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [brainOpen, setBrainOpen] = useState(false);
  const [personalOpen, setPersonalOpen] = useState(false);
  const [brain, setBrain] = useState({ instructions: '', entries: [] });
  const [brainDraft, setBrainDraft] = useState({ instructions: '', entries: [] });
  const [savingBrain, setSavingBrain] = useState(false);
  const [brainMessage, setBrainMessage] = useState('');
  const [audienceStaff, setAudienceStaff] = useState([]);
  const [audienceRoles, setAudienceRoles] = useState([]);
  const [audienceLoading, setAudienceLoading] = useState(false);
  const [accessibleStudents, setAccessibleStudents] = useState([]);
  const [accessibleTracks, setAccessibleTracks] = useState([]);
  const [accessibleContacts, setAccessibleContacts] = useState([]);
  const [accessibleFiles, setAccessibleFiles] = useState([]);
  const [pendingTask, setPendingTask] = useState(null);
  const [executingTask, setExecutingTask] = useState(false);
  const [taskActionResult, setTaskActionResult] = useState(null);
  const endRef = useRef(null);
  const messagesRef = useRef(null);
  const [showHistoryJump, setShowHistoryJump] = useState(false);
  const { schoolContext: taskAssistantSchoolContext } = useTaskAssistantContext();
  const { permissions, schoolWidePermissions, permissionScopes, loading: permissionsLoading } = usePermissions();
  const conversationKey = useMemo(() => currentUser?.uid && schoolId
    ? `zoko-master:zoki-conversation:v2:${currentUser.uid}:${schoolId}` : '', [currentUser?.uid, schoolId]);
  const activeConversation = useRef(conversationKey);
  const conversationGeneration = useRef(0);
  activeConversation.current = conversationKey;

  useEffect(() => {
    if (!schoolId || !canManage) return undefined;
    return subscribeZokiBrain({ db, schoolId, onData: value => { setBrain(value); setBrainDraft(value); }, onError: () => undefined });
  }, [canManage, schoolId]);

  useEffect(() => {
    let active = true;
    setConversationReady(false);
    setMessages([]);
    setPendingTask(null);
    setTaskActionResult(null);
    if (!conversationKey) return undefined;
    let localState = null;
    try {
      localState = JSON.parse(localStorage.getItem(conversationKey) || 'null');
    } catch {
      localStorage.removeItem(conversationKey);
    }
    const applyState = state => {
      const normalized = normalizeZokiConversationState(state);
      if (!active || !normalized) return;
      setMessages(normalized.messages);
      setPendingTask(normalized.pendingTask);
      setTaskActionResult(normalized.taskActionResult);
    };
    applyState(localState);
    syncPersonalAgentConversation({ schoolId, operation: 'load' })
      .then(result => applyState(result?.state))
      .catch(() => undefined)
      .finally(() => { if (active) setConversationReady(true); });
    return () => { active = false; };
  }, [conversationKey, schoolId]);

  useEffect(() => {
    if (!conversationReady || !conversationKey) return;
    const state = { messages: messages.slice(-60), pendingTask, taskActionResult, taskAgentTurn: null };
    try {
      localStorage.setItem(conversationKey, JSON.stringify(state));
    } catch {
      // The conversation remains available for the current session if browser storage is full.
    }
    if (loading || (!messages.length && !pendingTask && !taskActionResult)) return undefined;
    const timer = window.setTimeout(() => {
      syncPersonalAgentConversation({ schoolId, operation: 'save', state }).catch(() => undefined);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [conversationKey, conversationReady, loading, messages, pendingTask, schoolId, taskActionResult]);

  useEffect(() => {
    const receiveTaskWorkflowUpdate = event => {
      const detail = event.detail;
      if (!detail?.workflowId || detail.schoolId !== schoolId || !detail.text) return;
      const messageId = `zoki_task_${detail.workflowId}`;
      const nextMessage = {
        id: messageId,
        role: 'zoki',
        text: String(detail.text).slice(0, 5000),
        actionProposal: detail.actionProposal || null,
        actionStatus: detail.phase || '',
      };
      setMessages(previous => {
        const index = previous.findIndex(item => item.id === messageId);
        if (index < 0) return [...previous, nextMessage];
        return previous.map((item, itemIndex) => itemIndex === index ? { ...item, ...nextMessage } : item);
      });
    };
    window.addEventListener(ZOKI_TASK_WORKFLOW_UPDATE, receiveTaskWorkflowUpdate);
    return () => window.removeEventListener(ZOKI_TASK_WORKFLOW_UPDATE, receiveTaskWorkflowUpdate);
  }, [schoolId]);

  useEffect(() => {
    if (!schoolId || !canManage) return undefined;
    let active = true;
    setAudienceLoading(true);
    Promise.all([
      listSchoolStaff(db, schoolId),
      Promise.all([
        getDocs(schoolCollection(db, schoolId, 'roleDefinitions', 'nested')).catch(() => null),
        getDocs(schoolCollection(db, schoolId, 'roleDefinitions', 'legacy')).catch(() => null),
      ]),
    ]).then(([staff, roleSnapshots]) => {
      if (!active) return;
      const roles = new Map();
      roleSnapshots.filter(Boolean).forEach(snapshot => snapshot.docs.forEach(item => roles.set(item.id, { id: item.id, ...item.data() })));
      setAudienceStaff(staff.sort((left, right) => displayName(left, '').localeCompare(displayName(right, ''), 'he')));
      setAudienceRoles([...roles.values()].filter(role => role.status !== 'archived').sort((left, right) => displayName(left, '').localeCompare(displayName(right, ''), 'he')));
    }).catch(() => {
      if (active) setBrainMessage('לא ניתן לטעון כרגע את רשימות התפקידים ואנשי הצוות.');
    }).finally(() => {
      if (active) setAudienceLoading(false);
    });
    return () => { active = false; };
  }, [canManage, schoolId]);

  useEffect(() => {
    const container = messagesRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  function scrollToLatestMessage() {
    const container = messagesRef.current;
    if (container) container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }

  useEffect(() => {
    if (!schoolId || permissionsLoading) return undefined;
    const manager = canManage;
    const studentPermission = permissionScopes['students.view'] || permissionScopes.students_view;
    const canViewAll = manager || studentPermission?.type === 'school';
    const classes = taskAssistantSchoolContext?.sources?.classes || [];
    const classIds = classes.map(item => item.id).filter(Boolean);
    const legacyClassNames = classes.map(item => item.name).filter(Boolean);
    if (!canViewAll && classIds.length === 0) {
      setAccessibleStudents([]);
      return undefined;
    }
    return subscribeStudents({
      db, schoolId, classIds, legacyClassNames, canViewAll,
      onData: setAccessibleStudents,
      onError: () => setAccessibleStudents([]),
    });
  }, [canManage, permissionScopes, permissions, permissionsLoading, schoolId, taskAssistantSchoolContext?.sources?.classes]);

  useEffect(() => {
    if (!schoolId || permissionsLoading || (!canManage && !permissions['students.view'] && !permissions.students_view)) {
      setAccessibleTracks([]);
      return undefined;
    }
    let active = true;
    getDocs(schoolCollection(db, schoolId, 'tracks'))
      .then(snapshot => {
        if (active) setAccessibleTracks(snapshot.docs.map(item => ({ id: item.id, ...item.data() })));
      })
      .catch(() => { if (active) setAccessibleTracks([]); });
    return () => { active = false; };
  }, [canManage, permissions, permissionsLoading, schoolId]);

  useEffect(() => {
    if (!schoolId || !currentUser?.uid || permissionsLoading) {
      setAccessibleContacts([]);
      return undefined;
    }
    return subscribeContacts({
      db,
      schoolId,
      userId: currentUser.uid,
      includeInstitutional: canManage || permissions['contacts.view'] === true,
      canReadRestricted: canManage,
      onData: setAccessibleContacts,
      onError: () => setAccessibleContacts([]),
    });
  }, [canManage, currentUser?.uid, permissions, permissionsLoading, schoolId]);

  useEffect(() => {
    if (!schoolId || permissionsLoading) {
      setAccessibleFiles([]);
      return undefined;
    }
    let active = true;
    const classes = taskAssistantSchoolContext?.sources?.classes || [];
    const classIds = classes.map(item => item.id).filter(Boolean).slice(0, 30);
    const attendanceSchoolWide = canManage
      || permissionScopes.attendance_view?.type === 'school'
      || permissionScopes['attendance.view']?.type === 'school';
    const gradesSchoolWide = canManage
      || schoolWidePermissions['grades.view']
      || schoolWidePermissions['grades.edit']
      || schoolWidePermissions['gradebooks.manage'];
    const requests = [getDocs(schoolCollection(db, schoolId, 'files')).catch(() => null)];
    if (canManage) {
      requests.push(getDocs(schoolCollection(db, schoolId, 'files', 'nested')).catch(() => null));
    } else {
      if (attendanceSchoolWide) requests.push(getDocs(query(
        schoolCollection(db, schoolId, 'files', 'nested'), where('fileType', '==', 'attendance'),
      )).catch(() => null));
      if (gradesSchoolWide) requests.push(getDocs(query(
        schoolCollection(db, schoolId, 'files', 'nested'), where('fileType', '==', 'gradebook'),
      )).catch(() => null));
      if (classIds.length) requests.push(getDocs(query(
        schoolCollection(db, schoolId, 'files', 'nested'), where('classId', 'in', classIds),
      )).catch(() => null));
    }
    Promise.all(requests).then(snapshots => {
      if (!active) return;
      const files = new Map();
      snapshots.filter(Boolean).forEach(snapshot => snapshot.docs.forEach(item => {
        const value = { id: item.id, ...item.data() };
        if (!value.trashedAt && value.status !== 'archived') files.set(item.id, value);
      }));
      setAccessibleFiles([...files.values()]);
    });
    return () => { active = false; };
  }, [canManage, permissionScopes, permissionsLoading, schoolId, schoolWidePermissions, taskAssistantSchoolContext?.sources?.classes]);

  const greeting = useMemo(() => {
    const firstName = (userData?.fullName || '').trim().split(/\s+/u)[0];
    return firstName ? `היי ${firstName}, איך אפשר לעזור?` : 'היי, איך אפשר לעזור?';
  }, [userData?.fullName]);

  function finishConversation({ minimize = false } = {}) {
    conversationGeneration.current++;
    setQuestion('');
    setMessages([]);
    setPendingTask(null);
    setTaskActionResult(null);
    if (conversationKey) localStorage.removeItem(conversationKey);
    if (schoolId) syncPersonalAgentConversation({ schoolId, operation: 'end' }).catch(() => undefined);
    if (minimize) onMinimize();
  }

  function startTaskWorkflow(request, target = {}) {
    const workflowId = `task_${Date.now()}`;
    setMessages(previous => [...previous, {
      id: `zoki_task_${workflowId}`,
      role: 'zoki',
      text: 'עברתי לעמוד המשימות. אני טוען את ההקשר ומכין שם טיוטה לעריכה — השיחה נשארת כאן.',
      actionStatus: 'loading_context',
    }]);
    navigate('/tasks', { state: { zokiTaskWorkflow: {
      workflowId,
      request,
      targetType: target.type || 'none',
      targetLabel: target.label || '',
      startedAt: Date.now(),
    } } });
  }

  function continueTaskWorkflow(message, assignRole = false) {
    const staffId = message.actionProposal?.selectedStaffId;
    if (!staffId) return;
    sendZokiTaskWorkflowCommand({
      workflowId: message.actionProposal.workflowId,
      schoolId,
      action: 'select_assignee',
      staffId,
      assignRole,
    });
    patchMessage(message.id, { actionStatus: 'executing' });
  }

  async function submitQuestion(text = question) {
    const submittedConversation = conversationKey;
    const submittedGeneration = conversationGeneration.current;
    const nextQuestion = text.trim();
    if (!nextQuestion || loading || !schoolId) return;
    if (END_CONVERSATION_REQUEST.test(nextQuestion)) {
      finishConversation();
      return;
    }
    setQuestion('');
    setMessages(previous => [...previous, { id: `user_${Date.now()}`, role: 'user', text: nextQuestion }]);
    setLoading(true);
    let routedTask = false;
    try {
      if (TASK_CREATION_REQUEST.test(nextQuestion)) {
        routedTask = true;
        startTaskWorkflow(nextQuestion, taskTargetHint(nextQuestion));
        return;
      }
      let result;
      let degraded = false;
      if (isZokiAgentConfigured) {
        try {
          result = await zokiRequest('turn', schoolId, {
            question: nextQuestion,
            history: messages.filter(item => !item.error).slice(-8).map(item => ({ role: item.role === 'zoki' ? 'assistant' : 'user', text: item.text })),
            sourcePaths: zokiSourcePaths({ schoolId, uid: currentUser.uid, question: nextQuestion, sources: { ...taskAssistantSchoolContext.sources, students: accessibleStudents } }),
          });
        } catch (error) {
          if (['resource-exhausted', 'permission-denied', 'unauthenticated', 'invalid-app-check'].includes(error.code)) throw error;
          degraded = true;
        }
      }
      if (result?.actionIntent === 'create_task') {
        routedTask = true;
        startTaskWorkflow(result.actionRequest || nextQuestion, {
          type: result.actionTargetType,
          label: result.actionTargetLabel,
        });
        return;
      }
      result ||= await answerZokiOnSpark({
        question: nextQuestion,
        data: {
          ...(taskAssistantSchoolContext?.sources || {}),
          students: accessibleStudents,
          tracks: accessibleTracks,
          contacts: accessibleContacts,
          files: accessibleFiles,
          brainEntries: canManage ? brain.entries : [],
          brainInstructions: canManage ? brain.instructions : '',
        },
        canViewSensitive: canManage,
        loadStudentDetails: (student, detailQuestion) => loadAuthorizedStudentDetails({
          db, schoolId, student, question: detailQuestion,
        }),
      });
      if (activeConversation.current !== submittedConversation || conversationGeneration.current !== submittedGeneration) return;
      setMessages(previous => [...previous, {
        id: `zoki_${Date.now()}`, role: 'zoki', text: result.answer + (degraded ? '\n\nהשירות החכם אינו זמין כרגע; זו תשובה מהמידע המקומי.' : '') + (result.memoryStatus === 'saved' ? '\n\nנשמר עדכון בזיכרון האישי. אפשר לערוך או למחוק אותו ב״הזיכרון שלי״.' : result.memoryStatus === 'failed' ? '\n\nעדכון הזיכרון לא נשמר; התשובה זמינה.' : ''),
        sources: result.sources || [], followUpQuestion: '', actionProposal: null,
      }]);
    } catch (error) {
      if (activeConversation.current !== submittedConversation || conversationGeneration.current !== submittedGeneration) return;
      const isTaskError = routedTask || TASK_CREATION_REQUEST.test(nextQuestion);
      setMessages(previous => [...previous, { id: `error_${Date.now()}`, role: 'zoki', error: true, text: error.code === 'resource-exhausted' ? `הגעת למגבלת השאלות האישית או המשותפת. אפשר לנסות שוב בעוד ${error.retryAfter || 60} שניות.` : isTaskError ? taskAssistantErrorMessage(error) : errorMessage(error) }]);
    } finally {
      setLoading(false);
    }
  }

  function patchMessage(messageId, patch) {
    setMessages(previous => previous.map(item => item.id === messageId ? { ...item, ...patch } : item));
  }

  async function confirmTaskStatusAction(message) {
    const action = message.actionProposal;
    if (!action || message.actionStatus === 'executing' || message.actionStatus === 'executed') return;
    patchMessage(message.id, { actionStatus: 'executing', actionError: '' });
    try {
      const result = await executeZokiTaskStatus({
        schoolId, requestId: action.requestId, confirm: true,
        taskId: action.taskId, storageMode: action.storageMode,
        status: action.status, expectedStatus: action.expectedStatus,
      });
      patchMessage(message.id, { actionStatus: 'executed', actionResult: result, actionError: '' });
    } catch (error) {
      const reason = callableReason(error);
      const messagesByReason = {
        'permission-denied': 'אין לך הרשאה לשנות את מצב המשימה הזאת.',
        'task-status-changed': 'מצב המשימה השתנה מאז ההצעה. בקשו מזוקי לבדוק מחדש.',
        'task-status-already-applied': 'המשימה כבר נמצאת במצב המבוקש.',
      };
      patchMessage(message.id, { actionStatus: 'failed', actionError: messagesByReason[reason] || 'עדכון המשימה לא הושלם.' });
    }
  }

  async function confirmTaskAssignmentAction(message) {
    const action = message.actionProposal;
    if (!action || message.actionStatus === 'executing' || message.actionStatus === 'executed') return;
    patchMessage(message.id, { actionStatus: 'executing', actionError: '' });
    try {
      const result = await executeZokiTaskAssignment({
        schoolId, requestId: action.requestId, confirm: true,
        taskId: action.taskId, storageMode: action.storageMode,
        userId: action.userId, action: action.operation,
        expectedCurrentlyAssigned: action.expectedCurrentlyAssigned,
        expectedAssigneeIds: action.expectedAssigneeIds,
      });
      patchMessage(message.id, { actionStatus: 'executed', actionResult: result, actionError: '' });
    } catch (error) {
      const reason = callableReason(error);
      const messagesByReason = {
        'permission-denied': 'אין לך הרשאה לשנות את האחראים במשימה הזאת.',
        'task-assignees-changed': 'אחראי המשימה השתנו מאז ההצעה. בקשו מזוקי לבדוק מחדש.',
        'task-assignment-already-applied': 'שיוך המשימה כבר נמצא במצב המבוקש.',
      };
      patchMessage(message.id, { actionStatus: 'failed', actionError: messagesByReason[reason] || 'שינוי אחראי המשימה לא הושלם.' });
    }
  }

  async function confirmTaskDetailsAction(message) {
    const action = message.actionProposal;
    if (!action || message.actionStatus === 'executing' || message.actionStatus === 'executed') return;
    patchMessage(message.id, { actionStatus: 'executing', actionError: '' });
    try {
      const result = await executeZokiTaskDetails({
        schoolId, requestId: action.requestId, confirm: true,
        taskId: action.taskId, storageMode: action.storageMode,
        expected: action.expected, task: action.task,
      });
      patchMessage(message.id, { actionStatus: 'executed', actionResult: result, actionError: '' });
    } catch (error) {
      const reason = callableReason(error);
      const messagesByReason = {
        'permission-denied': 'אין לך הרשאה לערוך את פרטי המשימה הזאת.',
        'task-details-changed': 'פרטי המשימה השתנו מאז ההצעה. בקשו מזוקי לבדוק מחדש.',
        'task-details-already-applied': 'פרטי המשימה כבר נמצאים במצב המבוקש.',
      };
      patchMessage(message.id, { actionStatus: 'failed', actionError: messagesByReason[reason] || 'עריכת המשימה לא הושלמה.' });
    }
  }

  async function confirmGradeAction(message) {
    const action = message.actionProposal;
    if (!action || message.actionStatus === 'executing' || message.actionStatus === 'executed') return;
    patchMessage(message.id, { actionStatus: 'executing', actionError: '' });
    try {
      const result = await executeZokiGrade({
        schoolId, requestId: action.requestId, confirm: true,
        gradebookId: action.gradebookId, studentId: action.studentId,
        subjectId: action.subjectId, componentId: action.componentId,
        score: action.score, expectedPreviousScore: action.previousScore,
      });
      patchMessage(message.id, { actionStatus: 'executed', actionResult: result, actionError: '' });
    } catch (error) {
      const reason = callableReason(error);
      const messagesByReason = {
        'permission-denied': 'אין לך הרשאה להזין את הציון הזה.',
        'grade-changed': 'הציון השתנה מאז ההצעה. בקשו מזוקי לבדוק את הערך העדכני לפני אישור נוסף.',
        'grade-component-changed': 'מבנה המקצוע או הרכיב השתנה. יש לבקש מזוקי הצעה חדשה.',
        'grade-formula-invalid': 'לא ניתן לחשב את הציון לפי הנוסחה הנוכחית.',
      };
      patchMessage(message.id, { actionStatus: 'failed', actionError: messagesByReason[reason] || 'עדכון הציון לא הושלם.' });
    }
  }

  async function confirmStudentTransferAction(message) {
    const action = message.actionProposal;
    if (!action || message.actionStatus === 'executing' || message.actionStatus === 'executed') return;
    patchMessage(message.id, { actionStatus: 'executing', actionError: '' });
    try {
      const result = await executeZokiStudentTransfer({
        schoolId, requestId: action.requestId, confirm: true,
        studentId: action.studentId, targetClassId: action.targetClassId,
        expectedCurrentClassId: action.expectedCurrentClassId,
        effectiveDate: action.effectiveDate, reason: action.reason || '',
      });
      patchMessage(message.id, { actionStatus: 'executed', actionResult: result, actionError: '' });
    } catch (error) {
      const reason = callableReason(error);
      const messagesByReason = {
        'permission-denied': 'אין לך הרשאה להעביר את התלמיד בין הכיתות שנבחרו.',
        'student-class-changed': 'שיוך התלמיד השתנה מאז ההצעה. בקשו מזוקי לבדוק מחדש.',
        'cross-year-transfer': 'העברה דרך זוקי אפשרית רק בין כיתות באותה שנת לימודים.',
      };
      patchMessage(message.id, { actionStatus: 'failed', actionError: messagesByReason[reason] || 'העברת התלמיד לא הושלמה.' });
    }
  }

  async function confirmRoleAssignmentAction(message) {
    const action = message.actionProposal;
    if (!action || message.actionStatus === 'executing' || message.actionStatus === 'executed') return;
    patchMessage(message.id, { actionStatus: 'executing', actionError: '' });
    try {
      const result = await executeZokiRoleAssignment({
        schoolId, requestId: action.requestId, confirm: true,
        userId: action.userId, roleId: action.roleId, action: action.operation,
        expectedCurrentlyAssigned: action.expectedCurrentlyAssigned,
      });
      patchMessage(message.id, { actionStatus: 'executed', actionResult: result, actionError: '' });
    } catch (error) {
      const reason = callableReason(error);
      const messagesByReason = {
        'permission-denied': 'אין לך סמכות להקצות את התפקיד הזה לאיש הצוות שנבחר.',
        'staff-role-changed': 'שיוך התפקיד השתנה מאז ההצעה. בקשו מזוקי לבדוק מחדש.',
        'staff-role-already-applied': 'התפקיד כבר נמצא במצב המבוקש.',
      };
      patchMessage(message.id, { actionStatus: 'failed', actionError: messagesByReason[reason] || 'שינוי התפקיד לא הושלם.' });
    }
  }

  async function confirmDirectPermissionAction(message) {
    const action = message.actionProposal;
    if (!action || message.actionStatus === 'executing' || message.actionStatus === 'executed') return;
    patchMessage(message.id, { actionStatus: 'executing', actionError: '' });
    try {
      const result = await executeZokiDirectPermission({
        schoolId, requestId: action.requestId, confirm: true,
        userId: action.userId, permissionKey: action.permissionKey, action: action.operation,
        expectedCurrentlyEnabled: action.expectedCurrentlyEnabled,
      });
      patchMessage(message.id, { actionStatus: 'executed', actionResult: result, actionError: '' });
    } catch (error) {
      const reason = callableReason(error);
      const messagesByReason = {
        'permission-denied': 'אין לך סמכות לשנות את ההרשאה הזאת עבור איש הצוות שנבחר.',
        'staff-permission-changed': 'הרשאות איש הצוות השתנו מאז ההצעה. בקשו מזוקי לבדוק מחדש.',
        'staff-permission-already-applied': 'ההרשאה כבר נמצאת במצב המבוקש.',
      };
      patchMessage(message.id, { actionStatus: 'failed', actionError: messagesByReason[reason] || 'שינוי ההרשאה לא הושלם.' });
    }
  }

  async function confirmResourceAccessAction(message) {
    const action = message.actionProposal;
    if (!action || message.actionStatus === 'executing' || message.actionStatus === 'executed') return;
    patchMessage(message.id, { actionStatus: 'executing', actionError: '' });
    try {
      const result = await executeZokiResourceAccess({
        schoolId, requestId: action.requestId, confirm: true,
        userId: action.userId, resourceType: action.resourceType, resourceId: action.resourceId,
        action: action.operation, accessLevel: action.accessLevel,
        expectedDirectState: action.expectedDirectState,
      });
      patchMessage(message.id, { actionStatus: 'executed', actionResult: result, actionError: '' });
    } catch (error) {
      const reason = callableReason(error);
      const messagesByReason = {
        'permission-denied': 'אין לך סמכות לשנות את הגישה למשאב הזה.',
        'resource-access-changed': 'הרשאות הקובץ או התיקייה השתנו מאז ההצעה. בקשו מזוקי לבדוק מחדש.',
        'resource-access-already-applied': 'כלל הגישה כבר נמצא במצב המבוקש.',
      };
      patchMessage(message.id, { actionStatus: 'failed', actionError: messagesByReason[reason] || 'שינוי הגישה למשאב לא הושלם.' });
    }
  }

  async function confirmResourceRenameAction(message) {
    const action = message.actionProposal;
    if (!action || message.actionStatus === 'executing' || message.actionStatus === 'executed') return;
    patchMessage(message.id, { actionStatus: 'executing', actionError: '' });
    try {
      const result = await executeZokiResourceRename({
        schoolId, requestId: action.requestId, confirm: true,
        resourceType: action.resourceType, resourceId: action.resourceId,
        expectedName: action.currentName, newName: action.newName,
      });
      patchMessage(message.id, { actionStatus: 'executed', actionResult: result, actionError: '' });
    } catch (error) {
      const reason = callableReason(error);
      const messagesByReason = {
        'permission-denied': 'אין לך הרשאה לשנות את שם הפריט הזה.',
        'resource-changed': 'הפריט השתנה מאז ההצעה. בקשו מזוקי לבדוק מחדש.',
      };
      patchMessage(message.id, { actionStatus: 'failed', actionError: messagesByReason[reason] || 'שינוי השם לא הושלם.' });
    }
  }

  async function confirmResourceCreateAction(message) {
    const action = message.actionProposal;
    if (!action || message.actionStatus === 'executing' || message.actionStatus === 'executed') return;
    patchMessage(message.id, { actionStatus: 'executing', actionError: '' });
    try {
      const result = await executeZokiResourceCreate({
        schoolId, requestId: action.requestId, confirm: true,
        kind: action.kind, name: action.name, folderId: action.folderId, visibility: action.visibility,
      });
      patchMessage(message.id, { actionStatus: 'executed', actionResult: result, actionError: '' });
    } catch (error) {
      const reason = callableReason(error);
      const messagesByReason = {
        'permission-denied': 'אין לך הרשאה ליצור את הפריט במיקום הזה.',
        'resource-name-exists': 'כבר קיים פריט פעיל בשם הזה במיקום שנבחר.',
        'resource-folder-changed': 'תיקיית היעד השתנתה. בקשו מזוקי לבדוק מחדש.',
      };
      patchMessage(message.id, { actionStatus: 'failed', actionError: messagesByReason[reason] || 'יצירת הפריט לא הושלמה.' });
    }
  }

  async function confirmResourceTrashAction(message) {
    const action = message.actionProposal;
    if (!action || message.actionStatus === 'executing' || message.actionStatus === 'executed') return;
    patchMessage(message.id, { actionStatus: 'executing', actionError: '' });
    try {
      const result = await fileTrashAction({
        schoolId, resourceType: action.resourceType, resourceId: action.resourceId, action: 'trash',
        source: 'zoki', requestId: action.requestId, expectedName: action.resourceName,
      });
      patchMessage(message.id, { actionStatus: 'executed', actionResult: result, actionError: '' });
    } catch (error) {
      const reason = callableReason(error);
      const messagesByReason = {
        'permission-denied': 'אין לך הרשאה להעביר את הפריט הזה לסל המחזור.',
        'resource-changed': 'הפריט השתנה מאז ההצעה. בקשו מזוקי לבדוק מחדש.',
      };
      patchMessage(message.id, { actionStatus: 'failed', actionError: messagesByReason[reason] || 'העברת הפריט לסל המחזור לא הושלמה.' });
    }
  }

  async function confirmResourceRestoreAction(message) {
    const action = message.actionProposal;
    if (!action || message.actionStatus === 'executing' || message.actionStatus === 'executed') return;
    patchMessage(message.id, { actionStatus: 'executing', actionError: '' });
    try {
      const result = await fileTrashAction({
        schoolId, resourceType: action.resourceType, resourceId: action.resourceId, action: 'restore',
        source: 'zoki', requestId: action.requestId, expectedName: action.resourceName,
      });
      patchMessage(message.id, { actionStatus: 'executed', actionResult: result, actionError: '' });
    } catch (error) {
      const reason = callableReason(error);
      const messagesByReason = {
        'permission-denied': 'אין לך הרשאה לשחזר את הפריט הזה.',
        'resource-changed': 'מצב הפריט השתנה מאז ההצעה. בקשו מזוקי לבדוק מחדש.',
      };
      patchMessage(message.id, { actionStatus: 'failed', actionError: messagesByReason[reason] || 'שחזור הפריט לא הושלם.' });
    }
  }

  async function confirmResourceMoveAction(message) {
    const action = message.actionProposal;
    if (!action || message.actionStatus === 'executing' || message.actionStatus === 'executed') return;
    patchMessage(message.id, { actionStatus: 'executing', actionError: '' });
    try {
      const result = await executeZokiResourceMove({
        schoolId, requestId: action.requestId, confirm: true,
        fileId: action.fileId, expectedName: action.fileName,
        expectedFolderId: action.expectedFolderId, targetFolderId: action.targetFolderId,
      });
      patchMessage(message.id, { actionStatus: 'executed', actionResult: result, actionError: '' });
    } catch (error) {
      const reason = callableReason(error);
      const messagesByReason = {
        'permission-denied': 'אין לך הרשאה להעביר את הקובץ למיקום הזה.',
        'resource-changed': 'הקובץ השתנה מאז ההצעה. בקשו מזוקי לבדוק מחדש.',
        'resource-folder-changed': 'תיקיית היעד השתנתה. בקשו מזוקי לבדוק מחדש.',
        'resource-name-exists': 'כבר קיים קובץ פעיל בשם הזה בתיקיית היעד.',
      };
      patchMessage(message.id, { actionStatus: 'failed', actionError: messagesByReason[reason] || 'העברת הקובץ לא הושלמה.' });
    }
  }

  async function confirmStudentTrackAction(message) {
    const action = message.actionProposal;
    if (!action || message.actionStatus === 'executing' || message.actionStatus === 'executed') return;
    patchMessage(message.id, { actionStatus: 'executing', actionError: '' });
    try {
      const result = await executeZokiStudentTrack({
        schoolId, requestId: action.requestId, confirm: true,
        studentId: action.studentId, trackId: action.trackId, action: action.operation,
        expectedCurrentlyAssigned: action.expectedCurrentlyAssigned,
      });
      patchMessage(message.id, { actionStatus: 'executed', actionResult: result, actionError: '' });
    } catch (error) {
      const reason = callableReason(error);
      const messagesByReason = {
        'permission-denied': 'אין לך הרשאה לשנות את מגמות התלמיד הזה.',
        'student-tracks-changed': 'מגמות התלמיד השתנו מאז ההצעה. בקשו מזוקי לבדוק מחדש.',
        'student-track-already-applied': 'המגמה כבר נמצאת במצב המבוקש.',
      };
      patchMessage(message.id, { actionStatus: 'failed', actionError: messagesByReason[reason] || 'שינוי המגמה לא הושלם.' });
    }
  }

  async function confirmAttendanceAction(message) {
    const action = message.actionProposal;
    if (!action || message.actionStatus === 'executing' || message.actionStatus === 'executed') return;
    patchMessage(message.id, { actionStatus: 'executing', actionError: '' });
    try {
      const result = await executeZokiAttendance({
        schoolId, requestId: action.requestId, confirm: true,
        fileId: action.fileId, studentId: action.studentId, dateKey: action.dateKey,
        statusId: action.statusId, expectedPreviousStatusId: action.expectedPreviousStatusId,
      });
      patchMessage(message.id, { actionStatus: 'executed', actionResult: result, actionError: '' });
    } catch (error) {
      const reason = callableReason(error);
      const messagesByReason = {
        'permission-denied': 'אין לך הרשאה לעדכן את הנוכחות של התלמיד הזה.',
        'attendance-changed': 'הנוכחות השתנתה מאז ההצעה. בקשו מזוקי לבדוק מחדש.',
        'attendance-already-applied': 'סטטוס הנוכחות כבר נמצא במצב המבוקש.',
      };
      patchMessage(message.id, { actionStatus: 'failed', actionError: messagesByReason[reason] || 'עדכון הנוכחות לא הושלם.' });
    }
  }

  async function confirmStudentNoteAction(message) {
    const action = message.actionProposal;
    if (!action || message.actionStatus === 'executing' || message.actionStatus === 'executed') return;
    patchMessage(message.id, { actionStatus: 'executing', actionError: '' });
    try {
      const result = await executeZokiStudentNote({
        schoolId, requestId: action.requestId, confirm: true,
        studentId: action.studentId, expectedClassId: action.expectedClassId,
        content: action.content, type: action.noteType, visibility: action.visibility,
      });
      patchMessage(message.id, { actionStatus: 'executed', actionResult: result, actionError: '' });
    } catch (error) {
      const reason = callableReason(error);
      const messagesByReason = {
        'permission-denied': 'אין לך הרשאה להוסיף הערה לתלמיד הזה.',
        'student-class-changed': 'שיוך התלמיד השתנה מאז ההצעה. בקשו מזוקי לבדוק מחדש.',
      };
      patchMessage(message.id, { actionStatus: 'failed', actionError: messagesByReason[reason] || 'שמירת ההערה לא הושלמה.' });
    }
  }

  async function confirmCalendarEventAction(message) {
    const action = message.actionProposal;
    if (!action || message.actionStatus === 'executing' || message.actionStatus === 'executed') return;
    patchMessage(message.id, { actionStatus: 'executing', actionError: '' });
    try {
      const result = await executeZokiCalendarEvent({
        schoolId, requestId: action.requestId, confirm: true,
        title: action.title, description: action.description, date: action.date, time: action.time,
        category: action.category, color: action.color, visibleTo: action.visibleTo, editableBy: action.editableBy,
      });
      patchMessage(message.id, { actionStatus: 'executed', actionResult: result, actionError: '' });
    } catch (error) {
      const reason = callableReason(error);
      const messagesByReason = {
        'permission-denied': 'אין לך הרשאה ליצור את האירוע הזה.',
        'invalid-calendar-date': 'תאריך האירוע אינו תקין.',
        'calendar-category-changed': 'קטגוריית האירוע השתנתה. בקשו מזוקי הצעה חדשה.',
        'calendar-team-changed': 'אחד הצוותים שנבחרו אינו זמין עוד. בקשו מזוקי לבדוק מחדש.',
      };
      patchMessage(message.id, { actionStatus: 'failed', actionError: messagesByReason[reason] || 'יצירת האירוע לא הושלמה.' });
    }
  }

  async function confirmCalendarEventUpdateAction(message) {
    const action = message.actionProposal;
    if (!action || message.actionStatus === 'executing' || message.actionStatus === 'executed') return;
    patchMessage(message.id, { actionStatus: 'executing', actionError: '' });
    try {
      const result = await executeZokiCalendarEventUpdate({
        schoolId, requestId: action.requestId, confirm: true,
        eventId: action.eventId, expectedVersion: action.expectedVersion,
        title: action.title, description: action.description, date: action.date, time: action.time,
        category: action.category, color: action.color, visibleTo: action.visibleTo, editableBy: action.editableBy,
      });
      patchMessage(message.id, { actionStatus: 'executed', actionResult: result, actionError: '' });
    } catch (error) {
      const reason = callableReason(error);
      const messagesByReason = {
        'permission-denied': 'אין לך הרשאה לשנות את האירוע הזה.',
        'calendar-event-changed': 'האירוע השתנה מאז ההצעה. בקשו מזוקי לבדוק מחדש.',
        'invalid-calendar-date': 'תאריך האירוע אינו תקין.',
        'calendar-category-changed': 'קטגוריית האירוע השתנתה. בקשו מזוקי הצעה חדשה.',
        'calendar-team-changed': 'אחד הצוותים שנבחרו אינו זמין עוד. בקשו מזוקי לבדוק מחדש.',
      };
      patchMessage(message.id, { actionStatus: 'failed', actionError: messagesByReason[reason] || 'עדכון האירוע לא הושלם.' });
    }
  }

  async function confirmCalendarEventCancelAction(message) {
    const action = message.actionProposal;
    if (!action || message.actionStatus === 'executing' || message.actionStatus === 'executed') return;
    patchMessage(message.id, { actionStatus: 'executing', actionError: '' });
    try {
      const result = await executeZokiCalendarEventCancel({
        schoolId, requestId: action.requestId, confirm: true,
        eventId: action.eventId, expectedVersion: action.expectedVersion,
      });
      patchMessage(message.id, { actionStatus: 'executed', actionResult: result, actionError: '' });
    } catch (error) {
      const reason = callableReason(error);
      const messagesByReason = {
        'permission-denied': 'אין לך הרשאה לבטל את האירוע הזה.',
        'calendar-event-changed': 'האירוע השתנה מאז ההצעה. בקשו מזוקי לבדוק מחדש.',
      };
      patchMessage(message.id, { actionStatus: 'failed', actionError: messagesByReason[reason] || 'ביטול האירוע לא הושלם.' });
    }
  }

  async function confirmContactAction(message) {
    const action = message.actionProposal;
    if (!action || message.actionStatus === 'executing' || message.actionStatus === 'executed') return;
    patchMessage(message.id, { actionStatus: 'executing', actionError: '' });
    try {
      const result = await executeZokiContact({
        schoolId, requestId: action.requestId, confirm: true,
        scope: action.scope, fullName: action.fullName, organization: action.organization,
        jobTitle: action.jobTitle, primaryEmail: action.primaryEmail,
        additionalEmails: action.additionalEmails, phone: action.phone, category: action.category,
        tags: action.tags, notes: action.notes, visibility: action.visibility,
        ownerStaffIds: action.ownerStaffIds,
      });
      patchMessage(message.id, { actionStatus: 'executed', actionResult: result, actionError: '' });
    } catch (error) {
      const reason = callableReason(error);
      const messagesByReason = {
        'permission-denied': 'אין לך הרשאה ליצור איש קשר מוסדי.',
        'invalid-contact-email': 'כתובת הדוא״ל אינה תקינה.',
        'duplicate-contact': 'כבר קיים איש קשר פעיל עם אחת מכתובות הדוא״ל האלה.',
        'contact-staff-changed': 'אחד מאנשי הצוות האחראים אינו זמין עוד. בקשו מזוקי הצעה חדשה.',
      };
      patchMessage(message.id, { actionStatus: 'failed', actionError: messagesByReason[reason] || 'יצירת איש הקשר לא הושלמה.' });
    }
  }

  async function confirmTeamMembershipAction(message) {
    const action = message.actionProposal;
    if (!action || message.actionStatus === 'executing' || message.actionStatus === 'executed') return;
    patchMessage(message.id, { actionStatus: 'executing', actionError: '' });
    try {
      const result = await executeZokiTeamMembership({
        schoolId, requestId: action.requestId, confirm: true,
        userId: action.userId, teamId: action.teamId, action: action.operation,
        expectedCurrentlyMember: action.expectedCurrentlyMember,
      });
      patchMessage(message.id, { actionStatus: 'executed', actionResult: result, actionError: '' });
    } catch (error) {
      const reason = callableReason(error);
      const messagesByReason = {
        'permission-denied': 'אין לך הרשאה לשנות את הרכב הצוות הזה.',
        'team-membership-changed': 'הרכב הצוות השתנה מאז ההצעה. בקשו מזוקי לבדוק מחדש.',
        'team-membership-already-applied': 'איש הצוות כבר נמצא במצב המבוקש.',
      };
      patchMessage(message.id, { actionStatus: 'failed', actionError: messagesByReason[reason] || 'שינוי הרכב הצוות לא הושלם.' });
    }
  }

  async function confirmTeamCreateAction(message) {
    const action = message.actionProposal;
    if (!action || message.actionStatus === 'executing' || message.actionStatus === 'executed') return;
    patchMessage(message.id, { actionStatus: 'executing', actionError: '' });
    try {
      const result = await executeZokiTeamCreate({
        schoolId, requestId: action.requestId, confirm: true,
        name: action.name, description: action.description,
        responsibilityAreas: action.responsibilityAreas, keywords: action.keywords,
        aliases: action.aliases, supportingRoles: action.supportingRoles,
        typicalTaskTypes: action.typicalTaskTypes, memberIds: action.memberIds,
      });
      patchMessage(message.id, { actionStatus: 'executed', actionResult: result, actionError: '' });
    } catch (error) {
      const reason = callableReason(error);
      const messagesByReason = {
        'permission-denied': 'אין לך הרשאה ליצור צוות חדש.',
        'team-name-exists': 'כבר קיים צוות פעיל בשם הזה.',
        'team-staff-changed': 'אחד מחברי הצוות שנבחרו אינו זמין עוד. בקשו מזוקי הצעה חדשה.',
      };
      patchMessage(message.id, { actionStatus: 'failed', actionError: messagesByReason[reason] || 'יצירת הצוות לא הושלמה.' });
    }
  }

  async function confirmTeamManagerAction(message) {
    const action = message.actionProposal;
    if (!action || message.actionStatus === 'executing' || message.actionStatus === 'executed') return;
    patchMessage(message.id, { actionStatus: 'executing', actionError: '' });
    try {
      const result = await executeZokiTeamManager({
        schoolId, requestId: action.requestId, confirm: true,
        userId: action.userId, teamId: action.teamId, action: action.operation,
        expectedCurrentlyManager: action.expectedCurrentlyManager,
      });
      patchMessage(message.id, { actionStatus: 'executed', actionResult: result, actionError: '' });
    } catch (error) {
      const reason = callableReason(error);
      const messagesByReason = {
        'permission-denied': 'אין לך הרשאה לשנות את מנהלי הצוות הזה.',
        'team-manager-not-member': 'ניתן למנות למנהל רק חבר קיים בצוות.',
        'team-managers-changed': 'רשימת מנהלי הצוות השתנתה מאז ההצעה. בקשו מזוקי לבדוק מחדש.',
        'team-manager-already-applied': 'מנהל הצוות כבר נמצא במצב המבוקש.',
        'team-last-manager': 'לא ניתן להסיר את המנהל האחרון של הצוות.',
      };
      patchMessage(message.id, { actionStatus: 'failed', actionError: messagesByReason[reason] || 'שינוי מנהלי הצוות לא הושלם.' });
    }
  }

  function updateEntry(index, field, value) {
    setBrainDraft(previous => ({ ...previous, entries: previous.entries.map((entry, itemIndex) => itemIndex === index ? { ...entry, [field]: value } : entry) }));
  }

  function toggleAudienceEntry(index, field, id) {
    const current = brainDraft.entries[index]?.audience?.[field] || [];
    const next = current.includes(id) ? current.filter(item => item !== id) : [...current, id];
    updateEntry(index, 'audience', { ...brainDraft.entries[index].audience, [field]: next });
  }

  async function persistBrain() {
    setSavingBrain(true);
    setBrainMessage('');
    try {
      const entries = await saveZokiBrain({ db, schoolId, actorId: currentUser.uid, instructions: brainDraft.instructions, entries: brainDraft.entries });
      setBrainDraft(previous => ({ ...previous, entries }));
      setBrainMessage('ההגדרות נשמרו. מידע שפורסם זמין מיד לצוות המורשה.');
    } catch {
      setBrainMessage('לא ניתן לשמור. בדקו שיש לך הרשאת מנהל מוסד.');
    } finally {
      setSavingBrain(false);
    }
  }

  function editTaskProposal() {
    if (!pendingTask) return;
    navigate('/tasks', { state: { zokiTaskDraft: { proposal: pendingTask.proposal, context: pendingTask.context } } });
  }

  async function confirmTaskCreation() {
    if (!pendingTask?.action || executingTask) return;
    setExecutingTask(true);
    setTaskActionResult(null);
    try {
      const result = await executeZokiTask({
        schoolId, requestId: pendingTask.requestId, confirm: true, task: pendingTask.action,
      });
      setTaskActionResult({ ok: true, ...result });
      setPendingTask(null);
    } catch (error) {
      const reason = callableReason(error);
      setTaskActionResult({
        ok: false,
        message: reason === 'permission-denied'
          ? 'אין לך הרשאה ליצור או להקצות את המשימה הזאת.'
          : 'יצירת המשימה לא הושלמה. אפשר לערוך את הפרטים ולנסות שוב.',
      });
    } finally {
      setExecutingTask(false);
    }
  }

  return <div className={embedded ? 'zoki-floating-layer' : 'page zoki-page'}>
    <div className={embedded ? 'zoki-window' : 'page-content zoki-shell'}>
      <header className="zoki-window-header">
        <div><img src={zokiAvatar} alt="" /><span><strong>{greeting}</strong><small>מידע ופעולות במקום אחד, לפי ההרשאות שלך</small></span></div>
        <nav aria-label="פעולות שיחה">
          {isZokiAgentConfigured && <button type="button" onClick={() => setPersonalOpen(true)}>הזיכרון שלי</button>}
          {canManage && <button type="button" onClick={() => setBrainOpen(true)} aria-label="הגדרות העוזר" title="הגדרות העוזר"><Settings2 size={18} /></button>}
          {messages.length > 0 && <button type="button" className="zoki-end-conversation" onClick={() => finishConversation()} title="סיום ומחיקת השיחה"><CircleStop size={17} /><span>סיום שיחה</span></button>}
          {embedded && <button type="button" className="zoki-minimize-button" onClick={onMinimize} aria-label="מזעור" title="מזעור"><Minus size={16} /></button>}
        </nav>
      </header>

      <section className="zoki-chat" aria-label="שיחה עם העוזר">
        {showHistoryJump && <button type="button" className="zoki-history-jump" onClick={scrollToLatestMessage}><ArrowDown size={14} /> להודעה האחרונה</button>}
        <div ref={messagesRef} className="zoki-messages" aria-live="polite" onScroll={event => { const element = event.currentTarget; setShowHistoryJump(element.scrollHeight - element.scrollTop - element.clientHeight > 100); }}>
          {messages.length > 0 && <div className="zoki-messages-spacer" aria-hidden="true" />}
          {messages.length === 0 && <div className="zoki-empty"><img src={zokiAvatar} alt="" /><h2>אפשר לשאול אותי על כל מה שנמצא במערכת</h2><p>אם המידע אינו בהרשאה שלך, לא אחשוף אם הוא קיים.</p><div>{STARTERS.map(starter => <button type="button" key={starter} onClick={() => submitQuestion(starter)}>{starter}</button>)}</div></div>}
          {messages.map(message => <article key={message.id} className={`zoki-message zoki-message--${message.role}${message.error ? ' is-error' : ''}`}>
            {message.role === 'zoki' && <img src={zokiAvatar} alt="" />}
            <div><p>{message.text}</p>{message.followUpQuestion && <button type="button" className="zoki-follow-up" onClick={() => setQuestion(message.followUpQuestion)}>{message.followUpQuestion}</button>}
              {message.actionProposal?.type === 'task_role_selection' && <section className="zoki-inline-action zoki-role-selection"><header><ShieldCheck size={14} /><strong>בחירת אחראי למשימה</strong></header><label>איש צוות<select value={message.actionProposal.selectedStaffId || ''} onChange={event => patchMessage(message.id, { actionProposal: { ...message.actionProposal, selectedStaffId: event.target.value } })}><option value="">בחרו איש צוות</option>{(message.actionProposal.options || []).map(option => <option key={option.id} value={option.id}>{option.name}{option.jobTitle ? ` — ${option.jobTitle}` : ''}</option>)}</select></label><footer><button type="button" disabled={!message.actionProposal.selectedStaffId || message.actionStatus === 'executing'} onClick={() => continueTaskWorkflow(message, false)}><CheckCircle2 size={14} /> למשימה הזו בלבד</button>{message.actionProposal.canAssignRole && <button type="button" disabled={!message.actionProposal.selectedStaffId || message.actionStatus === 'executing'} onClick={() => continueTaskWorkflow(message, true)}>שייך לתפקיד והמשך</button>}{message.actionProposal.roleMissing && <button type="button" onClick={() => navigate('/staff')}>פתיחת ניהול הסגל</button>}</footer></section>}
              {message.actionProposal?.type === 'task_details_update' && <section className={`zoki-inline-action ${message.actionStatus === 'executed' ? 'is-complete' : ''}`}><header><ShieldCheck size={14} /><strong>{message.actionStatus === 'executed' ? 'פרטי המשימה עודכנו' : 'אישור עריכת משימה'}</strong></header><div><b>{message.actionProposal.taskTitle}</b>{message.actionProposal.changedFields.map(field => <span key={field}>{TASK_DETAIL_LABELS[field]}: {taskDetailValue(field, message.actionProposal.expected[field])} ← {taskDetailValue(field, message.actionProposal.task[field])}</span>)}</div><small>רק השדות המוצגים ישתנו. זוקי יוודא שהמשימה לא נערכה מאז ההצעה.</small>{message.actionStatus !== 'executed' && message.actionStatus !== 'cancelled' && <footer><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => confirmTaskDetailsAction(message)}><CheckCircle2 size={14} /> {message.actionStatus === 'executing' ? 'מעדכן…' : 'אישור ועדכון'}</button><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => patchMessage(message.id, { actionStatus: 'cancelled' })}>ביטול</button></footer>}{message.actionStatus === 'cancelled' && <small>פרטי המשימה נשארו ללא שינוי.</small>}{message.actionError && <small className="is-error">{message.actionError}</small>}{message.actionStatus === 'executed' && <button type="button" className="zoki-action-link" onClick={() => navigate(message.actionResult.route)}>פתיחת המשימה</button>}</section>}
              {message.actionProposal?.type === 'task_assignment_change' && <section className={`zoki-inline-action ${message.actionStatus === 'executed' ? 'is-complete' : ''}`}><header><ShieldCheck size={14} /><strong>{message.actionStatus === 'executed' ? 'אחראי המשימה עודכנו' : 'אישור שינוי אחראי במשימה'}</strong></header><div><span>{message.actionProposal.operation === 'add' ? 'הוספת אחראי' : 'הסרת אחראי'}</span><span>{message.actionProposal.staffName}</span><b>{message.actionProposal.taskTitle}</b></div><small>זוקי יוודא מחדש את ההרשאה, איש הצוות ורשימת האחראים בזמן האישור.</small>{message.actionStatus !== 'executed' && message.actionStatus !== 'cancelled' && <footer><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => confirmTaskAssignmentAction(message)}><CheckCircle2 size={14} /> {message.actionStatus === 'executing' ? 'מעדכן…' : 'אישור ושינוי'}</button><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => patchMessage(message.id, { actionStatus: 'cancelled' })}>ביטול</button></footer>}{message.actionStatus === 'cancelled' && <small>אחראי המשימה נשארו ללא שינוי.</small>}{message.actionError && <small className="is-error">{message.actionError}</small>}{message.actionStatus === 'executed' && <button type="button" className="zoki-action-link" onClick={() => navigate(message.actionResult.route)}>פתיחת המשימה</button>}</section>}
              {message.actionProposal?.type === 'task_status_change' && <section className={`zoki-inline-action ${message.actionStatus === 'executed' ? 'is-complete' : ''}`}><header><ShieldCheck size={14} /><strong>{message.actionStatus === 'executed' ? 'מצב המשימה עודכן' : 'אישור שינוי מצב משימה'}</strong></header><div><span>מ־{TASK_STATUS_LABELS[message.actionProposal.expectedStatus] || 'לביצוע'}</span><span>אל {TASK_STATUS_LABELS[message.actionProposal.status] || message.actionProposal.status}</span><b>{message.actionProposal.taskTitle}</b></div><small>זוקי יוודא מחדש את ההקצאה, ההרשאה והמצב הנוכחי בזמן האישור.</small>{message.actionStatus !== 'executed' && message.actionStatus !== 'cancelled' && <footer><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => confirmTaskStatusAction(message)}><CheckCircle2 size={14} /> {message.actionStatus === 'executing' ? 'מעדכן…' : 'אישור ועדכון'}</button><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => patchMessage(message.id, { actionStatus: 'cancelled' })}>ביטול</button></footer>}{message.actionStatus === 'cancelled' && <small>המשימה נשארה ללא שינוי.</small>}{message.actionError && <small className="is-error">{message.actionError}</small>}{message.actionStatus === 'executed' && <button type="button" className="zoki-action-link" onClick={() => navigate(message.actionResult.route)}>פתיחת המשימה</button>}</section>}
              {message.actionProposal?.type === 'grade_update' && <section className={`zoki-inline-action ${message.actionStatus === 'executed' ? 'is-complete' : ''}`}><header><ShieldCheck size={14} /><strong>{message.actionStatus === 'executed' ? 'הציון עודכן' : 'אישור עדכון ציון'}</strong></header><div><span>{message.actionProposal.studentName}</span><span>{message.actionProposal.subjectName} · {message.actionProposal.componentName}</span><b>מ־{message.actionProposal.previousScore ?? 'ללא ציון'} ל־{message.actionProposal.score}</b></div>{message.actionStatus !== 'executed' && message.actionStatus !== 'cancelled' && <footer><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => confirmGradeAction(message)}><CheckCircle2 size={14} /> {message.actionStatus === 'executing' ? 'מעדכן…' : 'אישור ועדכון'}</button><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => patchMessage(message.id, { actionStatus: 'cancelled' })}>ביטול</button></footer>}{message.actionStatus === 'cancelled' && <small>הפעולה בוטלה ולא נשמר שינוי.</small>}{message.actionError && <small className="is-error">{message.actionError}</small>}{message.actionStatus === 'executed' && <button type="button" className="zoki-action-link" onClick={() => navigate(message.actionResult.route)}>פתיחת כרטיס התלמיד</button>}</section>}
              {message.actionProposal?.type === 'attendance_update' && <section className={`zoki-inline-action ${message.actionStatus === 'executed' ? 'is-complete' : ''}`}><header><ShieldCheck size={14} /><strong>{message.actionStatus === 'executed' ? 'הנוכחות עודכנה' : 'אישור עדכון נוכחות'}</strong></header><div><span>{message.actionProposal.studentName}</span><span>{message.actionProposal.sheetName} · {message.actionProposal.dateKey}</span><b>מ־{message.actionProposal.previousStatusLabel || 'ללא סימון'} ל־{message.actionProposal.statusLabel}</b></div><small>הערות ופעולות מעקב קיימות יישמרו ללא שינוי.</small>{message.actionStatus !== 'executed' && message.actionStatus !== 'cancelled' && <footer><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => confirmAttendanceAction(message)}><CheckCircle2 size={14} /> {message.actionStatus === 'executing' ? 'מעדכן…' : 'אישור ועדכון'}</button><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => patchMessage(message.id, { actionStatus: 'cancelled' })}>ביטול</button></footer>}{message.actionStatus === 'cancelled' && <small>הפעולה בוטלה ולא נשמר שינוי.</small>}{message.actionError && <small className="is-error">{message.actionError}</small>}{message.actionStatus === 'executed' && <button type="button" className="zoki-action-link" onClick={() => navigate(message.actionResult.route)}>פתיחת גיליון הנוכחות</button>}</section>}
              {message.actionProposal?.type === 'student_note_create' && <section className={`zoki-inline-action ${message.actionStatus === 'executed' ? 'is-complete' : ''}`}><header><ShieldCheck size={14} /><strong>{message.actionStatus === 'executed' ? 'ההערה נשמרה' : 'אישור הוספת הערה'}</strong></header><div><span>{message.actionProposal.studentName} · {message.actionProposal.className}</span><span>{NOTE_TYPE_LABELS[message.actionProposal.noteType] || 'כללית'} · {message.actionProposal.visibility === 'school_admin' ? 'מנהלים בלבד' : 'צוות הכיתה המורשה'}</span><b>{message.actionProposal.content}</b></div><small>תוכן ההערה יישמר בתיק התלמיד ויהיה גלוי רק לקהל המצוין.</small>{message.actionStatus !== 'executed' && message.actionStatus !== 'cancelled' && <footer><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => confirmStudentNoteAction(message)}><CheckCircle2 size={14} /> {message.actionStatus === 'executing' ? 'שומר…' : 'אישור ושמירה'}</button><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => patchMessage(message.id, { actionStatus: 'cancelled' })}>ביטול</button></footer>}{message.actionStatus === 'cancelled' && <small>הפעולה בוטלה ולא נשמר שינוי.</small>}{message.actionError && <small className="is-error">{message.actionError}</small>}{message.actionStatus === 'executed' && <button type="button" className="zoki-action-link" onClick={() => navigate(message.actionResult.route)}>פתיחת כרטיס התלמיד</button>}</section>}
              {message.actionProposal?.type === 'calendar_event_create' && <section className={`zoki-inline-action ${message.actionStatus === 'executed' ? 'is-complete' : ''}`}><header><ShieldCheck size={14} /><strong>{message.actionStatus === 'executed' ? 'האירוע נוצר' : 'אישור יצירת אירוע'}</strong></header><div><span>{message.actionProposal.date}{message.actionProposal.time ? ` · ${message.actionProposal.time}` : ''} · {message.actionProposal.category}</span><span>גלוי ל: {(message.actionProposal.visibleToLabels || []).join(', ') || 'כולם'}</span><b>{message.actionProposal.title}</b></div>{message.actionProposal.description && <small>{message.actionProposal.description}</small>}{message.actionProposal.editableByLabels?.length > 0 && <small>עריכה גם לצוותים: {message.actionProposal.editableByLabels.join(', ')}</small>}{message.actionStatus !== 'executed' && message.actionStatus !== 'cancelled' && <footer><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => confirmCalendarEventAction(message)}><CheckCircle2 size={14} /> {message.actionStatus === 'executing' ? 'יוצר…' : 'אישור ויצירה'}</button><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => patchMessage(message.id, { actionStatus: 'cancelled' })}>ביטול</button></footer>}{message.actionStatus === 'cancelled' && <small>הפעולה בוטלה ולא נשמר שינוי.</small>}{message.actionError && <small className="is-error">{message.actionError}</small>}{message.actionStatus === 'executed' && <button type="button" className="zoki-action-link" onClick={() => navigate(message.actionResult.route)}>פתיחת לוח השנה</button>}</section>}
              {message.actionProposal?.type === 'calendar_event_update' && <section className={`zoki-inline-action ${message.actionStatus === 'executed' ? 'is-complete' : ''}`}><header><ShieldCheck size={14} /><strong>{message.actionStatus === 'executed' ? 'האירוע עודכן' : 'אישור שינוי אירוע'}</strong></header><div><span>מ־{message.actionProposal.previousDate}{message.actionProposal.previousTime ? ` · ${message.actionProposal.previousTime}` : ''}</span><span>אל {message.actionProposal.date}{message.actionProposal.time ? ` · ${message.actionProposal.time}` : ''}</span><b>{message.actionProposal.title}</b></div>{message.actionProposal.description && <small>{message.actionProposal.description}</small>}{message.actionStatus !== 'executed' && message.actionStatus !== 'cancelled' && <footer><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => confirmCalendarEventUpdateAction(message)}><CheckCircle2 size={14} /> {message.actionStatus === 'executing' ? 'מעדכן…' : 'אישור ועדכון'}</button><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => patchMessage(message.id, { actionStatus: 'cancelled' })}>ביטול</button></footer>}{message.actionStatus === 'cancelled' && <small>הפעולה בוטלה ולא נשמר שינוי.</small>}{message.actionError && <small className="is-error">{message.actionError}</small>}{message.actionStatus === 'executed' && <button type="button" className="zoki-action-link" onClick={() => navigate(message.actionResult.route)}>פתיחת לוח השנה</button>}</section>}
              {message.actionProposal?.type === 'calendar_event_cancel' && <section className={`zoki-inline-action is-destructive ${message.actionStatus === 'executed' ? 'is-complete' : ''}`}><header><ShieldCheck size={14} /><strong>{message.actionStatus === 'executed' ? 'האירוע בוטל' : 'אישור ביטול אירוע'}</strong></header><div><span>{message.actionProposal.date}{message.actionProposal.time ? ` · ${message.actionProposal.time}` : ''}</span><b>{message.actionProposal.eventName}</b></div><small>האישור יסיר את האירוע מלוח השנה. זוקי יוודא שהאירוע לא השתנה לפני הביצוע.</small>{message.actionStatus !== 'executed' && message.actionStatus !== 'cancelled' && <footer><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => confirmCalendarEventCancelAction(message)}><CheckCircle2 size={14} /> {message.actionStatus === 'executing' ? 'מבטל…' : 'אישור וביטול האירוע'}</button><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => patchMessage(message.id, { actionStatus: 'cancelled' })}>השארת האירוע</button></footer>}{message.actionStatus === 'cancelled' && <small>האירוע נשאר ללא שינוי.</small>}{message.actionError && <small className="is-error">{message.actionError}</small>}{message.actionStatus === 'executed' && <button type="button" className="zoki-action-link" onClick={() => navigate(message.actionResult.route)}>פתיחת לוח השנה</button>}</section>}
              {message.actionProposal?.type === 'contact_create' && <section className={`zoki-inline-action ${message.actionStatus === 'executed' ? 'is-complete' : ''}`}><header><ShieldCheck size={14} /><strong>{message.actionStatus === 'executed' ? 'איש הקשר נוצר' : 'אישור יצירת איש קשר'}</strong></header><div><span>{message.actionProposal.scope === 'institutional' ? 'איש קשר מוסדי' : 'איש קשר פרטי'}</span><span dir="ltr">{message.actionProposal.primaryEmail}{message.actionProposal.phone ? ` · ${message.actionProposal.phone}` : ''}</span><b>{message.actionProposal.fullName}</b></div>{(message.actionProposal.organization || message.actionProposal.jobTitle || message.actionProposal.category) && <small>{[message.actionProposal.jobTitle, message.actionProposal.organization, message.actionProposal.category].filter(Boolean).join(' · ')}</small>}{message.actionProposal.ownerStaffLabels?.length > 0 && <small>אנשי צוות אחראים: {message.actionProposal.ownerStaffLabels.join(', ')}</small>}{message.actionProposal.scope === 'institutional' && <small>חשיפה: {message.actionProposal.visibility === 'responsible_staff' ? 'אחראים ומנהלים בלבד' : 'בעלי הרשאת צפייה מוסדית'}</small>}{message.actionStatus !== 'executed' && message.actionStatus !== 'cancelled' && <footer><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => confirmContactAction(message)}><CheckCircle2 size={14} /> {message.actionStatus === 'executing' ? 'יוצר…' : 'אישור ויצירה'}</button><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => patchMessage(message.id, { actionStatus: 'cancelled' })}>ביטול</button></footer>}{message.actionStatus === 'cancelled' && <small>הפעולה בוטלה ולא נשמר שינוי.</small>}{message.actionError && <small className="is-error">{message.actionError}</small>}{message.actionStatus === 'executed' && <button type="button" className="zoki-action-link" onClick={() => navigate(message.actionResult.route)}>פתיחת אנשי הקשר</button>}</section>}
              {message.actionProposal?.type === 'team_membership_change' && <section className={`zoki-inline-action ${message.actionStatus === 'executed' ? 'is-complete' : ''}`}><header><ShieldCheck size={14} /><strong>{message.actionStatus === 'executed' ? 'הרכב הצוות עודכן' : 'אישור שינוי הרכב צוות'}</strong></header><div><span>{message.actionProposal.operation === 'add' ? 'הוספה לצוות' : 'הסרה מהצוות'}</span><span>{message.actionProposal.teamName}</span><b>{message.actionProposal.staffName}</b></div><small>זוקי יוודא מחדש את ההרשאה ואת החברות הנוכחית ברגע האישור.</small>{message.actionStatus !== 'executed' && message.actionStatus !== 'cancelled' && <footer><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => confirmTeamMembershipAction(message)}><CheckCircle2 size={14} /> {message.actionStatus === 'executing' ? 'מעדכן…' : 'אישור ושינוי'}</button><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => patchMessage(message.id, { actionStatus: 'cancelled' })}>ביטול</button></footer>}{message.actionStatus === 'cancelled' && <small>הפעולה בוטלה ולא נשמר שינוי.</small>}{message.actionError && <small className="is-error">{message.actionError}</small>}{message.actionStatus === 'executed' && <button type="button" className="zoki-action-link" onClick={() => navigate(message.actionResult.route)}>פתיחת הצוותים</button>}</section>}
              {message.actionProposal?.type === 'team_create' && <section className={`zoki-inline-action ${message.actionStatus === 'executed' ? 'is-complete' : ''}`}><header><ShieldCheck size={14} /><strong>{message.actionStatus === 'executed' ? 'הצוות נוצר' : 'אישור יצירת צוות'}</strong></header><div><span>{message.actionProposal.description || 'ללא תיאור'}</span><span>{message.actionProposal.memberLabels?.length ? `חברים: ${message.actionProposal.memberLabels.join(', ')}` : 'ללא חברים התחלתיים'}</span><b>{message.actionProposal.name}</b></div>{message.actionProposal.responsibilityAreas?.length > 0 && <small>תחומי אחריות: {message.actionProposal.responsibilityAreas.join(', ')}</small>}{message.actionProposal.typicalTaskTypes?.length > 0 && <small>משימות שכיחות: {message.actionProposal.typicalTaskTypes.join(', ')}</small>}{message.actionStatus !== 'executed' && message.actionStatus !== 'cancelled' && <footer><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => confirmTeamCreateAction(message)}><CheckCircle2 size={14} /> {message.actionStatus === 'executing' ? 'יוצר…' : 'אישור ויצירה'}</button><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => patchMessage(message.id, { actionStatus: 'cancelled' })}>ביטול</button></footer>}{message.actionStatus === 'cancelled' && <small>הפעולה בוטלה ולא נשמר שינוי.</small>}{message.actionError && <small className="is-error">{message.actionError}</small>}{message.actionStatus === 'executed' && <button type="button" className="zoki-action-link" onClick={() => navigate(message.actionResult.route)}>פתיחת הצוותים</button>}</section>}
              {message.actionProposal?.type === 'team_manager_change' && <section className={`zoki-inline-action ${message.actionStatus === 'executed' ? 'is-complete' : ''}`}><header><ShieldCheck size={14} /><strong>{message.actionStatus === 'executed' ? 'מנהלי הצוות עודכנו' : 'אישור שינוי מנהל צוות'}</strong></header><div><span>{message.actionProposal.operation === 'assign' ? 'מינוי למנהל צוות' : 'הסרה מניהול הצוות'}</span><span>{message.actionProposal.teamName}</span><b>{message.actionProposal.staffName}</b></div><small>רק חבר קיים יכול להתמנות, ולצוות יישאר תמיד לפחות מנהל אחד.</small>{message.actionStatus !== 'executed' && message.actionStatus !== 'cancelled' && <footer><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => confirmTeamManagerAction(message)}><CheckCircle2 size={14} /> {message.actionStatus === 'executing' ? 'מעדכן…' : 'אישור ושינוי'}</button><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => patchMessage(message.id, { actionStatus: 'cancelled' })}>ביטול</button></footer>}{message.actionStatus === 'cancelled' && <small>הפעולה בוטלה ולא נשמר שינוי.</small>}{message.actionError && <small className="is-error">{message.actionError}</small>}{message.actionStatus === 'executed' && <button type="button" className="zoki-action-link" onClick={() => navigate(message.actionResult.route)}>פתיחת הצוותים</button>}</section>}
              {message.actionProposal?.type === 'student_transfer' && <section className={`zoki-inline-action ${message.actionStatus === 'executed' ? 'is-complete' : ''}`}><header><ShieldCheck size={14} /><strong>{message.actionStatus === 'executed' ? 'העברת התלמיד הושלמה' : 'אישור העברת תלמיד'}</strong></header><div><span>{message.actionProposal.studentName}</span><span>מ־{message.actionProposal.currentClassName || 'ללא כיתה'} אל {message.actionProposal.targetClassName}</span><b>{message.actionProposal.effectiveDate}</b></div>{message.actionProposal.reason && <small>סיבה: {message.actionProposal.reason}</small>}{message.actionStatus !== 'executed' && message.actionStatus !== 'cancelled' && <footer><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => confirmStudentTransferAction(message)}><CheckCircle2 size={14} /> {message.actionStatus === 'executing' ? 'מעביר…' : 'אישור והעברה'}</button><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => patchMessage(message.id, { actionStatus: 'cancelled' })}>ביטול</button></footer>}{message.actionStatus === 'cancelled' && <small>הפעולה בוטלה ולא נשמר שינוי.</small>}{message.actionError && <small className="is-error">{message.actionError}</small>}{message.actionStatus === 'executed' && <button type="button" className="zoki-action-link" onClick={() => navigate(message.actionResult.route)}>פתיחת כרטיס התלמיד</button>}</section>}
              {message.actionProposal?.type === 'role_assignment' && <section className={`zoki-inline-action ${message.actionStatus === 'executed' ? 'is-complete' : ''}`}><header><ShieldCheck size={14} /><strong>{message.actionStatus === 'executed' ? 'שיוך התפקיד עודכן' : 'אישור שינוי הרשאות'}</strong></header><div><span>{message.actionProposal.staffName}</span><span>{message.actionProposal.operation === 'assign' ? 'הקצאת תפקיד' : 'הסרת תפקיד'}</span><b>{message.actionProposal.roleName}</b></div><small>השינוי חל על ההרשאות שמוגדרות בתפקיד הקיים. זוקי יבדוק שוב את סמכותך בעת האישור.</small>{message.actionStatus !== 'executed' && message.actionStatus !== 'cancelled' && <footer><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => confirmRoleAssignmentAction(message)}><CheckCircle2 size={14} /> {message.actionStatus === 'executing' ? 'מעדכן…' : 'אישור ושינוי'}</button><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => patchMessage(message.id, { actionStatus: 'cancelled' })}>ביטול</button></footer>}{message.actionStatus === 'cancelled' && <small>הפעולה בוטלה ולא נשמר שינוי.</small>}{message.actionError && <small className="is-error">{message.actionError}</small>}{message.actionStatus === 'executed' && <button type="button" className="zoki-action-link" onClick={() => navigate(message.actionResult.route)}>פתיחת ניהול הסגל</button>}</section>}
              {message.actionProposal?.type === 'direct_permission_change' && <section className={`zoki-inline-action ${message.actionStatus === 'executed' ? 'is-complete' : ''}`}><header><ShieldCheck size={14} /><strong>{message.actionStatus === 'executed' ? 'ההרשאה עודכנה' : 'אישור שינוי הרשאה'}</strong></header><div><span>{message.actionProposal.staffName}</span><span>{message.actionProposal.operation === 'grant' ? 'מתן הרשאה' : 'הסרת הרשאה'} · {message.actionProposal.permissionGroup}</span><b>{message.actionProposal.permissionName}</b></div><small>השינוי יחול רק על ההרשאה המוצגת. זוקי יבדוק שוב את סמכותך ואת המצב הנוכחי בעת האישור.</small>{message.actionStatus !== 'executed' && message.actionStatus !== 'cancelled' && <footer><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => confirmDirectPermissionAction(message)}><CheckCircle2 size={14} /> {message.actionStatus === 'executing' ? 'מעדכן…' : 'אישור ושינוי'}</button><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => patchMessage(message.id, { actionStatus: 'cancelled' })}>ביטול</button></footer>}{message.actionStatus === 'cancelled' && <small>הפעולה בוטלה ולא נשמר שינוי.</small>}{message.actionError && <small className="is-error">{message.actionError}</small>}{message.actionStatus === 'executed' && <button type="button" className="zoki-action-link" onClick={() => navigate(message.actionResult.route)}>פתיחת ניהול הסגל</button>}</section>}
              {message.actionProposal?.type === 'resource_access_change' && <section className={`zoki-inline-action ${message.actionStatus === 'executed' ? 'is-complete' : ''}`}><header><ShieldCheck size={14} /><strong>{message.actionStatus === 'executed' ? 'גישת המשאב עודכנה' : 'אישור שינוי גישה'}</strong></header><div><span>{message.actionProposal.staffName} · {message.actionProposal.resourceType === 'file' ? 'קובץ' : 'תיקייה'}</span><span>{message.actionProposal.operation === 'grant' ? `מתן ${RESOURCE_ACCESS_LEVEL_LABELS[message.actionProposal.accessLevel] || 'צפייה'}` : message.actionProposal.operation === 'deny' ? 'חסימה מפורשת' : 'הסרת הכלל האישי'}</span><b>{message.actionProposal.resourceName}</b></div><small>{message.actionProposal.operation === 'remove' ? 'הסרת כלל אישי אינה מבטיחה חסימה: גישה מתפקיד, צוות, כיתה או תיקיית־אב עשויה להישאר.' : 'הוספת כלל ראשון עשויה להפוך את המשאב לרשימת מורשים. זוקי יבדוק שוב את המצב בעת האישור.'}</small>{message.actionStatus !== 'executed' && message.actionStatus !== 'cancelled' && <footer><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => confirmResourceAccessAction(message)}><CheckCircle2 size={14} /> {message.actionStatus === 'executing' ? 'מעדכן…' : 'אישור ושינוי'}</button><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => patchMessage(message.id, { actionStatus: 'cancelled' })}>ביטול</button></footer>}{message.actionStatus === 'cancelled' && <small>הפעולה בוטלה ולא נשמר שינוי.</small>}{message.actionError && <small className="is-error">{message.actionError}</small>}{message.actionStatus === 'executed' && <button type="button" className="zoki-action-link" onClick={() => navigate(message.actionResult.route)}>פתיחת המשאב</button>}</section>}
              {message.actionProposal?.type === 'resource_create' && <section className={`zoki-inline-action ${message.actionStatus === 'executed' ? 'is-complete' : ''}`}><header><ShieldCheck size={14} /><strong>{message.actionStatus === 'executed' ? 'הפריט נוצר' : 'אישור יצירת פריט'}</strong></header><div><span>{message.actionProposal.kind === 'folder' ? 'תיקייה חדשה' : message.actionProposal.kind === 'spreadsheet' ? 'גיליון חדש' : 'מסמך חדש'}</span><span>{message.actionProposal.kind === 'folder' ? `חשיפה: ${message.actionProposal.visibility === 'principal_only' ? 'מנהלים בלבד' : 'כולם'}` : `בתיקייה: ${message.actionProposal.folderName}`}</span><b>{message.actionProposal.name}</b></div><small>{message.actionProposal.kind === 'folder' ? 'התיקייה תיווצר ריקה ברמה הראשית.' : 'הפריט ייווצר ריק ויהיה אפשר לפתוח ולערוך אותו מיד לאחר מכן.'}</small>{message.actionStatus !== 'executed' && message.actionStatus !== 'cancelled' && <footer><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => confirmResourceCreateAction(message)}><CheckCircle2 size={14} /> {message.actionStatus === 'executing' ? 'יוצר…' : 'אישור ויצירה'}</button><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => patchMessage(message.id, { actionStatus: 'cancelled' })}>ביטול</button></footer>}{message.actionStatus === 'cancelled' && <small>הפעולה בוטלה ולא נוצר פריט.</small>}{message.actionError && <small className="is-error">{message.actionError}</small>}{message.actionStatus === 'executed' && <button type="button" className="zoki-action-link" onClick={() => navigate(message.actionResult.route)}>פתיחת הפריט</button>}</section>}
              {message.actionProposal?.type === 'resource_rename' && <section className={`zoki-inline-action ${message.actionStatus === 'executed' ? 'is-complete' : ''}`}><header><ShieldCheck size={14} /><strong>{message.actionStatus === 'executed' ? 'שם הפריט עודכן' : 'אישור שינוי שם'}</strong></header><div><span>{message.actionProposal.resourceType === 'file' ? 'קובץ' : 'תיקייה'}</span><span>מ־{message.actionProposal.currentName}</span><b>{message.actionProposal.newName}</b></div><small>זוקי יוודא מחדש את הרשאת העריכה ושהשם לא השתנה מאז ההצעה.</small>{message.actionStatus !== 'executed' && message.actionStatus !== 'cancelled' && <footer><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => confirmResourceRenameAction(message)}><CheckCircle2 size={14} /> {message.actionStatus === 'executing' ? 'משנה…' : 'אישור ושינוי שם'}</button><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => patchMessage(message.id, { actionStatus: 'cancelled' })}>ביטול</button></footer>}{message.actionStatus === 'cancelled' && <small>הפעולה בוטלה ולא נשמר שינוי.</small>}{message.actionError && <small className="is-error">{message.actionError}</small>}{message.actionStatus === 'executed' && <button type="button" className="zoki-action-link" onClick={() => navigate(message.actionResult.route)}>פתיחת המשאב</button>}</section>}
              {message.actionProposal?.type === 'resource_trash' && <section className={`zoki-inline-action is-destructive ${message.actionStatus === 'executed' ? 'is-complete' : ''}`}><header><ShieldCheck size={14} /><strong>{message.actionStatus === 'executed' ? 'הפריט הועבר לסל המחזור' : 'אישור העברה לסל המחזור'}</strong></header><div><span>{message.actionProposal.resourceType === 'file' ? 'קובץ' : 'תיקייה'}</span><b>{message.actionProposal.resourceName}</b></div><small>{message.actionProposal.resourceType === 'folder' ? 'התיקייה וכל הקבצים שבתוכה יועברו יחד לסל המחזור ויהיו ניתנים לשחזור.' : 'הקובץ יועבר לסל המחזור ויהיה ניתן לשחזור.'}</small>{message.actionStatus !== 'executed' && message.actionStatus !== 'cancelled' && <footer><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => confirmResourceTrashAction(message)}><CheckCircle2 size={14} /> {message.actionStatus === 'executing' ? 'מעביר…' : 'אישור והעברה לסל'}</button><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => patchMessage(message.id, { actionStatus: 'cancelled' })}>השארת הפריט</button></footer>}{message.actionStatus === 'cancelled' && <small>הפריט נשאר ללא שינוי.</small>}{message.actionError && <small className="is-error">{message.actionError}</small>}{message.actionStatus === 'executed' && <button type="button" className="zoki-action-link" onClick={() => navigate(message.actionResult.route)}>פתיחת סל המחזור</button>}</section>}
              {message.actionProposal?.type === 'resource_restore' && <section className={`zoki-inline-action ${message.actionStatus === 'executed' ? 'is-complete' : ''}`}><header><ShieldCheck size={14} /><strong>{message.actionStatus === 'executed' ? 'הפריט שוחזר' : 'אישור שחזור'}</strong></header><div><span>{message.actionProposal.resourceType === 'file' ? 'קובץ מסל המחזור' : 'תיקייה מסל המחזור'}</span><b>{message.actionProposal.resourceName}</b></div><small>{message.actionProposal.resourceType === 'folder' ? 'התיקייה והקבצים שהועברו איתה ישוחזרו יחד.' : 'הקובץ יחזור למיקומו הקודם.'}</small>{message.actionStatus !== 'executed' && message.actionStatus !== 'cancelled' && <footer><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => confirmResourceRestoreAction(message)}><CheckCircle2 size={14} /> {message.actionStatus === 'executing' ? 'משחזר…' : 'אישור ושחזור'}</button><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => patchMessage(message.id, { actionStatus: 'cancelled' })}>ביטול</button></footer>}{message.actionStatus === 'cancelled' && <small>הפריט נשאר בסל המחזור.</small>}{message.actionError && <small className="is-error">{message.actionError}</small>}{message.actionStatus === 'executed' && <button type="button" className="zoki-action-link" onClick={() => navigate(message.actionResult.route)}>פתיחת הפריט</button>}</section>}
              {message.actionProposal?.type === 'resource_move' && <section className={`zoki-inline-action ${message.actionStatus === 'executed' ? 'is-complete' : ''}`}><header><ShieldCheck size={14} /><strong>{message.actionStatus === 'executed' ? 'הקובץ הועבר' : 'אישור העברת קובץ'}</strong></header><div><span>מ־{message.actionProposal.currentFolderName || 'ללא תיקייה'}</span><span>אל {message.actionProposal.targetFolderName}</span><b>{message.actionProposal.fileName}</b></div><small>זוקי יוודא מחדש את הרשאות העריכה, מיקום הקובץ ותיקיית היעד.</small>{message.actionStatus !== 'executed' && message.actionStatus !== 'cancelled' && <footer><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => confirmResourceMoveAction(message)}><CheckCircle2 size={14} /> {message.actionStatus === 'executing' ? 'מעביר…' : 'אישור והעברה'}</button><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => patchMessage(message.id, { actionStatus: 'cancelled' })}>ביטול</button></footer>}{message.actionStatus === 'cancelled' && <small>הקובץ נשאר במיקומו.</small>}{message.actionError && <small className="is-error">{message.actionError}</small>}{message.actionStatus === 'executed' && <button type="button" className="zoki-action-link" onClick={() => navigate(message.actionResult.route)}>פתיחת הקובץ</button>}</section>}
              {message.actionProposal?.type === 'student_track_change' && <section className={`zoki-inline-action ${message.actionStatus === 'executed' ? 'is-complete' : ''}`}><header><ShieldCheck size={14} /><strong>{message.actionStatus === 'executed' ? 'מגמת התלמיד עודכנה' : 'אישור שינוי מגמה'}</strong></header><div><span>{message.actionProposal.studentName}</span><span>{message.actionProposal.operation === 'add' ? 'הוספה למגמה' : 'הסרה ממגמה'}</span><b>{message.actionProposal.trackName}</b></div><small>השינוי יסונכרן גם עם ההרשמה של התלמיד לשנת הלימודים הנוכחית.</small>{message.actionStatus !== 'executed' && message.actionStatus !== 'cancelled' && <footer><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => confirmStudentTrackAction(message)}><CheckCircle2 size={14} /> {message.actionStatus === 'executing' ? 'מעדכן…' : 'אישור ושינוי'}</button><button type="button" disabled={message.actionStatus === 'executing'} onClick={() => patchMessage(message.id, { actionStatus: 'cancelled' })}>ביטול</button></footer>}{message.actionStatus === 'cancelled' && <small>הפעולה בוטלה ולא נשמר שינוי.</small>}{message.actionError && <small className="is-error">{message.actionError}</small>}{message.actionStatus === 'executed' && <button type="button" className="zoki-action-link" onClick={() => navigate(message.actionResult.route)}>פתיחת כרטיס התלמיד</button>}</section>}
              {message.sources?.length > 0 && <footer><span><BookOpen size={13} /> מקורות</span>{message.sources.map(item => <button type="button" key={item.id} onClick={() => navigate(item.route)}>{item.label}<ExternalLink size={12} /></button>)}</footer>}
            </div>
          </article>)}
          {taskActionResult?.ok && <div className="zoki-task-result is-success" role="status"><CheckCircle2 size={20} /><div><strong>המשימה נוצרה בהצלחה</strong><span>היא נשמרה פעם אחת בלבד.</span></div><button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate(taskActionResult.route)}>פתיחת המשימה</button></div>}
          {taskActionResult && !taskActionResult.ok && <div className="zoki-task-result is-error" role="alert"><ShieldCheck size={20} /><span>{taskActionResult.message}</span></div>}
          {pendingTask && <article className="zoki-task-confirmation"><header><span><ShieldCheck size={15} /> ממתין לאישור</span><h3>{pendingTask.proposal.title || 'משימה חדשה'}</h3></header><p>{pendingTask.proposal.description || 'ללא תיאור נוסף.'}</p><dl><div><dt>עדיפות</dt><dd>{pendingTask.proposal.priority === 'high' ? 'גבוהה' : pendingTask.proposal.priority === 'low' ? 'נמוכה' : 'רגילה'}</dd></div><div><dt>תאריך יעד</dt><dd>{pendingTask.action?.dueDate || 'לא נקבע'}</dd></div><div><dt>סוג</dt><dd>{pendingTask.action?.scope === 'assigned' ? 'משימה מוקצית' : pendingTask.action?.scope === 'team' ? 'משימת צוות' : pendingTask.action?.scope === 'personal' ? 'משימה אישית' : 'נדרשים פרטים נוספים'}</dd></div></dl><footer>{pendingTask.action && <button type="button" className="btn btn-primary" disabled={executingTask} onClick={confirmTaskCreation}><CheckCircle2 size={16} /> {executingTask ? 'יוצר…' : 'אישור ויצירת המשימה'}</button>}<button type="button" className="btn btn-secondary" onClick={editTaskProposal}><Pencil size={16} /> עריכת הפרטים</button><button type="button" className="btn btn-link" onClick={() => setPendingTask(null)}>ביטול</button></footer>{!pendingTask.action && <small>כדי להקצות לאדם או לצוות, יש לבחור יעד מדויק בטופס המלא.</small>}</article>}
          {loading && <article className="zoki-message zoki-message--zoki"><img src={zokiAvatar} alt="" /><div className="zoki-thinking"><span /><span /><span /></div></article>}
          <div ref={endRef} />
        </div>
        <form className="zoki-composer" onSubmit={event => { event.preventDefault(); submitQuestion(); }}><textarea id="zoki-question" aria-label="כתיבה לעוזר" value={question} onChange={event => setQuestion(event.target.value)} maxLength={2000} rows={2} placeholder="אפשר לשאול, לבקש פעולה או ליצור משימה…" onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submitQuestion(); } }} /><button type="submit" disabled={loading || question.trim().length < 2} aria-label="שליחה"><Send size={19} /></button><small><ShieldCheck size={13} /> מידע ופעולות מוגבלים להרשאות שלך</small></form>
      </section>
    </div>

    {personalOpen && <ZokiPersonalSettings key={schoolId} schoolId={schoolId} manager={canManage} onClose={() => setPersonalOpen(false)} />}
    {brainOpen && <div className="zoki-brain-overlay" onClick={() => setBrainOpen(false)}><aside className="zoki-brain-panel" role="dialog" aria-modal="true" aria-labelledby="zoki-brain-title" onClick={event => event.stopPropagation()}>
      <header><div><span><Settings2 size={15} /> הגדרות מנהל</span><h2 id="zoki-brain-title">הוראות וידע לצוות</h2><p>כאן מגדירים בקצרה מה העוזר צריך לדעת ואיך לפעול.</p></div><button type="button" onClick={() => setBrainOpen(false)} aria-label="סגירה"><X size={20} /></button></header>
      <div className="zoki-brain-body"><label>הנחיות כלליות<textarea rows={4} maxLength={8000} value={brainDraft.instructions} onChange={event => setBrainDraft(previous => ({ ...previous, instructions: event.target.value }))} placeholder="לדוגמה: בשאלות על טיולים יש להפנות תחילה לנוהל הבטיחות…" /></label>
        <div className="zoki-knowledge-head"><div><h3>נהלים, כללים ומידע</h3><span>{brainDraft.entries.length} פריטים</span></div><button type="button" className="btn btn-secondary btn-sm" onClick={() => setBrainDraft(previous => ({ ...previous, entries: [...previous.entries, { ...EMPTY_ENTRY, id: `knowledge_${Date.now()}` }] }))}><Plus size={14} /> הוספת פריט</button></div>
        {brainDraft.entries.length === 0 && <div className="zoki-no-knowledge">עדיין לא הוזן ידע בית־ספרי.</div>}
        {brainDraft.entries.map((entry, index) => <article className="zoki-knowledge-card" key={entry.id || index}><label>כותרת<input value={entry.title} maxLength={160} onChange={event => updateEntry(index, 'title', event.target.value)} placeholder="שם הנוהל או הכלל" /></label><label>תוכן<textarea rows={4} value={entry.body} maxLength={6000} onChange={event => updateEntry(index, 'body', event.target.value)} placeholder="המידע שהעוזר צריך לדעת…" /></label><details className="zoki-knowledge-advanced"><summary>אפשרויות מתקדמות</summary><footer><label>קטגוריה<input value={entry.category} maxLength={80} onChange={event => updateEntry(index, 'category', event.target.value)} /></label><label>מצב<select value={entry.status} onChange={event => updateEntry(index, 'status', event.target.value)}><option value="published">מפורסם</option><option value="draft">טיוטה</option></select></label><label>קהל<select value={entry.audience?.type || 'school'} onChange={event => updateEntry(index, 'audience', { type: event.target.value, roleIds: [], userIds: [] })}><option value="school">כל צוות בית הספר</option><option value="roles">תפקידים מסוימים</option><option value="users">משתמשים מסוימים</option></select></label><label>בתוקף עד<input type="date" value={entry.validUntil || ''} onChange={event => updateEntry(index, 'validUntil', event.target.value)} /></label></footer>
          {entry.audience?.type === 'roles' && <fieldset className="zoki-audience-picker"><legend>אילו תפקידים יוכלו לקבל את המידע?</legend>{audienceLoading ? <span>טוען תפקידים…</span> : audienceRoles.length > 0 ? <div>{audienceRoles.map(role => <label key={role.id}><input type="checkbox" checked={(entry.audience.roleIds || []).includes(role.id)} onChange={() => toggleAudienceEntry(index, 'roleIds', role.id)} /> {displayName(role, 'תפקיד')}</label>)}</div> : <span>לא נמצאו תפקידים מוגדרים.</span>}</fieldset>}
          {entry.audience?.type === 'users' && <fieldset className="zoki-audience-picker"><legend>אילו אנשי צוות יוכלו לקבל את המידע?</legend>{audienceLoading ? <span>טוען אנשי צוות…</span> : audienceStaff.length > 0 ? <div>{audienceStaff.map(staff => <label key={staff.id}><input type="checkbox" checked={(entry.audience.userIds || []).includes(staff.id)} onChange={() => toggleAudienceEntry(index, 'userIds', staff.id)} /> {displayName(staff, 'איש צוות')}</label>)}</div> : <span>לא נמצאו אנשי צוות פעילים.</span>}</fieldset>}</details><button type="button" className="zoki-delete-entry" onClick={() => setBrainDraft(previous => ({ ...previous, entries: previous.entries.filter((_, itemIndex) => itemIndex !== index) }))}><Trash2 size={15} /> מחיקת הפריט</button>
        </article>)}
      </div>
      <footer className="zoki-brain-actions">{brainMessage && <span>{brainMessage}</span>}<button type="button" className="btn btn-secondary" onClick={() => { setBrainDraft(brain); setBrainOpen(false); }}>ביטול</button><button type="button" className="btn btn-primary" disabled={savingBrain} onClick={persistBrain}><Save size={16} /> {savingBrain ? 'שומר…' : 'שמירת ההגדרות'}</button></footer>
    </aside></div>}
  </div>;
}
