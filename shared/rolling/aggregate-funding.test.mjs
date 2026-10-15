import test from 'node:test';
import assert from 'node:assert/strict';
import {Interface,keccak256,TypedDataEncoder,AbiCoder,encodeBytes32String} from 'ethers';
import {prepareAggregateFunding,aggregateFundingTransaction,aggregateFundingAbi,prepareAggregateUsdcFunding,aggregateUsdcFundingTransaction} from './aggregate-funding.mjs';
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
  if(method==='eth_getBlockByNumber')return {number:'0x10',hash:options.reorg&&params[0]!=='latest'?field(99):field(16),timestamp:options.stale?'0x1':'0x3e8'};
  if(method==='eth_getCode')return options.badCode?'0x6001':'0x6000';
  if(method==='eth_getBalance')return options.poor?'0x1':'0xffffff';
  assert.equal(method,'eth_call');assert.equal(params[1],'0x10');
  const {to,data}=params[0];if(to===scope.router){const f=r.parseTransaction({data});return r.encodeFunctionResult(f.name,[options.badScope&&f.name==='feeToken'?address(50):scope[f.name]]);}
  if(to===scope.collateralPortal){const f=p.parseTransaction({data});return p.encodeFunctionResult(f.name,[{depositNonces:0n,depositsEnabled:!options.disabled,getDeposit:options.existing?1n:0n,MIN_DEPOSIT:1n,MAX_DEPOSIT:2000000n}[f.name]]);}
  if(to===scope.bokPortal)return b.encodeFunctionResult('active',[true]);
  assert.equal(to,scope.quoter);const f=q.parseTransaction({data});assert.equal(f.args[0].tokenIn,scope.weth);assert.equal(f.args[0].sqrtPriceLimitX96,0n);
  if(options.noLiquidity)throw Error('synthetic provider private detail');
  return q.encodeFunctionResult('quoteExactOutputSingle',[f.args[0].amount*10n,1n,0,100000]);
 }};
 return {input,provider,calls,prepare:()=>prepareAggregateFunding(input,{provider,nowSeconds:()=>1000})};
}
test('fixed public quotes produce exact three allocations, user gas and signed collateral consent',async()=>{
 const f=fixture(), result=await f.prepare();assert.equal(result.value,'1003030');assert.equal(result.breakdown.maximumTotalWei,'1013030');assert.equal(result.plan.fee.maxEth,'1010');assert.equal(result.plan.bok.maxEth,'2020');assert.equal(result.ready,false);assert.deepEqual(result.requiredClaims,['collateral','private-fee','bok']);
 assert.equal(result.consentDigest,TypedDataEncoder.hash(result.consent.domain,result.consent.types,result.consent.value));assert.equal(result.consent.value.executor,f.input.scope.router);
 const tx=aggregateFundingTransaction(result,'0x1234',{nowSeconds:1000});const parsed=r.parseTransaction({data:tx.data});assert.equal(parsed.name,'fund');assert.equal(parsed.args.p.beneficiary.toLowerCase(),f.input.wallet.address);assert.equal(parsed.args.p.bokCommitment,field(13));assert.equal(tx.recovery,'reconcile-only');
 assert.equal(f.calls.filter(c=>c.method==='eth_call'&&c.params[0].to===f.input.scope.quoter).length,2);assert(!f.calls.some(c=>/send|sign/.test(c.method)));assert(Object.isFrozen(result.plan.fee));
});
test('USDC-only gas is explicitly unavailable before any provider call',async()=>{const f=fixture();f.input.allocation.asset='USDC';await assert.rejects(f.prepare(),{code:'AGGREGATE_USDC_GAS_ROUTE_UNQUALIFIED'});assert.equal(f.calls.length,0);});
test('wallet capability and zero user gas fail before funds or network',async()=>{for(const key of ['canSendTransaction','canSignTypedData','gasBudgetWei']){const f=fixture();f.input.wallet[key]=key==='gasBudgetWei'?'0':false;await assert.rejects(f.prepare());assert.equal(f.calls.length,0);}});
for(const [name,options,code] of [
 ['no liquidity never substitutes issuance',{noLiquidity:true},'PUBLIC_READ_FAILED'],['wrong deployed runtime',{badCode:true},'RUNTIME'],['mismatched portal scope',{badScope:true},'SCOPE'],['stale quote anchor',{stale:true},'STALE_QUOTE'],['quote reorg',{reorg:true},'QUOTE_REORG'],['inactive bridge',{disabled:true},'PORTAL_NOT_READY'],['active deposit preoccupation',{existing:true},'EXISTING_DEPOSIT'],['balance must cover allocations plus user gas',{poor:true},'INSUFFICIENT_USER_FUNDS'],
])test(name,async()=>{const f=fixture(options);await assert.rejects(f.prepare(),{code:'AGGREGATE_'+code});assert(!f.calls.some(c=>/send|sign/.test(c.method)));});
test('invented quote objects and expired plans cannot encode a payment',async()=>{assert.throws(()=>aggregateFundingTransaction({plan:{}},'0x12'),{code:'AGGREGATE_UNVERIFIED_QUOTE'});const f=fixture(),result=await f.prepare();assert.throws(()=>aggregateFundingTransaction(result,'0x12',{nowSeconds:1121}),{code:'AGGREGATE_STALE_QUOTE'});});
test('input descriptors reject accessors, inherited values and numeric coercion',async()=>{let touched=0;const f=fixture();Object.defineProperty(f.input.wallet,'address',{get(){touched++;return address(15);}});await assert.rejects(f.prepare());assert.equal(touched,0);const g=fixture();g.input.allocation.collateralWei={toString(){touched++;return '100';}};await assert.rejects(g.prepare());assert.equal(touched,0);});
test('all input allocations are captured before asynchronous reads',async()=>{const f=fixture();const request=f.provider.request;f.provider.request=async c=>{f.input.allocation.feeAmount='999';return request(c);};assert.equal((await f.prepare()).plan.fee.amount,'100');});

