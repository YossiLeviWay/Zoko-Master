// "Beginner teacher" persona: walks the app like someone who has never seen it,
// and reports everything that would confuse or block them.
//
//   node tests/persona/beginner-teacher.mjs [--url http://localhost:5173] [--routes /,/login,/tasks]
//
// Optional login (use a TEST account on an emulator/staging project only):
//   PERSONA_EMAIL=... PERSONA_PASSWORD=... node tests/persona/beginner-teacher.mjs
//
// Output: tests/persona/report.md and report.json (git-ignored).
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : fallback; };
const base = arg('url', 'http://localhost:5173/Zoko-Master');
const routes = arg('routes', '/').split(',').filter(Boolean);
const findings = [];
const add = (severity, route, viewport, what, detail = '') => findings.push({ severity, route, viewport, what, detail });

async function waitFor(url, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if ((await fetch(url)).ok) return true; } catch { /* retry */ } await new Promise(r => setTimeout(r, 500)); }
  return false;
}

// Runs inside the page. Everything a first-time user would trip on.
function audit() {
  const out = [];
  const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const name = el => (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.getAttribute('placeholder') || '').trim();
  const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const rgb = s => (s.match(/[\d.]+/g) || []).slice(0, 4).map(Number);
  const bgOf = el => { for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length === 3 || (c.length === 4 && c[3] > 0.9)) return c.slice(0, 3); } return [255, 255, 255]; };

  document.querySelectorAll('button, a[href], [role=button]').forEach(el => {
    if (!vis(el)) return;
    if (!name(el) && !el.querySelector('img[alt]')) out.push(['high', 'כפתור/קישור בלי שם נגיש (קורא מסך ומשתמש מתחיל לא יבינו מה הוא עושה)', el.outerHTML.slice(0, 120)]);
    const r = el.getBoundingClientRect();
    if ((r.width < 40 || r.height < 40) && innerWidth <= 480) out.push(['medium', `יעד לחיצה קטן מדי בנייד (${Math.round(r.width)}×${Math.round(r.height)})`, name(el).slice(0, 40)]);
  });
  document.querySelectorAll('input, select, textarea').forEach(el => {
    if (!vis(el) || el.type === 'hidden') return;
    const labelled = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`) || el.closest('label') || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
    if (!labelled) out.push(['high', 'שדה קלט בלי תווית (הטקסט נעלם כשמקלידים)', el.outerHTML.slice(0, 120)]);
  });
  document.querySelectorAll('img').forEach(el => { if (vis(el) && !el.hasAttribute('alt')) out.push(['medium', 'תמונה בלי alt', el.src.slice(-60)]); });
  if (document.documentElement.scrollWidth > innerWidth + 2) out.push(['high', `גלילה אופקית בדף (${document.documentElement.scrollWidth}px מול ${innerWidth}px)`, '']);
  if (!document.title || /vite|react app/i.test(document.title)) out.push(['low', 'כותרת הדף חסרה או גנרית', document.title]);
  if (!document.documentElement.lang) out.push(['low', 'חסר lang בדף', '']);
  if (!document.querySelector('h1')) out.push(['medium', 'אין כותרת ראשית (h1) — משתמש חדש לא יודע איפה הוא', '']);

  // Contrast of visible text (WCAG AA: 4.5 normal, 3 large).
  const seen = new Set(); let bad = 0;
  document.querySelectorAll('body *').forEach(el => {
    if (bad >= 8 || !vis(el) || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return;
    const s = getComputedStyle(el); const fg = rgb(s.color); if (fg.length < 3) return;
    const bg = bgOf(el); const a = fg[3] ?? 1; const mixed = fg.slice(0, 3).map((v, i) => v * a + bg[i] * (1 - a));
    const l1 = lum(mixed), l2 = lum(bg); const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const big = parseFloat(s.fontSize) >= 24 || (parseFloat(s.fontSize) >= 18.66 && +s.fontWeight >= 700);
    const key = `${s.color}|${s.backgroundColor}|${Math.round(ratio * 10)}`;
    if (ratio < (big ? 3 : 4.5) && !seen.has(key)) { seen.add(key); bad++; out.push(['high', `ניגודיות נמוכה ${ratio.toFixed(1)}:1`, `"${el.innerText.trim().slice(0, 40)}"`]); }
  });
  const nav = [...document.querySelectorAll('nav a, aside a')].filter(vis);
  if (nav.length > 8) out.push(['medium', `${nav.length} פריטי ניווט גלויים — מורה מתחיל לא יודע מאיפה להתחיל`, nav.map(name).join(' | ').slice(0, 200)]);
  return { out, navCount: nav.length, interactive: document.querySelectorAll('button, a[href], input, select, textarea').length };
}

let server;
const killServer = () => { try { process.kill(-server.pid); } catch { /* already stopped */ } };
if (!(await waitFor(base + '/', 1500))) {
  server = spawn('npx', ['vite', '--port', '5173', '--strictPort'], { stdio: 'ignore', detached: true });
  if (!(await waitFor(base + '/'))) { console.error('dev server did not start'); killServer(); process.exit(2); }
}
const browser = await chromium.launch();
try {
  for (const viewport of [{ name: 'מחשב', width: 1366, height: 768 }, { name: 'נייד', width: 390, height: 844 }]) {
    const ctx = await browser.newContext({ viewport, locale: 'he-IL' });
    const page = await ctx.newPage();
    let current = '';
    page.on('console', m => { if (m.type() === 'error') add('high', current, viewport.name, 'שגיאה בקונסולה', m.text().slice(0, 200)); });
    page.on('pageerror', e => add('high', current, viewport.name, 'חריגה לא מטופלת בדף', String(e).slice(0, 200)));
    page.on('requestfailed', r => { if (!/fonts\.g/.test(r.url())) add('medium', current, viewport.name, 'בקשה נכשלה', r.url().slice(0, 120)); });

    // Optional login as a test teacher (credentials step, then school choice).
    if (process.env.PERSONA_EMAIL) {
      current = '/login';
      await page.goto(base + '/login');
      await page.locator('input[type=email], input[type=text]').first().fill(process.env.PERSONA_EMAIL);
      await page.locator('input[type=password]').first().fill(process.env.PERSONA_PASSWORD || '');
      await page.locator('button[type=submit]').first().click();
      const select = page.locator('select').first();
      if (await select.waitFor({ timeout: 8000 }).then(() => true).catch(() => false)) {
        await select.selectOption({ index: 1 });
        await page.locator('button[type=submit]').first().click();
      } else add('high', '/login', viewport.name, 'אחרי הזנת פרטים לא הוצגה בחירת מוסד ולא הייתה כניסה');
      await page.waitForTimeout(2500);
      if (/\/login/.test(page.url())) add('high', '/login', viewport.name, 'הכניסה לא הושלמה — המשתמש נשאר במסך הכניסה', (await page.innerText('body')).slice(0, 160));
    }
    for (const route of routes) {
      current = route;
      const t0 = Date.now();
      await page.goto(base + route, { waitUntil: 'networkidle' }).catch(() => add('high', route, viewport.name, 'הדף לא נטען'));
      await page.waitForTimeout(800);
      const loadMs = Date.now() - t0;
      if (loadMs > 4000) add('medium', route, viewport.name, `טעינה איטית (${loadMs}ms)`);
      const text = (await page.innerText('body').catch(() => '')).trim();
      if (text.length < 20) add('high', route, viewport.name, 'מסך ריק — אין שום הסבר למשתמש');
      if (/configuration-required|undefined|NaN|\[object/.test(text)) add('high', route, viewport.name, 'טקסט טכני/שבור מוצג למשתמש', text.match(/configuration-required|undefined|NaN|\[object[^\]]*\]/)[0]);
      const { out, navCount, interactive } = await page.evaluate(audit);
      out.forEach(([sev, what, detail]) => add(sev, route, viewport.name, what, detail));
      if (interactive === 0) add('high', route, viewport.name, 'אין אף אלמנט אינטראקטיבי במסך');
      // Keyboard: can a first-timer tab to a control at all?
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => { const a = document.activeElement; return a && a !== document.body ? a.tagName : ''; });
      if (!focused) add('medium', route, viewport.name, 'מקש Tab לא מגיע לאף פקד');
      await page.screenshot({ path: `tests/persona/shot-${viewport.width}-${route.replace(/\W+/g, '_') || 'root'}.png` }).catch(() => {});
      add('info', route, viewport.name, `מצב: ${navCount} פריטי ניווט, ${interactive} פקדים, טעינה ${loadMs}ms`);
    }
    await ctx.close();
  }
} finally { await browser.close(); if (server) killServer(); }

// Deduplicate identical findings that appear on both viewports/routes.
const key = f => `${f.severity}|${f.what}|${f.detail}`;
const grouped = new Map();
for (const f of findings) { const k = key(f); const g = grouped.get(k) || { ...f, where: new Set() }; g.where.add(`${f.route || '/'} (${f.viewport})`); grouped.set(k, g); }
const order = { high: 0, medium: 1, low: 2, info: 3 };
const list = [...grouped.values()].sort((a, b) => order[a.severity] - order[b.severity]);
const label = { high: 'חוסם / חמור', medium: 'מבלבל', low: 'קטן', info: 'מידע' };
const md = ['# דוח מורה מתחיל', '', `נבדק: ${base} · מסכים: ${routes.join(', ')}`, '',
  ...['high', 'medium', 'low', 'info'].flatMap(sev => { const rows = list.filter(f => f.severity === sev); return rows.length ? [`## ${label[sev]} (${rows.length})`, ...rows.map(f => `- **${f.what}**${f.detail ? ` — \`${f.detail}\`` : ''}  \n  ${[...f.where].join(', ')}`), ''] : []; })].join('\n');
writeFileSync('tests/persona/report.md', md); writeFileSync('tests/persona/report.json', JSON.stringify(list.map(f => ({ ...f, where: [...f.where] })), null, 2));
console.log(md);
process.exitCode = list.some(f => f.severity === 'high') ? 1 : 0;
