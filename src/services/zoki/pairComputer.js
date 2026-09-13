export const LOCAL_CONNECTOR = 'http://127.0.0.1:5189';
export const isPairMessage = (event, popup, nonce) => event.origin === LOCAL_CONNECTOR
  && event.source === popup && event.data?.nonce === nonce
  && ['zoko-pair-ready','zoko-pair-done','zoko-pair-failed'].includes(event.data?.type);

// Open synchronously from a user click. Credentials travel only between this
// authenticated page and its own loopback popup, never through Firebase queues.
export function pairComputer(user, schoolId, signal) {
  const nonce = crypto.randomUUID();
  const popup = window.open(`${LOCAL_CONNECTOR}/__zoki_pair?nonce=${nonce}`, 'zoko-device-pair', 'width=480,height=420');
  if (!popup) return Promise.reject(Object.assign(new Error(), { code:'popup-blocked' }));
  return new Promise((resolve,reject) => {
    let sent=false, finished=false;
    const finish=(error)=>{if(finished)return;finished=true;clearTimeout(timeout);clearInterval(closed);window.removeEventListener('message',message);signal?.removeEventListener('abort',abort);popup.close();error?reject(error):resolve();};
    const fail=code=>Object.assign(new Error(),{code});
    const abort=()=>finish(new DOMException('Aborted','AbortError'));
    const message=async event=>{
      if(!isPairMessage(event,popup,nonce)||finished)return;
      if(event.data.type==='zoko-pair-ready'&&!sent){
        sent=true;
        try {
          const idToken=await user.getIdToken(true);
          if(!finished)popup.postMessage({type:'zoko-pair-credentials',nonce,idToken,refreshToken:user.refreshToken,schoolId},LOCAL_CONNECTOR);
        }catch{finish(fail('session-expired'));}
      }else if(event.data.type==='zoko-pair-done'&&sent)finish();
      else if(event.data.type==='zoko-pair-failed')finish(fail('computer-pairing-failed'));
    };
    const timeout=setTimeout(()=>finish(fail('computer-pairing-timeout')),180000);
    const closed=setInterval(()=>{if(popup.closed)finish(fail('computer-pairing-cancelled'));},500);
    window.addEventListener('message',message);signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();
  });
}
