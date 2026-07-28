/**
 * Israeli holidays data for the 2025-2026 school year.
 *
 * Includes Ministry of Education vacation days and major holidays
 * from all religions in Israel (Jewish, Muslim, Christian, Druze).
 */

export const HOLIDAY_COLORS = {
  jewish: '#fef3c7',
  muslim: '#d1fae5',
  christian: '#dbeafe',
  druze: '#e9d5ff',
  national: '#bfdbfe',
};

export const ISRAELI_HOLIDAYS = [
  // ===== Jewish holidays & Ministry of Education vacation days =====
  {
    name: 'ראש השנה',
    nameEn: 'Rosh Hashana',
    startDate: '2025-09-22',
    endDate: '2025-09-24',
    type: 'jewish',
    isVacation: true,
    isSchoolDay: false,
    note: '',
    color: '#fef3c7',
  },
  {
    name: 'יום הכיפורים',
    nameEn: 'Yom Kippur',
    startDate: '2025-10-01',
    endDate: '2025-10-02',
    type: 'jewish',
    isVacation: true,
    isSchoolDay: false,
    note: '',
    color: '#fef3c7',
  },
  {
    name: 'ימי חופשה בין יום הכיפורים לסוכות',
    nameEn: 'Break between Yom Kippur and Sukkot',
    startDate: '2025-10-03',
    endDate: '2025-10-05',
    type: 'jewish',
    isVacation: true,
    isSchoolDay: false,
    note: '',
    color: '#fef3c7',
  },
  {
    name: 'חג סוכות',
    nameEn: 'Sukkot',
    startDate: '2025-10-06',
    endDate: '2025-10-14',
    type: 'jewish',
    isVacation: true,
    isSchoolDay: false,
    note: '',
    color: '#fef3c7',
  },
  {
    name: 'אסרו חג סוכות',
    nameEn: 'Isru Chag Sukkot',
    startDate: '2025-10-15',
    endDate: '2025-10-15',
    type: 'jewish',
    isVacation: false,
    isSchoolDay: true,
    note: 'יום לימודים בגני ילדים, יסודיים וחטיבות ביניים; חופש בחטיבות עליונות',
    color: '#fef3c7',
  },
  {
    name: 'חג החנוכה',
    nameEn: 'Hanukkah',
    startDate: '2025-12-16',
    endDate: '2025-12-22',
    type: 'jewish',
    isVacation: true,
    isSchoolDay: false,
    note: '',
    color: '#fef3c7',
  },
  {
    name: 'ט"ו בשבט',
    nameEn: "Tu BiShvat",
    startDate: '2026-02-02',
    endDate: '2026-02-02',
    type: 'jewish',
    isVacation: false,
    isSchoolDay: true,
    note: 'יום לימודים',
    color: '#fef3c7',
  },
  {
    name: 'תענית אסתר',
    nameEn: "Ta'anit Esther",
    startDate: '2026-03-02',
    endDate: '2026-03-02',
    type: 'jewish',
    isVacation: false,
    isSchoolDay: true,
    note: 'יום לימודים',
    color: '#fef3c7',
  },
  {
    name: 'חופשת חג פורים',
    nameEn: 'Purim Break',
    startDate: '2026-03-03',
    endDate: '2026-03-04',
    type: 'jewish',
    isVacation: true,
    isSchoolDay: false,
    note: '',
    color: '#fef3c7',
  },
  {
    name: 'חופשת חג הפסח',
    nameEn: 'Passover Break',
    startDate: '2026-03-24',
    endDate: '2026-04-08',
    type: 'jewish',
    isVacation: true,
    isSchoolDay: false,
    note: '',
    color: '#fef3c7',
  },
  {
    name: 'אסרו חג פסח',
    nameEn: 'Isru Chag Pesach',
    startDate: '2026-04-09',
    endDate: '2026-04-09',
    type: 'jewish',
    isVacation: false,
    isSchoolDay: true,
    note: 'יום לימודים',
    color: '#fef3c7',
  },
  {
    name: 'יום העצמאות',
    nameEn: 'Independence Day',
    startDate: '2026-04-22',
    endDate: '2026-04-22',
    type: 'national',
    isVacation: true,
    isSchoolDay: false,
    note: '',
    color: '#bfdbfe',
  },
  {
    name: 'ל"ג בעומר',
    nameEn: "Lag BaOmer",
    startDate: '2026-05-05',
    endDate: '2026-05-05',
    type: 'jewish',
    isVacation: true,
    isSchoolDay: false,
    note: '',
    color: '#fef3c7',
  },
  {
    name: 'חג השבועות',
    nameEn: 'Shavuot',
    startDate: '2026-05-21',
    endDate: '2026-05-22',
    type: 'jewish',
    isVacation: true,
    isSchoolDay: false,
    note: '',
    color: '#fef3c7',
  },

  // ===== Muslim holidays (approximate dates for 2025-2026) =====
  {
    name: 'עיד אל-פיטר',
    nameEn: 'Eid al-Fitr',
    startDate: '2026-03-20',
    endDate: '2026-03-21',
    type: 'muslim',
    isVacation: false,
    isSchoolDay: false,
    note: 'Dates approximate, based on lunar calendar',
    color: '#d1fae5',
  },
  {
    name: 'עיד אל-אדחא',
    nameEn: 'Eid al-Adha',
    startDate: '2026-05-27',
    endDate: '2026-05-30',
    type: 'muslim',
    isVacation: false,
    isSchoolDay: false,
    note: 'Dates approximate, based on lunar calendar',
    color: '#d1fae5',
  },
  {
    name: 'מולד הנביא',
    nameEn: 'Mawlid an-Nabi',
    startDate: '2025-09-05',
    endDate: '2025-09-05',
    type: 'muslim',
    isVacation: false,
    isSchoolDay: false,
    note: 'Dates approximate, based on lunar calendar',
    color: '#d1fae5',
  },
  {
    name: 'תחילת הרמדאן',
    nameEn: 'Ramadan Start',
    startDate: '2026-02-18',
    endDate: '2026-02-18',
    type: 'muslim',
    isVacation: false,
    isSchoolDay: false,
    note: 'Dates approximate, based on lunar calendar',
    color: '#d1fae5',
  },

  // ===== Christian holidays =====
  {
    name: 'חג המולד',
    nameEn: 'Christmas',
    startDate: '2025-12-25',
    endDate: '2025-12-25',
    type: 'christian',
    isVacation: false,
    isSchoolDay: false,
    note: '',
    color: '#dbeafe',
  },
  {
    name: 'יום שישי הטוב',
    nameEn: 'Good Friday',
    startDate: '2026-04-03',
    endDate: '2026-04-03',
    type: 'christian',
    isVacation: false,
    isSchoolDay: false,
    note: '',
    color: '#dbeafe',
  },
  {
    name: 'חג הפסחא',
    nameEn: 'Easter',
    startDate: '2026-04-05',
    endDate: '2026-04-05',
    type: 'christian',
    isVacation: false,
    isSchoolDay: false,
    note: '',
    color: '#dbeafe',
  },

  // ===== Druze holidays =====
  {
    name: 'זיארת אל-נבי שועייב',
    nameEn: "Ziyarat al-Nabi Shu'ayb",
    startDate: '2026-04-24',
    endDate: '2026-04-24',
    type: 'druze',
    isVacation: false,
    isSchoolDay: false,
    note: 'Most important Druze holiday, pilgrimage to the tomb of Jethro',
    color: '#e9d5ff',
  },
];

