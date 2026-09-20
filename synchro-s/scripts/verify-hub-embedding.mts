import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {hubCookieOptions,HUB_SESSION_COOKIE,isCrossOriginMutation,readSessionCookie} from '../lib/server/hubSession.ts';
assert.deepEqual(hubCookieOptions(),{httpOnly:true,secure:true,sameSite:'none',partitioned:true,path:'/'});
assert.ok(HUB_SESSION_COOKIE.startsWith('__Host-'));
for(const method of ['POST','PUT','PATCH','DELETE']){
 assert.equal(isCrossOriginMutation(new Request('https://synchro.example/api/write',{method,headers:{origin:'https://evil.example'}})),true);
 assert.equal(isCrossOriginMutation(new Request('https://synchro.example/api/write',{method,headers:{origin:'null'}})),true);
 assert.equal(isCrossOriginMutation(new Request('https://synchro.example/api/write',{method,headers:{origin:'https://synchro.example'}})),false);
}
assert.equal(readSessionCookie({get:n=>({value:n})},'standalone'),HUB_SESSION_COOKIE);
assert.equal(readSessionCookie({get:n=>n==='standalone'?{value:'existing'}:undefined},'standalone'),'existing');
const source=readFileSync(new URL('../public/hub-entry.mjs',import.meta.url),'utf8').replace(/^import .*;$/gm,'');
for(const embedded of [true,false]){
 let callbacks:any,frame:any;const requests:any[]=[];const status={hidden:false,textContent:''};const window:any={};window.parent=embedded?{}:window;
 const context={window,document:{title:'',querySelector:()=>status,createElement:()=>({style:{},remove(){this.removed=true;},removed:false}),body:{append:f=>{frame=f;}}},initializeAuth:()=>({}),initializeApp:()=>({}),browserSessionPersistence:{},signInWithCustomToken:async()=>({user:{uid:'test-user',getIdToken:async()=>'fixture-token'}}),signOut:async()=>{},installSso:async c=>{callbacks=c;},AbortSignal,fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({authenticated:true,firebaseUid:'test-user'})};}};
 await vm.runInNewContext('(async()=>{'+source+'})()',context);
 await callbacks.signIn('custom-token','test-user');
 assert.equal(JSON.parse(requests[0].options.body).hubEmbedded,embedded);
 assert.equal(frame.src,'/synchro-s');assert.equal(status.hidden,true);
 await callbacks.signOut();assert.equal(frame.removed,true);assert.equal(requests.at(-1).url,'/api/auth/logout');assert.equal(status.hidden,false);
}
console.log('PASS: isolated secure cookie, mutation origin guard, session selection, embedded/popup bridge and logout');
