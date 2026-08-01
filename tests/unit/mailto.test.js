import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMailtoUrl,
  invalidEmailAddresses,
  normalizeEmailList,
  prepareMailtoLaunch,
} from '../../src/utils/mailto.js';

test('mailto builder encodes Hebrew content and multiple to, cc and bcc recipients', () => {
  const url = buildMailtoUrl({
    to: ['first@example.com', 'second@example.com'],
    cc: 'copy@example.com; another@example.com',
    bcc: ['hidden@example.com'],
    subject: 'עדכון בנושא תלמיד',
    body: 'שלום,\nזהו גוף המייל.',
  });

  assert.match(url, /^mailto:first%40example\.com,second%40example\.com\?/);
  const query = new URLSearchParams(url.split('?')[1]);
  assert.equal(query.get('cc'), 'copy@example.com,another@example.com');
  assert.equal(query.get('bcc'), 'hidden@example.com');
  assert.equal(query.get('subject'), 'עדכון בנושא תלמיד');
  assert.equal(query.get('body'), 'שלום,\nזהו גוף המייל.');
});

test('email normalization removes duplicates and reports malformed addresses', () => {
  assert.deepEqual(normalizeEmailList(' USER@example.com; user@example.com\nsecond@example.com '), [
    'user@example.com',
    'second@example.com',
  ]);
  assert.deepEqual(invalidEmailAddresses('valid@example.com; invalid-address'), ['invalid-address']);
});

test('long mailto draft falls back to recipients and subject without discarding the body', () => {
  const body = 'תוכן ארוך '.repeat(500);
  const launch = prepareMailtoLaunch({
    to: ['user@example.com'],
    subject: 'נושא',
    body,
  }, 300);

  assert.equal(launch.copyBodyRequired, true);
  assert.ok(launch.fullUrlLength > 300);
  const query = new URLSearchParams(launch.href.split('?')[1]);
  assert.equal(query.get('subject'), 'נושא');
  assert.equal(query.get('body'), null);
});
