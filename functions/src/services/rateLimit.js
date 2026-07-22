import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { adminDb } from './firebaseAdmin.js';

export async function enforceRateLimit({ uid, action, limit = 20, windowSeconds = 60 }) {
  const key = `${uid}_${action}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  const ref = adminDb.collection('securityRateLimits').doc(key);
  const now = Timestamp.now();

  await adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data();
    const windowStartedAt = data?.windowStartedAt;
    const windowExpired = !windowStartedAt
      || now.toMillis() - windowStartedAt.toMillis() >= windowSeconds * 1000;

    if (windowExpired) {
      transaction.set(ref, {
        uid,
        action,
        count: 1,
        windowStartedAt: now,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return;
    }

    if ((data.count || 0) >= limit) {
      throw new HttpsError('resource-exhausted', 'נשלחו יותר מדי בקשות. נסו שוב מאוחר יותר.');
    }

    transaction.update(ref, {
      count: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}
