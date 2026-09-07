import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js';
import {initializeAuth,browserSessionPersistence,signInWithCustomToken,signOut} from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js';
import {installSso} from './hub-client.mjs';
const auth=initializeAuth(initializeApp({apiKey:'AIzaSyCFM21ZxgwIYwmjRPaAOp5bL9Kprqiyppg',authDomain:'fir-lms-prod.firebaseapp.com',projectId:'fir-lms-prod'},'synchro-s'),{persistence:browserSessionPersistence});
await installSso({appId:'synchro',brokerUrl:'https://asia-northeast3-fir-lms-prod.cloudfunctions.net/hubSsoApi',hubOrigins:['https://sedubanpo.github.io'],
 async signIn(token,uid){
  const credential=await signInWithCustomToken(auth,token);if(credential.user.uid!==uid)throw Error('Identity mismatch');
  const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:await credential.user.getIdToken()}),signal:AbortSignal.timeout(25000)});
  if(!r.ok){document.querySelector('#status').textContent='앱 권한을 확인하지 못했습니다. 허브에서 다시 연결해 주세요.';throw Error('Session creation failed');}
  const check=await fetch('/api/auth/session',{cache:'no-store'});const session=await check.json();if(!check.ok||!session.authenticated||session.firebaseUid!==uid)throw Error('Session identity mismatch');
  // Top-level handoff preserves the existing SameSite=Lax protection. No cookie policy weakening.
  setTimeout(()=>{window.opener=null;location.replace('/synchro-s');},100);
 },async signOut(){await signOut(auth);}
});
