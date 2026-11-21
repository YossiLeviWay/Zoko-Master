// End-to-end smoke test on a local emulator (principal login): seeds a class, students and an attendance sheet
// through the app's own repositories, then checks the students page, context menu, quick marking, add-student and links.
// Run: PERSONA_SMOKE=1 PERSONA_OPEN_RULES=1 ./scripts/persona/run.sh   (rules are open in this mode, so it checks UI wiring, not security)
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 }, locale: 'he-IL' })).newPage();
const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 140)));
const log = (k, v) => console.log('CHECK', k, v);
await p.goto('http://localhost:5173/Zoko-Master/#/login');
await p.locator('input[type=email]').fill('principal@persona.test');
await p.locator('input[type=password]').fill(process.env.PERSONA_PASSWORD || '');
await p.locator('button[type=submit]').click();
await p.locator('select').waitFor({ timeout: 10000 });
await p.locator('select').selectOption({ index: 1 });
await p.locator('button[type=submit]').click();
await p.waitForTimeout(3000);

const seeded = await p.evaluate(async () => {
  const base = '/Zoko-Master/src';
  const { db, auth } = await import(`${base}/firebase.js`);
  const years = await import(`${base}/services/firestore/academicYearRepository.js`);
  const repo = await import(`${base}/services/firestore/classStudentRepository.js`);
  const att = await import(`${base}/services/firestore/attendanceRepository.js`);
  const fs = await import(`${base}/services/firestore/paths.js`);
  const schoolId = 'demo-school';
  const actor = { uid: auth.currentUser.uid, fullName: 'מנהל לדוגמה' };
  await years.ensureInitialAcademicYears({ db, schoolId, actor });
  const year = years.DEFAULT_ACADEMIC_YEARS.find(item => item.status === 'active');
  const classInput = { name: 'י׳1', gradeLevel: 'י', academicYear: year.label, academicYearId: year.id, academicYearLabel: year.label, teacherId: actor.uid, studyDays: [0, 1, 2, 3, 4], trackIds: [], programTypes: [], staffIds: [] };
  const classId = await repo.createClass({ db, schoolId, actor, input: classInput });
  const classItem = { id: classId, ...classInput };
  const names = [['דנה', 'כהן', '0501111111'], ['יוסי', 'לוי', ''], ['נועה', 'אברהם', '0503333333']];
  const students = [];
  for (const [firstName, lastName, parentPhone] of names) {
    const input = { firstName, lastName, fullName: `${firstName} ${lastName}`, idNumber: '', phone: '', parentPhone, classId, trackIds: [], programTypes: [], additionalSubjects: [], joinedAt: '2026-09-01', endDate: '', status: 'active' };
    const id = await repo.createStudent({ db, schoolId, actor, input, classItem });
    students.push({ id, ...input });
  }
  const sheets = await att.createAttendanceSheets({ db, schoolId, actor, folderId: 'seed-folder', input: { title: 'נוכחות י׳1', startDate: '2026-11-01', endDate: '2026-12-20', academicYearId: year.id, academicYear: year.label, description: '' }, selections: [{ classItem, students }] });
  return { classId, students: students.length, sheets: sheets.length };
});
log('seeded', JSON.stringify(seeded));

// ---- dashboard: important dates for the principal's role
await p.evaluate(() => { location.hash = '/'; }); await p.waitForTimeout(2500);
log('milestones-widget', await p.locator('.milestone-list, .milestone-item').count() > 0 || (await p.locator('.section-empty', { hasText: 'אין מועדים קרובים' }).count()) > 0);
log('milestone-items', await p.locator('.milestone-item').count());
log('milestone-has-source-link', await p.locator('.milestone-item a[href^="https://"]').count() > 0);
if (await p.locator('.milestone-item').count()) {
  const first = await p.locator('.milestone-item .milestone-text').first().innerText();
  await p.locator('.milestone-item button').first().click(); await p.waitForTimeout(1200);
  const after = await p.locator('.milestone-item .milestone-text').first().innerText().catch(() => '');
  log('milestone-done-hides-item', first !== after);
}
// ---- dashboard customisation: settings window, custom title, a second task list
const gear = p.getByRole('button', { name: /התאמת התצוגה: המשימות שלי/ });
log('settings-button', await gear.count());
await gear.first().click(); await p.waitForTimeout(500);
log('settings-dialog-open', await p.locator('.widget-settings').count());
log('settings-has-staff-team-priority-due', JSON.stringify(await Promise.all(['#ws-team', '#ws-staff', '#ws-priority', '#ws-due', '#ws-limit'].map(sel => p.locator(sel).count()))));
await p.locator('#ws-title').fill('הדחופות שלי'); await p.locator('#ws-priority').selectOption('high'); await p.locator('#ws-limit').selectOption('3');
await p.locator('.widget-settings button.btn-primary').click(); await p.waitForTimeout(600);
log('custom-title-shown', await p.locator('.section-title', { hasText: 'הדחופות שלי' }).count());
log('filter-empty-message', await p.getByText('אין משימות שמתאימות לסינון שבחרת.').count());
await p.getByRole('button', { name: /הוספת תצוגה/ }).click(); await p.waitForTimeout(300);
await p.locator('.context-menu-item', { hasText: 'המשימות שלי' }).click(); await p.waitForTimeout(600);
log('second-task-list-added', await p.locator('.dashboard-widget .section-title', { hasText: 'המשימות שלי' }).count());
await p.getByRole('button', { name: /הוספת תצוגה/ }).click(); await p.waitForTimeout(300);
await p.keyboard.press('Escape');
await p.screenshot({ path: 'tests/persona/f-dashboard.png' });

