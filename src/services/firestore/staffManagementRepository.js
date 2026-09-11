import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { canManageStaffMember, schoolJobTitle, staffMutation } from '../../utils/staffManagement.js';
import { privateSessionGuard } from '../../utils/browserPrivacy.js';

// Both the regular menu and Zoki use this rule-authorized Spark transaction.
// This removes institutional access, never the Firebase Auth account.
export async function changeStaffMember({ db, actorId, schoolId, userId, operation, title, expectedTitle, requestId, confirmed }) {
  if (!confirmed || ![actorId, schoolId, userId, requestId].every(id => typeof id === 'string' && /^[\w-]{1,128}$/.test(id))) throw new Error('invalid-input');
  const assertSession = privateSessionGuard();
  const payload = JSON.stringify([actorId, schoolId, userId, operation, title ?? '', expectedTitle ?? '']);
  const payloadHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))), byte => byte.toString(16).padStart(2, '0')).join('');
  assertSession();
  const userRef = doc(db, 'users', userId);
  const memberRef = doc(db, 'schools', schoolId, 'memberships', userId);
  const receiptRef = doc(db, 'schools', schoolId, 'staffChanges', requestId);
  return runTransaction(db, async transaction => {
    const [actor, target, receipt, membership] = await Promise.all([
      transaction.get(doc(db, 'users', actorId)), transaction.get(userRef), transaction.get(receiptRef), transaction.get(memberRef),
    ]);
    assertSession();
    if (receipt.exists()) {
      const saved = receipt.data();
      if (saved.actorId !== actorId || saved.userId !== userId || saved.operation !== operation || saved.payloadHash !== payloadHash) throw new Error('invalid-input');
      return { ok: true, repeated: true };
    }
    if (!target.exists() || !actor.exists() || !canManageStaffMember({ ...actor.data(), uid: actorId }, { ...target.data(), uid: userId }, schoolId)) throw new Error('permission-denied');
    if (operation === 'jobTitle' && schoolJobTitle(target.data(), schoolId) !== expectedTitle) throw new Error('stale-proposal');
    const marker = { schoolId, requestId };
    transaction.update(userRef, { ...staffMutation(target.data(), schoolId, operation, title), staffChange: marker, updatedAt: serverTimestamp() });
    if (operation === 'remove' && membership.exists()) transaction.update(memberRef, { status: 'revoked', updatedAt: serverTimestamp(), staffChange: marker });
    transaction.set(receiptRef, { actorId, userId, schoolId, operation, payloadHash, createdAt: serverTimestamp() });
    return { ok: true };
  });
}
