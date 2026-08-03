const positiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const enabled = value => !['0', 'false', 'off', 'disabled'].includes(String(value || '').toLowerCase());

export const FIREBASE_AI_CONFIG = Object.freeze({
  model: import.meta.env.VITE_FIREBASE_AI_MODEL || 'gemini-3.5-flash-lite',
  taskAssistantEnabled: enabled(import.meta.env.VITE_TASK_ASSISTANT_ENABLED ?? 'true'),
  maxInputLength: positiveInteger(import.meta.env.VITE_TASK_ASSISTANT_MAX_INPUT, 1800),
  requestsPerWindow: positiveInteger(import.meta.env.VITE_TASK_ASSISTANT_WINDOW_LIMIT, 6),
  dailyRequestsPerUser: positiveInteger(import.meta.env.VITE_TASK_ASSISTANT_DAILY_LIMIT, 20),
  timeoutMs: positiveInteger(import.meta.env.VITE_TASK_ASSISTANT_TIMEOUT_MS, 8000),
});
