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
