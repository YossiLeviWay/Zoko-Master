import { PilotError } from './client.mjs';

// Firebase credentials stay in this process's memory, never in queue documents,
// Codex prompts, browser storage, logs or files. Re-pair after a process restart.
export function memoryCredentials({ token, refreshToken, apiKey, fetchImpl = fetch, now = Date.now }) {
  let current = token, renewal = refreshToken, refreshAt = now() + 40 * 60 * 1000;
  let active = true;
  return {
    async token() {
      if (!active) throw new PilotError('session-expired');
      if (now() >= refreshAt) {
        const response = await fetchImpl(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: renewal }),
          signal: AbortSignal.timeout(20000),
        }).catch(() => { throw new PilotError('firebase-unavailable'); });
        if (response.status === 429 || response.status >= 500) throw new PilotError('firebase-unavailable');
        if (!response.ok) throw new PilotError('session-expired');
        const result = await response.json();
        if (!active || typeof result.id_token !== 'string' || typeof result.refresh_token !== 'string') throw new PilotError('session-expired');
        current = result.id_token; renewal = result.refresh_token;
        refreshAt = now() + Math.min(40 * 60, Math.max(30, Number(result.expires_in || 3600) - 300)) * 1000;
      }
      return current;
    },
    clear() { active = false; current = ''; renewal = ''; },
  };
}
