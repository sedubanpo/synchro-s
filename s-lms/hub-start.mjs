import {installSso} from './hub-client.mjs';
const start=()=>installSso({appId:"lms",...{"brokerUrl":"https://asia-northeast3-fir-lms-prod.cloudfunctions.net/hubSsoApi","hubOrigins":["https://sedubanpo.github.io"]},...window.SeduHubAdapter});
if(document.readyState==='complete')start();else window.addEventListener('load',start,{once:true});
