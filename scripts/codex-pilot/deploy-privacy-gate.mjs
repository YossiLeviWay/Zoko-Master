// One narrowly scoped migration from the verified live baseline. Abort when any
// administrator has changed that baseline; never overwrite newer access rules.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const require=createRequire(import.meta.url), auth=require('firebase-tools/lib/auth');
const projectId='eduflow-pro-12a90';
const baseline="rules_version = '2';\nservice cloud.firestore {\n  match /databases/{database}/documents {\n    match /{document=**} {\n      allow read, write: if request.auth != null;\n    }\n  }\n}";
const desired=await readFile(new URL('./privacy-gate.rules',import.meta.url),'utf8');
const account=auth.getGlobalDefaultAccount();
const token=await auth.getAccessToken(account.tokens.refresh_token,['https://www.googleapis.com/auth/cloud-platform']);
async function request(path,method='GET',body) {
 const response=await fetch(`https://firebaserules.googleapis.com/v1/${path}`,{method,headers:{Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 if(!response.ok)throw Error(`rules-${method.toLowerCase()}-${response.status}`);
 return response.json();
}
const releasePath=`projects/${projectId}/releases/cloud.firestore`;
const release=await request(releasePath), live=await request(release.rulesetName);
const current=live.source.files[0].content;
if(current===desired){console.log('Privacy gate already active.');process.exit(0);}
if(current!==baseline || live.source.files.length!==1)throw Error('live-rules-changed-review-required');
console.log(JSON.stringify({scope:'users/{uid}/zokiPilot only; other access unchanged',before:release.rulesetName,sha256:createHash('sha256').update(desired).digest('hex'),apply:process.argv.includes('--apply')}));
if(process.argv.includes('--apply')) {
 const rule=await request(`projects/${projectId}/rulesets`,'POST',{source:{files:[{name:'firestore.rules',content:desired}]}});
 if((await request(releasePath)).rulesetName!==release.rulesetName)throw Error('live-rules-changed-review-required');
 await request(`${releasePath}?updateMask=rulesetName`,'PATCH',{release:{name:releasePath,rulesetName:rule.name}});
 const verified=await request(releasePath);if(verified.rulesetName!==rule.name)throw Error('release-verification-failed');
 await writeFile('/tmp/zoko-bridge-rule-release.json',JSON.stringify({previous:release.rulesetName,current:rule.name}),{mode:0o600});
 console.log('Owner-only pilot privacy gate deployed and verified.');
}
