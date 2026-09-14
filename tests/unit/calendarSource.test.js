import test from 'node:test';import assert from 'node:assert/strict';
import {calendarAnalysisSource} from '../../scripts/codex-pilot/calendar-source.mjs';
import {sourceManifest,validateCoverage} from '../../scripts/codex-pilot/coverage.mjs';
const row=(row,values)=>({row,cells:values.map((value,index)=>({column:index+1,value,cell:`${index+1}:${row}`}))});
test('calendar compaction keeps dates, content and unknown layouts with complete coverage',()=>{
 const file={name:'synthetic.xlsx',pages:[{sheet:'Test',rows:[row(1,['תאריך','2026-09-01','2026-09-02']),row(2,['צוות',null,null]),row(3,['כללי','Synthetic event',null]),row(4,['תאריך','unclear date',null]),row(5,['Unknown note'])]}]};
 const full=sourceManifest(file),before=JSON.stringify(file);const result=calendarAnalysisSource(file,full);
 assert.equal(JSON.stringify(file),before);assert.deepEqual(result.manifest.map(r=>r.id),['S1R3','S1R4','S1R5']);
 assert.equal(result.file.pages[0].rows[0].cells[1].value,'2026-09-01');
 assert.equal(result.file.pages[0].rows[1].cells[1].value,'Synthetic event');
 const answer={actions:[{sources:['S1R3']}],excludedSources:[...result.excludedSources,{id:'S1R4',reason:'Needs review'},{id:'S1R5',reason:'Needs review'}]};
 assert.equal(validateCoverage(answer,full).length,4);
 assert.throws(()=>validateCoverage({...answer,excludedSources:result.excludedSources},full),/incomplete-source-coverage/);
});
test('ordinary tables and content outside date columns are never silently removed',()=>{
 const file={pages:[{sheet:'Test',rows:[row(1,['Name','Date']),row(2,['Important']),row(3,['תאריך','2026-09-01','2026-09-02']),row(4,['צוות',null,null,'A note']),row(5,['Important note'])]}]};
 const result=calendarAnalysisSource(file,sourceManifest(file));
 assert.deepEqual(result.manifest.map(r=>r.id),['S1R1','S1R2','S1R4','S1R5']);
 assert.equal(result.file.pages[0].rows.length,5);
});
