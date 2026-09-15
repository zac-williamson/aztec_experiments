// Actual standard CLI configuration/key/SQLite initialization; CLI seams execute the current source.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { GasSettings } from '@aztec/stdlib/gas';
import {readCliSponsorConfig,createCliSponsorship,validateCliSponsorFlags} from '../sponsor-service/cli-provider.mjs';
const roots=[];after(()=>roots.forEach(p=>fs.rmSync(p,{recursive:true,force:true})));
const hex=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const valid=()=>({issuerUrl:'https://issuer.example',sponsorAddress:hex(11),windowDuration:'60',gasSettings:{gasLimits:{daGas:100,l2Gas:200},teardownGasLimits:{daGas:10,l2Gas:20},maxFeesPerGas:{feePerDaGas:'3',feePerL2Gas:'5'},maxPriorityFeesPerGas:{feePerDaGas:'1',feePerL2Gas:'2'}}});
const fails=e=>e.code==='CLI_SPONSOR_CONFIGURATION_UNAVAILABLE'&&e.message===e.code;
function fixture(){const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'cli-sponsor-config-'));roots.push(dir);const configPath=path.join(dir,'sponsor.json'),walletPath=path.join(dir,'wallet.json'),walletSecret=hex(20);fs.writeFileSync(configPath,JSON.stringify(valid()),{mode:0o600});fs.writeFileSync(walletPath,JSON.stringify({secretKey:walletSecret}),{mode:0o600});return {dir,configPath,walletPath,walletSecret};}
const cli=fs.readFileSync(new URL('../apps/src/billboard/user/cli.mjs',import.meta.url),'utf8');

test('real standard route derives key, opens private SQLite, persists stable opaque namespace and closes',async()=>{
  const f=fixture();let local=await createCliSponsorship(f);assert.equal(local.sponsorship.sponsorAddress,hex(11));assert.deepEqual(local.sponsorship.gasSettings,valid().gasSettings);assert.equal(GasSettings.from(local.sponsorship.gasSettings).getFeeLimit().toBigInt(),1300n);
  const dir=path.join(f.dir,'sponsor-coupons-v1');assert.equal(fs.statSync(dir).mode&0o777,0o700);const [file]=fs.readdirSync(dir);assert.match(file,/^[0-9a-f]{64}\.sqlite$/);assert(!file.includes(f.walletSecret.slice(2)));assert.equal(fs.statSync(path.join(dir,file)).mode&0o777,0o600);
  await local.close();await assert.rejects(local.sponsorship.couponProvider.acquire({}),e=>e.code==='SPONSOR_LOCAL_PROVIDER_UNAVAILABLE');
  local=await createCliSponsorship(f);assert.deepEqual(fs.readdirSync(dir),[file]);await local.close();
  local=await createCliSponsorship({...f,walletSecret:hex(21)});assert.equal(fs.readdirSync(dir).length,2);await local.close();
});

test('strict public configuration rejects extra secret fields and unsafe nested values',async()=>{
  const f=fixture();for(const modify of [c=>c.walletSecret='private',c=>c.owner='private',c=>delete c.issuerUrl,c=>c.issuerUrl='http://issuer.example',c=>c.issuerUrl='https://user:secret@issuer.example',c=>c.issuerUrl='https://issuer.example?token=secret',c=>c.sponsorAddress=hex(0),c=>c.windowDuration='86401',c=>c.gasSettings.extra=1,c=>c.gasSettings.gasLimits.secret='private',c=>c.gasSettings.gasLimits.daGas=2**32,c=>c.gasSettings.gasLimits.l2Gas=1.2,c=>c.gasSettings.teardownGasLimits.daGas=101,c=>c.gasSettings.maxFeesPerGas.feePerDaGas='01',c=>c.gasSettings.maxPriorityFeesPerGas.feePerDaGas='4']){
    const config=valid();modify(config);fs.writeFileSync(f.configPath,JSON.stringify(config));assert.throws(()=>readCliSponsorConfig(f.configPath),fails);
  }assert(!fs.existsSync(path.join(f.dir,'sponsor-coupons-v1')));
});

