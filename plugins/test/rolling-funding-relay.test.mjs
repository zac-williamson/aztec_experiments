// Controlled RPC doubles, real ethers signing/ABI and fsync operation journals.
// These do not qualify actual liquidity, wallet prompts or testnet acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Wallet,Interface,Transaction,keccak256} from 'ethers';
import {createRollingFundingRelay,openRollingFundingRelay,prepareFundingRelayState} from '../rolling-funding-relay.mjs';
import {aggregateUsdcFundingAbi} from '../../shared/rolling/aggregate-funding.mjs';
const a=n=>'0x'+BigInt(n).toString(16).padStart(40,'0'),h=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const abi=new Interface(aggregateUsdcFundingAbi),quote=new Interface(['function quoteExactOutputSingle((address tokenIn,address tokenOut,uint256 amount,uint24 fee,uint160 sqrtPriceLimitX96)) returns(uint256,uint160,uint32,uint256)']),token=new Interface(['function implementation() view returns(address)']);
const board=new Interface(['event Deposited(address indexed depositor,uint128 amount,bytes32 secretHash,bytes32 key,uint256 index)']),fee=new Interface(['event DepositToAztecPublic(bytes32 indexed to,uint256 amount,bytes32 secretHash,bytes32 key,uint256 index)']),bok=new Interface(['event Deposited(bytes32 indexed account,uint128 amount,bytes32 key,uint256 index)']);
async function fixture(t,options={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'rolling-relay-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const signer=new Wallet(h(1)),relayer=signer.address.toLowerCase(),codeHash=keccak256('0x6001');
 const config={chainId:'31337',development:true,router:a(2),routerCodeHash:codeHash,collateralPortal:a(3),feePortal:a(4),bokPortal:a(5),privateFpc:h(6),usdc:a(7),usdcCodeHash:codeHash,usdcImplementation:a(8),usdcImplementationCodeHash:codeHash,weth:a(9),quoter:a(10),quoterCodeHash:codeHash,gasPoolFee:500,relayer,feeUsdc:'500',maxGasWei:'1000',totalGasBudgetWei:options.budget??'2000'};
 const plan={beneficiary:a(11),relayer,collateral:{amount:'100',maxUsdc:'200',poolFee:500},collateralSecretHash:h(12),fee:{amount:'100',maxUsdc:'200',poolFee:500},feeSecretHash:h(13),bokAmount:'300',bokCommitment:h(14),bokSecretHash:h(15),nonce:'0',validAfter:'0',deadline:String(Math.floor(Date.now()/1000)+120),relayFeeUsdc:'500',authorizationSalt:h(16)};
 if(options.feeOnly)Object.assign(plan,{collateral:{amount:'0',maxUsdc:'0',poolFee:0},collateralSecretHash:h(0),bokAmount:'0',bokCommitment:h(0),bokSecretHash:h(0)});
 const input={data:abi.encodeFunctionData('fundUsdc',[plan,options.feeOnly?'0x':'0x01','0x02'])};
 const state={sends:0,signs:0,calls:0,canonical:!options.unknown,receipt:null,nonce:0};
 const event=(address,iface,name,values)=>({address,...iface.encodeEventLog(iface.getEvent(name),values)});
 const provider={getNetwork:async()=>({chainId:options.wrongChain?1n:31337n}),getBlock:async tag=>({number:10,timestamp:Math.floor(Date.now()/1000),hash:h(options.reorg&&typeof tag==='number'?99:20)}),getCode:async()=>options.wrongCode?'0x6002':'0x6001',getBalance:async()=>999999n,
  call:async request=>{state.calls++;if(request.to===config.router){if(options.revert)throw Error('RAW_PRIVATE_REVERT');return '0x';}if(request.to===config.usdc)return token.encodeFunctionResult('implementation',[options.upgrade?a(99):config.usdcImplementation]);assert.equal(request.to,config.quoter);return quote.encodeFunctionResult('quoteExactOutputSingle',[options.underfunded?1000:100,1,0,0]);},
  estimateGas:async()=>options.expensive?10000n:100n,getFeeData:async()=>({maxFeePerGas:2n,maxPriorityFeePerGas:1n}),getTransactionCount:async()=>state.nonce,
  getTransactionReceipt:async hash=>state.canonical&&state.receipt?.hash===hash?state.receipt:null,
  broadcastTransaction:async raw=>{state.sends++;const tx=Transaction.from(raw),parsed=abi.parseTransaction(tx),p=parsed.args[0];
   const files=await fs.readdir(directory),records=await Promise.all(files.filter(x=>x!=='funding-budget.json').map(async file=>JSON.parse(await fs.readFile(path.join(directory,file),'utf8'))));
   const record=records.find(r=>r.operations?.['relay-funding']?.hash===tx.hash)?.operations['relay-funding'];assert(record,'Signed hash persisted before broadcast');assert.equal(record.raw,raw.slice(2));
   state.receipt={hash:tx.hash,blockNumber:10,blockHash:h(20),status:1,logs:[event(config.router,abi,'UsdcFunded',[p.beneficiary,record.identity,relayer,p.collateral.amount,p.fee.amount,p.bokAmount,options.feeOnly?0:150,150,500,options.feeOnly?50:100]),...(options.feeOnly?[]:[event(config.collateralPortal,board,'Deposited',[p.beneficiary,100,h(12),h(21),1])]),event(config.feePortal,fee,'DepositToAztecPublic',[h(6),100,h(13),h(22),2]),...(options.feeOnly?[]:[event(config.bokPortal,bok,'Deposited',[h(14),300,h(23),3])])]};
   if(options.lostAck)throw Error('LOST_ACK_PRIVATE_SENTINEL');return {hash:tx.hash};},
 };
 const trustedSigner={getAddress:()=>signer.getAddress(),signTransaction:async tx=>{state.signs++;return signer.signTransaction(tx);}};
 const lease={assertHeld:async()=>{if(state.lostLease)throw Error('lease lost');},close:async()=>{}};
 const open=()=>createRollingFundingRelay({config,directory,provider,signer:trustedSigner,lease});const relay=await open();t.after(()=>relay.close());return {relay,open,state,input,config,plan,directory,provider};
}
test('one user-reimbursed transaction durably saves signed bytes and verifies every canonical leg',async t=>{
 const f=await fixture(t),r=await f.relay.submit(f.input);assert.equal(r.status,'succeeded');assert.equal(r.canonical,true);assert.equal(r.scope,'aggregate-funding');assert.equal(f.state.sends,1);
 assert.deepEqual(await f.relay.submit(f.input),r);assert.deepEqual(await f.relay.status(r.planHash),r);assert.equal(f.state.signs,1);assert.equal(f.state.sends,1);
 assert(!JSON.stringify(r).includes(f.input.data));assert.equal(JSON.parse(await fs.readFile(path.join(f.directory,'funding-budget.json'),'utf8')).reservedGasWei,'1000');
});
test('lost broadcast acknowledgement survives restart and never signs or sends again',async t=>{
 const f=await fixture(t,{lostAck:true,unknown:true}),r=await f.relay.submit(f.input);assert.equal(r.status,'unresolved');assert(r.planHash);await f.relay.close();const reopened=await f.open();
 const pending=await reopened.submit(f.input);assert.equal(pending.canonical,false);assert.equal(f.state.sends,1);f.state.canonical=true;assert.equal((await reopened.status(r.planHash)).status,'succeeded');assert.equal(f.state.sends,1);await reopened.close();
});
test('unknown predecessor blocks a different plan, including after restart',async t=>{
 const f=await fixture(t,{unknown:true});await f.relay.submit(f.input);const next={data:abi.encodeFunctionData('fundUsdc',[{...f.plan,authorizationSalt:h(88)},'0x01','0x02'])};
 await assert.rejects(f.relay.submit(next));assert.equal(f.state.sends,1);assert.equal(f.state.signs,1);
});
for(const defect of ['wrongChain','wrongCode','upgrade','revert','expensive','underfunded','reorg'])test(`relay refuses ${defect} before budget reservation or signing`,async t=>{
 const f=await fixture(t,{[defect]:true});await assert.rejects(f.relay.submit(f.input),/Funding relay unavailable/);assert.equal(f.state.sends,0);assert.equal(f.state.signs,0);assert.equal(JSON.parse(await fs.readFile(path.join(f.directory,'funding-budget.json'),'utf8')).reservedGasWei,'0');
});
test('cumulative conservative gas budget remains consumed even after successful reimbursement',async t=>{
 const f=await fixture(t,{budget:'1000'});assert.equal((await f.relay.terms()).feeUsdc,'500');await f.relay.submit(f.input);await assert.rejects(f.relay.terms());const next={data:abi.encodeFunctionData('fundUsdc',[{...f.plan,authorizationSalt:h(88)},'0x01','0x02'])};await assert.rejects(f.relay.submit(next));assert.equal(f.state.sends,1);
});
for(const admission of ['terms','submit'])test(`a mined predecessor releases ${admission} without a client status call`,async t=>{
 const f=await fixture(t,{unknown:true});await f.relay.submit(f.input);
 await assert.rejects(f.relay.terms());assert.equal(f.state.signs,1);
 f.state.canonical=true;
 if(admission==='terms'){
  assert.equal((await f.relay.terms()).feeUsdc,'500');assert.equal(f.state.signs,1);assert.equal(f.state.sends,1);
  const ledger=JSON.parse(await fs.readFile(path.join(f.directory,'funding-budget.json'),'utf8'));
  assert.equal(ledger.activePlan,null);assert.equal(ledger.reservedGasWei,'1000');
 }else{
  const next={data:abi.encodeFunctionData('fundUsdc',[{...f.plan,authorizationSalt:h(88)},'0x01','0x02'])};
  assert.equal((await f.relay.submit(next)).canonical,true);assert.equal(f.state.sends,2);assert.equal(f.state.signs,2);
 }
});
test('quote reconciliation retains a malformed canonical payment fence',async t=>{
 const f=await fixture(t,{unknown:true});await f.relay.submit(f.input);f.state.canonical=true;f.state.receipt.logs.pop();
 await assert.rejects(f.relay.terms());assert.equal(f.state.sends,1);assert.equal(f.state.signs,1);
 assert.notEqual(JSON.parse(await fs.readFile(path.join(f.directory,'funding-budget.json'),'utf8')).activePlan,null);
});
test('quote reconciliation and submission cannot concurrently own the signer',async t=>{
 const f=await fixture(t,{unknown:true});await f.relay.submit(f.input);f.state.canonical=true;
 const original=f.provider.getTransactionReceipt;let entered,release;const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 f.provider.getTransactionReceipt=async hash=>{entered();await gate;return original(hash);};
 const terms=f.relay.terms();await ready;await assert.rejects(f.relay.submit(f.input));release();await terms;
 assert.equal(f.state.sends,1);assert.equal(f.state.signs,1);
});
test('HTTP data cannot replace signer, change network, select a destination or call arbitrary methods',async t=>{
 const f=await fixture(t);for(const input of [{...f.input,to:a(99)},{data:'0x1234'},{data:abi.encodeFunctionData('fundUsdc',[{...f.plan,relayer:a(99)},'0x01','0x02'])},{data:abi.encodeFunctionData('fundUsdc',[{...f.plan,relayFeeUsdc:'1'},'0x01','0x02'])}])await assert.rejects(f.relay.submit(input));assert.equal(f.state.calls,0);assert.equal(f.state.sends,0);
});
test('malformed or reorged canonical effects cannot finish an unknown payment',async t=>{
 const f=await fixture(t,{unknown:true}),r=await f.relay.submit(f.input);f.state.canonical=true;f.state.receipt.logs.pop();assert.equal((await f.relay.status(r.planHash)).canonical,false);assert.equal(f.state.sends,1);
});
test('a concurrent submission cannot allocate the same signer nonce twice',async t=>{
 const f=await fixture(t),call=f.provider.call;let release,entered;const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r);f.provider.call=async x=>{entered();await gate;return call(x);};
 const first=f.relay.submit(f.input);await ready;await assert.rejects(f.relay.submit(f.input));release();await first;assert.equal(f.state.sends,1);
});

