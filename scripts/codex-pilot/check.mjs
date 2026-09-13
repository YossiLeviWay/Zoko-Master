import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { canaryPng } from './canary.mjs';
import { CodexPilotClient } from './client.mjs';

export async function privacyCheck({ executable, onStatus = () => {} } = {}) {
  const cwd = await mkdtemp(join(tmpdir(), 'zoko-codex-check-'));
  const marker = `ZOKO_SYNTHETIC_${randomUUID()}`;
  const png = canaryPng(marker);
  const began = Date.now();
  const roots = new Set([process.env.CODEX_HOME || join(homedir(), '.codex')]);
  const client = new CodexPilotClient({ cwd, executable, timeoutMs: 60000 });
  let complete = false;
  try {
    const state = await client.initialize();
    if (!state.authenticated) return { ready: false, reason: 'codex-login-required' };
    const configuration = await client.call('config/read', { includeLayers: false });
    for (const key of ['sqlite_home', 'log_dir']) {
      const value = configuration.config?.[key];
      if (typeof value === 'string' && value) roots.add(value.startsWith('~/') ? join(homedir(), value.slice(2)) : resolve(value));
    }
    onStatus('checking');
    const response = await client.generate({ instructions: 'This is an English protocol test. Respond exactly READY. Do not translate. Do not use tools.', images: [`data:image/png;base64,${png.toString('base64')}`], text: `Synthetic text and image privacy test ${marker}. Return exactly READY. Do not call any tools.` });
    if (!['READY', 'מוכן'].includes(response.trim())) return { ready: false, reason: 'codex-probe-failed' };
    complete = true;
  } catch (error) { return { ready: false, reason: error.code || 'codex-probe-failed' }; }
  finally { client.close(); await rm(cwd, { recursive: true, force: true }); }
  if (!complete) return { ready: false, reason: 'codex-probe-failed' };
  // Look for the generated canary, never return existing history or file content.
  let checked = 0;
  const visit = async directory => {
    let entries; try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      if (['plugins', 'skills', 'node_modules', '.git', 'browser', 'vendor'].includes(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { await visit(path); continue; }
      if (!entry.isFile()) continue;
      const info = await stat(path).catch(() => null);
      if (!info || info.mtimeMs < began - 2000) continue;
      const bytes = await readFile(path); checked++;
      if (bytes.includes(marker) || bytes.includes(png.toString('base64'))) throw new Error('codex-persisted-test-content');
    }
  };
  try { for (const root of roots) await visit(root); if (!checked) throw new Error('unverifiable'); }
  catch { return { ready: false, reason: 'codex-privacy-check-failed' }; }
  return { ready: true, checkedFiles: checked, testedAt: new Date().toISOString() };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await privacyCheck(); console.log(JSON.stringify(result)); process.exitCode = result.ready ? 0 : 1;
}