test('bounded config reader rejects malformed/oversized/nonregular/link files',()=>{
  const f=fixture();for(const content of ['{','x'.repeat(16385)]){fs.writeFileSync(f.configPath,content);assert.throws(()=>readCliSponsorConfig(f.configPath),fails);}
  fs.writeFileSync(f.configPath,JSON.stringify(valid()));const link=path.join(f.dir,'link.json');fs.symlinkSync(f.configPath,link);assert.throws(()=>readCliSponsorConfig(link),fails);assert.throws(()=>readCliSponsorConfig(f.dir),fails);
  const hard=path.join(f.dir,'hard.json');fs.linkSync(f.configPath,hard);assert.throws(()=>readCliSponsorConfig(f.configPath),fails);
});

test('invalid loaded wallet and nonprivate coupon directory fail with fixed safe error',async()=>{
  const f=fixture();await assert.rejects(createCliSponsorship({...f,walletSecret:'private-secret'}),fails);fs.mkdirSync(path.join(f.dir,'sponsor-coupons-v1'),{mode:0o755});await assert.rejects(createCliSponsorship(f),fails);
});

test('both sponsor options and missing option values reject at actual CLI main seam before SDK',async()=>{
  const main=cli.slice(cli.indexOf('async function main() {'),cli.indexOf('\nmain().catch')).replace("await import('../../../../sponsor-service/cli-provider.mjs')",'helpers');
  for(const args of [{'sponsor-config':'a','sponsor-provider':'b'},{'sponsor-config':true},{'sponsor-provider':true}]){
    let sdk=0;const context={args,helpers:{validateCliSponsorFlags},loadAztecSDK:()=>{sdk++;},log:()=>{throw Error('Must reject before startup logging');}};
    const run=vm.runInNewContext(main+'\nmain',context);await assert.rejects(run(),fails);assert.equal(sdk,0);
  }
});

function rpcWrapper(){const source=cli.slice(cli.indexOf('function createCliRpcFetch('),cli.indexOf('\nif (AZTEC_API_KEY) globalThis.fetch'));return vm.runInNewContext(source+'\ncreateCliRpcFetch',{URL,Request,Headers});}
test('actual CLI RPC wrapper never leaks credential through misleading origin/path/query',async()=>{
  const seen=[],fetch=rpcWrapper()((input,init)=>{seen.push({input,init});return Promise.resolve();},'https://rpc.example/rpc','fixture-api-key');
  for(const url of ['https://evil.example/?https://rpc.example/rpc','https://evil.example/rpc.example/rpc','https://rpc.example.evil/rpc','https://rpc.example/other','https://rpc.example/rpc/','https://user:pass@rpc.example/rpc'])await fetch(url);
  for(const row of seen)assert.equal(row.init,undefined);
});
test('actual CLI RPC wrapper preserves URL/Request/Headers and forbids authenticated redirects',async()=>{
  const seen=[],fetch=rpcWrapper()((input,init)=>{seen.push({input,init});return Promise.resolve();},'https://rpc.example/rpc','fixture-api-key');
  const request=new Request('https://rpc.example/rpc',{method:'POST',headers:{'content-type':'application/json','x-existing':'kept'},body:'{}'});await fetch(request);assert.equal(seen[0].input,request);assert.equal(seen[0].init.headers.get('x-existing'),'kept');assert.equal(seen[0].init.headers.get('x-aztec-api-key'),'fixture-api-key');assert.equal(seen[0].init.redirect,'error');assert.equal(request.headers.has('x-aztec-api-key'),false);
  const headers=new Headers({'x-override':'present'}),url=new URL('https://rpc.example/rpc');await fetch(url,{headers,redirect:'follow'});assert.equal(seen[1].input,url);assert.equal(seen[1].init.headers.get('x-override'),'present');assert.equal(seen[1].init.redirect,'error');assert.equal(headers.has('x-aztec-api-key'),false);
});
test('actual CLI RPC wrapper honors issuer privacy mode even on exact endpoint collision',async()=>{
  const seen=[],fetch=rpcWrapper()((input,init)=>{seen.push({input,init});return Promise.resolve();},'https://rpc.example/rpc','fixture-api-key');
  const options={credentials:'omit',referrerPolicy:'no-referrer',headers:{'content-type':'application/json'},redirect:'error'};await fetch('https://rpc.example/rpc',options);assert.equal(seen[0].init,options);assert.equal(new Headers(seen[0].init.headers).has('x-aztec-api-key'),false);
  const req=new Request('https://rpc.example/rpc',options);await fetch(req);assert.equal(seen[1].init,undefined);
});

