// Account identity stays in memory only. Token refresh still reloads profile
// and permissions, but does not tear down the current authenticated screen.
export function createAuthLoadingGate() {
  let previousUid;
  return user => {
    const uid = user?.uid || null;
    const changed = previousUid !== uid;
    previousUid = uid;
    return changed;
  };
}
