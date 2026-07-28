import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { schoolCollection } from './paths.js';
import {
  buildInitiativeClone,
  deriveInitiativeHealth,
  initiativeProgress,
  safeInitiativeIdList,
} from '../../utils/initiatives.js';

function cleanText(value, max = 4000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function initiativeCollection(db, schoolId) {
  return schoolCollection(db, schoolId, 'initiatives', 'nested');
}

function initiativeDoc(db, schoolId, initiativeId) {
  return doc(initiativeCollection(db, schoolId), initiativeId);
}

function initiativeSubcollection(db, schoolId, initiativeId, name) {
  return collection(initiativeDoc(db, schoolId, initiativeId), name);
}

function activityEntry({ schoolId, initiativeId, actor, action, details = '' }) {
  return {
    schoolId,
    initiativeId,
    actorId: actor.uid,
    actorName: actor.fullName || '',
    action,
    details: cleanText(details, 500),
    createdAt: serverTimestamp(),
  };
}

function normalizeInitiative(item) {
  return {
    ...item,
    id: item.id,
    title: cleanText(item.title, 200) || 'תכנית ללא שם',
    description: cleanText(item.description),
    academicYearId: cleanText(item.academicYearId, 128),
    academicYearLabel: cleanText(item.academicYearLabel, 80),
    category: cleanText(item.category, 100),
    ownerId: cleanText(item.ownerId, 128),
    ownerName: cleanText(item.ownerName, 200),
    memberIds: safeInitiativeIdList(item.memberIds),
    teamIds: safeInitiativeIdList(item.teamIds),
    classIds: safeInitiativeIdList(item.classIds),
    fileIds: safeInitiativeIdList(item.fileIds),
    goals: Array.isArray(item.goals) ? item.goals.filter(goal => typeof goal === 'string').slice(0, 20) : [],
    status: ['active', 'completed', 'archived', 'cancelled'].includes(item.status) ? item.status : 'active',
    health: ['on_track', 'attention', 'at_risk', 'completed'].includes(item.health) ? item.health : 'on_track',
  };
}

export function subscribeInitiatives({ db, schoolId, uid, teamIds = [], canViewAll = false, onData, onError }) {
  if (!schoolId || !uid) return () => undefined;
  const ref = initiativeCollection(db, schoolId);
  const entries = canViewAll ? [ref] : [
    query(ref, where('ownerId', '==', uid)),
    query(ref, where('memberIds', 'array-contains', uid)),
    ...teamIds.map(teamId => query(ref, where('teamIds', 'array-contains', teamId))),
  ];
  const sets = new Map();
  const emit = () => {
    const merged = new Map();
    sets.forEach(items => items.forEach(item => merged.set(item.id, item)));
    onData([...merged.values()].sort((left, right) => {
      if (left.status === 'archived' && right.status !== 'archived') return 1;
      if (right.status === 'archived' && left.status !== 'archived') return -1;
      return String(left.endDate || '9999-12-31').localeCompare(String(right.endDate || '9999-12-31'));
    }));
  };
  return (() => {
    const unsubscribers = entries.map((entry, index) => onSnapshot(entry, snapshot => {
      sets.set(index, snapshot.docs.map(item => normalizeInitiative({ id: item.id, ...item.data() })));
      emit();
    }, onError));
    return () => unsubscribers.forEach(unsubscribe => unsubscribe());
  })();
}

export function subscribeInitiativeDetails({ db, schoolId, initiativeId, onData, onError }) {
  if (!schoolId || !initiativeId) return () => undefined;
  const state = { milestones: [], updates: [], comments: [], activity: [] };
  const emit = () => onData({
    milestones: [...state.milestones].sort((a, b) => Number(a.order || 0) - Number(b.order || 0)),
    updates: [...state.updates].sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)),
    comments: [...state.comments].sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0)),
    activity: [...state.activity].sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)),
  });
  const listeners = ['milestones', 'updates', 'comments', 'activity'].map(name => onSnapshot(
    initiativeSubcollection(db, schoolId, initiativeId, name),
    snapshot => {
      state[name] = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
      emit();
    },
    onError,
  ));
  return () => listeners.forEach(unsubscribe => unsubscribe());
}

