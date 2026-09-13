import { PilotError } from './client.mjs';
import { digest } from './imports.mjs';

// One immutable revision is split into bounded documents. A manifest becomes
// visible only after all pages were saved; no partial proposal is approvable.
export async function saveProposal(db, proposal) {
  const pages = []; let current = []; let bytes = 0;
  for (const item of proposal.items) {
    const size = Buffer.byteLength(JSON.stringify(item));
    if (size > 700000) throw new PilotError('proposal-row-too-large');
    if (bytes + size > 700000 && current.length) { pages.push(current); current = []; bytes = 0; }
    current.push(item); bytes += size;
  }
  if (current.length) pages.push(current);
  const base = `${proposal.root}/revisions/${proposal.revision}`;
  for (let i = 0; i < pages.length; i++) {
    const path = `${base}/pages/p${i}`; const data = { items: pages[i], hash: digest(pages[i]) };
    const existing = await db.get(path);
    if (existing) { if (existing.data.hash !== data.hash) throw new PilotError('approval-changed'); }
    else await db.commit([{ path, data }]);
  }
  const header = Object.fromEntries(Object.entries(proposal).filter(([key]) => key !== 'items'));
  const manifest = { ...header, pages: pages.length, count: proposal.items.length };
  const existing = await db.get(base);
  if (existing) { if (existing.data.hash !== proposal.hash) throw new PilotError('approval-changed'); }
  else await db.commit([{ path: base, data: manifest, timestamps: ['createdAt'] }]);
}
export async function loadProposal(db, root, revision) {
  const base = `${root}/revisions/${revision}`; const record = await db.get(base);
  if (!record || !Number.isInteger(record.data.pages) || record.data.pages > 10000) throw new PilotError('proposal-unavailable');
  const { pages, count } = record.data; const header = Object.fromEntries(Object.entries(record.data).filter(([key]) => !['pages','count','createdAt'].includes(key))); const items = [];
  for (let i = 0; i < pages; i++) {
    const page = await db.get(`${base}/pages/p${i}`);
    if (!page || digest(page.data.items) !== page.data.hash) throw new PilotError('proposal-unavailable');
    items.push(...page.data.items);
  }
  if (items.length !== count) throw new PilotError('proposal-unavailable');
  const { hash } = header; const unsigned = Object.fromEntries(Object.entries(header).filter(([key]) => !['root', 'hash', 'seal'].includes(key)));
  if (digest({ ...unsigned, items }) !== hash) {
    // Property ordering is significant to JSON digests; reconstruct canonical
    // proposal order instead of depending on Firestore's alphabetical maps.
    const canonical = { id: header.id, revision: header.revision, schoolId: header.schoolId, actorId: header.actorId, answer: header.answer, items };
    if (digest(canonical) !== hash) throw new PilotError('proposal-unavailable');
  }
  return { ...header, items };
}
export async function saveConversation(db, actor, state) {
  const path = `users/${actor.uid}/zokiPilot/${actor.schoolId}/state/conversation`;
  const existing = await db.get(path);
  await db.commit([{ path, version: existing?.version || null, data: { history: state.history, proposalId: state.proposal?.id || null, revision: state.proposal?.revision || null, executed: state.executed === true }, timestamps: ['updatedAt'] }]);
}
export async function restoreConversation(db, actor) {
  const value = await db.get(`users/${actor.uid}/zokiPilot/${actor.schoolId}/state/conversation`);
  const state = value?.data || {};
  const proposal = state.proposalId ? await loadProposal(db, `users/${actor.uid}/zokiPilot/${actor.schoolId}/proposals/${state.proposalId}`, state.revision) : null;
  return { history: state.history || [], proposal, executed: state.executed === true };
}
