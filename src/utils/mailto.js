export const MAX_MAILTO_URL_LENGTH = 1800;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmailList(value) {
  const items = Array.isArray(value)
    ? value
    : String(value || '').split(/[;,\n]/);
  return [...new Set(items.map(item => String(item || '').trim().toLowerCase()).filter(Boolean))];
}

export function invalidEmailAddresses(value) {
  return normalizeEmailList(value).filter(email => !EMAIL_PATTERN.test(email));
}

function encodedRecipients(value) {
  return normalizeEmailList(value).map(encodeURIComponent).join(',');
}

function queryString(entries) {
  return entries
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
}

export function buildMailtoUrl({ to = [], cc = [], bcc = [], subject = '', body = '' }) {
  const query = queryString([
    ['cc', normalizeEmailList(cc).join(',')],
    ['bcc', normalizeEmailList(bcc).join(',')],
    ['subject', String(subject || '')],
    ['body', String(body || '')],
  ]);
  return `mailto:${encodedRecipients(to)}${query ? `?${query}` : ''}`;
}

export function prepareMailtoLaunch(draft, maxLength = MAX_MAILTO_URL_LENGTH) {
  const fullUrl = buildMailtoUrl(draft);
  if (fullUrl.length <= maxLength) {
    return { href: fullUrl, copyBodyRequired: false, fullUrlLength: fullUrl.length };
  }
  const fallbackUrl = buildMailtoUrl({
    to: draft.to,
    cc: draft.cc,
    bcc: draft.bcc,
    subject: draft.subject,
  });
  return { href: fallbackUrl, copyBodyRequired: true, fullUrlLength: fullUrl.length };
}

export async function copyTextToClipboard(text) {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    throw new Error('Clipboard is unavailable');
  }
  await navigator.clipboard.writeText(String(text || ''));
}
