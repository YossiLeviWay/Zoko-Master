import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const envConfig = {
  VITE_FIREBASE_API_KEY: import.meta.env.VITE_FIREBASE_API_KEY,
  VITE_FIREBASE_AUTH_DOMAIN: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  VITE_FIREBASE_PROJECT_ID: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  VITE_FIREBASE_STORAGE_BUCKET: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  VITE_FIREBASE_MESSAGING_SENDER_ID: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  VITE_FIREBASE_APP_ID: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const missingFirebaseVariables = Object.entries(envConfig)
  .filter(([, value]) => !value)
  .map(([name]) => name);

export const isFirebaseConfigured = missingFirebaseVariables.length === 0;

const firebaseConfig = {
  apiKey: envConfig.VITE_FIREBASE_API_KEY || 'configuration-required',
  authDomain: envConfig.VITE_FIREBASE_AUTH_DOMAIN || 'configuration-required.invalid',
  projectId: envConfig.VITE_FIREBASE_PROJECT_ID || 'configuration-required',
  storageBucket: envConfig.VITE_FIREBASE_STORAGE_BUCKET || 'configuration-required.invalid',
  messagingSenderId: envConfig.VITE_FIREBASE_MESSAGING_SENDER_ID || '0',
  appId: envConfig.VITE_FIREBASE_APP_ID || '1:0:web:0',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Secondary app used only for creating user accounts without signing out the current admin/principal
const secondaryApp = initializeApp(firebaseConfig, 'userCreation');
export const secondaryAuth = getAuth(secondaryApp);

export default app;
