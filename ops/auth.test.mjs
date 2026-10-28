import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {verifyIdentityToken,createOperatorAuth} from './auth.mjs';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwks={keys:[{...publicKey.export({format:'jwk'}),kid:'operator-test',use:'sig',alg:'RS256'}]};
const now=1793200000000,issuer='https://cognito-idp.us-east-1.amazonaws.com/us-east-1_test',clientId='client';
const claims={iss:issuer,aud:clientId,token_use:'id',nonce:'nonce',exp:now/1000+3600,iat:now/1000,email_verified:true,sub:'test-operator',email:'operator@example.test','cognito:groups':['operators']};
const token=c=>{const s=[{alg:'RS256',kid:'operator-test'},c].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');return s+'.'+sign('RSA-SHA256',Buffer.from(s),privateKey).toString('base64url');};
test('operator identity requires verified signed issuer, client, nonce and membership',()=>{
 assert.equal(verifyIdentityToken(token(claims),{issuer,clientId,nonce:'nonce',jwks,now}).email,claims.email);
 for(const change of [{iss:'https://other.test'},{aud:'other'},{nonce:'wrong'},{exp:now/1000-1},{email_verified:false},{'cognito:groups':[]},{token_use:'access'}])assert.throws(()=>verifyIdentityToken(token({...claims,...change}),{issuer,clientId,nonce:'nonce',jwks,now}));
 const changed=token(claims).split('.');changed[1]=Buffer.from(JSON.stringify({...claims,email:'attacker@example.test'})).toString('base64url');assert.throws(()=>verifyIdentityToken(changed.join('.'),{issuer,clientId,nonce:'nonce',jwks,now}));
});
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(status,h={}){this.status=status;Object.assign(this.headers,h);},end(body){this.body=body;}});
test('authorization uses PKCE, one-use state bound to cookie, no tokens in redirects',async()=>{
 let nonce,exchanges=0;const origin='https://board.example.test',loginDomain='https://rolling.auth.us-east-1.amazoncognito.com';
 const auth=createOperatorAuth({origin,issuer,clientId,loginDomain,now:()=>now,fetchImpl:async(url,args)=>{if(url.endsWith('/jwks.json'))return {ok:true,json:async()=>jwks};exchanges++;assert.ok(args.body.get('code_verifier'));return {ok:true,json:async()=>({id_token:token({...claims,nonce})})};}});
 const res=response();await auth.handle({method:'GET',headers:{}},res,new URL(origin+'/_ops/auth/login'));const login=new URL(res.headers.Location);nonce=login.searchParams.get('nonce');assert.equal(login.searchParams.get('code_challenge_method'),'S256');assert.ok(login.searchParams.get('code_challenge'));const state=login.searchParams.get('state');
 const callback=new URL(origin+'/_ops/auth/callback?code=test&state='+state),done=response();await auth.handle({method:'GET',headers:{cookie:`__Secure-rolling_login=${state}`}},done,callback);assert.equal(done.status,303);assert.equal(done.headers.Location,'/_ops/');assert.match(done.headers['Set-Cookie'],/HttpOnly; Secure; SameSite=Lax/);assert.ok(auth.identity({headers:{cookie:done.headers['Set-Cookie'].split(';')[0]}}));
 const replay=response();await auth.handle({method:'GET',headers:{cookie:`__Secure-rolling_login=${state}`}},replay,callback);assert.equal(replay.status,400);assert.equal(exchanges,1);
 const logout=response();await auth.handle({method:'POST',headers:{origin:'https://other.example.test'}},logout,new URL(origin+'/_ops/auth/logout'));assert.equal(logout.status,403);
});