for(const defect of ['writable','symlink'])test(`private relay directory rejects existing ${defect} before signer reads`,async t=>{
 const f=await fixture(t),base=await fs.realpath(f.directory),target=path.join(base,'private');await fs.mkdir(target,{mode:defect==='writable'?0o777:0o700});
 if(defect==='writable')await fs.chmod(target,0o777);
 const stateDirectory=defect==='symlink'?path.join(base,'linked'):target;if(defect==='symlink')await fs.symlink(target,stateDirectory);
 await assert.rejects(openRollingFundingRelay({ethereumUrl:'http://127.0.0.1:8545/',signerFile:path.join(base,'does-not-exist.json'),stateDirectory,policy:f.config}),/Funding relay unavailable/);
 assert.equal(f.state.sends,0);assert(!(await fs.readdir(target)).includes('hosted.lock'));
});
test('durable gas reservation without a plan file remains unresolved after restart',async t=>{
 const f=await fixture(t);await f.relay.close();const file=path.join(f.directory,'funding-budget.json'),budget=JSON.parse(await fs.readFile(file,'utf8'));
 await fs.writeFile(file,JSON.stringify({...budget,activePlan:h(90),reservedGasWei:'1000'}));const reopened=await f.open();
 await assert.rejects(reopened.terms());assert.equal((await reopened.status(h(90))).status,'unresolved');assert.equal((await reopened.status(h(91))).status,'absent');await assert.rejects(reopened.submit(f.input));assert.equal(f.state.sends,0);await reopened.close();
});

