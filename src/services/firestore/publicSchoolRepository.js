import { collection, onSnapshot, query, where } from 'firebase/firestore';

export function subscribePublicSchools({ db, onData, onError }) {
  return onSnapshot(
    query(collection(db, 'schoolPublicDirectory'), where('status', '==', 'active')),
    snapshot => onData(snapshot.docs
      .map(item => ({ id: item.id, ...item.data() }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'he'))),
    onError,
  );
}
