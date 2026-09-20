import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js';
import {initializeAuth,browserSessionPersistence,signInWithCustomToken,signOut} from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js';
import {installSso} from './hub-client.mjs';
const embedded=window.parent!==window;
let appFrame;
const auth=initializeAuth(initializeApp({apiKey:'AIzaSyCFM21ZxgwIYwmjRPaAOp5bL9Kprqiyppg',authDomain:'fir-lms-prod.firebaseapp.com',projectId:'fir-lms-prod'},'synchro-s'),{persistence:browserSessionPersistence});
await installSso({appId:'synchro',brokerUrl:'https://asia-northeast3-fir-lms-prod.cloudfunctions.net/hubSsoApi',hubOrigins:['https://sedubanpo.github.io'],
 async signIn(token,uid){
  const credential=await signInWithCustomToken(auth,token);if(credential.user.uid!==uid)throw Error('Identity mismatch');
  const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:await credential.user.getIdToken(),hubEmbedded:embedded}),signal:AbortSignal.timeout(25000)});
  if(!r.ok){document.querySelector('#status').textContent='앱 권한을 확인하지 못했습니다. 허브에서 다시 연결해 주세요.';throw Error('Session creation failed');}
  const check=await fetch('/api/auth/session',{cache:'no-store'});const session=await check.json();if(!check.ok||!session.authenticated||session.firebaseUid!==uid)throw Error('Session identity mismatch');
  document.title='싱크로에스';
  appFrame=document.createElement('iframe');appFrame.title='싱크로에스 업무 화면';appFrame.src='/synchro-s';
  appFrame.style.cssText='position:fixed;inset:0;width:100%;height:100%;border:0;background:white';
  document.body.append(appFrame);document.querySelector('#status').hidden=true;
  // Keep this authenticated bridge alive for hub logout and worker changes.

 },async signOut(){
  appFrame?.remove();appFrame=null;
  const response=await fetch('/api/auth/logout',{method:'POST'});
  await signOut(auth);
  document.querySelector('#status').hidden=false;document.querySelector('#status').textContent='로그아웃되었습니다.';
  if(!response.ok)throw Error('Session logout failed');
 }
});