// Development composition uses the same real relay factory above; these checks
// isolate only admission and lifecycle ordering, without a node or payment.
async function developmentRelayFixture(t){
 const f=await fixture(t),directory=await fs.realpath(f.directory),signerFile=path.join(directory,'signer.json');
 await fs.writeFile(signerFile,JSON.stringify({ethereumKey:h(1)}),{mode:0o600});
 const policy=f.config,scope=Object.fromEntries(['chainId','router','routerCodeHash','collateralPortal','feePortal','bokPortal','privateFpc','weth','quoter','quoterCodeHash','usdcCodeHash','usdcImplementation','usdcImplementationCodeHash'].map(k=>[k,policy[k]]));
 Object.assign(scope,{bokToken:policy.usdc,usdcRelayAddress:policy.relayer});
 const input={ethereumUrl:'http://127.0.0.1:18545/',signerFile,stateDirectory:path.join(directory,'service'),policy};
 const value={fundingRelayConfig:input,walletConfig:{config:{network:{chainId:'31337',ethRpcUrl:input.ethereumUrl},aggregateFunding:scope}}};
 let opens=0,closes=0;
 return {directory,value,scope,input,open:async c=>{assert.equal(c,input);opens++;return {terms(){throw Error('pending original payment');},status:async()=>({status:'unresolved'}),close:async()=>{closes++;}};},counts:()=>({opens,closes})};
}
test('development relay preserves pending status recovery without requiring new-plan terms',async t=>{
 const {openDevelopmentFundingRelay}=await import('../devnet/start.mjs'),f=await developmentRelayFixture(t);
 const relay=await openDevelopmentFundingRelay({fixture:f.value,directory:f.directory,open:f.open});
 assert.deepEqual(await relay.status(),{status:'unresolved'});assert.throws(()=>relay.terms(),/pending original/);
 await Promise.all([relay.close(),relay.close()]);assert.deepEqual(f.counts(),{opens:1,closes:1});
});
test('development USDC capability requires matching private relay configuration before opening',async t=>{
 const {openDevelopmentFundingRelay}=await import('../devnet/start.mjs'),f=await developmentRelayFixture(t);
 for(const key of ['router','collateralPortal','feePortal','bokPortal','usdcImplementation','usdcRelayAddress']){
  const saved=f.scope[key];f.scope[key]=a(999);await assert.rejects(openDevelopmentFundingRelay({fixture:f.value,directory:f.directory,open:f.open}),/scope differs/);f.scope[key]=saved;
 }
 const saved=f.value.fundingRelayConfig;delete f.value.fundingRelayConfig;
 await assert.rejects(openDevelopmentFundingRelay({fixture:f.value,directory:f.directory,open:f.open}),/scope differs/);
 delete f.scope.usdcRelayAddress;assert.equal(await openDevelopmentFundingRelay({fixture:f.value,directory:f.directory,open:f.open}),undefined);
 f.value.fundingRelayConfig=saved;assert.deepEqual(f.counts(),{opens:0,closes:0});
});
test('development relay refuses remote network and escaping signer paths before opening',async t=>{
 const {openDevelopmentFundingRelay}=await import('../devnet/start.mjs'),f=await developmentRelayFixture(t);
 const signerFile=f.input.signerFile;f.input.signerFile=path.join(path.dirname(f.directory),'outside-signer.json');
 await assert.rejects(openDevelopmentFundingRelay({fixture:f.value,directory:f.directory,open:f.open}),/scope differs/);f.input.signerFile=signerFile;
 f.value.walletConfig.config.network.chainId='11155111';await assert.rejects(openDevelopmentFundingRelay({fixture:f.value,directory:f.directory,open:f.open}),/scope differs/);
 assert.deepEqual(f.counts(),{opens:0,closes:0});
});

