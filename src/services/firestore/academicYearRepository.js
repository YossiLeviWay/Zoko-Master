import {
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { schoolCollection, schoolDoc } from './paths';

export const DEFAULT_ACADEMIC_YEARS = Object.freeze([
  Object.freeze({ id: 'year_2025_2026', label: 'תשפ״ו', startYear: 2025, endYear: 2026, status: 'closed' }),
  Object.freeze({ id: 'year_2026_2027', label: 'תשפ״ז', startYear: 2026, endYear: 2027, status: 'active' }),
]);

export const INITIAL_ACTIVE_ACADEMIC_YEAR_ID = 'year_2026_2027';

function normalizedYear(year) {
  return {
    id: year.id,
    label: String(year.label || `${year.startYear}-${year.endYear}`).trim(),
    startYear: Number(year.startYear),
    endYear: Number(year.endYear),
    status: year.status === 'archived' ? 'archived' : year.status === 'closed' ? 'closed' : 'active',
  };
}

export function academicYearId(startYear, endYear = Number(startYear) + 1) {
  return `year_${Number(startYear)}_${Number(endYear)}`;
}

export function academicYearIdFromLegacy(value) {
  const match = String(value || '').match(/(20\d{2})\D+(20\d{2})/);
  return match ? academicYearId(match[1], match[2]) : '';
}

export function subscribeAcademicYears({ db, schoolId, onData, onError }) {
  return onSnapshot(
    schoolCollection(db, schoolId, 'academicYears'),
    snapshot => {
      const merged = new Map(DEFAULT_ACADEMIC_YEARS.map(year => [year.id, year]));
      snapshot.docs.forEach(item => merged.set(item.id, normalizedYear({ id: item.id, ...item.data() })));
      onData([...merged.values()].sort((a, b) => b.startYear - a.startYear));
    },
    onError,
  );
}

export function subscribeAcademicYearSettings({ db, schoolId, onData, onError }) {
  return onSnapshot(
    schoolDoc(db, schoolId, 'settings', 'academic_years'),
    snapshot => onData({
      activeAcademicYearId: snapshot.data()?.activeAcademicYearId || INITIAL_ACTIVE_ACADEMIC_YEAR_ID,
      exists: snapshot.exists(),
    }),
    onError,
  );
}

export async function ensureInitialAcademicYears({ db, schoolId, actor }) {
  const settingsRef = schoolDoc(db, schoolId, 'settings', 'academic_years');
  await runTransaction(db, async transaction => {
    const settingsSnapshot = await transaction.get(settingsRef);
    for (const year of DEFAULT_ACADEMIC_YEARS) {
      const yearRef = schoolDoc(db, schoolId, 'academicYears', year.id);
      const snapshot = await transaction.get(yearRef);
      if (!snapshot.exists()) transaction.set(yearRef, {
        ...year,
        schoolId,
        createdBy: actor.uid,
        updatedBy: actor.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    if (!settingsSnapshot.exists()) transaction.set(settingsRef, {
      schoolId,
      activeAcademicYearId: INITIAL_ACTIVE_ACADEMIC_YEAR_ID,
      createdBy: actor.uid,
      updatedBy: actor.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
}

export async function createAcademicYear({ db, schoolId, actor, input }) {
  const startYear = Number(input.startYear);
  const endYear = Number(input.endYear || startYear + 1);
  if (!Number.isInteger(startYear) || endYear !== startYear + 1 || startYear < 2025 || startYear > 2200) {
    throw new Error('INVALID_ACADEMIC_YEAR');
  }
  const id = academicYearId(startYear, endYear);
  await setDoc(schoolDoc(db, schoolId, 'academicYears', id), {
    schoolId,
    label: String(input.label || `${startYear}-${endYear}`).trim().slice(0, 30),
    startYear,
    endYear,
    status: 'active',
    createdBy: actor.uid,
    updatedBy: actor.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return id;
}

export async function setActiveAcademicYear({ db, schoolId, actor, academicYearId: nextId }) {
  await setDoc(schoolDoc(db, schoolId, 'settings', 'academic_years'), {
    schoolId,
    activeAcademicYearId: nextId,
    updatedBy: actor.uid,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}
