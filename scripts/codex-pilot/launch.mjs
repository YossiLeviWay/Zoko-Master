import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(fileURLToPath(new URL('../..',import.meta.url)));
const directory = join(root,'.zoki-local');
await mkdir(directory,{recursive:true,mode:0o700});
async function ready(){try{return (await (await fetch('http://127.0.0.1:5189/__zoki_health',{signal:AbortSignal.timeout(1000)})).json()).application==='zoko-connector';}catch{return false;}}
if (!await ready()) {
  const child=spawn(process.execPath,[join(root,'scripts/codex-pilot/server.mjs')],{cwd:root,detached:true,stdio:'ignore'});
  await writeFile(join(directory,'connector.pid'),String(child.pid),{mode:0o600});child.unref();
}
for(let attempt=0;attempt<30 && !await ready();attempt++)await new Promise(resolve=>setTimeout(resolve,300));
if(!await ready())throw Error('לא ניתן להפעיל את החיבור. בדוק שהפורט המקומי פנוי.');
if (process.platform==='darwin' && !process.argv.includes('--no-open')) spawn('/usr/bin/open',['https://yossileviway.github.io/Zoko-Master/#/zoki'],{stdio:'ignore'}).unref();
console.log('תוכנת החיבור פועלת ברקע. באתר הרגיל בחר Codex שלי ואז חיבור המחשב שלי לאתר.');
