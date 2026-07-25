import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

if (getApps().length === 0) initializeApp();

export const adminAuth = getAuth();
export const adminDb = getFirestore();
export const adminStorage = getStorage();
export { Timestamp };