// ---- students page
await p.evaluate(() => { location.hash = '/students'; }); await p.waitForTimeout(3000);
log('student-rows', await p.locator('tbody tr').count());
log('missing-info-triangles', await p.locator('.missing-info').count());
log('toolbar-more-button', await p.locator('.more-menu button').count());
log('old-outcomes-entry-gone', await p.locator('.students-outcomes-entry').count() === 0);
await p.locator('tbody tr').first().click({ button: 'right' }); await p.waitForTimeout(300);
log('context-menu-items', JSON.stringify(await p.locator('.app-context-menu [role=menuitem]').allInnerTexts()));
await p.keyboard.press('Escape'); await p.waitForTimeout(200);
log('context-menu-closed-by-esc', await p.locator('.app-context-menu').count() === 0);
await p.screenshot({ path: `tests/persona/f-students.png` });
await p.locator('.more-menu button').click(); await p.waitForTimeout(200);
log('more-menu-items', JSON.stringify(await p.locator('.more-menu-list [role=menuitem]').allInnerTexts()));
await p.keyboard.press('Escape');

// ---- files -> attendance sheet
await p.evaluate(() => { location.hash = '/files'; }); await p.waitForTimeout(3000);
await p.screenshot({ path: `tests/persona/f-files.png` });
await p.getByText('נוכחות', { exact: true }).first().click(); await p.waitForTimeout(800);
const sheet = p.getByText('נוכחות י׳1').first();
log('sheet-listed', await sheet.count());
if (await sheet.count()) {
  await sheet.click(); await p.waitForTimeout(2500);
  log('attendance-grid', await p.locator('.attendance-grid').count());
  log('quickbar', await p.locator('.attendance-quickbar').count());
  log('add-student-button', await p.getByRole('button', { name: /הוספת תלמיד/ }).count());
  log('sheet-rows', await p.locator('.attendance-grid tbody tr').count());
  log('sheet-missing-triangles', await p.locator('.attendance-grid .missing-info').count());
  const before = await p.locator('.attendance-grid tbody tr').count();
  await p.locator('.attendance-quickbar button', { hasText: 'נוכח' }).first().click();
  const cell = p.locator('.attendance-grid tbody tr').first().locator('td button, td').nth(2);
  await cell.click(); await p.waitForTimeout(800);
  log('dialog-skipped-in-quick-mode', await p.locator('.attendance-cell-dialog').count() === 0);
  await p.screenshot({ path: `tests/persona/f-attendance.png` });
  await p.getByRole('button', { name: /הוספת תלמיד/ }).click(); await p.waitForTimeout(300);
  await p.locator('.attendance-cell-dialog input').first().fill('רועי'); 
  await p.locator('.attendance-cell-dialog input').nth(1).fill('שמעוני');
  await p.locator('.attendance-cell-dialog button.btn-primary').click(); await p.waitForTimeout(2500);
  log('sheet-rows-after-add', `${before} -> ${await p.locator('.attendance-grid tbody tr').count()}`);
  await p.locator('.attendance-student-link').first().click(); await p.waitForTimeout(2500);
  log('link-opens-student-page', p.url().includes('#/students'));
  log('student-profile-open', await p.locator('[role=dialog], .student-profile, [class*="profile"]').count());
  await p.evaluate(() => { location.hash = '/students'; }); await p.waitForTimeout(2500);
  log('students-after-add', await p.locator('tbody tr').count());
}
log('page-errors', JSON.stringify(errs.filter(e => !/INTERNAL ASSERTION/.test(e))));
await b.close();
