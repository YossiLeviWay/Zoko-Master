import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDocs } from 'firebase/firestore';
import { BookOpen, Bot, CheckCircle2, ExternalLink, Pencil, Plus, Save, Send, Settings2, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { db } from '../../firebase.js';
import { askZoki, callableReason, executeZokiAttendance, executeZokiCalendarEvent, executeZokiCalendarEventCancel, executeZokiCalendarEventUpdate, executeZokiContact, executeZokiDirectPermission, executeZokiGrade, executeZokiResourceAccess, executeZokiResourceCreate, executeZokiResourceMove, executeZokiResourceRename, executeZokiRoleAssignment, executeZokiStudentNote, executeZokiStudentTrack, executeZokiStudentTransfer, executeZokiTask, executeZokiTaskAssignment, executeZokiTaskDetails, executeZokiTaskStatus, executeZokiTeamCreate, executeZokiTeamManager, executeZokiTeamMembership, fileTrashAction } from '../../services/adminUserService.js';
import { saveZokiBrain, subscribeZokiBrain } from '../../services/firestore/zokiBrainRepository.js';
import { listSchoolStaff } from '../../services/firestore/classStudentRepository.js';
import { schoolCollection } from '../../services/firestore/paths.js';
import { useTaskAssistantContext } from '../../hooks/useTaskAssistantContext.js';
import TaskAssistantEntry from '../Tasks/TaskAssistantEntry.jsx';
import TaskPatternReviewPanel from '../Tasks/TaskPatternReviewPanel.jsx';
import Header from '../Layout/Header.jsx';
import zokiAvatar from '../../assets/zoki-avatar-minimal.svg';
import './Zoki.css';

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
  if (reason === 'zoki-not-configured') return 'זוקי עדיין אינו מחובר למודל ה-AI בסביבת השרת.';
  if (reason === 'permission-denied') return 'אין לך הרשאה לקבל את המידע הזה.';
  if (reason === 'resource-exhausted') return 'נשלחו הרבה שאלות בזמן קצר. אפשר לנסות שוב בעוד כמה דקות.';
  return 'לא הצלחתי לענות כרגע. אפשר לנסות שוב.';
}

function displayName(item, fallback) {
  return item.fullName || item.displayName || item.name || item.title || fallback;
}

function zokiTaskAction(proposal, context) {
  const responsible = proposal?.assignmentPlan?.responsible || [];
  const assignedStaff = responsible.find(item => item.source === 'staff' && item.id);
  const assignedTeam = responsible.find(item => item.source === 'team' && item.id);
  const scope = proposal?.taskType === 'personal' ? 'personal'
    : assignedStaff ? 'assigned'
      : assignedTeam ? 'team' : null;
  if (!scope) return null;
  return {
    scope,
    title: proposal.title,
    description: proposal.description || '',
    priority: ['low', 'medium', 'high'].includes(proposal.priority) ? proposal.priority : 'medium',
    dueDate: proposal.dueDate || proposal.dateRange?.endDate || '',
    startDate: proposal.dateRange?.startDate || '',
    endDate: proposal.dateRange?.endDate || '',
    completionCriteria: proposal.completionCriteria || '',
    assigneeIds: assignedStaff ? [assignedStaff.id] : [],
    teamId: assignedTeam?.id || '',
    agentSessionId: context?.sessionId || '',
    workPlanSteps: (proposal.workPlanSteps || []).map((step, index) => ({
      id: step.id || `step_${index + 1}`,
      title: step.title,
      dueDate: '',
      status: 'todo',
      responsibleIds: (step.suggestedParties || []).filter(item => item.source === 'staff' && item.id).map(item => item.id).slice(0, 10),
      teamId: (step.suggestedParties || []).find(item => item.source === 'team' && item.id)?.id || '',
      dependencyStepId: '',
      order: index,
    })),
  };
}

