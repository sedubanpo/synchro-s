// Independent cookie jar for the approved hub's embedded app. Standalone login stays Lax.
export const HUB_SESSION_COOKIE = '__Host-synchro_s_hub';
export function hubCookieOptions() {
  return {httpOnly:true,secure:true,sameSite:'none' as const,partitioned:true,path:'/'};
}
export function isCrossOriginMutation(request: Request) {
  if (['GET','HEAD','OPTIONS'].includes(request.method)) return false;
  const origin=request.headers.get('origin');
  return request.headers.get('sec-fetch-site')==='cross-site' || (origin!==null && origin!==new URL(request.url).origin);
}
export function readSessionCookie(store:{get(name:string):{value:string}|undefined},standaloneName:string) {
  return store.get(HUB_SESSION_COOKIE)?.value ?? store.get(standaloneName)?.value;
}