test('actual CLI main finally closes real encrypted provider on success and action failure',async()=>{
  const main=cli.slice(cli.indexOf('async function main() {'),cli.indexOf('\nmain().catch'))
    .replaceAll("await import('../../../../sponsor-service/cli-provider.mjs')",'helpers').replace("await import('ethers')",'({})');
  for(const failAction of [false,'BB_SUBMISSION_UNKNOWN','BB_TRANSACTION_FAILED','BB_STATE_CONFLICT','unrecognized']){
    const f=fixture();let closes=0,route;
    const helpers={validateCliSponsorFlags,createCliSponsorship:async input=>{route=await createCliSponsorship(input);return {...route,close:async()=>{closes++;await route.close();if(failAction==='BB_SUBMISSION_UNKNOWN')throw Error('private-close-diagnostic');}};}};
    class Field{static fromHexString(){return {};}}
    const a={Fr:Field,deriveSigningKey:()=>({}),deriveKeys:async()=>({publicKeys:{}}),SchnorrInitializerlessAccountContract:class{async getContractArtifact(){return {};}async getImmutablesHash(){return {}; }},getContractInstanceFromInstantiationParams:async()=>({address:{toString:()=>hex(22)}})};
    const context={args:{'sponsor-config':f.configPath},helpers,ACTION:'status',AZTEC_NODE_URL:'https://rpc.example',ETH_RPC_URL:'https://eth.example',PORTAL_ADDRESS:'0x'+'01'.repeat(20),AZTEC_WALLET_PATH:f.walletPath,ETH_WALLET_PATH:'unused',CENSOR_WALLET_PATH:'unused',PXE_DIR_PREFIX:'test',PXE_CACHE_DIR:path.join(f.dir,'cache'),__dirname:path.join(f.dir,'app'),path,
      log:()=>{},loadCliWalletInputs:()=>({ethWallet:null,aztecWallet:{secretKey:f.walletSecret},censorWalletJson:null}),loadAztecSDK:async()=>a,
      fs:{readFileSync:filename=>filename.endsWith('portal_bytecode.txt')?'00':'{}',existsSync:()=>true},initCRSNode:()=>{},createStoreNode:()=>{},restorePxeCache:async()=>false,dumpPxeCache:async()=>false,indexedDB:{},
      runBillboardUser:async()=>{if(failAction)throw Object.assign(Error('private-action-diagnostic'),{code:failAction});return {state:'done'};}};
    const run=vm.runInNewContext(main+'\nmain',context);
    if(failAction)await assert.rejects(run(),e=>e.code===failAction);else await run();
    assert.equal(closes,1);await assert.rejects(route.sponsorship.couponProvider.acquire({}),e=>e.code==='SPONSOR_LOCAL_PROVIDER_UNAVAILABLE');
  }
});


test('actual CLI fatal mapping preserves reconciliation codes without private diagnostics',()=>{
  const source=cli.slice(cli.indexOf('function formatCliSponsorFailure('),cli.indexOf('\nmain().catch'));
  const format=vm.runInNewContext(source+'\nformatCliSponsorFailure');
  for(const code of ['BB_SUBMISSION_UNKNOWN','BB_TRANSACTION_FAILED','BB_STATE_CONFLICT','CLI_SPONSOR_CONFIGURATION_UNAVAILABLE']){
    const text=format(Object.assign(Error('private-wallet-input'),{code}));assert(text.startsWith(code+':'));assert(!text.includes('private'));
  }
  assert.match(format({code:'BB_SUBMISSION_UNKNOWN'}),/Check its outcome before another attempt/);
  assert(!format({code:'evil-private-code',message:'private'}).includes('private'));
  assert(!format({get code(){throw Error('private-getter');}}).includes('private'));
});