test('malformed RPC quantities are rejected without object coercion',async()=>{const f=fixture();let touched=0;f.provider.request=async()=>({toString(){touched++;return '0xaa36a7';}});await assert.rejects(f.prepare(),{code:'AGGREGATE_PUBLIC_READ_FAILED'});assert.equal(touched,0);});
test('quote deadline includes all balance/public-read time',async()=>{const f=fixture();let reads=0;await assert.rejects(prepareAggregateFunding(f.input,{provider:f.provider,nowSeconds:()=>reads++===0?1000:1031}),{code:'AGGREGATE_STALE_QUOTE'});});

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
 f.prepare=()=>prepareAggregateUsdcFunding(f.input,{provider:f.provider,nowSeconds:()=>1000});return f;
}
test('USDC-only user needs no ETH or approval; exact signed allocation reimburses bound relayer',async()=>{
 const f=usdcFixture(),result=await f.prepare();assert.equal(result.maximumUsdc,'10101260');assert.equal(result.value,'0');assert.equal(result.plan.relayer,f.input.relay.address);assert.equal(result.plan.bokAmount,'200');
 assert.equal(result.authorization.value.from,f.input.wallet.address);assert.equal(result.authorization.value.to,f.input.scope.router);assert.equal(result.authorization.value.value,result.maximumUsdc);assert.equal(result.authorization.value.nonce,result.authorizationNonce);
 assert.equal(result.authorizationDigest,TypedDataEncoder.hash(result.authorization.domain,result.authorization.types,result.authorization.value));
 const tx=aggregateUsdcFundingTransaction(result,'0x12','0x34',{nowSeconds:1000});assert.equal(tx.from,f.input.relay.address);assert.equal(tx.beneficiary,f.input.wallet.address);assert.equal(tx.value,'0');assert.equal(r.parseTransaction(tx).name,'fundUsdc');
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
test('USDC deadline is strict and forged plans cannot encode relay calls',async()=>{const f=usdcFixture(),result=await f.prepare();assert.throws(()=>aggregateUsdcFundingTransaction(result,'0x12','0x34',{nowSeconds:1120}),{code:'AGGREGATE_STALE_QUOTE'});assert.throws(()=>aggregateUsdcFundingTransaction(structuredClone(result),'0x12','0x34'),{code:'AGGREGATE_UNVERIFIED_QUOTE'});assert.throws(()=>aggregateFundingTransaction(result,'0x12'),{code:'AGGREGATE_UNVERIFIED_QUOTE'});});
test('USDC absent wallet typed signing or relay budget fails before public calls',async()=>{for(const alter of [f=>{f.input.wallet.canSignTypedData=false;},f=>{f.input.relay.feeUsdc='0';},f=>{f.input.relay.gasBudgetWei='0';}]){const f=usdcFixture();alter(f);await assert.rejects(f.prepare());assert.equal(f.calls.length,0);}});
