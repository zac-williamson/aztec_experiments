import test from 'node:test';
import assert from 'node:assert/strict';
import {Interface,keccak256,TypedDataEncoder,AbiCoder,encodeBytes32String} from 'ethers';
import {prepareAggregateFunding,validateAggregateFundingQuote,encodeAggregateFundingTransaction,aggregateFundingTransaction,aggregateFundingAbi,prepareAggregateUsdcFunding,aggregateUsdcFundingTransaction} from './aggregate-funding.mjs';
const address=n=>'0x'+n.toString(16).padStart(40,'0'),field=n=>'0x'+n.toString(16).padStart(64,'0');
const r=new Interface(aggregateFundingAbi), p=new Interface(['function depositNonces(address) view returns(uint256)','function depositsEnabled() view returns(bool)','function getDeposit(address) view returns(uint128)','function MIN_DEPOSIT() view returns(uint256)','function MAX_DEPOSIT() view returns(uint256)']);
const b=new Interface(['function active() view returns(bool)']);
const q=new Interface(['function quoteExactOutputSingle((address tokenIn,address tokenOut,uint256 amount,uint24 fee,uint160 sqrtPriceLimitX96)) returns(uint256,uint160,uint32,uint256)']);
function fixture(options={}) {
 const scope={chainId:'11155111',router:address(1),routerCodeHash:keccak256('0x6000'),collateralPortal:address(2),feePortal:address(3),bokPortal:address(4),weth:address(5),swapRouter:address(6),feeToken:address(7),bokToken:address(8),privateFpc:field(9),quoter:address(10),quoterCodeHash:keccak256('0x6000')};
 const allocation={asset:'ETH',collateralWei:'1000000',feeAmount:'100',bokAmount:'200',feePoolFee:3000,bokPoolFee:500,slippageBps:100,collateralSecretHash:field(11),feeSecretHash:field(12),bokCommitment:field(13),bokSecretHash:field(14)};
 const wallet={address:address(15),chainId:scope.chainId,canSendTransaction:true,canSignTypedData:true,gasBudgetWei:'10000'};const input={scope,allocation,wallet};const calls=[];
 const provider={async request(call){calls.push(call);const {method,params}=call;
  if(method==='eth_chainId')return '0xaa36a7';
  if(method==='eth_getBlockByNumber'&&params[0]==='pending')return {number:'0x11',hash:field(17),timestamp:'0x'+BigInt(options.pendingTime??1000).toString(16)};
  if(method==='eth_getBlockByNumber')return {number:'0x10',hash:options.reorg&&params[0]!=='latest'?field(99):field(16),timestamp:options.stale?'0x1':'0x3e8'};
  if(method==='eth_getCode')return options.badCode?'0x6001':'0x6000';
  if(method==='eth_getBalance')return options.poor?'0x1':'0xffffff';
  assert.equal(method,'eth_call');if(params[1]==='pending'){assert(['fund','fundUsdc'].includes(r.parseTransaction(params[0]).name));if(options.simulationFails)throw Error('PRIVATE_SENTINEL');return '0x';}assert.equal(params[1],'0x10');
  const {to,data}=params[0];if(to===scope.router){const f=r.parseTransaction({data});return r.encodeFunctionResult(f.name,[options.badScope&&f.name==='feeToken'?address(50):scope[f.name]]);}
  if(to===scope.collateralPortal){const f=p.parseTransaction({data});return p.encodeFunctionResult(f.name,[{depositNonces:0n,depositsEnabled:!options.disabled,getDeposit:options.existing?1n:0n,MIN_DEPOSIT:1n,MAX_DEPOSIT:2000000n}[f.name]]);}
  if(to===scope.bokPortal)return b.encodeFunctionResult('active',[true]);
  assert.equal(to,scope.quoter);const f=q.parseTransaction({data});assert.equal(f.args[0].tokenIn,scope.weth);assert.equal(f.args[0].sqrtPriceLimitX96,0n);
  if(options.noLiquidity)throw Error('synthetic provider private detail');
  return q.encodeFunctionResult('quoteExactOutputSingle',[f.args[0].amount*10n,1n,0,100000]);
 }};
 return {input,provider,calls,prepare:()=>prepareAggregateFunding(input,{provider})};
}
test('fixed public quotes produce exact three allocations, user gas and signed collateral consent',async()=>{
 const f=fixture(), result=await f.prepare();assert.equal(result.value,'1003030');assert.equal(result.breakdown.maximumTotalWei,'1013030');assert.equal(result.plan.fee.maxEth,'1010');assert.equal(result.plan.bok.maxEth,'2020');assert.equal(result.ready,false);assert.deepEqual(result.requiredClaims,['collateral','private-fee','bok']);
 assert.equal(result.consentDigest,TypedDataEncoder.hash(result.consent.domain,result.consent.types,result.consent.value));assert.equal(result.consent.value.executor,f.input.scope.router);
 const tx=await aggregateFundingTransaction(result,'0x1234');const parsed=r.parseTransaction({data:tx.data});assert.equal(parsed.name,'fund');assert.equal(parsed.args.p.beneficiary.toLowerCase(),f.input.wallet.address);assert.equal(parsed.args.p.bokCommitment,field(13));assert.equal(tx.recovery,'reconcile-only');
 assert.equal(f.calls.filter(c=>c.method==='eth_call'&&c.params[0].to===f.input.scope.quoter).length,2);assert(!f.calls.some(c=>/send|sign/.test(c.method)));assert(Object.isFrozen(result.plan.fee));
});
test('USDC-only gas is explicitly unavailable before any provider call',async()=>{const f=fixture();f.input.allocation.asset='USDC';await assert.rejects(f.prepare(),{code:'AGGREGATE_USDC_GAS_ROUTE_UNQUALIFIED'});assert.equal(f.calls.length,0);});
test('wallet capability and zero user gas fail before funds or network',async()=>{for(const key of ['canSendTransaction','canSignTypedData','gasBudgetWei']){const f=fixture();f.input.wallet[key]=key==='gasBudgetWei'?'0':false;await assert.rejects(f.prepare());assert.equal(f.calls.length,0);}});
for(const [name,options,code] of [
 ['no liquidity never substitutes issuance',{noLiquidity:true},'PUBLIC_READ_FAILED'],['wrong deployed runtime',{badCode:true},'RUNTIME'],['mismatched portal scope',{badScope:true},'SCOPE'],['quote reorg',{reorg:true},'QUOTE_REORG'],['inactive bridge',{disabled:true},'PORTAL_NOT_READY'],['balance must cover allocations plus user gas',{poor:true},'INSUFFICIENT_USER_FUNDS'],
])test(name,async()=>{const f=fixture(options);await assert.rejects(f.prepare(),{code:'AGGREGATE_'+code});assert(!f.calls.some(c=>/send|sign/.test(c.method)));});
test('invented quote objects and chain-expired plans cannot encode a payment',async()=>{await assert.rejects(aggregateFundingTransaction({plan:{}},'0x12'),{code:'AGGREGATE_UNVERIFIED_QUOTE'});const options={},f=fixture(options),result=await f.prepare();options.pendingTime=1901;await assert.rejects(aggregateFundingTransaction(result,'0x12'),{code:'AGGREGATE_STALE_QUOTE'});});
test('input descriptors reject accessors, inherited values and numeric coercion',async()=>{let touched=0;const f=fixture();Object.defineProperty(f.input.wallet,'address',{get(){touched++;return address(15);}});await assert.rejects(f.prepare());assert.equal(touched,0);const g=fixture();g.input.allocation.collateralWei={toString(){touched++;return '100';}};await assert.rejects(g.prepare());assert.equal(touched,0);});
test('all input allocations are captured before asynchronous reads',async()=>{const f=fixture();const request=f.provider.request;f.provider.request=async c=>{f.input.allocation.feeAmount='999';return request(c);};assert.equal((await f.prepare()).plan.fee.amount,'100');});

