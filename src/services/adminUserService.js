import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

function callable(name) {
  const invoke = httpsCallable(functions, name);
  return async payload => {
    const result = await invoke(payload);
    return result.data;
  };
}

export const createStaffUser = callable('createStaffUser');
export const updateStaffUser = callable('updateStaffUser');
export const deleteStaffUser = callable('deleteStaffUser');
export const setUserRole = callable('setUserRole');
export const approveSchoolMembership = callable('approveSchoolMembership');
export const removeSchoolMembership = callable('removeSchoolMembership');
export const requestStaffPasswordReset = callable('requestStaffPasswordReset');
export const updateTeamMembership = callable('updateTeamMembership');
export const createServerNotifications = callable('createNotifications');
export const draftCommunicationWithAgent = callable('draftCommunicationWithAgent');
export const createSchool = callable('createSchool');
export const updateSchool = callable('updateSchool');
export const deleteSchool = callable('deleteSchool');
export const assignInstitutionManager = callable('assignInstitutionManager');
export const createStaffInvitation = callable('createStaffInvitation');
export const manageStaffInvitation = callable('manageStaffInvitation');
export const acceptStaffInvitation = callable('acceptStaffInvitation');
export const submitJoinRequest = callable('submitJoinRequest');
export const reviewJoinRequest = callable('reviewJoinRequest');
export const setActiveSchool = callable('setActiveSchool');
export const requestPublicPasswordReset = callable('requestPublicPasswordReset');
export const inviteTaskCollaborators = callable('inviteTaskCollaborators');
export const respondTaskInvitation = callable('respondTaskInvitation');
export const createMandatoryTask = callable('createMandatoryTask');
export const executeZokiTask = callable('executeZokiTask');
export const executeZokiGrade = callable('executeZokiGrade');
export const executeZokiStudentTransfer = callable('executeZokiStudentTransfer');
export const draftTaskWithAgent = callable('draftTaskWithAgent');
export const askZoki = callable('askZoki');
export const getZokiTaskGuidance = callable('getZokiTaskGuidance');
export const saveZokiBrainSettings = callable('saveZokiBrain');
export const listTaskPatternCandidates = callable('listTaskPatternCandidates');
export const reviewTaskPattern = callable('reviewTaskPattern');
export const createCustomRole = callable('createCustomRole');
export const updateCustomRole = callable('updateCustomRole');
export const archiveCustomRole = callable('archiveCustomRole');
export const cloneCustomRole = callable('cloneCustomRole');
export const assignCustomRole = callable('assignCustomRole');
export const upsertPersonalFileItem = callable('upsertPersonalFileItem');
export const archivePersonalFileItem = callable('archivePersonalFileItem');
export const recordPersonalFileAccess = callable('recordPersonalFileAccess');
export const upsertSkillCatalogItem = callable('upsertSkillCatalogItem');
export const createCvDocument = callable('createCvDocument');
export const saveCvDraft = callable('saveCvDraft');
export const duplicateCvDocument = callable('duplicateCvDocument');
export const finalizeCvDocument = callable('finalizeCvDocument');
export const archiveCvDocument = callable('archiveCvDocument');
export const registerCvPdf = callable('registerCvPdf');
export const recordCvAccess = callable('recordCvAccess');
export const upsertCvTemplate = callable('upsertCvTemplate');
export const cvTemplateAction = callable('cvTemplateAction');
export const previewBulkCvDrafts = callable('previewBulkCvDrafts');
export const bulkCreateCvDrafts = callable('bulkCreateCvDrafts');
export const bulkImportStudents = callable('bulkImportStudents');
export const upsertResourceAcl = callable('upsertResourceAcl');
export const removeResourceAcl = callable('removeResourceAcl');
export const setPermissionDelegation = callable('setPermissionDelegation');
export const startPermissionPreview = callable('startPermissionPreview');
export const evaluatePreviewAccess = callable('evaluatePreviewAccess');
export const fileTrashAction = callable('fileTrashAction');
export const previewClassGraduation = callable('previewClassGraduation');
export const graduateClass = callable('graduateClass');
export const restoreGraduate = callable('restoreGraduate');
export const initializeOutcomeTemplates = callable('initializeOutcomeTemplates');
export const upsertOutcomeDefinition = callable('upsertOutcomeDefinition');
export const outcomeDefinitionAction = callable('outcomeDefinitionAction');
export const upsertClassOutcomeTarget = callable('upsertClassOutcomeTarget');
export const calculateClassOutcomes = callable('calculateClassOutcomes');
export const manualOutcomeApproval = callable('manualOutcomeApproval');
export const requestForumAccess = callable('requestForumAccess');
export const reviewForumAccess = callable('reviewForumAccess');
export const revokeForumMembership = callable('revokeForumMembership');
export const upsertForumFolder = callable('upsertForumFolder');
export const createForumThread = callable('createForumThread');
export const createForumPost = callable('createForumPost');
export const forumContentAction = callable('forumContentAction');
export const createSupportTicket = callable('createSupportTicket');
export const updateSupportTicket = callable('updateSupportTicket');
export const listPlatformInstitutions = callable('listPlatformInstitutions');
export const listPlatformStaff = callable('listPlatformStaff');
export const platformStaffAction = callable('platformStaffAction');
export const repairPlatformStaffPermissions = callable('repairPlatformStaffPermissions');

export function callableReason(error) {
  return error?.details?.reason || error?.customData?.details?.reason || String(error?.code || '').replace(/^functions\//, '') || 'internal-error';
}

export function invitationErrorMessage(error) {
  const messages = {
    'permission-denied': 'אין הרשאה לשלוח הזמנה למוסד או לתפקיד שנבחרו.',
    'school-not-found': 'המוסד לא נמצא או אינו פעיל.',
    'school-disabled': 'המוסד מושבת ולכן לא ניתן לשלוח הזמנה.',
    'invitation-already-exists': 'כבר קיימת הזמנה פעילה לכתובת זו.',
    'email-already-member': 'כתובת הדוא״ל כבר משויכת לחבר פעיל במוסד.',
    'invalid-email': 'כתובת הדוא״ל אינה תקינה.',
    'email-provider-error': 'ההזמנה נשמרה, אך שירות הדוא״ל לא הצליח לשלוח אותה. ניתן לנסות שליחה מחדש.',
    'app-check-failed': 'אימות האפליקציה נכשל. רעננו את הדף או פנו למנהל המערכת.',
    unauthenticated: 'החיבור פג. התחברו מחדש ונסו שוב.',
    'invalid-argument': 'אחד מפרטי ההזמנה אינו תקין.',
  };
  return messages[callableReason(error)] || 'לא ניתן להשלים את הפעולה כרגע.';
}
