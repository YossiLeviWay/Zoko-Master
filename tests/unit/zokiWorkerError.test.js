import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyWorkerFetchError, workerFailure } from '../../src/utils/zokiWorkerError.js';

test('a fetch failure keeps its own name, and a timeout is not called unreachable', () => {
  const unreachable = classifyWorkerFetchError(new TypeError('Failed to fetch'));
  assert.equal(unreachable.code, 'worker-unreachable');
  assert.match(unreachable.detail, /TypeError: Failed to fetch/u);
  const timeout = classifyWorkerFetchError(Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' }));
  assert.equal(timeout.code, 'worker-timeout');
  assert.match(timeout.detail, /TimeoutError/u);
  const token = workerFailure('id-token-failed', Object.assign(new Error('network down'), { name: 'FirebaseError' }));
  assert.equal(token.code, 'id-token-failed');
  assert.match(token.detail, /FirebaseError: network down/u);
});
