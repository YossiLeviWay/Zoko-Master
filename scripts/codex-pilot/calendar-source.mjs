// Compact only recognized weekly calendar grids. Keep every content-bearing
// cell and every date header; omit empty category slots from model bookkeeping.
// The original source and full coverage check remain authoritative.
export function calendarAnalysisSource(source, manifest) {
  if (!source) return {file:source, manifest, excludedSources:[]};
  const excludedSources=[];
  const meaningful=cell=>cell.value!=null && String(cell.value).trim()!=='';
  const isDate=cell=>typeof cell.value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(cell.value);
  const pages=source.pages.map((page,index)=>{
    if (!page.rows) return page;
    let dateColumns=null;
    const rows=[];
    for(const row of page.rows){
      const cells=(row.cells||[]).filter(meaningful);
      const label=cells.find(cell=>cell.column===1)?.value;
      const dates=cells.filter(cell=>cell.column>1&&isDate(cell));
      const id=`S${index+1}R${row.row}`;
      if(label==='תאריך' && dates.length>=2 && cells.every(cell=>cell.column===1||isDate(cell))){
        dateColumns=new Set(dates.map(cell=>cell.column));
        rows.push({...row,contextOnly:true});
        excludedSources.push({id,reason:'שורת תאריכים המשמשת הקשר לאירועים שמתחתיה'});
      }else if(dateColumns && cells.every(cell=>cell.column===1) && (cells.length===0 || ['כללי','צוות','צלש','ז','ח','ט','י','יא','יב'].includes(String(label).replace(/[׳״"']/g,'').trim()))){
        excludedSources.push({id,reason:'שורת קטגוריה ריקה מאירועים בלוח השבועי'});
      }else{
        // Unknown layouts and cells outside the recognized date grid survive.
        rows.push(row);
        if(label==='תאריך')dateColumns=null;
      }
    }
    return {...page,rows};
  });
  const omitted=new Set(excludedSources.map(row=>row.id));
  return {file:{...source,pages},manifest:manifest.filter(row=>!omitted.has(row.id)),excludedSources};
}