for(const loss of ['budget','directory','marker'])test(`retained relay initialization refuses missing ${loss} without recreating spending state`,async t=>{
 const f=await fixture(t),base=await fs.realpath(f.directory),stateDirectory=path.join(base,'retained');
 await prepareFundingRelayState({stateDirectory,policy:f.config});
 const marker=stateDirectory+'.initialized.json',budget=path.join(stateDirectory,'funding-budget.json');
 const identity=JSON.parse(await fs.readFile(marker,'utf8')).identity;
 await fs.writeFile(budget,JSON.stringify({identity,reservedGasWei:'1000',activePlan:h(90)}),{mode:0o600});
 await prepareFundingRelayState({stateDirectory,policy:f.config});
 if(loss==='directory')await fs.rm(stateDirectory,{recursive:true});else await fs.unlink(loss==='budget'?budget:marker);
 await assert.rejects(prepareFundingRelayState({stateDirectory,policy:f.config}));
 if(loss==='directory')await assert.rejects(fs.stat(stateDirectory),{code:'ENOENT'});
 if(loss==='budget')await assert.rejects(fs.stat(budget),{code:'ENOENT'});
 if(loss==='marker')await assert.rejects(fs.stat(marker),{code:'ENOENT'});
 assert.equal(f.state.sends,0);
});
test('relay initialization crash and changed policy cannot grant a fresh budget',async t=>{
 const f=await fixture(t),base=await fs.realpath(f.directory),stateDirectory=path.join(base,'new');
 await prepareFundingRelayState({stateDirectory,policy:f.config});
 const marker=stateDirectory+'.initialized.json',before=await fs.readFile(marker);
 assert.equal((await fs.stat(marker)).mode&0o777,0o600);
 await assert.rejects(prepareFundingRelayState({stateDirectory,policy:f.config}));
 await assert.rejects(prepareFundingRelayState({stateDirectory,policy:{...f.config,totalGasBudgetWei:'3000'}}));
 assert.deepEqual(await fs.readFile(marker),before);assert.deepEqual(await fs.readdir(stateDirectory),[]);
});

