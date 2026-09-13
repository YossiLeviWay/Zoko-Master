import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, lstat, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PilotError } from './client.mjs';
import { digest } from './imports.mjs';

export async function loadIntegrityKey(directory) {
  await mkdir(directory, { mode: 0o700, recursive: true });
  const info = await lstat(directory);
  if (!info.isDirectory() || (info.mode & 0o077)) throw new PilotError('integrity-key-permissions');
  const path = join(directory, 'integrity.key');
  try { await writeFile(path, randomBytes(32), { mode: 0o600, flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const file = await lstat(path);
  if (!file.isFile() || (file.mode & 0o077)) throw new PilotError('integrity-key-permissions');
  const key = await readFile(path); if (key.length !== 32) throw new PilotError('integrity-key-invalid'); return key;
}
export function proposalSeal(key, proposal) {
  return createHmac('sha256', key).update(proposal.hash).digest('hex');
}
export function verifyProposalSeal(key, proposal) {
  const unsigned = Object.fromEntries(Object.entries(proposal).filter(([field]) => !['root','hash','seal'].includes(field)));
  if (digest(unsigned) !== proposal.hash || typeof proposal.seal !== 'string' || !/^[a-f0-9]{64}$/.test(proposal.seal)) throw new PilotError('proposal-unverified');
  const expected = Buffer.from(proposalSeal(key, proposal), 'hex');
  if (!timingSafeEqual(expected, Buffer.from(proposal.seal, 'hex'))) throw new PilotError('proposal-unverified');
}
