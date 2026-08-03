import { addDoc, serverTimestamp } from 'firebase/firestore';
import { schoolCollection } from './paths';

const cleanText = (value, maxLength) => typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

export async function createSchoolTeam({ db, schoolId, actor, name, description = '' }) {
  const teamName = cleanText(name, 120);
  if (!db || !schoolId || !actor?.uid || teamName.length < 2) throw new Error('invalid-team');
  return addDoc(schoolCollection(db, schoolId, 'teams'), {
    schoolId,
    name: teamName,
    description: cleanText(description, 500),
    memberIds: [],
    managerIds: [actor.uid],
    createdBy: cleanText(actor.fullName, 120) || actor.uid,
    createdById: actor.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
