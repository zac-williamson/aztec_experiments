import {randomBytes,createHash,createPublicKey,verify} from 'node:crypto';

const random=()=>randomBytes(32).toString('base64url');
const cookieName='__Secure-rolling_ops';
const cookies=req=>Object.fromEntries((req.headers.cookie||'').split(';').map(s=>s.trim().split('=')).filter(x=>x.length===2));
const cookie=(value,maxAge)=>`${cookieName}=${value}; Path=/_ops; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
export function verifyIdentityToken(token,{issuer,clientId,nonce,jwks,now=Date.now()}){
 if(typeof token!=='string'||token.length>16384)throw Error('Invalid identity');
 const parts=token.split('.');if(parts.length!==3)throw Error('Invalid identity');
 const header=JSON.parse(Buffer.from(parts[0],'base64url'));
 const claims=JSON.parse(Buffer.from(parts[1],'base64url'));
 if(header.alg!=='RS256'||typeof header.kid!=='string')throw Error('Invalid identity');
 const jwk=jwks.keys.find(k=>k.kid===header.kid&&k.kty==='RSA'&&k.use==='sig'&&k.alg==='RS256');
 if(!jwk||!verify('RSA-SHA256',Buffer.from(parts.slice(0,2).join('.')),createPublicKey({key:jwk,format:'jwk'}),Buffer.from(parts[2],'base64url')))throw Error('Invalid identity');
 if(claims.iss!==issuer||claims.aud!==clientId||claims.token_use!=='id'||claims.nonce!==nonce||!Number.isFinite(claims.exp)||claims.exp*1000<=now||!Number.isFinite(claims.iat)||claims.iat*1000>now+60000||claims.email_verified!==true||typeof claims.sub!=='string'||typeof claims.email!=='string')throw Error('Invalid identity');
 if(!Array.isArray(claims['cognito:groups'])||!claims['cognito:groups'].some(g=>g==='operators'||g==='administrators'))throw Error('Access not granted');
 return {email:claims.email,subject:claims.sub,admin:claims['cognito:groups'].includes('administrators'),expiresAt:Math.min(now+3600000,claims.exp*1000)};
}
export function createOperatorAuth({origin,issuer,clientId,loginDomain,fetchImpl=fetch,now=Date.now}){
 if(new URL(origin).protocol!=='https:'||!/^https:\/\/cognito-idp\.[a-z0-9-]+\.amazonaws\.com\/[\w-]+$/.test(issuer)||!/^https:\/\/[a-z0-9-]+\.auth\.[a-z0-9-]+\.amazoncognito\.com$/.test(loginDomain))throw Error('Invalid operator identity configuration');
 const pending=new Map(),sessions=new Map();let keys;
 function prune(){for(const map of [pending,sessions])for(const [key,value]of map)if(value.expiresAt<=now())map.delete(key);}
 function identity(req){prune();return sessions.get(cookies(req)[cookieName])||null;}
 async function handle(req,res,url){
  if(!url.pathname.startsWith('/_ops/auth/'))return false;
  res.setHeader('Cache-Control','no-store');prune();
  const redirect=location=>{res.writeHead(303,{Location:location});res.end();return true;};
  if(url.pathname==='/_ops/auth/login'&&req.method==='GET'){
   if(pending.size>=200){res.writeHead(429);res.end('Please try again shortly.');return true;}
   const state=random(),nonce=random(),verifier=random();
   pending.set(state,{nonce,verifier,expiresAt:now()+600000});
   res.setHeader('Set-Cookie',`__Secure-rolling_login=${state}; Path=/_ops/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
   const login=new URL('/oauth2/authorize',loginDomain);
   login.search=new URLSearchParams({client_id:clientId,response_type:'code',scope:'openid email',redirect_uri:origin+'/_ops/auth/callback',state,nonce,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')}).toString();return redirect(login.href);
  }
  if(url.pathname==='/_ops/auth/callback'&&req.method==='GET'){
   const state=url.searchParams.get('state'),attempt=pending.get(state);pending.delete(state);
   res.setHeader('Set-Cookie','__Secure-rolling_login=; Path=/_ops/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
   if(!attempt||cookies(req)['__Secure-rolling_login']!==state||!url.searchParams.get('code')){res.writeHead(400);res.end('Sign-in expired. Start again.');return true;}
   try{
    const response=await fetchImpl(loginDomain+'/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:clientId,code:url.searchParams.get('code'),redirect_uri:origin+'/_ops/auth/callback',code_verifier:attempt.verifier}),signal:AbortSignal.timeout(10000),redirect:'error'});
    if(!response.ok)throw Error('Sign-in failed');const tokens=await response.json();
    if(!keys||keys.expiresAt<=now()){const r=await fetchImpl(issuer+'/.well-known/jwks.json',{signal:AbortSignal.timeout(10000),redirect:'error'});if(!r.ok)throw Error('Identity unavailable');keys={value:await r.json(),expiresAt:now()+3600000};}
    const user=verifyIdentityToken(tokens.id_token,{issuer,clientId,nonce:attempt.nonce,jwks:keys.value,now:now()});
    if(sessions.size>=200)throw Error('Session limit');const session=random();sessions.set(session,user);res.setHeader('Set-Cookie',cookie(session,Math.floor((user.expiresAt-now())/1000)));return redirect('/_ops/');
   }catch{res.writeHead(403);res.end('Sign-in could not be completed. Check your invitation and try again.');return true;}
  }
  if(url.pathname==='/_ops/auth/logout'&&req.method==='POST'){
   if(req.headers.origin!==origin){res.writeHead(403);res.end();return true;}
   sessions.delete(cookies(req)[cookieName]);res.setHeader('Set-Cookie',cookie('',0));const logout=new URL('/logout',loginDomain);logout.search=new URLSearchParams({client_id:clientId,logout_uri:origin+'/_ops/'}).toString();return redirect(logout.href);
  }
  res.writeHead(405);res.end();return true;
 }
 return {identity,handle};
}
