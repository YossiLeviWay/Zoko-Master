// Chrome fires this on the document when a Content-Security-Policy directive blocks a
// request, before fetch() rejects. The bubble can then say which directive and which URL.
const recent = [];

export function noteCspViolation(event) {
  const record = {
    blockedURI: String(event?.blockedURI || '').slice(0, 180),
    violatedDirective: String(event?.violatedDirective || event?.effectiveDirective || '').slice(0, 80),
  };
  recent.push(record);
  if (recent.length > 5) recent.shift();
  console.warn('securitypolicyviolation', record.violatedDirective, record.blockedURI);
  return record;
}

export function latestCspViolation() {
  return recent.at(-1) || null;
}

export function formatCspViolation(record) {
  if (!record?.violatedDirective && !record?.blockedURI) return '';
  return `csp ${record.violatedDirective || 'unknown'} blocked ${record.blockedURI || 'unknown'}`;
}

export function installCspViolationListener() {
  if (typeof document === 'undefined' || installCspViolationListener.installed) return;
  installCspViolationListener.installed = true;
  document.addEventListener('securitypolicyviolation', noteCspViolation);
}
