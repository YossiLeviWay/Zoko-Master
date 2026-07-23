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
export const createSchool = callable('createSchool');
export const updateSchool = callable('updateSchool');
export const deleteSchool = callable('deleteSchool');
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
