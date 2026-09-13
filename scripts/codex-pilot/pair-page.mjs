export const pairHtml = `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>חיבור המחשב לזוקו</title><style>body{font-family:Arial,sans-serif;background:#f8fafc;color:#243444;padding:28px;line-height:1.7}main{background:white;border:1px solid #dbe3eb;border-radius:18px;padding:24px}h1{font-size:22px;margin-top:0}button{background:#f4512c;color:white;border:0;border-radius:10px;padding:12px 18px;font:inherit;cursor:pointer}button:disabled{opacity:.5}p{font-size:15px}</style><main><h1>חיבור המחשב לזוקו</h1><p>אפשר לחשבון שבו אתה מחובר באתר להשתמש ב־Codex שבמחשב הזה. שינויים בנתוני המוסד עדיין יוצגו לאישור באתר.</p><button id="pair">אישור חיבור המחשב לחשבון שלי</button><p id="status" role="status">לא נדרשת הקלדת סיסמה נוספת.</p></main><script src="/__zoki_pair.js"></script></html>`;
export const pairScript = `
const site='https://yossileviway.github.io';
const nonce=new URL(location.href).searchParams.get('nonce');
const button=document.getElementById('pair'),status=document.getElementById('status');
let awaiting=false;
if(!window.opener||!/^[-a-z0-9]{36}$/.test(nonce||'')){button.disabled=true;status.textContent='יש לפתוח את החיבור מתוך זוקי באתר הרגיל.';}
button.addEventListener('click',()=>{awaiting=true;button.disabled=true;status.textContent='בודק התחברות ופרטיות…';window.opener.postMessage({type:'zoko-pair-ready',nonce},site);});
window.addEventListener('message',async event=>{
 if(!awaiting||event.origin!==site||event.source!==window.opener||event.data?.nonce!==nonce||event.data?.type!=='zoko-pair-credentials')return;
 awaiting=false;
 const {idToken,refreshToken,schoolId}=event.data;
 if(typeof idToken!=='string'||typeof refreshToken!=='string'||typeof schoolId!=='string')return;
 try{
  const response=await fetch('/__zoki_codex/connect',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json',Authorization:'Bearer '+idToken},body:JSON.stringify({schoolId,refreshToken})});
  const result=await response.json();
  if(!response.ok||!result.connected)throw Error();
  status.textContent='המחשב מחובר. אפשר להמשיך באתר.';
  window.opener.postMessage({type:'zoko-pair-done',nonce},site);
 }catch{status.textContent='החיבור לא הושלם. בדוק ש־Codex מחובר לחשבון שלך ונסה שוב.';window.opener.postMessage({type:'zoko-pair-failed',nonce},site);}
});`;