test('malformed RPC quantities are rejected without object coercion',async()=>{const f=fixture();let touched=0;f.provider.request=async()=>({toString(){touched++;return '0xaa36a7';}});await assert.rejects(f.prepare(),{code:'AGGREGATE_PUBLIC_READ_FAILED'});assert.equal(touched,0);});
test('idle canonical blocks use pending execution time, independent of browser clock',async()=>{const f=fixture({stale:true,pendingTime:1902}),quote=await f.prepare();assert.equal(quote.quoteAnchor.timestamp,'0x1');assert.equal(quote.plan.deadline,'2802');await aggregateFundingTransaction(quote,'0x12');});
test('deadline includes pending-state advancement during public reads',async()=>{const options={},f=fixture(options),request=f.provider.request;f.provider.request=async c=>{if(c.method==='eth_getBalance')options.pendingTime=1901;return request(c);};await assert.rejects(f.prepare(),{code:'AGGREGATE_STALE_QUOTE'});});
test('missing or regressed pending execution time cannot authorize funding',async()=>{for(const missing of [true,false]){const f=fixture({pendingTime:999}),request=f.provider.request;f.provider.request=c=>c.method==='eth_getBlockByNumber'&&c.params[0]==='pending'&&missing?null:request(c);await assert.rejects(f.prepare(),{code:'AGGREGATE_PUBLIC_READ_FAILED'});}});
test('confirmation rechecks canonical anchor and exact pending execution without exposing provider errors',async()=>{for(const changed of ['reorg','simulationFails']){const options={},f=fixture(options),quote=await f.prepare();options[changed]=true;await assert.rejects(aggregateFundingTransaction(quote,'0x12'),e=>e.code==='AGGREGATE_'+(changed==='reorg'?'QUOTE_REORG':'PUBLIC_READ_FAILED')&&!e.message.includes('PRIVATE_SENTINEL'));}});


