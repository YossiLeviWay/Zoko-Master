import { initializeApp, setLogLevel } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAuth, inMemoryPersistence, setPersistence } from 'firebase/auth';
import { initializeFirestore, memoryLocalCache } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { getStorage } from 'firebase/storage';

const environmentConfig = {
  VITE_FIREBASE_API_KEY: import.meta.env.VITE_FIREBASE_API_KEY,
  VITE_FIREBASE_AUTH_DOMAIN: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  VITE_FIREBASE_PROJECT_ID: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  VITE_FIREBASE_STORAGE_BUCKET: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  VITE_FIREBASE_MESSAGING_SENDER_ID: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  VITE_FIREBASE_APP_ID: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const missingFirebaseVariables = Object.entries(environmentConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key);

export const isFirebaseConfigured = missingFirebaseVariables.length === 0;

const firebaseConfig = {
  apiKey: environmentConfig.VITE_FIREBASE_API_KEY || 'configuration-required',
  authDomain: environmentConfig.VITE_FIREBASE_AUTH_DOMAIN || 'configuration-required.invalid',
  projectId: environmentConfig.VITE_FIREBASE_PROJECT_ID || 'configuration-required',
  storageBucket: environmentConfig.VITE_FIREBASE_STORAGE_BUCKET || 'configuration-required.invalid',
  messagingSenderId: environmentConfig.VITE_FIREBASE_MESSAGING_SENDER_ID || '0',
  appId: environmentConfig.VITE_FIREBASE_APP_ID || '1:0:web:0',
};

// SDK errors may include document paths or request details. The UI presents
// fixed, actionable messages instead of forwarding these diagnostics.
setLogLevel('silent');
const app = initializeApp(firebaseConfig);

const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY;
export const isAppCheckConfigured = Boolean(isFirebaseConfigured && appCheckSiteKey);
export const appCheck = isFirebaseConfigured && appCheckSiteKey
  ? initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    })
  : null;

export const auth = getAuth(app);
// Move any existing SDK login out of disk storage before rendering the app.
// Subsequent logins remain in memory; authorization and MFA are unchanged.
export const authPrivacyReady = setPersistence(auth, inMemoryPersistence);
export const db = initializeFirestore(app, { localCache: memoryLocalCache() });
export const functions = getFunctions(app, import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION || 'europe-west1');
export const storage = getStorage(app);

export default app;
