import {
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { schoolCollection, schoolDoc } from './paths';
import {
  academicYearFromHebrewYear,
  academicYearIdForHebrewYear,
  CURRENT_HEBREW_ACADEMIC_YEAR,
  gregorianStartForHebrewYear,
  hebrewYearLabel,
} from '../../utils/academicYears';

export const DEFAULT_ACADEMIC_YEARS = Object.freeze([
  Object.freeze(academicYearFromHebrewYear(5786, 'closed')),
  Object.freeze(academicYearFromHebrewYear(5787, 'active')),
  Object.freeze(academicYearFromHebrewYear(5788, 'future')),
]);

export const INITIAL_ACTIVE_ACADEMIC_YEAR_ID = academicYearIdForHebrewYear(CURRENT_HEBREW_ACADEMIC_YEAR);

function normalizedYear(year) {
  const gregorianStartYear = Number(year.gregorianStartYear ?? year.startYear);
  const gregorianEndYear = Number(year.gregorianEndYear ?? year.endYear ?? gregorianStartYear + 1);
  const hebrewYearNumber = Number(year.hebrewYearNumber || gregorianStartYear + 3761);
  const hebrewLabel = String(year.hebrewLabel || year.label || hebrewYearLabel(hebrewYearNumber)).trim();
  return {
    id: year.id,
    hebrewYearNumber,
    hebrewLabel,
    gregorianStartYear,
    gregorianEndYear,
    startDate: year.startDate || `${gregorianStartYear}-09-01`,
    endDate: year.endDate || `${gregorianEndYear}-08-31`,
    isActive: year.isActive === true || year.status === 'active',
    label: hebrewLabel,
    startYear: gregorianStartYear,
    endYear: gregorianEndYear,
    status: ['archived', 'closed', 'future'].includes(year.status) ? year.status : 'active',
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
      onData([...merged.values()].map(normalizedYear).sort((a, b) => b.hebrewYearNumber - a.hebrewYearNumber));
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
  const hebrewYearNumber = Number(input.hebrewYearNumber);
  if (!Number.isInteger(hebrewYearNumber) || hebrewYearNumber < 5786 || hebrewYearNumber > 6000) {
    throw new Error('INVALID_ACADEMIC_YEAR');
  }
  const startYear = gregorianStartForHebrewYear(hebrewYearNumber);
  const endYear = startYear + 1;
  const id = academicYearIdForHebrewYear(hebrewYearNumber);
  const label = hebrewYearLabel(hebrewYearNumber);
  await setDoc(schoolDoc(db, schoolId, 'academicYears', id), {
    schoolId,
    hebrewYearNumber,
    hebrewLabel: label,
    gregorianStartYear: startYear,
    gregorianEndYear: endYear,
    startDate: input.startDate || `${startYear}-09-01`,
    endDate: input.endDate || `${endYear}-08-31`,
    isActive: false,
    label,
    startYear,
    endYear,
    status: 'future',
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