const usdc=new Interface(['function implementation() view returns(address)','function DOMAIN_SEPARATOR() view returns(bytes32)','function balanceOf(address) view returns(uint256)','function authorizationState(address,bytes32) view returns(bool)']);
function usdcFixture(options={}) {
 const f=fixture(options),s=f.input.scope;
 Object.assign(s,{usdcCodeHash:keccak256('0x6000'),usdcImplementation:address(70),usdcImplementationCodeHash:keccak256('0x6000'),usdcDomain:{name:'USDC',version:'2'}});
 const a=f.input.allocation;delete a.bokPoolFee;Object.assign(a,{asset:'USDC',collateralPoolFee:500,authorizationSalt:field(80)});
 delete f.input.wallet.canSendTransaction;delete f.input.wallet.gasBudgetWei;
 f.input.relay={address:address(71),feeUsdc:'50',gasBudgetWei:'10000'};
 const original=f.provider.request;
 f.provider.request=async call=>{
  if(call.method==='eth_getBalance'){f.calls.push(call);assert.equal(call.params[0],f.input.relay.address,'Only RELAYER requires ETH');return options.relayEmpty?'0x0':'0xffffff';}
  if(call.method==='eth_call'){
   const {to,data}=call.params[0];
   if(to===s.quoter){f.calls.push(call);const parsed=q.parseTransaction({data});assert.equal(parsed.args[0].tokenIn,s.bokToken);assert([s.weth,s.feeToken].includes(parsed.args[0].tokenOut.toLowerCase()));if(options.noLiquidity)throw Error('No route');return q.encodeFunctionResult('quoteExactOutputSingle',[parsed.args[0].amount*10n,1,0,100]);}
   if(to===s.bokToken){f.calls.push(call);const parsed=usdc.parseTransaction({data});const values={implementation:options.badImplementation?address(72):s.usdcImplementation,DOMAIN_SEPARATOR:options.badDomain?field(3):TypedDataEncoder.hashDomain({...s.usdcDomain,chainId:s.chainId,verifyingContract:s.bokToken}),balanceOf:options.poor?1n:999999999n,authorizationState:options.spent===true};return usdc.encodeFunctionResult(parsed.name,[values[parsed.name]]);}
   if(to===s.router && r.parseTransaction({data}).name==='usdcAuthorizationNonce'){
    f.calls.push(call);const plan=r.parseTransaction({data}).args[0],hash=keccak256(AbiCoder.defaultAbiCoder().encode([r.getFunction('fundUsdc').inputs[0]],[plan]));
    return r.encodeFunctionResult('usdcAuthorizationNonce',[keccak256(AbiCoder.defaultAbiCoder().encode(['bytes32','uint256','address','bytes32'],[encodeBytes32String('ROLLING_USDC_FUNDING_V1'),s.chainId,s.router,hash]))]);
   }
  }
  return original(call);
 };
 f.prepare=()=>prepareAggregateUsdcFunding(f.input,{provider:f.provider});return f;
}
test('USDC-only user needs no ETH or approval; exact signed allocation reimburses bound relayer',async()=>{
 const f=usdcFixture(),result=await f.prepare();assert.equal(result.maximumUsdc,'10101260');assert.equal(result.value,'0');assert.equal(result.plan.relayer,f.input.relay.address);assert.equal(result.plan.bokAmount,'200');
 assert.equal(result.authorization.value.from,f.input.wallet.address);assert.equal(result.authorization.value.to,f.input.scope.router);assert.equal(result.authorization.value.value,result.maximumUsdc);assert.equal(result.authorization.value.nonce,result.authorizationNonce);
 assert.equal(result.authorizationDigest,TypedDataEncoder.hash(result.authorization.domain,result.authorization.types,result.authorization.value));
 const tx=await aggregateUsdcFundingTransaction(result,'0x12','0x34');assert.equal(tx.from,f.input.relay.address);assert.equal(tx.beneficiary,f.input.wallet.address);assert.equal(tx.value,'0');assert.equal(r.parseTransaction(tx).name,'fundUsdc');
 assert.equal(result.ready,false);assert.equal(result.failureGasRisk,'relayer-unreimbursed-on-revert');assert.equal(result.relayPreflightRequired,true);
 assert.equal(f.calls.filter(c=>c.method==='eth_getBalance').length,1);assert.equal(f.calls.filter(c=>c.method==='eth_call'&&c.params[0].to===f.input.scope.quoter).length,2);assert(!f.calls.some(c=>/send|sign/.test(c.method)));
});
for(const [label,options,code] of [
 ['missing FEE conversion liquidity',{noLiquidity:true},'PUBLIC_READ_FAILED'],['unknown upgraded implementation',{badImplementation:true},'USDC_IMPLEMENTATION'],['wrong token signature domain',{badDomain:true},'USDC_DOMAIN'],
 ['spent authorization',{spent:true},'AUTHORIZATION_SPENT'],['insufficient user USDC',{poor:true},'INSUFFICIENT_USER_FUNDS'],['unfunded relayer ETH',{relayEmpty:true},'RELAY_GAS_REQUIRED'],['changed quote anchor',{reorg:true},'QUOTE_REORG'],
])test(`USDC route rejects ${label} before signatures/payment`,async()=>{const f=usdcFixture(options);await assert.rejects(f.prepare(),{code:'AGGREGATE_'+code});assert(!f.calls.some(c=>/send|sign/.test(c.method)));});
test('USDC authorization nonce binds allocations, fee, beneficiary, executor, expiry and fresh salt',async()=>{
 const f=usdcFixture(),result=await f.prepare();for(const change of [p=>{p.beneficiary=address(99);},p=>{p.relayer=address(99);},p=>{p.relayFeeUsdc='51';},p=>{p.bokAmount='201';},p=>{p.bokCommitment=field(99);},p=>{p.collateral.maxUsdc='5';},p=>{p.deadline='1121';},p=>{p.authorizationSalt=field(99);}]){
 const p=structuredClone(result.plan);change(p);const hash=keccak256(AbiCoder.defaultAbiCoder().encode([r.getFunction('fundUsdc').inputs[0]],[p]));const nonce=keccak256(AbiCoder.defaultAbiCoder().encode(['bytes32','uint256','address','bytes32'],[encodeBytes32String('ROLLING_USDC_FUNDING_V1'),f.input.scope.chainId,f.input.scope.router,hash]));assert.notEqual(nonce,result.authorizationNonce);}
});
test('USDC deadline is strict and forged plans cannot encode relay calls',async()=>{const options={},f=usdcFixture(options),result=await f.prepare();options.pendingTime=1900;await assert.rejects(aggregateUsdcFundingTransaction(result,'0x12','0x34'),{code:'AGGREGATE_STALE_QUOTE'});await assert.rejects(aggregateUsdcFundingTransaction(structuredClone(result),'0x12','0x34'),{code:'AGGREGATE_UNVERIFIED_QUOTE'});await assert.rejects(aggregateFundingTransaction(result,'0x12'),{code:'AGGREGATE_UNVERIFIED_QUOTE'});});
test('USDC absent wallet typed signing or relay budget fails before public calls',async()=>{for(const alter of [f=>{f.input.wallet.canSignTypedData=false;},f=>{f.input.relay.feeUsdc='0';},f=>{f.input.relay.gasBudgetWei='0';}]){const f=usdcFixture();alter(f);await assert.rejects(f.prepare());assert.equal(f.calls.length,0);}});