export function subscribeInitiativeTimeline({ db, schoolId, uid, teamIds = [], canViewAll = false, onData, onError }) {
  let detailListeners = [];
  const milestonesByInitiative = new Map();
  const emit = () => onData([...milestonesByInitiative.values()].flat());
  const unsubscribeInitiatives = subscribeInitiatives({
    db, schoolId, uid, teamIds, canViewAll,
    onError,
    onData: initiatives => {
      detailListeners.forEach(unsubscribe => unsubscribe());
      detailListeners = [];
      milestonesByInitiative.clear();
      initiatives.filter(item => item.status !== 'archived').forEach(initiative => {
        detailListeners.push(onSnapshot(
          initiativeSubcollection(db, schoolId, initiative.id, 'milestones'),
          snapshot => {
            milestonesByInitiative.set(initiative.id, snapshot.docs.map(item => ({
              id: item.id,
              initiativeId: initiative.id,
              initiativeTitle: initiative.title,
              ...item.data(),
            })));
            emit();
          },
          onError,
        ));
      });
      emit();
    },
  });
  return () => {
    unsubscribeInitiatives();
    detailListeners.forEach(unsubscribe => unsubscribe());
  };
}

export function subscribeInitiativeTemplates({ db, schoolId, onData, onError }) {
  if (!schoolId) return () => undefined;
  return onSnapshot(
    schoolCollection(db, schoolId, 'initiativeTemplates', 'nested'),
    snapshot => onData(snapshot.docs.map(item => ({ id: item.id, ...item.data() })).filter(item => item.status !== 'archived')),
    onError,
  );
}

function initiativePayload(input, schoolId, actor) {
  const goals = Array.isArray(input.goals)
    ? input.goals.map(goal => cleanText(goal, 300)).filter(Boolean).slice(0, 20)
    : [];
  return {
    schoolId,
    title: cleanText(input.title, 200),
    description: cleanText(input.description),
    academicYearId: cleanText(input.academicYearId, 128),
    academicYearLabel: cleanText(input.academicYearLabel, 80),
    category: cleanText(input.category, 100),
    startDate: cleanText(input.startDate, 10),
    endDate: cleanText(input.endDate, 10),
    ownerId: cleanText(input.ownerId, 128) || actor.uid,
    ownerName: cleanText(input.ownerName, 200) || actor.fullName || '',
    memberIds: safeInitiativeIdList(input.memberIds).slice(0, 100),
    teamIds: safeInitiativeIdList(input.teamIds).slice(0, 50),
    classIds: safeInitiativeIdList(input.classIds).slice(0, 100),
    fileIds: safeInitiativeIdList(input.fileIds).slice(0, 100),
    goals,
    nextAction: cleanText(input.nextAction, 300),
    status: ['active', 'completed', 'archived', 'cancelled'].includes(input.status) ? input.status : 'active',
    health: ['on_track', 'attention', 'at_risk', 'completed'].includes(input.health) ? input.health : 'on_track',
    healthOverride: ['on_track', 'attention', 'at_risk', 'completed'].includes(input.healthOverride)
      ? input.healthOverride : '',
    healthOverrideReason: cleanText(input.healthOverrideReason, 500),
    updatedBy: actor.uid,
    updatedAt: serverTimestamp(),
  };
}

export async function createInitiative({ db, schoolId, actor, input }) {
  if (!schoolId || !actor?.uid || !input?.title?.trim() || !input.academicYearId) throw new Error('INVALID_INITIATIVE');
  const ref = doc(initiativeCollection(db, schoolId));
  const batch = writeBatch(db);
  batch.set(ref, {
    ...initiativePayload(input, schoolId, actor),
    createdBy: actor.uid,
    createdAt: serverTimestamp(),
    archivedAt: null,
    health: 'on_track',
    healthOverride: '',
    healthOverrideReason: '',
  });
  batch.set(doc(initiativeSubcollection(db, schoolId, ref.id, 'activity')), activityEntry({
    schoolId, initiativeId: ref.id, actor, action: 'initiative.created',
  }));
  await batch.commit();
  return ref.id;
}

export async function updateInitiative({ db, schoolId, initiativeId, actor, input, activityDetails = '' }) {
  const ref = initiativeDoc(db, schoolId, initiativeId);
  const batch = writeBatch(db);
  batch.update(ref, initiativePayload(input, schoolId, actor));
  batch.set(doc(initiativeSubcollection(db, schoolId, initiativeId, 'activity')), activityEntry({
    schoolId, initiativeId, actor, action: 'initiative.updated', details: activityDetails,
  }));
  return batch.commit();
}

