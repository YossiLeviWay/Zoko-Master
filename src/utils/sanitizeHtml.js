const ALLOWED_TAGS = new Set([
  'A', 'B', 'BLOCKQUOTE', 'BR', 'CODE', 'DIV', 'EM', 'FONT', 'H1', 'H2', 'H3',
  'HR', 'I', 'LI', 'OL', 'P', 'PRE', 'S', 'SPAN', 'STRONG', 'SUB', 'SUP',
  'TABLE', 'TBODY', 'TD', 'TH', 'THEAD', 'TR', 'U', 'UL',
]);

const DROP_WITH_CONTENT = new Set([
  'EMBED', 'IFRAME', 'LINK', 'MATH', 'META', 'NOSCRIPT', 'OBJECT', 'SCRIPT',
  'STYLE', 'SVG', 'TEMPLATE',
]);

const ALLOWED_STYLE_PROPERTIES = new Set([
  'background-color', 'color', 'direction', 'font-family', 'font-size',
  'font-style', 'font-weight', 'text-align', 'text-decoration',
]);

function sanitizeStyle(element, value) {
  const parser = document.createElement('span');
  parser.setAttribute('style', value);
  const safeDeclarations = [];

  for (const property of ALLOWED_STYLE_PROPERTIES) {
    const propertyValue = parser.style.getPropertyValue(property);
    if (!propertyValue || /url\s*\(|expression\s*\(|javascript:/i.test(propertyValue)) continue;
    safeDeclarations.push(`${property}: ${propertyValue}`);
  }

  if (safeDeclarations.length > 0) {
    element.setAttribute('style', safeDeclarations.join('; '));
  }
}

function sanitizeElement(element) {
  for (const child of [...element.children]) {
    if (DROP_WITH_CONTENT.has(child.tagName)) {
      child.remove();
      continue;
    }
    if (!ALLOWED_TAGS.has(child.tagName)) {
      sanitizeElement(child);
      child.replaceWith(...child.childNodes);
      continue;
    }

    const attributes = [...child.attributes];
    for (const attribute of attributes) child.removeAttribute(attribute.name);

    const dir = attributes.find(({ name }) => name.toLowerCase() === 'dir')?.value;
    if (dir === 'rtl' || dir === 'ltr') child.setAttribute('dir', dir);

    const styles = [attributes.find(({ name }) => name.toLowerCase() === 'style')?.value || ''];
    if (child.tagName === 'FONT') {
      const color = attributes.find(({ name }) => name.toLowerCase() === 'color')?.value;
      const face = attributes.find(({ name }) => name.toLowerCase() === 'face')?.value;
      const size = attributes.find(({ name }) => name.toLowerCase() === 'size')?.value;
      if (color) styles.push(`color: ${color}`);
      if (face) styles.push(`font-family: ${face}`);
      const legacyFontSizes = { 1: 10, 2: 13, 3: 16, 4: 18, 5: 24, 6: 32, 7: 48 };
      if (legacyFontSizes[size]) styles.push(`font-size: ${legacyFontSizes[size]}px`);
    }
    sanitizeStyle(child, styles.join('; '));

    if (child.tagName === 'TD' || child.tagName === 'TH') {
      for (const name of ['colspan', 'rowspan']) {
        const raw = attributes.find(attribute => attribute.name.toLowerCase() === name)?.value;
        const value = Number.parseInt(raw, 10);
        if (Number.isInteger(value) && value > 0 && value <= 100) child.setAttribute(name, String(value));
      }
    }

    if (child.tagName === 'A') {
      const href = attributes.find(({ name }) => name.toLowerCase() === 'href')?.value || '';
      if (/^(https?:|mailto:)/i.test(href)) {
        child.setAttribute('href', href);
        child.setAttribute('rel', 'noopener noreferrer');
      }
    }

    sanitizeElement(child);
  }
}

export function sanitizeHtml(html) {
  if (!html || typeof html !== 'string') return '';
  const template = document.createElement('template');
  template.innerHTML = html;
  sanitizeElement(template.content);
  return template.innerHTML;
}

export function escapeHtml(value) {
  const element = document.createElement('div');
  element.textContent = String(value ?? '');
  return element.innerHTML;
}
