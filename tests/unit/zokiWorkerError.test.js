import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCspViolation, noteCspViolation } from '../../src/utils/cspViolations.js';
import { classifyWorkerFetchError, visibleWorkerDiagnostic, workerFailure } from '../../src/utils/zokiWorkerError.js';

test('a fetch failure keeps its own name, and a timeout is not called unreachable', () => {
  const unreachable = classifyWorkerFetchError(new TypeError('Failed to fetch'), 'host zoko.workers.dev | online true | build abc1234');
  assert.equal(unreachable.code, 'worker-unreachable');
  assert.match(unreachable.detail, /worker-unreachable \| TypeError: Failed to fetch/u);
  assert.match(unreachable.detail, /host zoko\.workers\.dev/u);
  assert.match(unreachable.detail, /build abc1234/u);
  const timeout = classifyWorkerFetchError(Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' }));
  assert.equal(timeout.code, 'worker-timeout');
  assert.match(timeout.detail, /TimeoutError/u);
  const token = workerFailure('id-token-failed', Object.assign(new Error('network down'), { name: 'FirebaseError' }));
  assert.equal(token.code, 'id-token-failed');
  assert.match(token.detail, /FirebaseError: network down/u);
  const shown = visibleWorkerDiagnostic({ code: 'worker-unreachable' }, 'abc1234');
  assert.match(shown, /worker-unreachable \| Error:/u);
  assert.match(shown, /build abc1234/u);
  const violation = noteCspViolation({ blockedURI: 'https://zoko-task-agent.yossi-levi019.workers.dev/v1/zoki/turn', violatedDirective: 'connect-src' });
  assert.equal(formatCspViolation(violation), 'csp connect-src blocked https://zoko-task-agent.yossi-levi019.workers.dev/v1/zoki/turn');
  assert.match(visibleWorkerDiagnostic({ code: 'worker-unreachable', detail: 'worker-unreachable | TypeError: Failed to fetch' }, 'abc1234'), /csp connect-src blocked https:\/\/zoko-task-agent\.yossi-levi019\.workers\.dev/u);
});
