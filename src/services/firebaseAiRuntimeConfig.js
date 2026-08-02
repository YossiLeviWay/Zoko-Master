import { fetchAndActivate, getRemoteConfig, getValue } from 'firebase/remote-config';
import { FIREBASE_AI_CONFIG } from '../config/firebaseAi';
import firebaseApp, { isFirebaseConfigured } from '../firebase';

let runtimePromise;

const remoteBoolean = (remoteConfig, key, fallback) => {
  const source = getValue(remoteConfig, key);
  return source.getSource() === 'static' ? fallback : source.asBoolean();
};

const remoteInteger = (remoteConfig, key, fallback) => {
  const value = getValue(remoteConfig, key).asNumber();
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
};

export async function getFirebaseAiRuntimeConfig() {
  if (!isFirebaseConfigured) return FIREBASE_AI_CONFIG;
  if (!runtimePromise) runtimePromise = (async () => {
    try {
      const remoteConfig = getRemoteConfig(firebaseApp);
      remoteConfig.settings.fetchTimeoutMillis = 4000;
      remoteConfig.settings.minimumFetchIntervalMillis = 60 * 60 * 1000;
      remoteConfig.defaultConfig = {
        zoko_task_assistant_enabled: String(FIREBASE_AI_CONFIG.taskAssistantEnabled),
        zoko_ai_model: FIREBASE_AI_CONFIG.model,
        zoko_task_assistant_daily_limit: String(FIREBASE_AI_CONFIG.dailyRequestsPerUser),
        zoko_task_assistant_timeout_ms: String(FIREBASE_AI_CONFIG.timeoutMs),
      };
      await fetchAndActivate(remoteConfig);
      const model = getValue(remoteConfig, 'zoko_ai_model').asString().trim();
      return {
        ...FIREBASE_AI_CONFIG,
        model: model || FIREBASE_AI_CONFIG.model,
        taskAssistantEnabled: remoteBoolean(remoteConfig, 'zoko_task_assistant_enabled', FIREBASE_AI_CONFIG.taskAssistantEnabled),
        dailyRequestsPerUser: remoteInteger(remoteConfig, 'zoko_task_assistant_daily_limit', FIREBASE_AI_CONFIG.dailyRequestsPerUser),
        timeoutMs: remoteInteger(remoteConfig, 'zoko_task_assistant_timeout_ms', FIREBASE_AI_CONFIG.timeoutMs),
      };
    } catch {
      return FIREBASE_AI_CONFIG;
    }
  })();
  return runtimePromise;
}
