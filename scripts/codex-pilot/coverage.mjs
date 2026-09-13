import { PilotError } from './client.mjs';
export function sourceManifest(file) {
  if (!file) return [];
  return file.pages.flatMap((page, index) => page.rows ? page.rows.map(row => ({ id: `S${index + 1}R${row.row}`, label: `${page.sheet} · שורה ${row.row}`, uncertain: (row.cells || []).some(cell => cell.warning) })) : [{ id: `P${page.page}`, label: `עמוד ${page.page}`, uncertain: page.visual === true || /\[UNCERTAIN\]/.test(page.text || '') }]);
}
export function validateCoverage(answer, manifest) {
  if (!manifest.length || !answer.actions?.length) return [];
  const allowed = new Set(manifest.map(row => row.id)), covered = new Set();
  const excluded = answer.excludedSources || [];
  if (!Array.isArray(excluded)) throw new PilotError('incomplete-source-coverage');
  for (const action of answer.actions || []) {
    if (!Array.isArray(action.sources)) throw new PilotError('incomplete-source-coverage');
    for (const id of action.sources) { if (!allowed.has(id)) throw new PilotError('unknown-source-row'); covered.add(id); }
    if (action.sources.some(id => manifest.find(row => row.id === id)?.uncertain)) action.needsReview = true;
  }
  for (const row of excluded) {
    if (!allowed.has(row.id) || typeof row.reason !== 'string' || !row.reason.trim() || row.reason.length > 500 || covered.has(row.id)) throw new PilotError('invalid-excluded-row');
    covered.add(row.id);
  }
  if (manifest.some(row => !covered.has(row.id))) throw new PilotError('incomplete-source-coverage');
  return excluded.map(row => ({ id: row.id, label: manifest.find(source => source.id === row.id).label, reason: row.reason }));
}
