// Evidence IDs remain in structured data for validation, never in chat prose.
export function zokiDisplayText(text, sources = []) {
  let result = String(text || '').replace(/[（([]\s*(?:מקור(?:ות)?|sources?)\s*:[^\])）]*[\])）]/giu, '');
  for (const source of sources) {
    const id = typeof source === 'string' ? source : source.id;
    if (typeof id === 'string' && id.includes('/')) result = result.split(id).join('');
  }
  return result
    .replace(/\busers\/[\w-]+/gu, '')
    .replace(/[（([]\s*[.\s]*[\])）]/gu, '')
    .replace(/(?:מקור(?:ות)?|sources?)\s*:\s*(?=[.,;!?]|$)/gimu, '')
    .replace(/[ \t]+([.,;!?])/gu, '$1')
    .replace(/([.,;!?])\s*\./gu, '$1')
    .replace(/[ \t]{2,}/gu, ' ')
    .trim();
}

export function zokiInline(text) {
  const parts = [];
  const pattern = /\*\*(.+?)\*\*/gu;
  let cursor = 0;
  for (const match of String(text || '').matchAll(pattern)) {
    if (match.index > cursor) parts.push({ text: text.slice(cursor, match.index) });
    parts.push({ strong: match[1] });
    cursor = match.index + match[0].length;
  }
  if (cursor < String(text || '').length) parts.push({ text: String(text).slice(cursor) });
  return parts.filter(part => part.strong || part.text);
}

export function zokiBlocks(text, sources) {
  const clean = zokiDisplayText(text, sources);
  if (!clean) return [];
  return clean.split(/\n{2,}/u).map(block => {
    const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
    if (lines.length && lines.every(line => /^[-*]\s+/u.test(line))) {
      return { type: 'list', items: lines.map(line => line.replace(/^[-*]\s+/u, '')) };
    }
    return { type: 'p', text: lines.join('\n') };
  });
}