export async function archiveInitiative({ db, schoolId, initiativeId, actor, closing = {} }) {
  const closingSummary = cleanText(closing.summary, 2000);
  const ref = initiativeDoc(db, schoolId, initiativeId);
  const batch = writeBatch(db);
  batch.update(ref, {
    status: 'archived',
    closingSummary,
    closingOutcome: cleanText(closing.outcome, 2000),
    achievedGoals: cleanText(closing.achievedGoals, 2000),
    unachievedGoals: cleanText(closing.unachievedGoals, 2000),
    lessons: cleanText(closing.lessons, 2000),
    recommendations: cleanText(closing.recommendations, 2000),
    archivedAt: serverTimestamp(),
    updatedBy: actor.uid, updatedAt: serverTimestamp(),
  });
  batch.set(doc(initiativeSubcollection(db, schoolId, initiativeId, 'activity')), activityEntry({
    schoolId, initiativeId, actor, action: 'initiative.archived', details: closingSummary,
  }));
  return batch.commit();
}

export async function setInitiativeHealthOverride({ db, schoolId, initiativeId, actor, health, reason }) {
  const normalizedHealth = ['on_track', 'attention', 'at_risk', 'completed'].includes(health) ? health : '';
  const normalizedReason = cleanText(reason, 500);
  if (!normalizedHealth || !normalizedReason) throw new Error('INVALID_HEALTH_OVERRIDE');
  const ref = initiativeDoc(db, schoolId, initiativeId);
  const batch = writeBatch(db);
  batch.update(ref, {
    health: normalizedHealth,
    healthOverride: normalizedHealth,
    healthOverrideReason: normalizedReason,
    updatedBy: actor.uid,
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(initiativeSubcollection(db, schoolId, initiativeId, 'activity')), activityEntry({
    schoolId,
    initiativeId,
    actor,
    action: 'initiative.health_overridden',
    details: normalizedReason,
  }));
  return batch.commit();
}

function milestonePayload(input, schoolId, initiativeId, actor) {
  const dateType = ['exact', 'range', 'proposed', 'unset'].includes(input.dateType) ? input.dateType : 'unset';
  const status = ['not_started', 'in_progress', 'waiting_external', 'blocked', 'completed', 'cancelled'].includes(input.status)
    ? input.status : 'not_started';
  if (status === 'cancelled' && !cleanText(input.cancelReason, 500)) throw new Error('CANCEL_REASON_REQUIRED');
  const evidenceIds = safeInitiativeIdList(input.evidenceIds).slice(0, 50);
  const completionSummary = cleanText(input.completionSummary, 2000);
  if (status === 'completed' && input.requiresEvidence === true && evidenceIds.length === 0 && !completionSummary) {
    throw new Error('EVIDENCE_REQUIRED');
  }
  return {
    schoolId,
    initiativeId,
    title: cleanText(input.title, 200),
    description: cleanText(input.description, 2000),
    ownerId: cleanText(input.ownerId, 128),
    participantIds: safeInitiativeIdList(input.participantIds).slice(0, 100),
    status,
    priority: ['low', 'medium', 'high'].includes(input.priority) ? input.priority : 'medium',
    weight: Math.max(1, Math.min(100, Number(input.weight) || 1)),
    dateType,
    startDate: dateType === 'exact' || dateType === 'range' ? cleanText(input.startDate, 10) : '',
    endDate: dateType === 'range' ? cleanText(input.endDate, 10) : '',
    proposedDate: dateType === 'proposed' ? cleanText(input.proposedDate, 10) : '',
    requiredOutput: cleanText(input.requiredOutput, 500),
    approverId: cleanText(input.approverId, 128),
    dependencyId: cleanText(input.dependencyId, 128),
    reminderAt: cleanText(input.reminderAt, 30),
    fileIds: safeInitiativeIdList(input.fileIds).slice(0, 50),
    evidenceIds,
    requiresEvidence: input.requiresEvidence === true,
    completionSummary,
    cancelReason: status === 'cancelled' ? cleanText(input.cancelReason, 500) : '',
    order: Number(input.order) || 0,
    updatedBy: actor.uid,
    updatedAt: serverTimestamp(),
  };
}

export async function createMilestone({ db, schoolId, initiativeId, actor, input }) {
  if (!input?.title?.trim()) throw new Error('INVALID_MILESTONE');
  const ref = doc(initiativeSubcollection(db, schoolId, initiativeId, 'milestones'));
  const batch = writeBatch(db);
  batch.set(ref, { ...milestonePayload(input, schoolId, initiativeId, actor), createdBy: actor.uid, createdAt: serverTimestamp() });
  batch.set(doc(initiativeSubcollection(db, schoolId, initiativeId, 'activity')), activityEntry({
    schoolId, initiativeId, actor, action: 'milestone.created', details: input.title,
  }));
  await batch.commit();
  return ref.id;
}

export async function updateMilestone({ db, schoolId, initiativeId, milestoneId, actor, input }) {
  const ref = doc(initiativeSubcollection(db, schoolId, initiativeId, 'milestones'), milestoneId);
  const batch = writeBatch(db);
  batch.update(ref, milestonePayload(input, schoolId, initiativeId, actor));
  batch.set(doc(initiativeSubcollection(db, schoolId, initiativeId, 'activity')), activityEntry({
    schoolId, initiativeId, actor, action: 'milestone.updated', details: input.title,
  }));
  return batch.commit();
}

export async function addInitiativeUpdate({ db, schoolId, initiativeId, actor, input }) {
  const type = ['progress', 'decision', 'blocker', 'achievement', 'help', 'meeting'].includes(input.type) ? input.type : 'progress';
  const text = cleanText(input.text, 4000);
  if (!text) throw new Error('INVALID_UPDATE');
  if (type === 'blocker' && (!input.blockerOwnerId || !input.blockerDueDate)) throw new Error('INVALID_BLOCKER');
  const ref = doc(initiativeSubcollection(db, schoolId, initiativeId, 'updates'));
  await setDoc(ref, {
    schoolId,
    initiativeId,
    type,
    text,
    authorId: actor.uid,
    authorName: actor.fullName || '',
    contextType: input.milestoneId ? 'milestone' : input.taskId ? 'task' : 'initiative',
    milestoneId: cleanText(input.milestoneId, 128),
    taskId: cleanText(input.taskId, 128),
    fileIds: safeInitiativeIdList(input.fileIds).slice(0, 20),
    link: cleanText(input.link, 1000),
    mentionedUserIds: safeInitiativeIdList(input.mentionedUserIds).slice(0, 20),
    blockerOwnerId: type === 'blocker' ? cleanText(input.blockerOwnerId, 128) : '',
    blockerDueDate: type === 'blocker' ? cleanText(input.blockerDueDate, 10) : '',
    blockerStatus: type === 'blocker' ? cleanText(input.blockerStatus, 20) || 'open' : '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function addInitiativeUpdateComment({ db, schoolId, initiativeId, updateId, actor, text }) {
  const body = cleanText(text, 1000);
  if (!body || !updateId) throw new Error('INVALID_COMMENT');
  const ref = doc(initiativeSubcollection(db, schoolId, initiativeId, 'comments'));
  await setDoc(ref, {
    schoolId,
    initiativeId,
    updateId: cleanText(updateId, 128),
    text: body,
    authorId: actor.uid,
    authorName: actor.fullName || '',
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function recomputeInitiativeSummary({ db, schoolId, initiative, milestones, updates, actor }) {
  const progress = initiativeProgress(milestones);
  const health = deriveInitiativeHealth({ initiative, milestones, updates });
  await updateDoc(initiativeDoc(db, schoolId, initiative.id), {
    health,
    progressPercent: progress.percent,
    completedMilestones: progress.completed,
    totalMilestones: progress.total,
    updatedBy: actor.uid,
    updatedAt: serverTimestamp(),
  });
  return { progress, health };
}

export async function saveInitiativeTemplate({ db, schoolId, initiative, milestones, actor }) {
  const ref = doc(schoolCollection(db, schoolId, 'initiativeTemplates', 'nested'));
  await setDoc(ref, {
    schoolId,
    title: initiative.title,
    description: initiative.description || '',
    category: initiative.category || '',
    goals: initiative.goals || [],
    milestoneTemplates: milestones.map(item => ({
      title: item.title,
      description: item.description || '',
      priority: item.priority || 'medium',
      weight: item.weight || 1,
      requiredOutput: item.requiredOutput || '',
      requiresEvidence: item.requiresEvidence === true,
      dateType: 'unset',
      dependencyOrder: item.dependencyId ? item.order : null,
      order: item.order || 0,
    })),
    status: 'active',
    createdBy: actor.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function duplicateInitiative({ db, schoolId, source, milestones, actor, options }) {
  const input = buildInitiativeClone(source, options);
  const initiativeId = await createInitiative({ db, schoolId, actor, input });
  if (options?.includeMilestones !== false) {
    for (const milestone of milestones) {
      await createMilestone({
        db, schoolId, initiativeId, actor,
        input: {
          ...milestone,
          status: 'not_started',
          dateType: options?.includeDates ? milestone.dateType : 'unset',
          startDate: options?.includeDates ? milestone.startDate : '',
          endDate: options?.includeDates ? milestone.endDate : '',
          proposedDate: options?.includeDates ? milestone.proposedDate : '',
          evidenceIds: [],
          completionSummary: '',
          cancelReason: '',
          fileIds: options?.includeFiles ? milestone.fileIds : [],
          ownerId: options?.includeOwners ? milestone.ownerId : '',
          participantIds: options?.includeOwners ? milestone.participantIds : [],
        },
      });
    }
  }
  return initiativeId;
}