for(const [asset,make]of [['ETH',fixture],['USDC',usdcFixture]])test(`${asset} signature preflight rejects expired or forged quotes before consent`,async()=>{
 const options={},f=make(options),quote=await f.prepare();await validateAggregateFundingQuote(quote);
 await assert.rejects(validateAggregateFundingQuote(structuredClone(quote)),{code:'AGGREGATE_UNVERIFIED_QUOTE'});
 options.pendingTime=1901;await assert.rejects(validateAggregateFundingQuote(quote),{code:'AGGREGATE_STALE_QUOTE'});
});

test('fresh ETH and USDC signup remain available to a wallet with an earlier deposit', async () => {
 for (const make of [fixture, usdcFixture]) {
  const f = make({existing:true});
  const quote = await f.prepare();
  assert.equal(quote.plan.beneficiary, f.input.wallet.address);
  assert(!f.calls.some(call => call.method === 'eth_call' && call.params[0].to === f.input.scope.collateralPortal && p.parseTransaction(call.params[0])?.name === 'getDeposit'));
 }
});

for(const [asset,make]of [['ETH',fixture],['USDC',usdcFixture]])test(`${asset} zero Bok funding skips plugin availability and quotes only required assets`,async()=>{
 const f=make();Object.assign(f.input.allocation,{bokAmount:'0',bokCommitment:field(0),bokSecretHash:field(0),...(asset==='ETH'?{bokPoolFee:0}:{})});
 const original=f.provider.request;f.provider.request=async c=>{assert(!(c.method==='eth_call'&&c.params[0].to===f.input.scope.bokPortal),'No optional portal call');return original(c);};
 const result=await f.prepare();assert.deepEqual(result.requiredClaims,['collateral','private-fee']);
 assert.equal(asset==='ETH'?result.value:result.maximumUsdc,asset==='ETH'?'1001010':'10101060');
 if(asset==='ETH')assert.deepEqual(result.plan.bok,{amount:'0',maxEth:'0',poolFee:0});
 else assert.equal(result.plan.bokAmount,'0');
 assert.equal(f.calls.filter(c=>c.method==='eth_call'&&c.params[0].to===f.input.scope.quoter).length,asset==='ETH'?1:2);
 const tx=asset==='ETH'?await aggregateFundingTransaction(result,'0x12'):await aggregateUsdcFundingTransaction(result,'0x12','0x34');assert.equal(tx.planHash,result.planHash);
});
for(const make of [fixture,usdcFixture])test('zero Bok rejects nonzero disabled custody before any read',async()=>{
 const f=make();Object.assign(f.input.allocation,{bokAmount:'0',...(f.input.allocation.asset==='ETH'?{bokPoolFee:0}:{})});
 await assert.rejects(f.prepare(),{code:'AGGREGATE_INVALID'});assert.equal(f.calls.length,0);
});
test('zero Bok USDC still authenticates the payment token implementation',async()=>{
 const f=usdcFixture({badImplementation:true});Object.assign(f.input.allocation,{bokAmount:'0',bokCommitment:field(0),bokSecretHash:field(0)});
 await assert.rejects(f.prepare(),{code:'AGGREGATE_USDC_IMPLEMENTATION'});
});

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
for(const [asset,make]of [['ETH',fixture],['USDC',usdcFixture]]){
 test(`${asset} same-block metadata starts together and drains rejected siblings`,async()=>{
  const f=make(),original=f.provider.request,held=deferred(),started=deferred();let active=0,maximum=0,finished=false;
  f.provider.request=async call=>{
   const anchored=call.method==='eth_getCode'||call.method==='eth_call'&&call.params[1]==='0x10';
   if(!anchored)return original(call);
   assert.equal(call.params[1],'0x10');active++;maximum=Math.max(maximum,active);
   try{
    if(call.method==='eth_getCode'&&call.params[0]===f.input.scope.router){started.resolve();await held.promise;return original(call);}
    if(call.method==='eth_getCode'&&call.params[0]===f.input.scope.quoter)throw Error('Rejected runtime read');
    return await original(call);
   }finally{active--;}
  };
  const result=f.prepare();result.then(()=>{finished=true;},()=>{finished=true;});
  await started.promise;await new Promise(resolve=>setImmediate(resolve));
  assert(maximum>=10,'Independent metadata must overlap');assert.equal(finished,false,'Failure cannot escape while sibling read remains active');
  held.resolve();await assert.rejects(result,{code:'AGGREGATE_PUBLIC_READ_FAILED'});assert.equal(active,0);
  const quotes=f.calls.filter(call=>call.method==='eth_call'&&call.params[0].to===f.input.scope.quoter);
  if(asset==='ETH')assert.equal(quotes.length,2,'Independent public quotes drain with metadata; failed authority still rejects the result');
  else assert.equal(quotes.length,0,'USDC retains its existing dependent quote ordering');
 });
 test(`${asset} independent asset quotes overlap at the captured block and reject a later reorg`,async()=>{
  const options={},f=make(options),original=f.provider.request,held=deferred(),both=deferred();let started=0,finished=false;
  f.provider.request=async call=>{
   if(call.method==='eth_call'&&call.params[0].to===f.input.scope.quoter){
    assert.equal(call.params[1],'0x10');if(++started===2)both.resolve();await held.promise;
   }
   return original(call);
  };
  const result=f.prepare();result.then(()=>{finished=true;},()=>{finished=true;});
  await both.promise;assert.equal(finished,false);options.reorg=true;held.resolve();
  await assert.rejects(result,{code:'AGGREGATE_QUOTE_REORG'});assert.equal(started,2);
 });
}
test('encoding for gas estimation performs no public reads and never substitutes for final preflight',async()=>{
 const options={},f=fixture(options),quote=await f.prepare(),count=f.calls.length;
 const encoded=encodeAggregateFundingTransaction(quote,'0x1234');assert.equal(f.calls.length,count);assert(Object.isFrozen(encoded));
 assert.throws(()=>encodeAggregateFundingTransaction(structuredClone(quote),'0x1234'),{code:'AGGREGATE_UNVERIFIED_QUOTE'});
 assert.throws(()=>encodeAggregateFundingTransaction(quote,'not-a-signature'),{code:'AGGREGATE_CONSENT'});
 assert.notEqual(encodeAggregateFundingTransaction(quote,'0x5678').data,encoded.data);
 options.simulationFails=true;await assert.rejects(aggregateFundingTransaction(quote,'0x1234'),{code:'AGGREGATE_PUBLIC_READ_FAILED'});
});

