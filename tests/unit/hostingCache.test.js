import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('index.html is not cached, hashed assets stay immutable, and no service worker is registered', () => {
  const hosting = JSON.parse(readFileSync(new URL('../../firebase.json', import.meta.url))).hosting;
  const cache = source => hosting.headers.filter(rule => rule.source === source).at(-1)?.headers.find(header => header.key === 'Cache-Control')?.value || '';
  assert.match(cache('**'), /no-cache/u);
  assert.match(cache('/index.html'), /no-cache/u);
  assert.match(cache('/unregister-sw.js'), /no-cache/u);
  assert.match(cache('**/*.@(js|css)'), /immutable/u);
  const sources = hosting.headers.map(rule => rule.source);
  assert.ok(sources.indexOf('**/*.@(js|css)') < sources.indexOf('/unregister-sw.js'));
  assert.ok(sources.indexOf('**/*.@(js|css)') < sources.indexOf('/index.html'));
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const policy = source => hosting.headers.filter(rule => rule.source === source).at(-1)?.headers.find(header => header.key === 'Content-Security-Policy')?.value || '';
  assert.match(policy('**'), /https:\/\/zoko-task-agent\.yossi-levi019\.workers\.dev/u);
  assert.match(html, /https:\/\/zoko-task-agent\.yossi-levi019\.workers\.dev/u);
  assert.match(html, /unregister-sw\.js/u);
  assert.match(html, /zoko-build/u);
  assert.doesNotMatch(html, /serviceWorker\.register/u);
  const killer = readFileSync(new URL('../../public/unregister-sw.js', import.meta.url), 'utf8');
  assert.match(killer, /unregister\(/u);
  assert.doesNotMatch(killer, /\.register\(/u);
});
