import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';

// Runs a callback when the browser is idle, so warming up never competes with the page being opened.
export function whenIdle(callback) {
  if (typeof window === 'undefined') return () => undefined;
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(callback, { timeout: 2500 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(callback, 600);
  return () => window.clearTimeout(id);
}

const warmedSchools = new Set();

// Reads, once per school and tab, the small collections that the calendar needs before it can be
// shown. The answers land in the in-memory Firestore cache, so opening the page for the first
// time finds its data already there. Every read is best effort: a user who may not read a
// collection simply does not get it warmed.
export function warmSchoolData(db, schoolId) {
  if (!schoolId || warmedSchools.has(schoolId)) return;
  warmedSchools.add(schoolId);
  const today = new Date();
  const quiet = promise => promise.catch(() => undefined);
  quiet(getDocs(collection(db, `categories_${schoolId}`)));
  quiet(getDoc(doc(db, `settings_${schoolId}`, 'calendar')));
  quiet(getDocs(collection(db, `holidays_${schoolId}`)));
  quiet(getDocs(collection(db, `teams_${schoolId}`)));
  quiet(getDocs(query(
    collection(db, `events_${schoolId}`),
    where('year', '==', today.getFullYear()),
    where('month', '==', today.getMonth()),
  )));
}