export const OFFICIAL_HOLIDAY_SOURCES = Object.freeze({
  ministryCalendar: Object.freeze({
    title: 'לוח חופשות — חוזר מנכ״ל, משרד החינוך',
    url: 'https://pop.education.gov.il/maagal_hashana/vacation-schedule/',
    publishedAt: null,
  }),
  specialEducationCalendar: Object.freeze({
    title: 'לוח הפעלת תוכניות החופשה בחינוך המיוחד — תשפ״ז',
    url: 'https://meyda.education.gov.il/files/Special/lows/lows/hollidays-special-tashpaz.pdf',
    publishedAt: '2026-06-22',
  }),
  jewishDaycareCalendar: Object.freeze({
    title: 'לוח חופשות במעונות יום בחברה החרדית — תשפ״ז',
    url: 'https://meyda.education.gov.il/files/PortalBaaluyot/POB/daycare/vacations-2627/haredi.pdf',
    publishedAt: '2026-06',
  }),
});

const VERIFIED_AT = '2026-07-27';

function officialHoliday(id, values, source = OFFICIAL_HOLIDAY_SOURCES.specialEducationCalendar) {
  return Object.freeze({
    id: `official_year_2026_2027_${id}`,
    officialHolidayId: `tashpaz_${id}`,
    academicYearId: 'year_2026_2027',
    sector: 'jewish',
    appliesTo: ['students', 'staff'],
    verificationStatus: 'official-derived',
    sourceTitle: source.title,
    sourceUrl: source.url,
    sourcePublishedAt: source.publishedAt,
    verifiedAt: VERIFIED_AT,
    color: values.type === 'national' ? HOLIDAY_COLORS.national : HOLIDAY_COLORS.jewish,
    ...values,
  });
}

/**
 * Built-in Ministry-backed calendar for the 2026-2027 school year.
 *
 * The Ministry landing page currently publishes the opening date only. Vacation
 * ranges are therefore cross-checked against the Ministry's June 2026 special
 * education operation calendar (which explicitly derives from the general
 * school circulars) and the Ministry's published Jewish-sector calendar.
 * Entries remain source-attributed so a later official circular can replace the
 * template without touching a school's local overrides.
 */
