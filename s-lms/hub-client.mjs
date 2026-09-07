// Install in each application origin. A ticket is never accepted from an unknown origin/window.
export async function installSso({appId,brokerUrl,hubOrigins,signIn,signOut,windowObject=window}){
  const nonce=new URL(windowObject.location.href).searchParams.get('hub_nonce');
  if(!/^[A-Za-z0-9_-]{43}$/.test(nonce||''))return null;
  const peer=windowObject.parent!==windowObject?windowObject.parent:windowObject.opener;
  if(!peer)return null;
  // The referrer is only used to choose a pre-authorized origin; it never grants trust.
  let origin;try{origin=new URL(document.referrer).origin;}catch{return null;}
  if(!hubOrigins.includes(origin))return null;
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  const encode=b=>btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const verifier=encode(bytes),challenge=encode(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
  let busy=false,authenticated=false,disposed=false,sequence=0;
  const send=(type,extra={})=>peer.postMessage({channel:'sedu-hub-v1',type,appId,nonce,...extra},origin);
  async function receive(event){
    const d=event.data;
    if(disposed||event.source!==peer||event.origin!==origin||!d||d.channel!=='sedu-hub-v1'||d.appId!==appId||d.nonce!==nonce)return;
    if(d.type==='logout'){sequence++;disposed=true;clearInterval(ping);clearTimeout(deadline);await signOut();send('signed-out');windowObject.removeEventListener('message',receive);return;}
    if(d.type!=='ticket'||busy||authenticated||!/^[A-Za-z0-9_-]{43}$/.test(d.code||''))return;
    busy=true;const current=++sequence;clearInterval(ping);
    try{
      const r=await fetch(brokerUrl+'/exchange',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:d.code,appId,nonce,verifier}),signal:AbortSignal.timeout(15000)});
      if(!r.ok)throw Error('SSO exchange failed');
      const result=await r.json();if(disposed||current!==sequence)return;
      await signIn(result.customToken,result.uid);
      if(disposed||current!==sequence){await signOut();return;}
      authenticated=true;send('authenticated');
    }catch{try{await signOut();}catch{}if(!disposed)send('error');}
  }
  windowObject.addEventListener('message',receive);
  const ping=setInterval(()=>{if(!busy&&!authenticated)send('ready',{challenge});},750);
  send('ready',{challenge});
  const deadline=setTimeout(()=>{clearInterval(ping);if(!authenticated){disposed=true;windowObject.removeEventListener('message',receive);}},30000);
  return ()=>{disposed=true;sequence++;clearInterval(ping);clearTimeout(deadline);windowObject.removeEventListener('message',receive);};
}
