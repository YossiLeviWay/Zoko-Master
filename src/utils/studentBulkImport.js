const DEFAULT_FIELDS = ['firstName', 'lastName', 'idNumber', 'className', 'trackName'];
const FIELD_LABELS = Object.freeze({
  firstName: 'שם פרטי',
  lastName: 'שם משפחה',
  idNumber: 'מספר מזהה',
  className: 'כיתה',
  trackName: 'מגמה',
});

export function normalizeImportHeader(value) {
  return String(value || '')
    .replace(/^\uFEFF/u, '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[-.:'"׳״’”“_/\\()]/gu, '')
    .replaceAll('[', '')
    .replaceAll(']', '')
    .replace(/\s+/gu, '')
    .trim();
}

const HEADER_ALIASES = Object.freeze({
  שםפרטי: 'firstName',
  שםתלמיד: 'firstName',
  firstname: 'firstName',
  givenname: 'firstName',
  שםמשפחה: 'lastName',
  lastname: 'lastName',
  surname: 'lastName',
  מספרמזהה: 'idNumber',
  מספרזהות: 'idNumber',
  תז: 'idNumber',
  id: 'idNumber',
  idnumber: 'idNumber',
  כיתה: 'className',
  שםכיתה: 'className',
  class: 'className',
  מגמה: 'trackName',
  שםמגמה: 'trackName',
  מסלול: 'trackName',
  track: 'trackName',
  major: 'trackName',
  סטטוס: 'status',
  status: 'status',
  שנתלימודים: 'academicYear',
  academicyear: 'academicYear',
  שכבה: 'gradeLevel',
  תאריךלידה: 'birthDate',
  טלפון: 'phone',
  טלפוןתלמיד: 'phone',
  דואל: 'email',
  מייל: 'email',
  email: 'email',
  שםאישקשר: 'contactName',
  טלפוןאישקשר: 'contactPhone',
  תאריךהצטרפות: 'joinedAt',
  הערהראשונית: 'initialNote',
});

export function importFieldForHeader(value) {
  return HEADER_ALIASES[normalizeImportHeader(value)] || '';
}

export function parseDelimitedStudentText(text) {
  const input = String(text || '').replace(/^\uFEFF/u, '');
  const firstLine = input.split(/\r?\n/u, 1)[0] || '';
  const delimiter = firstLine.includes('\t') ? '\t'
    : (firstLine.match(/;/gu)?.length || 0) > (firstLine.match(/,/gu)?.length || 0) ? ';' : ',';
  const parsed = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === '"') {
      if (quoted && input[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cell.trim()); cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && input[index + 1] === '\n') index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) parsed.push(row);
      row = []; cell = '';
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) parsed.push(row);
  if (!parsed.length) return { headers: [], rows: [], mapping: {}, hasHeader: false };

  const recognized = parsed[0].map(importFieldForHeader).filter(Boolean);
  const hasHeader = recognized.length >= 2 && recognized.some(field => field === 'firstName' || field === 'lastName');
  const width = Math.max(...parsed.map(item => item.length));
  const headers = hasHeader
    ? parsed[0].map((header, index) => header.replace(/^\uFEFF/u, '') || `עמודה ${index + 1}`)
    : Array.from({ length: width }, (_, index) => FIELD_LABELS[DEFAULT_FIELDS[index]] || `עמודה ${index + 1}`);
  const mapping = {};
  headers.forEach((header, index) => {
    const field = hasHeader ? importFieldForHeader(header) : DEFAULT_FIELDS[index];
    if (field) mapping[index] = field;
  });
  return {
    headers,
    rows: (hasHeader ? parsed.slice(1) : parsed).slice(0, 200),
    mapping,
    hasHeader,
  };
}

export function normalizeImportLookup(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[׳’]/gu, "'")
    .replace(/[״”]/gu, '"')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase('he-IL');
}