export const TASHPAZ_OFFICIAL_HOLIDAYS = Object.freeze([
  officialHoliday('school_opening', {
    name: 'פתיחת שנת הלימודים תשפ״ז',
    nameEn: 'First day of school',
    startDate: '2026-09-01',
    endDate: '2026-09-01',
    returnDate: '2026-09-01',
    hebrewDate: 'י״ט באלול תשפ״ו',
    type: 'national',
    eventKind: 'school-day',
    isVacation: false,
    isSchoolDay: true,
    note: 'יום פתיחת שנת הלימודים תשפ״ז.',
  }, OFFICIAL_HOLIDAY_SOURCES.ministryCalendar),
  officialHoliday('rosh_hashanah', {
    name: 'ראש השנה',
    nameEn: 'Rosh Hashana',
    startDate: '2026-09-11',
    endDate: '2026-09-13',
    returnDate: '2026-09-14',
    hebrewDate: 'כ״ט באלול תשפ״ו–ב׳ בתשרי תשפ״ז',
    type: 'jewish',
    eventKind: 'vacation',
    isVacation: true,
    isSchoolDay: false,
    note: 'החזרה ללימודים ביום שני, 14.9.2026.',
  }, OFFICIAL_HOLIDAY_SOURCES.jewishDaycareCalendar),
  officialHoliday('yom_kippur', {
    name: 'יום הכיפורים',
    nameEn: 'Yom Kippur',
    startDate: '2026-09-20',
    endDate: '2026-09-21',
    returnDate: '2026-09-22',
    hebrewDate: 'ט׳–י׳ בתשרי תשפ״ז',
    type: 'jewish',
    eventKind: 'vacation',
    isVacation: true,
    isSchoolDay: false,
    note: 'החזרה ללימודים ביום שלישי, 22.9.2026.',
  }, OFFICIAL_HOLIDAY_SOURCES.jewishDaycareCalendar),
  officialHoliday('between_yom_kippur_sukkot', {
    name: 'ימים שבין יום הכיפורים לסוכות',
    nameEn: 'Break between Yom Kippur and Sukkot',
    startDate: '2026-09-22',
    endDate: '2026-09-24',
    returnDate: '2026-10-04',
    hebrewDate: 'י״א–י״ג בתשרי תשפ״ז',
    type: 'jewish',
    eventKind: 'vacation',
    isVacation: true,
    isSchoolDay: false,
    note: 'חלק מרצף חופשת תשרי; החזרה לאחר סוכות ביום ראשון, 4.10.2026.',
  }),
  officialHoliday('sukkot', {
    name: 'חג הסוכות ושמחת תורה',
    nameEn: 'Sukkot and Simchat Torah',
    startDate: '2026-09-25',
    endDate: '2026-10-03',
    returnDate: '2026-10-04',
    hebrewDate: 'י״ד–כ״ב בתשרי תשפ״ז',
    type: 'jewish',
    eventKind: 'vacation',
    isVacation: true,
    isSchoolDay: false,
    note: 'החזרה ללימודים ביום ראשון, 4.10.2026.',
  }, OFFICIAL_HOLIDAY_SOURCES.jewishDaycareCalendar),
  officialHoliday('hanukkah', {
    name: 'חופשת חנוכה',
    nameEn: 'Hanukkah break',
    startDate: '2026-12-06',
    endDate: '2026-12-12',
    returnDate: '2026-12-13',
    hebrewDate: 'כ״ו בכסלו–ב׳ בטבת תשפ״ז',
    type: 'jewish',
    eventKind: 'vacation',
    isVacation: true,
    isSchoolDay: false,
    note: 'החזרה ללימודים ביום ראשון, 13.12.2026.',
  }),
  officialHoliday('purim', {
    name: 'חופשת פורים',
    nameEn: 'Purim break',
    startDate: '2027-03-23',
    endDate: '2027-03-24',
    returnDate: '2027-03-25',
    hebrewDate: 'י״ד–ט״ו באדר ב׳ תשפ״ז',
    type: 'jewish',
    eventKind: 'vacation',
    isVacation: true,
    isSchoolDay: false,
    note: 'החזרה ללימודים ביום חמישי, 25.3.2027.',
  }, OFFICIAL_HOLIDAY_SOURCES.jewishDaycareCalendar),
  officialHoliday('passover', {
    name: 'חופשת פסח',
    nameEn: 'Passover break',
    startDate: '2027-04-13',
    endDate: '2027-04-28',
    returnDate: '2027-04-29',
    hebrewDate: 'ו׳–כ״א בניסן תשפ״ז',
    type: 'jewish',
    eventKind: 'vacation',
    isVacation: true,
    isSchoolDay: false,
    note: 'החזרה ללימודים ביום חמישי, 29.4.2027.',
  }),
  officialHoliday('memorial_day', {
    name: 'יום הזיכרון לחללי מערכות ישראל',
    nameEn: 'Memorial Day',
    startDate: '2027-05-11',
    endDate: '2027-05-11',
    returnDate: '2027-05-13',
    hebrewDate: 'ד׳ באייר תשפ״ז',
    type: 'national',
    eventKind: 'commemoration',
    isVacation: false,
    isSchoolDay: true,
    note: 'יום לימודים וטקסי זיכרון; למחרת יום העצמאות.',
  }, OFFICIAL_HOLIDAY_SOURCES.jewishDaycareCalendar),
  officialHoliday('independence_day', {
    name: 'יום העצמאות',
    nameEn: 'Independence Day',
    startDate: '2027-05-12',
    endDate: '2027-05-12',
    returnDate: '2027-05-13',
    hebrewDate: 'ה׳ באייר תשפ״ז',
    type: 'national',
    eventKind: 'vacation',
    isVacation: true,
    isSchoolDay: false,
    note: 'החזרה ללימודים ביום חמישי, 13.5.2027.',
  }, OFFICIAL_HOLIDAY_SOURCES.jewishDaycareCalendar),
  officialHoliday('shavuot', {
    name: 'חופשת שבועות',
    nameEn: 'Shavuot break',
    startDate: '2027-06-10',
    endDate: '2027-06-11',
    returnDate: '2027-06-13',
    hebrewDate: 'ה׳–ו׳ בסיוון תשפ״ז',
    type: 'jewish',
    eventKind: 'vacation',
    isVacation: true,
    isSchoolDay: false,
    note: 'החזרה ללימודים ביום ראשון, 13.6.2027.',
  }, OFFICIAL_HOLIDAY_SOURCES.jewishDaycareCalendar),
]);