for(const [asset,make]of [['ETH',fixture],['USDC',usdcFixture]])test(`${asset} rejected asset quote drains its held sibling`,async()=>{
 const f=make(),original=f.provider.request,held=deferred(),both=deferred();let count=0,finished=false;
 f.provider.request=async call=>{
  if(call.method==='eth_call'&&call.params[0].to===f.input.scope.quoter){
   if(++count===1){await held.promise;return original(call);}
   both.resolve();throw Error('Quote rejected');
  }
  return original(call);
 };
 const result=f.prepare();result.then(()=>{finished=true;},()=>{finished=true;});
 await both.promise;await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false);
 held.resolve();await assert.rejects(result,{code:'AGGREGATE_PUBLIC_READ_FAILED'});assert.equal(count,2);
});

for(const [asset,make]of [['ETH',fixture],['USDC',usdcFixture]])for(const failure of [null,'eth_chainId','anchor','pending'])test(`${asset} fresh quote-state wave overlaps and drains ${failure??'success'}`,{timeout:3000},async()=>{
 const options={},f=make(options),quote=await f.prepare(),original=f.provider.request,held=deferred(),started=deferred();let calls=[],done=false;
 f.provider.request=call=>{
  const key=call.method==='eth_chainId'?'eth_chainId':call.params[0]==='pending'?'pending':'anchor';calls.push(key);if(calls.length===3)started.resolve();
  if(key===failure)throw Error('controlled read failure');
  return held.promise.then(()=>original(call));
 };
 const checking=validateAggregateFundingQuote(quote);checking.then(()=>{done=true;},()=>{done=true;});
 await started.promise;await new Promise(resolve=>setImmediate(resolve));assert.equal(done,false);assert.deepEqual(calls,['eth_chainId','anchor','pending']);
 held.resolve();if(failure)await assert.rejects(checking,{code:'AGGREGATE_PUBLIC_READ_FAILED'});else await checking;
 // Every later boundary must read again and reject newly expired execution state.
 f.provider.request=original;options.pendingTime=1901;await assert.rejects(validateAggregateFundingQuote(quote),{code:'AGGREGATE_STALE_QUOTE'});
});
for(const failure of [false,true])test(`USDC post-plan authority wave shares numbered anchor and drains: ${failure}`,{timeout:3000},async()=>{
 const f=usdcFixture(),original=f.provider.request,held=deferred(),started=deferred(),names=[];let done=false,entered=false,lateFence=false;
 const token=new Interface(['function balanceOf(address) view returns(uint256)','function authorizationState(address,bytes32) view returns(bool)']);
 f.provider.request=call=>{
  let name;if(call.method==='eth_getBalance')name='relay';else if(call.method==='eth_call'){
   if(call.params[0].to===f.input.scope.router&&r.parseTransaction(call.params[0]).name==='usdcAuthorizationNonce')name='nonce';
   else if(call.params[0].to===f.input.scope.bokToken){const parsed=token.parseTransaction(call.params[0]);if(parsed)name=parsed.name;}
  }
  if(!name){if(entered&&call.method==='eth_getBlockByNumber'&&call.params[0]==='0x10')lateFence=true;return original(call);}
  entered=true;names.push(name);if(names.length===4)started.resolve();
  assert.equal(call.params[1],name==='relay'?'latest':'0x10');
  if(failure&&name==='nonce')throw Error('controlled nonce read failure');
  return held.promise.then(()=>original(call));
 };
 const preparing=f.prepare();preparing.then(()=>{done=true;},()=>{done=true;});await started.promise;await new Promise(resolve=>setImmediate(resolve));
 assert.equal(done,false);assert.equal(lateFence,false);assert.deepEqual(names,['nonce','authorizationState','balanceOf','relay']);held.resolve();
 if(failure)await assert.rejects(preparing,{code:'AGGREGATE_PUBLIC_READ_FAILED'});else{await preparing;assert.equal(lateFence,true);}
});

