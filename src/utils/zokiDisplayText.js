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
