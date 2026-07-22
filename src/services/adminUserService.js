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