export default function ZokiPage() {
  const { userData, currentUser, selectedSchool, availableSchools, isPrincipal, isGlobalAdmin } = useAuth();
  const navigate = useNavigate();
  const schoolId = selectedSchool || userData?.schoolId;
  const canManage = isPrincipal() || isGlobalAdmin();
  const [mode, setMode] = useState('ask');
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [brainOpen, setBrainOpen] = useState(false);
  const [taskKnowledgeOpen, setTaskKnowledgeOpen] = useState(false);
  const [brain, setBrain] = useState({ instructions: '', entries: [] });
  const [brainDraft, setBrainDraft] = useState({ instructions: '', entries: [] });
  const [savingBrain, setSavingBrain] = useState(false);
  const [brainMessage, setBrainMessage] = useState('');
  const [audienceStaff, setAudienceStaff] = useState([]);
  const [audienceRoles, setAudienceRoles] = useState([]);
  const [audienceLoading, setAudienceLoading] = useState(false);
  const [pendingTask, setPendingTask] = useState(null);
  const [executingTask, setExecutingTask] = useState(false);
  const [taskActionResult, setTaskActionResult] = useState(null);
  const endRef = useRef(null);
  const { schoolContext: taskAssistantSchoolContext, loading: taskAssistantContextLoading } = useTaskAssistantContext();
  const taskKnowledgeSnapshot = useMemo(() => {
    const sources = taskAssistantSchoolContext?.sources || {};
    const staff = Array.isArray(sources.staff) ? sources.staff : [];
    const teams = Array.isArray(sources.teams) ? sources.teams : [];
    const classes = Array.isArray(sources.classes) ? sources.classes : [];
    const initiatives = Array.isArray(sources.initiatives) ? sources.initiatives : [];
    const tasks = Array.isArray(sources.tasks) ? sources.tasks : [];
    return {
      school: {
        id: schoolId,
        name: availableSchools?.find(item => item.id === schoolId)?.name || schoolId,
      },
      staff: staff.map(item => ({
        id: item.uid || item.id,
        name: item.fullName || item.name || '',
        jobTitle: item.jobTitle || item.roleName || '',
        teams: teams.filter(team => team.memberIds?.includes(item.uid || item.id)).map(team => team.name || ''),
        classes: classes.filter(entry => [entry.teacherId, entry.homeroomTeacherId, ...(entry.staffIds || [])].includes(item.uid || item.id)).map(entry => entry.name || entry.title || ''),
      })),
      units: [
        ...teams.map(item => ({ type: 'צוות', name: item.name || '', owners: [], summary: item.description || '' })),
        ...classes.map(item => ({ type: 'כיתה', name: item.name || item.title || '', owners: [], summary: item.grade || item.gradeLevel || '' })),
        ...initiatives.map(item => ({ type: 'תכנית', name: item.title || '', owners: [], summary: item.description || item.summary || '' })),
        ...tasks.map(item => ({ type: 'משימה', name: item.title || '', owners: [], summary: item.description || '' })),
      ],
      calendar: [...(sources.events || []), ...(sources.holidays || [])].map(item => ({
        date: item.startDate || item.date || '', range: item.endDate || '', title: item.name || item.title || '', summary: item.description || '',
      })),
      documents: (sources.files || []).map(item => ({
        name: item.name || '', domain: item.type || item.category || '',
        summary: String(item.content || item.text || item.description || item.summary || '').slice(0, 4000),
      })),
      patterns: sources.approvedRules || [],
    };
  }, [availableSchools, schoolId, taskAssistantSchoolContext]);

  useEffect(() => {
    if (!schoolId || !canManage) return undefined;
    return subscribeZokiBrain({ db, schoolId, onData: value => { setBrain(value); setBrainDraft(value); }, onError: () => undefined });
  }, [canManage, schoolId]);

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

  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages, loading]);

  const greeting = useMemo(() => {
    const firstName = (userData?.fullName || '').trim().split(/\s+/u)[0];
    return firstName ? `היי ${firstName}, איך אפשר לעזור?` : 'היי, איך אפשר לעזור?';
  }, [userData?.fullName]);

  async function submitQuestion(text = question) {
    const nextQuestion = text.trim();
    if (!nextQuestion || loading || !schoolId) return;
    setQuestion('');
    setMessages(previous => [...previous, { id: `user_${Date.now()}`, role: 'user', text: nextQuestion }]);
    setLoading(true);
    try {
      const history = messages.slice(-8).filter(message => !message.error).map(message => ({
        role: message.role === 'user' ? 'user' : 'assistant',
        text: message.text,
      }));
      const result = await askZoki({ schoolId, question: nextQuestion, history });
      const actionRequestId = result.actionProposal
        ? (globalThis.crypto?.randomUUID?.().replaceAll('-', '_') || `request_${Date.now()}`)
        : '';
      setMessages(previous => [...previous, {
        id: `zoki_${Date.now()}`, role: 'zoki', text: result.answer,
        sources: result.sources || [], followUpQuestion: result.followUpQuestion || '',
        actionProposal: result.actionProposal ? { ...result.actionProposal, requestId: actionRequestId } : null,
      }]);
    } catch (error) {
      setMessages(previous => [...previous, { id: `error_${Date.now()}`, role: 'zoki', error: true, text: errorMessage(error) }]);
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
      setBrainMessage('המוח של זוקי נשמר. מידע שפורסם זמין מיד לצוות המורשה.');
    } catch {
      setBrainMessage('לא ניתן לשמור. בדקו שיש לך הרשאת מנהל מוסד.');
    } finally {
      setSavingBrain(false);
    }
  }

  function openTaskProposal(proposal, context) {
    const requestId = globalThis.crypto?.randomUUID?.().replaceAll('-', '_') || `request_${Date.now()}`;
    setTaskActionResult(null);
    setPendingTask({ proposal, context, requestId, action: zokiTaskAction(proposal, context) });
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

  return <div className="page zoki-page">
    <Header title="זוקי" />
    <div className="page-content zoki-shell">
      <header className="zoki-hero">
        <div className="zoki-identity"><img src={zokiAvatar} alt="זוקי" /><div><span><Sparkles size={15} /> הסוכן הבית־ספרי</span><h1>{greeting}</h1><p>מידע, הכוונה ויצירת משימות—תמיד בהתאם להרשאות שלך.</p></div></div>
        {canManage && <button type="button" className="btn btn-secondary" onClick={() => setBrainOpen(true)}><Settings2 size={16} /> ניהול המוח של זוקי</button>}
      </header>

      <div className="zoki-mode-switch" role="tablist" aria-label="סוג העזרה">
        <button type="button" role="tab" aria-selected={mode === 'ask'} className={mode === 'ask' ? 'active' : ''} onClick={() => setMode('ask')}><Bot size={17} /> שאלה ומידע</button>
        <button type="button" role="tab" aria-selected={mode === 'task'} className={mode === 'task' ? 'active' : ''} onClick={() => setMode('task')}><Sparkles size={17} /> יצירת משימה</button>
      </div>

      {mode === 'ask' ? <section className="zoki-chat" aria-label="שיחה עם זוקי">
        <div className="zoki-messages" aria-live="polite">
          {messages.length === 0 && <div className="zoki-empty"><img src={zokiAvatar} alt="" /><h2>אפשר לשאול אותי על כל מה שנמצא במערכת</h2><p>אם המידע אינו בהרשאה שלך, לא אחשוף אם הוא קיים.</p><div>{STARTERS.map(starter => <button type="button" key={starter} onClick={() => submitQuestion(starter)}>{starter}</button>)}</div></div>}
          {messages.map(message => <article key={message.id} className={`zoki-message zoki-message--${message.role}${message.error ? ' is-error' : ''}`}>
            {message.role === 'zoki' && <img src={zokiAvatar} alt="" />}
            <div><p>{message.text}</p>{message.followUpQuestion && <button type="button" className="zoki-follow-up" onClick={() => setQuestion(message.followUpQuestion)}>{message.followUpQuestion}</button>}
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
          {loading && <article className="zoki-message zoki-message--zoki"><img src={zokiAvatar} alt="" /><div className="zoki-thinking"><span /><span /><span /></div></article>}
          <div ref={endRef} />
        </div>
        <form className="zoki-composer" onSubmit={event => { event.preventDefault(); submitQuestion(); }}><label className="sr-only" htmlFor="zoki-question">שאלה לזוקי</label><textarea id="zoki-question" value={question} onChange={event => setQuestion(event.target.value)} maxLength={2000} rows={2} placeholder="שאלו את זוקי על תלמידים, ציונים, קבצים, נהלים או איך עושים משהו…" onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submitQuestion(); } }} /><button type="submit" disabled={loading || question.trim().length < 2} aria-label="שליחה"><Send size={19} /></button><small><ShieldCheck size={13} /> התשובה מוגבלת להרשאות שלך</small></form>
      </section> : <section className="zoki-task-mode"><div className="zoki-task-intro"><h2>ספרו לזוקי מה צריך לקדם</h2><p>זוקי ינסח משימה ויציג את הפרטים לאישור. דבר לא יישמר לפני לחיצה מפורשת.</p></div>
        {taskActionResult?.ok && <div className="zoki-task-result is-success" role="status"><CheckCircle2 size={20} /><div><strong>המשימה נוצרה בהצלחה</strong><span>זוקי שמר אותה פעם אחת בלבד.</span></div><button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate(taskActionResult.route)}>פתיחת המשימה</button></div>}
        {taskActionResult && !taskActionResult.ok && <div className="zoki-task-result is-error" role="alert"><ShieldCheck size={20} /><span>{taskActionResult.message}</span></div>}
        {pendingTask && <article className="zoki-task-confirmation"><header><span><ShieldCheck size={15} /> ממתין לאישור</span><h3>{pendingTask.proposal.title || 'משימה חדשה'}</h3></header><p>{pendingTask.proposal.description || 'ללא תיאור נוסף.'}</p><dl><div><dt>עדיפות</dt><dd>{pendingTask.proposal.priority === 'high' ? 'גבוהה' : pendingTask.proposal.priority === 'low' ? 'נמוכה' : 'רגילה'}</dd></div><div><dt>תאריך יעד</dt><dd>{pendingTask.action?.dueDate || 'לא נקבע'}</dd></div><div><dt>סוג</dt><dd>{pendingTask.action?.scope === 'assigned' ? 'משימה מוקצית' : pendingTask.action?.scope === 'team' ? 'משימת צוות' : pendingTask.action?.scope === 'personal' ? 'משימה אישית' : 'נדרשים פרטים נוספים'}</dd></div></dl><footer>{pendingTask.action && <button type="button" className="btn btn-primary" disabled={executingTask} onClick={confirmTaskCreation}><CheckCircle2 size={16} /> {executingTask ? 'יוצר…' : 'אישור ויצירת המשימה'}</button>}<button type="button" className="btn btn-secondary" onClick={editTaskProposal}><Pencil size={16} /> עריכת כל הפרטים</button><button type="button" className="btn btn-link" onClick={() => setPendingTask(null)}>ביטול</button></footer>{!pendingTask.action && <small>כדי להקצות משימה לאדם או לצוות, יש לבחור את היעד המדויק בטופס המלא.</small>}</article>}
        <TaskAssistantEntry uid={currentUser?.uid} schoolId={schoolId} schoolContext={taskAssistantSchoolContext} contextLoading={taskAssistantContextLoading} onManual={() => navigate('/tasks', { state: { openManualTask: true } })} onProposal={openTaskProposal} />
      </section>}
    </div>

    {brainOpen && <div className="zoki-brain-overlay" onClick={() => setBrainOpen(false)}><aside className="zoki-brain-panel" role="dialog" aria-modal="true" aria-labelledby="zoki-brain-title" onClick={event => event.stopPropagation()}>
      <header><div><span><Settings2 size={15} /> פאנל מנהל</span><h2 id="zoki-brain-title">המוח של זוקי</h2><p>הוראות וידע בית־ספרי שזוקי יציג לצוות.</p></div><button type="button" onClick={() => setBrainOpen(false)} aria-label="סגירה"><X size={20} /></button></header>
      <div className="zoki-brain-body"><section className="zoki-agent-knowledge"><div><Sparkles size={18} /><span><strong>למידת משימות וידע מוסדי</strong><small>סקירת דפוסים, מקורות, גרסאות וסנכרון המוח הפרטי של זוקי.</small></span></div><button type="button" className="btn btn-secondary btn-sm" onClick={() => { setBrainOpen(false); setTaskKnowledgeOpen(true); }}>פתיחת ניהול הלמידה</button></section><label>הוראות קבועות לזוקי<textarea rows={5} maxLength={8000} value={brainDraft.instructions} onChange={event => setBrainDraft(previous => ({ ...previous, instructions: event.target.value }))} placeholder="לדוגמה: בכל שאלה על טיולים יש להפנות תחילה לנוהל הבטיחות…" /></label>
        <div className="zoki-knowledge-head"><div><h3>נהלים, כללים ומידע</h3><span>{brainDraft.entries.length} פריטים</span></div><button type="button" className="btn btn-secondary btn-sm" onClick={() => setBrainDraft(previous => ({ ...previous, entries: [...previous.entries, { ...EMPTY_ENTRY, id: `knowledge_${Date.now()}` }] }))}><Plus size={14} /> הוספת פריט</button></div>
        {brainDraft.entries.length === 0 && <div className="zoki-no-knowledge">עדיין לא הוזן ידע בית־ספרי.</div>}
        {brainDraft.entries.map((entry, index) => <article className="zoki-knowledge-card" key={entry.id || index}><div><label>כותרת<input value={entry.title} maxLength={160} onChange={event => updateEntry(index, 'title', event.target.value)} placeholder="שם הנוהל או הכלל" /></label><label>קטגוריה<input value={entry.category} maxLength={80} onChange={event => updateEntry(index, 'category', event.target.value)} /></label></div><label>תוכן<textarea rows={5} value={entry.body} maxLength={6000} onChange={event => updateEntry(index, 'body', event.target.value)} placeholder="המידע שזוקי צריך לדעת…" /></label><footer><label>מצב<select value={entry.status} onChange={event => updateEntry(index, 'status', event.target.value)}><option value="published">מפורסם</option><option value="draft">טיוטה</option></select></label><label>קהל<select value={entry.audience?.type || 'school'} onChange={event => updateEntry(index, 'audience', { type: event.target.value, roleIds: [], userIds: [] })}><option value="school">כל צוות בית הספר</option><option value="roles">תפקידים מסוימים</option><option value="users">משתמשים מסוימים</option></select></label><label>בתוקף עד<input type="date" value={entry.validUntil || ''} onChange={event => updateEntry(index, 'validUntil', event.target.value)} /></label><button type="button" className="zoki-delete-entry" onClick={() => setBrainDraft(previous => ({ ...previous, entries: previous.entries.filter((_, itemIndex) => itemIndex !== index) }))} aria-label="מחיקת הפריט"><Trash2 size={16} /></button></footer>
          {entry.audience?.type === 'roles' && <fieldset className="zoki-audience-picker"><legend>אילו תפקידים יוכלו לקבל את המידע?</legend>{audienceLoading ? <span>טוען תפקידים…</span> : audienceRoles.length > 0 ? <div>{audienceRoles.map(role => <label key={role.id}><input type="checkbox" checked={(entry.audience.roleIds || []).includes(role.id)} onChange={() => toggleAudienceEntry(index, 'roleIds', role.id)} /> {displayName(role, 'תפקיד')}</label>)}</div> : <span>לא נמצאו תפקידים מוגדרים.</span>}</fieldset>}
          {entry.audience?.type === 'users' && <fieldset className="zoki-audience-picker"><legend>אילו אנשי צוות יוכלו לקבל את המידע?</legend>{audienceLoading ? <span>טוען אנשי צוות…</span> : audienceStaff.length > 0 ? <div>{audienceStaff.map(staff => <label key={staff.id}><input type="checkbox" checked={(entry.audience.userIds || []).includes(staff.id)} onChange={() => toggleAudienceEntry(index, 'userIds', staff.id)} /> {displayName(staff, 'איש צוות')}</label>)}</div> : <span>לא נמצאו אנשי צוות פעילים.</span>}</fieldset>}
        </article>)}
      </div>
      <footer className="zoki-brain-actions">{brainMessage && <span>{brainMessage}</span>}<button type="button" className="btn btn-secondary" onClick={() => { setBrainDraft(brain); setBrainOpen(false); }}>ביטול</button><button type="button" className="btn btn-primary" disabled={savingBrain} onClick={persistBrain}><Save size={16} /> {savingBrain ? 'שומר…' : 'שמירת המוח'}</button></footer>
    </aside></div>}
    {taskKnowledgeOpen && <TaskPatternReviewPanel schoolId={schoolId} knowledgeSnapshot={taskKnowledgeSnapshot} onClose={() => { setTaskKnowledgeOpen(false); setBrainOpen(true); }} />}
  </div>;
}