test('status awaits the owned in-flight original submission without allocating another send',async t=>{
 const f=await fixture(t),original=f.provider.broadcastTransaction;let enter,release;
 const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r);
 f.provider.broadcastTransaction=async raw=>{enter();await gate;return original(raw);};
 const submitted=f.relay.submit(f.input);await entered;
 const {AbiCoder}=await import('ethers');const planHash=keccak256(AbiCoder.defaultAbiCoder().encode([abi.getFunction('fundUsdc').inputs[0]],[f.plan]));
 let settled=false;const observed=f.relay.status(planHash).then(value=>{settled=true;return value;});
 await Promise.resolve();assert.equal(settled,false);release();
 const [sent,status]=await Promise.all([submitted,observed]);assert.equal(status.transactionHash,sent.transactionHash);assert.equal(status.canonical,true);assert.equal(f.state.sends,1);assert.equal(f.state.signs,1);
});

test('existing relay accepts fee-only USDC authorization and returns one conserved fee purchase',async t=>{const f=await fixture(t,{feeOnly:true}),r=await f.relay.submit(f.input);assert.equal(r.status,'succeeded');assert.equal(r.canonical,true);assert.equal(f.state.sends,1);assert.equal(f.state.signs,1);assert.deepEqual(await f.relay.submit(f.input),r);assert.equal(f.state.sends,1);});
