import test from 'node:test';
import assert from 'node:assert/strict';
import { requireRecentMfa } from '../src/services/platformSecurity.js';

function request({ secondFactor = 'totp', ageSeconds = 0 } = {}) {
  return { auth: { token: { auth_time: Math.floor(Date.now() / 1000) - ageSeconds, firebase: { sign_in_second_factor: secondFactor } } } };
}

test('sensitive platform operations require recent MFA', () => {
  assert.doesNotThrow(() => requireRecentMfa(request({ ageSeconds: 30 })));
  assert.throws(() => requireRecentMfa(request({ secondFactor: null })));
  assert.throws(() => requireRecentMfa(request({ ageSeconds: 601 })));
});