for(const [asset,make,simulate]of [['ETH',fixture,q=>aggregateFundingTransaction(q,'0x12')],['USDC',usdcFixture,q=>aggregateUsdcFundingTransaction(q,'0x12','0x34')]]){
 for(const failure of [null,'validation','simulation'])test(`${asset} exact pending simulation overlaps initial quote reads and drains ${failure??'success'}`,{timeout:3000},async()=>{
  const f=make(),quote=await f.prepare(),original=f.provider.request,validation=deferred(),simulation=deferred(),entered=deferred();let initial=0,simulations=0,settled=false,totalReads=0;
  f.provider.request=call=>{
   const isSimulation=call.method==='eth_call';totalReads++;
   if(isSimulation){simulations++;if(initial===3)entered.resolve();return simulation.promise.then(()=>{if(failure==='simulation')throw Error('private provider error');return original(call);});}
   if(++initial<=3){if(initial===3&&simulations)entered.resolve();return validation.promise.then(()=>{if(failure==='validation'&&call.method==='eth_chainId')throw Error('private validation error');return original(call);});}
   return original(call);
  };
  const result=simulate(quote).finally(()=>settled=true),observed=failure?assert.rejects(result,{code:'AGGREGATE_PUBLIC_READ_FAILED'}):result;
  await entered.promise;assert.equal(totalReads,4);assert.equal(simulations,1);assert.equal(settled,false);
  (failure==='simulation'?simulation:validation).resolve();await new Promise(setImmediate);assert.equal(settled,false);assert.equal(totalReads,4,'no final fence until every initial read settles');
  validation.resolve();simulation.resolve();await observed;
  assert.equal(totalReads,failure?4:7,'successful execution still takes the fresh final chain/canonical/pending wave');assert.equal(simulations,1);
 });
 for(const mutation of ['fork','chain','expiry'])test(`${asset} simulation cannot reuse initial validation after ${mutation}`,{timeout:3000},async()=>{
  const options={},f=make(options),quote=await f.prepare(),original=f.provider.request,held=deferred(),entered=deferred();let simulationStarted=false,initialReads=0,settled=false,changed=false;
  f.provider.request=async call=>{
   if(call.method==='eth_call'){simulationStarted=true;if(initialReads===3)entered.resolve();await held.promise;return original(call);}
   if(!changed){initialReads++;if(initialReads===3&&simulationStarted)entered.resolve();return original(call);}
   if(mutation==='chain'&&call.method==='eth_chainId')return '0x1';
   if(mutation==='fork'&&call.method==='eth_getBlockByNumber'&&call.params[0]===quote.quoteAnchor.number)return {...await original(call),hash:field(999)};
   return original(call);
  };
  const result=simulate(quote).finally(()=>settled=true),rejected=assert.rejects(result,{code:'AGGREGATE_'+({fork:'QUOTE_REORG',chain:'CHAIN',expiry:'STALE_QUOTE'}[mutation])});
  await entered.promise;await new Promise(setImmediate);assert.equal(settled,false);changed=true;if(mutation==='expiry')options.pendingTime=1901;held.resolve();await rejected;
 });
}

