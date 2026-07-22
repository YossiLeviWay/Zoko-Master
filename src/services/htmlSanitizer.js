import DOMPurify from 'dompurify';

const DOCUMENT_TAGS = [
  'a', 'b', 'blockquote', 'br', 'code', 'col', 'colgroup', 'div', 'em', 'font',
  'h1', 'h2', 'h3', 'hr', 'i', 'li', 'ol', 'p', 'pre', 's', 'span', 'strong',
  'sub', 'sup', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul',
];

const DOCUMENT_ATTRIBUTES = [
  'align', 'class', 'colspan', 'dir', 'href', 'rel', 'rowspan', 'style', 'target',
];

export function sanitizeDocumentHtml(value) {
  if (typeof value !== 'string' || value.length === 0) return '';
  return DOMPurify.sanitize(value, {
    ALLOWED_TAGS: DOCUMENT_TAGS,
    ALLOWED_ATTR: DOCUMENT_ATTRIBUTES,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['embed', 'form', 'iframe', 'input', 'link', 'math', 'meta', 'object', 'script', 'style', 'svg'],
    FORBID_ATTR: ['src', 'srcdoc'],
  });
}
