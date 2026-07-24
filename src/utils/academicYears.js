const HEBREW_LETTERS = Object.freeze([
  [400, 'ת'], [300, 'ש'], [200, 'ר'], [100, 'ק'],
  [90, 'צ'], [80, 'פ'], [70, 'ע'], [60, 'ס'], [50, 'נ'], [40, 'מ'], [30, 'ל'], [20, 'כ'], [10, 'י'],
  [9, 'ט'], [8, 'ח'], [7, 'ז'], [6, 'ו'], [5, 'ה'], [4, 'ד'], [3, 'ג'], [2, 'ב'], [1, 'א'],
]);

export const CURRENT_HEBREW_ACADEMIC_YEAR = 5787;

export function hebrewYearLabel(yearNumber) {
  let remaining = Number(yearNumber) % 1000;
  if (!Number.isInteger(remaining) || remaining <= 0) return '';
  let letters = '';
  while (remaining > 0) {
    if (remaining === 15) { letters += 'טו'; break; }
    if (remaining === 16) { letters += 'טז'; break; }
    const entry = HEBREW_LETTERS.find(([value]) => value <= remaining);
    if (!entry) break;
    letters += entry[1];
    remaining -= entry[0];
  }
  if (letters.length === 1) return `${letters}׳`;
  return `${letters.slice(0, -1)}״${letters.slice(-1)}`;
}

export function gregorianStartForHebrewYear(hebrewYearNumber) {
  return Number(hebrewYearNumber) - 3761;
}

export function academicYearIdForHebrewYear(hebrewYearNumber) {
  const start = gregorianStartForHebrewYear(hebrewYearNumber);
  return `year_${start}_${start + 1}`;
}

export function academicYearFromHebrewYear(hebrewYearNumber, status = 'active') {
  const gregorianStartYear = gregorianStartForHebrewYear(hebrewYearNumber);
  const gregorianEndYear = gregorianStartYear + 1;
  const hebrewLabel = hebrewYearLabel(hebrewYearNumber);
  return {
    id: academicYearIdForHebrewYear(hebrewYearNumber),
    hebrewYearNumber,
    hebrewLabel,
    gregorianStartYear,
    gregorianEndYear,
    startDate: `${gregorianStartYear}-09-01`,
    endDate: `${gregorianEndYear}-08-31`,
    isActive: status === 'active',
    status,
    label: hebrewLabel,
    startYear: gregorianStartYear,
    endYear: gregorianEndYear,
  };
}

export function academicYearForDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const startYear = date.getMonth() >= 8 ? date.getFullYear() : date.getFullYear() - 1;
  return academicYearFromHebrewYear(startYear + 3761);
}

export function academicYearDisplay(year, separator = ' ') {
  if (!year) return '';
  const label = year.hebrewLabel || year.label || hebrewYearLabel(year.hebrewYearNumber);
  const start = year.gregorianStartYear ?? year.startYear;
  const end = year.gregorianEndYear ?? year.endYear;
  return start && end ? `${label}${separator}(${start}-${end})` : label;
}
