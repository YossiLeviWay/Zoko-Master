import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
// Snapshot of the last production UI (6b3f923); remove after the staged rollout.
// Loading at the original module ID preserves relative imports and React transforms.
const baseline = JSON.parse(readFileSync(new URL('./simple-access-legacy.json', import.meta.url), 'utf8'));
export function simpleAccessRollout(enabled) {
  return {
    name: 'simple-access-rollout',
    enforce: 'pre',
    load(id) {
      if (enabled || id.includes('?')) return null;
      const relative = path.relative(root, id).split(path.sep).join('/');
      return Object.hasOwn(baseline, relative) ? baseline[relative] : null;
    },
  };
}
