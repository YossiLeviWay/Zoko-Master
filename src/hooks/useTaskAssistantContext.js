import { useEffect, useMemo, useState } from 'react';
import { documentId, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext.jsx';
import { db } from '../firebase.js';
import { usePermissions } from './usePermissions.js';
import { listSchoolStaff, subscribeClasses } from '../services/firestore/classStudentRepository.js';
import { subscribeInitiatives } from '../services/firestore/initiativeRepository.js';
import { schoolCollection, schoolDoc } from '../services/firestore/paths.js';
import { subscribeOrganizationTasks, subscribePersonalTasks } from '../services/firestore/taskRepository.js';
import { getZokiTaskGuidance } from '../services/adminUserService.js';

const emptySources = () => ({
  staff: [], teams: [], roles: [], classes: [], events: [], holidays: [], initiatives: [], tasks: [], files: [], approvedRules: [], playbooks: [],
});

function uniqueIds(value) {
  return [...new Set((Array.isArray(value) ? value : []).filter(item => typeof item === 'string' && item))];
}

async function documentsByIds(ref, ids) {
  const snapshots = await Promise.all(Array.from({ length: Math.ceil(ids.length / 30) }, (_, index) => (
    getDocs(query(ref, where(documentId(), 'in', ids.slice(index * 30, index * 30 + 30))))
  )));
  return snapshots.flatMap(snapshot => snapshot.docs.map(item => ({ id: item.id, ...item.data() })));
}

export function useTaskAssistantContext() {
  const { currentUser, userData, selectedSchool, isPrincipal, isGlobalAdmin } = useAuth();
  const { permissions, permissionScopes, loading: permissionsLoading } = usePermissions();
  const schoolId = selectedSchool || userData?.schoolId;
  const uid = currentUser?.uid;
  const manager = isPrincipal() || isGlobalAdmin();
  const [sources, setSources] = useState(emptySources);
  const [sourceLoading, setSourceLoading] = useState(true);

  const assignedTeamIds = useMemo(() => {
    const memberships = uniqueIds([userData?.schoolId, ...(userData?.schoolIds || [])]);
    return uniqueIds(userData?.teamIdsBySchool?.[schoolId]
      || (memberships.length === 1 ? userData?.teamIds : []));
  }, [schoolId, userData]);

  const explicitClassIds = useMemo(() => uniqueIds([
    ...(permissionScopes['classes.view']?.classIds || []),
    ...(permissionScopes.classes_view?.classIds || []),
    ...(userData?.classIdsBySchool?.[schoolId] || []),
  ]), [permissionScopes, schoolId, userData?.classIdsBySchool]);

  const canSeeStaff = manager || permissions['staff.view'] || permissions.staff_view || permissions['tasks.assign'] || permissions.tasks_assign;
  const canSeeAllTeams = manager || permissions['teams.view'] || permissions.teams_view || permissions['tasks.assign'] || permissions.tasks_assign;
  const canSeeOwnTeams = canSeeAllTeams || permissions['tasks.viewTeam'] || permissions.tasks_view;
  const canSeeRoles = manager || permissions['roles.view'] || permissions['staff.view'] || permissions.staff_view;
  const canSeeClasses = manager || permissions['classes.view'] || permissions.classes_view;
  const canSeeCalendar = manager || permissions['calendar.view'] || permissions.calendar_view;
  const canSeeInitiatives = manager || permissions['initiatives.view'] || permissions['initiatives.viewAll'];
  const canViewAllInitiatives = manager || permissions['initiatives.viewAll'];
  const canViewAllTasks = manager || permissions['tasks.viewAll'];

  useEffect(() => {
    setSources(emptySources());
    if (!schoolId || !uid || permissionsLoading) {
      setSourceLoading(Boolean(schoolId && uid));
      return undefined;
    }
    let active = true;
    const unsubscribers = [];
    const patch = value => active && setSources(previous => ({ ...previous, ...value }));
    let taskAgentRules = [];
    let taskPlaybooks = [];
    let zokiRules = [];
    const updateGuidance = () => patch({
      approvedRules: [...new Set([...taskAgentRules, ...zokiRules])],
      playbooks: taskPlaybooks,
    });
    const finishers = [];
    const track = promise => {
      finishers.push(promise.catch(() => undefined));
      return promise;
    };

    if (canSeeStaff) track(listSchoolStaff(db, schoolId).then(staff => patch({ staff })).catch(() => patch({ staff: [] })));

    if (canSeeRoles) track(getDocs(schoolCollection(db, schoolId, 'roles')).then(snapshot => patch({
      roles: snapshot.docs.map(item => ({ id: item.id, ...item.data() })).filter(item => item.status !== 'archived'),
    })).catch(() => patch({ roles: [] })));

    if (canSeeOwnTeams) {
      if (canSeeAllTeams) track(getDocs(schoolCollection(db, schoolId, 'teams')).then(snapshot => patch({
        teams: snapshot.docs.map(item => ({ id: item.id, ...item.data() })),
      })).catch(() => patch({ teams: [] })));
      else if (assignedTeamIds.length) track(documentsByIds(schoolCollection(db, schoolId, 'teams'), assignedTeamIds)
        .then(teams => patch({ teams })).catch(() => patch({ teams: [] })));
    }

    if (canSeeClasses) unsubscribers.push(subscribeClasses({
      db, schoolId, uid, explicitClassIds,
      canViewAll: manager || permissionScopes['classes.view']?.type === 'school' || permissionScopes.classes_view?.type === 'school',
      onData: classes => patch({ classes: classes.filter(item => item.status !== 'archived') }),
      onError: () => patch({ classes: [] }),
    }));

    if (canSeeCalendar) {
      unsubscribers.push(onSnapshot(schoolCollection(db, schoolId, 'events'), snapshot => patch({ events: snapshot.docs.map(item => ({ id: item.id, ...item.data() })) }), () => patch({ events: [] })));
      unsubscribers.push(onSnapshot(schoolCollection(db, schoolId, 'holidays'), snapshot => patch({ holidays: snapshot.docs.map(item => ({ id: item.id, ...item.data() })) }), () => patch({ holidays: [] })));
    }

    if (permissions['tasks.useAssistant'] || manager) unsubscribers.push(onSnapshot(
      schoolDoc(db, schoolId, 'settings', 'task_agent'),
      snapshot => {
        const data = snapshot.data() || {};
        taskAgentRules = Array.isArray(data.approvedRules) ? data.approvedRules : [];
        taskPlaybooks = Array.isArray(data.taskPlaybooks) ? data.taskPlaybooks : [];
        updateGuidance();
      },
      () => { taskAgentRules = []; taskPlaybooks = []; updateGuidance(); },
    ));
    if (permissions['tasks.useAssistant'] || manager) track(getZokiTaskGuidance({ schoolId })
      .then(result => { zokiRules = Array.isArray(result?.rules) ? result.rules : []; updateGuidance(); })
      .catch(() => { zokiRules = []; updateGuidance(); }));

    if (canSeeInitiatives) unsubscribers.push(subscribeInitiatives({
      db, schoolId, uid, teamIds: assignedTeamIds, canViewAll: canViewAllInitiatives,
      onData: initiatives => patch({ initiatives }), onError: () => patch({ initiatives: [] }),
    }));

    if (manager) track(getDocs(schoolCollection(db, schoolId, 'files')).then(snapshot => patch({
      files: snapshot.docs.map(item => ({ id: item.id, ...item.data() })),
    })).catch(() => patch({ files: [] })));

    let personalTasks = [];
    let organizationTasks = [];
    const updateTasks = () => patch({
      tasks: [...personalTasks, ...organizationTasks.filter(task => task.createdBy === uid)],
    });
    unsubscribers.push(subscribePersonalTasks({
      db, uid, schoolId, onData: items => { personalTasks = items; updateTasks(); }, onError: () => undefined,
    }));
    unsubscribers.push(subscribeOrganizationTasks({
      db, uid, schoolId, teamIds: assignedTeamIds, canViewAll: canViewAllTasks,
      onData: items => { organizationTasks = items; updateTasks(); }, onError: () => undefined,
    }));

    setSourceLoading(true);
    Promise.all(finishers).finally(() => { if (active) setSourceLoading(false); });
    if (finishers.length === 0) setSourceLoading(false);
    return () => {
      active = false;
      unsubscribers.forEach(unsubscribe => unsubscribe());
    };
  }, [
    assignedTeamIds, canSeeAllTeams, canSeeCalendar, canSeeClasses, canSeeInitiatives, canSeeOwnTeams,
    canSeeRoles, canSeeStaff, canViewAllInitiatives, canViewAllTasks, explicitClassIds, manager,
    permissionScopes, permissions, permissionsLoading, schoolId, uid,
  ]);

  const schoolContext = useMemo(() => ({
    capabilities: { canAssign: manager || permissions['tasks.assign'] || permissions.tasks_assign },
    permissions: {
      ...permissions,
      __principal: manager,
      teams_view: canSeeOwnTeams,
      classes_view: canSeeClasses,
    },
    sources,
  }), [canSeeClasses, canSeeOwnTeams, manager, permissions, sources]);

  return { schoolContext, loading: permissionsLoading || sourceLoading };
}
