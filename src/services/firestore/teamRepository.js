import { addDoc, arrayUnion, serverTimestamp, updateDoc } from 'firebase/firestore';
import { schoolCollection, schoolDoc } from './paths';

const cleanText = (value, maxLength) => typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const safeIds = values => [...new Set((Array.isArray(values) ? values : [])
  .filter(value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)))]
  .slice(0, 50);

export async function createSchoolTeam({ db, schoolId, actor, name, description = '', memberIds = [] }) {
  const teamName = cleanText(name, 120);
  if (!db || !schoolId || !actor?.uid || teamName.length < 2) throw new Error('invalid-team');
  return addDoc(schoolCollection(db, schoolId, 'teams'), {
    schoolId,
    name: teamName,
    description: cleanText(description, 500),
    memberIds: safeIds(memberIds),
    managerIds: [actor.uid],
    createdBy: cleanText(actor.fullName, 120) || actor.uid,
    createdById: actor.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function addSchoolTeamMembers({ db, schoolId, teamId, memberIds }) {
  const members = safeIds(memberIds);
  if (!db || !schoolId || !teamId || !members.length) throw new Error('invalid-team-members');
  return updateDoc(schoolDoc(db, schoolId, 'teams', teamId), {
    memberIds: arrayUnion(...members),
    updatedAt: serverTimestamp(),
  });
}
