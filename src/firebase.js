import { initializeApp, setLogLevel } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { connectAuthEmulator, getAuth, inMemoryPersistence, setPersistence } from 'firebase/auth';
import { connectFirestoreEmulator, initializeFirestore, memoryLocalCache, memoryLruGarbageCollector } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { connectStorageEmulator, getStorage } from 'firebase/storage';

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
// Data stays in RAM only (nothing is written to disk), but it is kept while the tab is open, so a
// page that was already loaded shows its data at once on the next visit instead of waiting for the
// network again. Logging out reloads the tab (see AuthContext), which empties this cache.
export const db = initializeFirestore(app, { localCache: memoryLocalCache({ garbageCollector: memoryLruGarbageCollector() }) });
export const functions = getFunctions(app, import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION || 'europe-west1');
export const storage = getStorage(app);

// Local testing only: the flag is honoured exclusively by the Vite dev server, so a
// production bundle can never be redirected to an emulator.
if (import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}

export default app;