for(const [asset,make]of [['ETH',fixture],['USDC',usdcFixture]])for(const fork of [false,true])test(`${asset} quote has one final canonical anchor read and refuses a late fork=${fork}`,{timeout:3000},async()=>{
 const f=make(),original=f.provider.request,held=deferred(),entered=deferred();let anchorReads=0,settled=false;
 f.provider.request=async call=>{
  if(call.method==='eth_getBlockByNumber'&&call.params[0]==='0x10'){
   anchorReads++;entered.resolve();await held.promise;const value=await original(call);return fork?{...value,hash:field(999)}:value;
  }
  return original(call);
 };
 const preparation=f.prepare().finally(()=>settled=true),observed=fork?assert.rejects(preparation,{code:'AGGREGATE_QUOTE_REORG'}):preparation;
 await entered.promise;assert.equal(anchorReads,1);assert.equal(settled,false,'no quote published before fresh canonical check');held.resolve();await observed;assert.equal(anchorReads,1);
});

for(const [asset,make]of [['ETH',fixture],['USDC',usdcFixture]])for(const mode of ['revert','network','plain','getter','portal','malformed'])test(`${asset} exact quoter failure classification: ${mode}`,async()=>{
 const f=make(),original=f.provider.request;let getters=0;
 f.provider.request=async call=>{
  const target=mode==='portal'?f.input.scope.collateralPortal:f.input.scope.quoter;
  if(call.method==='eth_call'&&call.params[0].to===target){
   if(mode==='malformed')return '0x';
   const failure=Error('private provider detail');
   if(mode==='getter')Object.defineProperty(failure,'code',{get(){getters++;return 'CALL_EXCEPTION';}});
   else if(mode!=='plain')failure.code=mode==='network'?'NETWORK_ERROR':'CALL_EXCEPTION';
   throw failure;
  }
  return original(call);
 };
 await assert.rejects(f.prepare(),error=>{assert.equal(error.code,mode==='revert'?'AGGREGATE_LIQUIDITY_UNAVAILABLE':'AGGREGATE_PUBLIC_READ_FAILED');assert(!error.message.includes('private provider detail'));return true;});
 assert.equal(getters,0);assert(!f.calls.some(call=>/send|sign/.test(call.method)));
});

for(const [asset,make] of [['ETH',fixture],['USDC',usdcFixture]])test(`${asset} posting credit quotes only fee swap, requires no collateral consent`,async()=>{
 const f=make({disabled:true});Object.assign(f.input.allocation,{collateralWei:'0',collateralSecretHash:field(0),bokAmount:'0',bokCommitment:field(0),bokSecretHash:field(0),...(asset==='ETH'?{bokPoolFee:0}:{collateralPoolFee:0})});
 const quote=await f.prepare();assert.deepEqual(quote.requiredClaims,['private-fee']);assert.equal(quote.plan.nonce,'0');
 assert(!f.calls.some(c=>c.method==='eth_call'&&c.params[0].to===f.input.scope.collateralPortal));
 assert.equal(f.calls.filter(c=>c.method==='eth_call'&&c.params[0].to===f.input.scope.quoter).length,1);
 const tx=asset==='ETH'?await aggregateFundingTransaction(quote,'0x'):await aggregateUsdcFundingTransaction(quote,'0x','0x12');
 assert.equal(r.parseTransaction(tx).args[1],'0x');assert.equal(tx.value,asset==='ETH'?quote.plan.fee.maxEth:'0');
});
