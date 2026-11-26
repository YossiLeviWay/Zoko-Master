import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarDateFields, SCHOOL_WEEK, sortCalendarCategories, todayScrollTop } from '../../src/utils/calendarInteractions.js';
import { readFile } from 'node:fs/promises';
test('moving across month/year and editing the past keeps calendar query fields consistent',()=>{
 assert.deepEqual(calendarDateFields('2025-12-31'),{date:'2025-12-31',year:2025,month:11});
 assert.deepEqual(calendarDateFields('2027-01-01'),{date:'2027-01-01',year:2027,month:0});
 assert.throws(()=>calendarDateFields('2026-02-30'),/invalid-date/);
});
test('category order is stable and does not mutate snapshots',()=>{
 const rows=[{name:'ב',order:2},{name:'א',order:0},{name:'ג'}];
 assert.deepEqual(sortCalendarCategories(rows).map(r=>r.name),['א','ב','ג']);assert.equal(rows[0].name,'ב');
});
test('opening the calendar puts today\'s week under the header, without a smooth scroll', () => {
  assert.deepEqual([...SCHOOL_WEEK], [0, 1, 2, 3, 4]);
  assert.equal(todayScrollTop({ scrollTop: 0, cellTop: 800, wrapTop: 100, headHeight: 40 }), 800 - 100 - 40);
  assert.equal(todayScrollTop({ scrollTop: 0, cellTop: 10, wrapTop: 0, headHeight: 40 }), 0);
});

test('calendar changes also reach the legacy production rollout',async()=>{
 const snapshot=JSON.parse(await readFile('scripts/simple-access-legacy.json','utf8'));
 assert.match(snapshot['src/components/Gantt/GanttChart.jsx'],/dropCalendar/);
 assert.match(snapshot['src/components/Gantt/GanttChart.jsx'],/categoriesReady/);
 const chart = await readFile('src/components/Gantt/GanttChart.jsx', 'utf8');
 for (const source of [chart, snapshot['src/components/Gantt/GanttChart.jsx']]) {
  assert.match(source, /SCHOOL_WEEK/);
  assert.match(source, /wrap\.scrollTop = todayScrollTop/);
  assert.doesNotMatch(source, /behavior: animate \? 'smooth'/);
 }
 assert.doesNotMatch(snapshot['src/components/Layout/Sidebar.jsx'],/path: '\/categories'/);
});

test('Zoki chat window no longer offers a Codex engine picker', async () => {
 const page=await readFile('src/components/Zoki/ZokiPage.jsx','utf8');
 assert.doesNotMatch(page,/Codex|EnginePicker|onCodex/);
 const snapshot=JSON.parse(await readFile('scripts/simple-access-legacy.json','utf8'));
 assert.match(snapshot['src/components/Gantt/GanttChart.jsx'],/className="calendar-workspace"/);
});
