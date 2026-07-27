import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TASHPAZ_OFFICIAL_HOLIDAYS,
  academicYearIdForHolidayDate,
  holidaysForAcademicYear,
  mergeHolidayCalendar,
} from '../../src/data/holidays.js';

test('Tashpaz template contains only attributed 2026-2027 records', () => {
  assert.ok(TASHPAZ_OFFICIAL_HOLIDAYS.length > 0);
  for (const holiday of TASHPAZ_OFFICIAL_HOLIDAYS) {
    assert.equal(holiday.academicYearId, 'year_2026_2027');
    assert.match(holiday.startDate, /^(2026|2027)-/);
    assert.ok(holiday.hebrewDate);
    assert.ok(holiday.returnDate);
    assert.ok(holiday.sourceTitle);
    assert.match(holiday.sourceUrl, /^https:\/\/(pop|meyda)\.education\.gov\.il\//);
    assert.deepEqual(holiday.appliesTo, ['students', 'staff']);
  }
});

test('academic year inference keeps 2025 events in Tashpav', () => {
  assert.equal(academicYearIdForHolidayDate('2025-09-22'), 'year_2025_2026');
  assert.equal(academicYearIdForHolidayDate('2026-04-22'), 'year_2025_2026');
  assert.equal(academicYearIdForHolidayDate('2026-09-01'), 'year_2026_2027');
  assert.equal(academicYearIdForHolidayDate('2027-06-11'), 'year_2026_2027');
});

test('calendar merge isolates years and does not duplicate official records', () => {
  const official = holidaysForAcademicYear('year_2026_2027')[0];
  const merged = mergeHolidayCalendar('year_2026_2027', [
    { id: 'old', name: 'ראש השנה', startDate: '2025-09-22' },
    {
      id: 'override',
      officialHolidayId: official.officialHolidayId,
      academicYearId: 'year_2026_2027',
      name: official.name,
      startDate: official.startDate,
      endDate: official.endDate,
      note: 'התאמה מקומית שנשמרת',
    },
  ]);

  assert.equal(merged.filter(item => item.officialHolidayId === official.officialHolidayId).length, 1);
  assert.equal(merged.find(item => item.officialHolidayId === official.officialHolidayId).note, 'התאמה מקומית שנשמרת');
  assert.equal(merged.some(item => item.id === 'old'), false);
});

test('a local hidden override suppresses only its official event', () => {
  const official = holidaysForAcademicYear('year_2026_2027')[0];
  const merged = mergeHolidayCalendar('year_2026_2027', [{
    id: 'hidden',
    officialHolidayId: official.officialHolidayId,
    academicYearId: 'year_2026_2027',
    isHidden: true,
  }]);

  assert.equal(merged.some(item => item.officialHolidayId === official.officialHolidayId), false);
  assert.equal(merged.length, TASHPAZ_OFFICIAL_HOLIDAYS.length - 1);
});
