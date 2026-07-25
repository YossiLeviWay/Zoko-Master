import { failedPrecondition, permissionDenied } from './errors.js';

export function requirePlatformAdmin(actor) {
  if (!actor.platformAdmin) throw permissionDenied();
}

export function requireRecentMfa(request, { maxAgeSeconds = 600 } = {}) {
  const authTime = Number(request.auth?.token?.auth_time || 0);
  const secondFactor = request.auth?.token?.firebase?.sign_in_second_factor;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!secondFactor || !authTime || nowSeconds - authTime > maxAgeSeconds) throw failedPrecondition();
}