export const HOLIDAY_CALENDARS = Object.freeze({
  year_2025_2026: Object.freeze(ISRAELI_HOLIDAYS.map((holiday, index) => Object.freeze({
    id: `legacy_year_2025_2026_${index + 1}`,
    academicYearId: 'year_2025_2026',
    ...holiday,
  }))),
  year_2026_2027: TASHPAZ_OFFICIAL_HOLIDAYS,
});

export function academicYearIdForHolidayDate(dateValue) {
  const date = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const startYear = date.getMonth() >= 8 ? year : year - 1;
  return `year_${startYear}_${startYear + 1}`;
}

export function holidaysForAcademicYear(academicYearId) {
  return [...(HOLIDAY_CALENDARS[academicYearId] || [])];
}

export function mergeHolidayCalendar(academicYearId, storedHolidays = []) {
  const storedForYear = storedHolidays.filter((holiday) => (
    (holiday.academicYearId || academicYearIdForHolidayDate(holiday.startDate)) === academicYearId
  ));
  const overrides = new Map(
    storedForYear
      .filter(holiday => holiday.officialHolidayId)
      .map(holiday => [holiday.officialHolidayId, holiday]),
  );
  const official = holidaysForAcademicYear(academicYearId).flatMap((holiday) => {
    const override = overrides.get(holiday.officialHolidayId);
    if (override?.isHidden) return [];
    return [{
      ...holiday,
      ...(override || {}),
      id: override?.id || holiday.id,
      _storageId: override?.id || '',
      _isOfficialTemplate: !override,
    }];
  });
  const local = storedForYear.filter(holiday => !holiday.officialHolidayId && !holiday.isHidden);
  return [...official, ...local].sort((a, b) => (
    String(a.startDate || '').localeCompare(String(b.startDate || ''))
  ));
}

/**
 * Returns all holidays that fall within the given month.
 * @param {number} year - Full year (e.g. 2025)
 * @param {number} month - 0-indexed month (0 = January, 11 = December)
 * @returns {Array} Holidays that overlap with the specified month
 */
export function getHolidaysForMonth(year, month) {
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0); // last day of month

  return ISRAELI_HOLIDAYS.filter((holiday) => {
    const start = new Date(holiday.startDate + 'T00:00:00');
    const end = new Date(holiday.endDate + 'T00:00:00');
    return start <= monthEnd && end >= monthStart;
  });
}

/**
 * Returns the next N upcoming holidays from today.
 * @param {number} count - Number of holidays to return (default 5)
 * @returns {Array} Next upcoming holidays sorted by start date
 */
export function getUpcomingHolidays(count = 5) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return ISRAELI_HOLIDAYS
    .filter((holiday) => {
      const end = new Date(holiday.endDate + 'T00:00:00');
      return end >= today;
    })
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
    .slice(0, count);
}
