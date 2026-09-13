import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarDateFields, sortCalendarCategories } from '../../src/utils/calendarInteractions.js';
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
test('Codex is local only even when the former public relay flag is provided',async()=>{
 const server=await readFile('scripts/codex-pilot/server.mjs','utf8');assert.doesNotMatch(server,/createRelay/);
 const page=await readFile('src/components/Zoki/ZokiPage.jsx','utf8');assert.match(page,/onCodex=\{localCodex && manager/);
});
test('calendar changes also reach the legacy production rollout',async()=>{
 const snapshot=JSON.parse(await readFile('scripts/simple-access-legacy.json','utf8'));
 assert.match(snapshot['src/components/Gantt/GanttChart.jsx'],/dropCalendar/);
 assert.match(snapshot['src/components/Gantt/GanttChart.jsx'],/categoriesReady/);
 assert.doesNotMatch(snapshot['src/components/Layout/Sidebar.jsx'],/path: '\/categories'/);
});

test('manager sees engine choice publicly while Codex activation stays local', async () => {
 const page=await readFile('src/components/Zoki/ZokiPage.jsx','utf8');
 assert.match(page,/showEnginePicker=\{manager\}/);
 assert.match(page,/onCodex=\{localCodex && manager/);
 const picker=await readFile('src/components/Zoki/ZokiEnginePicker.jsx','utf8');
 assert.match(picker,/disabled=\{!onCodex\}/);
 assert.doesNotMatch(picker,/fetch\(|localStorage|sessionStorage/);
 const snapshot=JSON.parse(await readFile('scripts/simple-access-legacy.json','utf8'));
 assert.match(snapshot['src/components/Gantt/GanttChart.jsx'],/className="calendar-workspace"/);
});
