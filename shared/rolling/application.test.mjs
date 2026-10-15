// Development fakes: no proving, network, funding or real transaction acceptance.
// Real pinned ABI encoding and encrypted CAS journal are exercised below.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {poseidon2HashWithSeparator} from '@aztec-labs/foundation/crypto/poseidon';
import {BarretenbergSync} from '@aztec-foundation/bb.js';
import {after} from 'node:test';
import {nameRegistration,NAME_DOMAIN} from './name-policy.mjs';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {deriveStorageSlotInMap} from '@aztec-labs/stdlib/hash';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {encodeArguments,loadContractArtifact,decodeFromAbi,getFunctionReturnType} from '@aztec-labs/stdlib/abi';
import {createL2Journal,l2JournalScopeText} from '../l2-journal.mjs';
import {createEncryptedJournalSlot} from '../journal-record.mjs';
import {Tx,TxHash,mergeExecutionPayloads} from '@aztec-labs/stdlib/tx';
import {BatchCall} from '@aztec-labs/aztec.js/contracts';
import {PrivateMintAndPayFeePaymentMethod} from '../private-fee-payment.mjs';
import {derivePrivateFeeBridgeSecret} from '../private-fee-client.mjs';
import {prepareFundingClaim as verifyFundingClaim} from './funding-receipts.mjs';
import {BaseWallet} from '@aztec-labs/wallet-sdk/base-wallet';
import {FIELD_MODULUS} from './invocation.mjs';
import {createRollingApplication} from './application.mjs';
const hex=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const artifact=loadContractArtifact(JSON.parse(fs.readFileSync(process.env.ROLLING_TEST_ARTIFACT??new URL('../../billboard/target/rolling_contract-RollingBoard.json',import.meta.url))));
// REQUIRED: run only after normal profile-protocol build/processing. Never invent
// or patch an ABI to make these cases pass against an older application artifact.
const bokArtifact=loadContractArtifact(JSON.parse(fs.readFileSync(new URL('../../experiments/private-bok/target/private_bok-PrivateBok.json',import.meta.url))));
const ownedRecordAbi=artifact.functions.find(f=>f.name==='owned_name_records');
const displayPack=value=>{const bytes=new TextEncoder().encode(value),words=[0n,0n];for(let i=0;i<bytes.length;i++)words[Math.floor(i/31)]|=BigInt(bytes[i])<<BigInt(8*(30-i%31));return words;};
async function ownershipPage(names=[['Jane','Smith']]){
 assert(ownedRecordAbi,'Normal processed profile ABI required');const fields=[];
 for(let i=0;i<8;i++){
  if(i>=names.length){fields.push(...Array(8).fill(0n));continue;}
  const [first,last]=names[i],registration=nameRegistration(first,last),id=await poseidon2HashWithSeparator(registration.preimage.map(n=>new Fr(n)),NAME_DOMAIN);
  fields.push(id.toBigInt(),1n,BigInt(first.length),...displayPack(first),BigInt(last.length),...displayPack(last));
 }
 return decodeFromAbi(getFunctionReturnType(ownedRecordAbi),fields.map(n=>new Fr(n)));
}
after(async()=>{await BarretenbergSync.destroySingleton();});

function fixture(){
  const state={calls:[],sends:0,fee:10n,outcome:null,privateReads:[],failSend:false,failCAS:false,guard:true,policy:1,estimates:0};
  const values=new Map();const privateStore={read:async k=>values.get(k)??null,compareAndSwap:async(k,old,next)=>{
    if(state.failCAS||values.get(k)!==old&&!(old===null&&!values.has(k)))throw Error('CAS conflict');values.set(k,next);
  }};
  const board={methods:new Proxy({},{get:(_,name)=>(...args)=>({name,args,simulate:async()=>{
    state.privateReads.push({name,args});
    if(state.responses&&Object.hasOwn(state.responses,name))return {result:state.responses[name]};
    if(name==='preference_head'&&state.preferenceHeadError)throw state.preferenceHeadError;
    if(name==='preference_head'&&state.beforePreferenceHead)await state.beforePreferenceHead();
    if(name==='effective_policy'&&state.policyReadError)throw state.policyReadError;
    if(name==='get_screen_hints'&&state.hintsReadError)throw state.hintsReadError;
    const replies={balance_of:state.bokCredit??1000n,get_plugin:{adapter:AztecAddress.fromBigIntUnsafe(state.bokAdapter??5n),enabled:state.bokEnabled!==false},request:state.bokRequest,preference_head:('preferenceHead' in state)?state.preferenceHead:decodeFromAbi(getFunctionReturnType(artifact.functions.find(f=>f.name==='preference_head')),[Fr.ZERO,new Fr(1n),Fr.ZERO,Fr.ZERO]),profile_state:state.profileState??decodeFromAbi(getFunctionReturnType([...artifact.functions,...artifact.nonDispatchPublicFunctions].find(f=>f.name==='profile_state')),Array.from({length:8},()=>Fr.ZERO)),owned_name_records:('records' in state)?state.records:await ownershipPage(),get_deposit_info:[1n,9n,100n,BigInt('0x'+'33'.repeat(20)),0n,0n,0n,0n,0n,50n],get_deposit_ids:[9n,0n,0n,0n,0n,0n,0n,0n,0n,0n],
      main_policy:[BigInt(state.policy),1n],effective_policy:('effectivePolicy' in state)?state.effectivePolicy:[BigInt(state.policy),1n,1n,2n,false],get_screen_hints:state.hints??decodeFromAbi(getFunctionReturnType(artifact.functions.find(f=>f.name==='get_screen_hints')),Array.from({length:28},()=>Fr.ZERO))};
    return {result:replies[name]};
  }})})};
  const journal={assertCanStart:async()=>{},inspectOutcome:async()=>state.outcome,inspect:async()=>state.outcome,confirmed:()=>{}};
  const owner=new AztecAddress(new Fr(3n));
  const wallet={getAccounts:async()=>[owner],getChainInfo:async()=>({chainId:31337,version:1}),sendTx:async(payload,opts)=>{
    state.sends++;state.sent={payload,opts};assert.ok([...values.values()].every(x=>!x.includes('Private Sentinel')));
    assert.equal(opts.transactionJournal,journal);if(state.failSend)throw Error('unknown after send');
    state.outcome={operation:opts.journalOperation,outcome:'success',txHash:hex(77),receipt:{txHash:hex(77),status:'checkpointed',blockNumber:1,blockHash:hex(42),transactionFee:2n}};return {receipt:{}};
  }};
  const node={getBlockData:async height=>({header:{globalVariables:{blockNumber:height==='checkpointed'?1:height}},blockHash:hex(42)}),getPublicStorageAt:async(reference,address,slot)=>{(state.nameReads??=[]).push({reference,address:address.toString(),slot:slot.toString()});if(state.nameReadError)throw state.nameReadError;if(state.beforeNameRead)await state.beforeNameRead();return new Fr(state.nameRegistered??0n);}};wallet.aztecNode=node;wallet.pxe={getSyncedBlockHeader:async()=>({globalVariables:{blockNumber:1,timestamp:100n},hash:async()=>hex(42)})};let random=100n;
  const sdk={poseidon2HashWithSeparator,deriveStorageSlotInMap,Fr:class extends Fr {static random(){return new Fr(random++);}},AztecAddress,encodeArguments,Contract:{at:()=>board},isTrustedPrivateNode:n=>n===node,isPrivateWalletForNode:(w,n)=>w===wallet&&n===node,isPrivatePXEForNode:(p,n)=>p===wallet.pxe&&n===node,
    inspectTrustedNode:async()=>{if(!state.guard)throw Error('stale trusted node');},
    preparePrivateFeePayment:async()=>({availableCredit:100n}),estimatePrivateFeeTransaction:async input=>{
      await input.guard();state.estimates++;state.calls.push(input.interaction);
      if(['set_preference','mark_thread_read'].includes(input.interaction.name)&&state.preferenceError)throw state.preferenceError;
      if(input.interaction.name==='screen'&&state.screenError)throw state.screenError;
      if(['set_bio','set_avatar'].includes(input.interaction.name)){assert.equal(input.interaction.args[1],state.profileVersion??0,'stale profile version');assert((state.profileVersion??0)<0xffffffff,'profile version exhausted');}
      if(input.interaction.name==='post')assert.equal(input.interaction.args[2].expected_main_policy_version,state.policy,'policy changed');
      return {maximumFee:state.fee,payload:input.interaction,gasSettings:{ceiling:state.fee}};
    }};
  const deployment={board:{address:hex(1),artifact},network:{chainId:'31337',version:'1',rollup:'0x'+'11'.repeat(20)},
    portal:'0x'+'22'.repeat(20),privateFee:{address:hex(2),artifact:{},gasSettings:{}}};
  const accountSession={owner,wallet,node,journal,walletSecret:hex(8),walletSalt:'0'};
  const options={sdk,deployment,accountSession,privateStore,publicReader:new Proxy({},{get(){throw Error('Private access to public reader');}}),contextGuard:async()=>{assert.ok(state.guard);}};
  return {state,values,options,app:createRollingApplication(options),restart:()=>createRollingApplication(options)};
}
test('locked construction does not load or query a wallet',async()=>{
  assert.deepEqual(await createRollingApplication({}).readAccountStatus(),{status:'locked'});
});
function fundingFixture(){
 const f=fixture(),receipt={txHash:hex(40),blockHash:hex(41),blockNumber:2,sender:'0x'+'33'.repeat(20),nonce:'1',amount:'100',leafIndex:'2',messageKey:hex(43),secretHash:hex(44)};
 f.options.funding={provider:{label:'controlled Ethereum reader'}};
 f.options.accountSession.wallet.pxe.getSyncedBlockHeader=async()=>({globalVariables:{blockNumber:3},hash:async()=>hex(42),state:{l1ToL2MessageTree:{root:new Fr(45)}}});
 f.state.claimReads=[];f.state.claimSecret=hex(46);
 f.options.sdk.prepareFundingClaim=async input=>{
  f.state.claimReads.push(input);await input.contextGuard();
  assert.equal(input.ethProvider,f.options.funding.provider);assert.deepEqual(input.scope,{...f.options.deployment.network,portal:f.options.deployment.portal,recipient:hex(1)});
  assert.deepEqual(input.secrets,{walletSecret:hex(8),walletSalt:hex(0)});assert.deepEqual(input.anchor,{number:3,hash:hex(42),root:hex(45)});
  if(f.state.claimError)throw Object.assign(Error('Verified receipt unavailable'),{code:'ROLLING_FUNDING_REORG'});
  return {status:f.state.claimStatus??'claim-ready',claim:{contract:hex(1),method:'claim_deposit',args:[receipt.sender,'100',f.state.claimSecret,'2']}};
 };
 return {...f,receipt,app:f.restart()};
}
test('funding claim keeps derived secret encrypted and revalidates receipt before one journalled send',async()=>{
 const f=fundingFixture(),prepared=await f.app.prepare({type:'claim-deposit',receipt:f.receipt});
 assert.equal(f.state.claimReads.length,1);assert(!JSON.stringify(prepared).includes(f.state.claimSecret));
 assert([...f.values.values()].every(value=>!value.includes(f.state.claimSecret)));
 const result=await f.restart().submitPrepared(prepared.intentId);assert.equal(result.status,'confirmed');assert.equal(f.state.claimReads.length,2);assert.equal(f.state.sends,1);
 assert.equal(f.state.sent.payload.name,'claim_deposit');assert.equal(f.state.sent.opts.transactionJournal,f.options.accountSession.journal);
 assert.equal((await f.restart().reconcile(prepared.intentId)).status,'confirmed');assert.equal(f.state.sends,1);
});
test('funding recovery mints private fee credit in the same collateral transaction and rechecks both receipts',async()=>{
 const f=fundingFixture(),original=f.options.sdk.prepareFundingClaim,feeReceipt={...f.receipt,txHash:hex(51)},bridgeClaim={amount:'200',salt:hex(52),leafIndex:'4'};
 f.options.accountSession.node.getNodeInfo=async()=>({l1ContractAddresses:{feeJuicePortalAddress:'0x'+'55'.repeat(20),feeJuiceAddress:'0x'+'66'.repeat(20)}});
 let feeReads=0;const payments=[];
 f.options.sdk.prepareFundingClaim=async input=>{
  if(input.kind==='collateral')return original(input);
  feeReads++;assert.deepEqual(input.receipt,feeReceipt);assert.deepEqual(input.secrets,{walletSecret:hex(8)});
  assert.deepEqual(input.scope,{...f.options.deployment.network,portal:'0x'+'55'.repeat(20),token:'0x'+'66'.repeat(20),recipient:hex(2)});
  return {status:'claim-ready',claim:{contract:hex(2),kind:'private-fee-bridge',bridgeClaim}};
 };
 f.options.sdk.preparePrivateFeePayment=async input=>{payments.push(input);return {availableCredit:200n};};
 const prepared=await f.restart().prepare({type:'claim-deposit',receipt:f.receipt,feeReceipt});
 assert(!JSON.stringify(prepared).includes(bridgeClaim.salt));assert.equal(f.state.sends,0);
 assert.equal((await f.restart().submitPrepared(prepared.intentId)).status,'confirmed');
 assert.equal(feeReads,2);assert.equal(f.state.claimReads.length,2);assert.equal(f.state.sends,1);
 assert.equal(payments.length,2);assert(payments.every(input=>input.claim===bridgeClaim));
});
function aggregateClaimFixture(usdc=false){
 const f=fundingFixture(),feeReceipt={...f.receipt,amount:'200',leafIndex:'3'},bokReceipt={...f.receipt,amount:'300',leafIndex:'4'};
 f.options.deployment.bok={address:hex(5),operator:hex(6),pluginId:hex(7),artifact:bokArtifact};
 const retained={intent:{expected:{kind:'aggregate-funding'}},recipientSalt:hex(91),bridgeSecret:hex(92),
  bokScope:{...f.options.deployment.network,portal:'0x'+'77'.repeat(20),recipient:hex(5),token:'0x'+'88'.repeat(20)}};
 if(usdc){retained.intent.expected.kind='aggregate-usdc-funding';retained.aggregateCustody={kind:'aggregate-usdc-custody-v1',planHash:hex(94),beneficiary:'0x'+'99'.repeat(20),privateFeeSalt:hex(95)};}
 f.options.funding.loadAggregate=async()=>f.state.missingContext?null:retained;
 f.options.accountSession.node.getNodeInfo=async()=>({l1ContractAddresses:{feeJuicePortalAddress:'0x'+'55'.repeat(20),feeJuiceAddress:'0x'+'66'.repeat(20)}});
 f.options.sdk.BatchCall=class {constructor(wallet,interactions){assert.equal(wallet,f.options.accountSession.wallet);this.name='batch';this.interactions=interactions;}};
 f.options.sdk.prepareFundingClaim=async input=>{
  f.state.claimReads.push(input);assert.equal(input.aggregateIntent,retained.intent);assert.equal(input.aggregateCustody,retained.aggregateCustody);
  if(input.kind==='collateral')return {status:'claim-ready',claim:{contract:hex(1),method:'claim_deposit',args:[f.receipt.sender,'100',hex(46),'2']}};
  if(input.kind==='private-fee')return {status:'claim-ready',claim:{contract:hex(2),kind:'private-fee-bridge',bridgeClaim:{amount:'200',salt:hex(90),leafIndex:'3'}}};
  assert.deepEqual(input.secrets,{recipientSalt:hex(91),bridgeSecret:hex(92)});assert.deepEqual(input.scope,retained.bokScope);
  return {status:f.state.bokClaimStatus??'claim-ready',claim:{contract:hex(5),method:'claim',args:['300',hex(91),f.state.changedClaim?hex(93):hex(92),'4']}};
 };
 f.state.payments=[];f.options.sdk.preparePrivateFeePayment=async input=>{f.state.payments.push(input);return {availableCredit:200n};};
 return {...f,retained,action:{type:'claim-deposit',receipt:f.receipt,feeReceipt,bokReceipt}};
}
for(const usdc of [false,true])test(`${usdc?'USDC':'ETH'} aggregate recovery batches collateral and Bok claims with bridged fees; encrypted reload never pays again`,async()=>{
 const f=aggregateClaimFixture(usdc),prepared=await f.restart().prepare(f.action);
 assert.equal(f.state.sends,0);assert.equal(f.state.claimReads.length,3);
 for(const secret of [hex(46),hex(90),hex(91),hex(92),hex(95)]){
  assert(!JSON.stringify(prepared).includes(secret));assert([...f.values.values()].every(value=>!value.includes(secret)));
 }
 assert.equal((await f.restart().submitPrepared(prepared.intentId)).status,'confirmed');
 assert.equal(f.state.sends,1);assert.equal(f.state.claimReads.length,6);
 assert.deepEqual(f.state.sent.payload.interactions.map(call=>call.name),['claim_deposit','claim']);
 assert(f.state.payments.every(p=>p.claim.amount==='200'));assert.equal(f.state.sent.opts.transactionJournal,f.options.accountSession.journal);
 assert.equal((await f.restart().reconcile(prepared.intentId)).status,'confirmed');assert.equal(f.state.sends,1);
});
test('aggregate claim cannot mix payment receipts or disclose private context in an action',async()=>{
 for(const change of [action=>action.bokReceipt.txHash=hex(80),action=>delete action.feeReceipt,action=>action.aggregateIntent={secret:hex(92)}]){
  const f=aggregateClaimFixture(),action=structuredClone(f.action);change(action);
  await assert.rejects(f.restart().prepare(action));assert.equal(f.state.sends,0);assert.equal(f.state.estimates,0);
 }
});
test('aggregate recovery missing custody, undelivered credit, or changed private claim cannot submit',async()=>{
 for(const change of ['missingContext','changedClaim','waiting']){
  const f=aggregateClaimFixture(),prepared=await f.restart().prepare(f.action),before=[...f.values.values()];
  if(change==='waiting')f.state.bokClaimStatus='waiting';else f.state[change]=true;
  await assert.rejects(f.restart().submitPrepared(prepared.intentId));assert.equal(f.state.sends,0);assert.deepEqual([...f.values.values()],before);
 }
});
for(const outcome of ['waiting','absent','reverted'])test(`funding ${outcome} receipt never estimates or sends`,async()=>{
 const f=fundingFixture();f.state.claimStatus=outcome;
 await assert.rejects(f.app.prepare({type:'claim-deposit',receipt:f.receipt}),{code:'ROLLING_FUNDING_NOT_READY'});
 assert.equal(f.state.sends,0);assert.equal(f.state.estimates,0);assert.equal(f.values.size,0);
});
test('funding reorg or changed derived claim blocks submission without replacing the saved intent',async()=>{
 for(const kind of ['reorg','changed-secret']){
  const f=fundingFixture(),prepared=await f.app.prepare({type:'claim-deposit',receipt:f.receipt}),before=[...f.values.values()];
  if(kind==='reorg')f.state.claimError=true;else f.state.claimSecret=hex(47);
  await assert.rejects(f.restart().submitPrepared(prepared.intentId));assert.equal(f.state.sends,0);assert.deepEqual([...f.values.values()],before);
 }
});
test('funding metadata cannot supply a private secret or silently create a payment',async()=>{
 const f=fundingFixture();await assert.rejects(f.app.prepare({type:'claim-deposit',receipt:{...f.receipt,secret:hex(55)}}));assert.equal(f.state.claimReads.length,0);assert.equal(f.state.sends,0);
 const plain=fixture();await assert.rejects(plain.app.prepare({type:'claim-deposit',receipt:f.receipt}),{code:'ROLLING_FUNDING_UNAVAILABLE'});
});
test('name availability uses normalized canonical ID and rejects a collision before fees or journal writes',async()=>{
 const f=fixture();f.state.nameRegistered=1n;
 await assert.rejects(f.app.prepare({type:'name',first:'  JoHN ',last:' DOE '}),{code:'ROLLING_NAME_TAKEN'});
 const expected=hex((await poseidon2HashWithSeparator(nameRegistration('john','doe').preimage.map(n=>new Fr(n)),NAME_DOMAIN)).toBigInt());
 const slot=(await deriveStorageSlotInMap(artifact.storageLayout.registered_names.slot,new Fr(BigInt(expected)))).toString();
 assert.deepEqual(f.state.nameReads,[{reference:{hash:hex(42)},address:hex(1),slot}]);assert.deepEqual(f.state.privateReads,[]);
 assert.equal(f.state.estimates,0);assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
});
test('name availability failures and changing canonical anchors never become available or taken',async()=>{
 for(const kind of ['transport','malformed','reorg','account','missing-layout']){
  const f=fixture();if(kind==='transport')f.state.nameReadError=Error('PRIVATE_SENTINEL');
  if(kind==='malformed')f.state.nameRegistered=2n;
  if(kind==='reorg')f.options.accountSession.node.getBlockData=async n=>({header:{globalVariables:{blockNumber:n==='checkpointed'?1:n}},blockHash:hex(n==='checkpointed'?42:43)});
  if(kind==='account')f.state.beforeNameRead=async()=>{f.options.accountSession.owner=new AztecAddress(new Fr(99n));};
  if(kind==='missing-layout'){f.options.deployment.board.artifact={...artifact,storageLayout:{...artifact.storageLayout,registered_names:undefined}};}
  await assert.rejects(f.app.prepare({type:'name',first:'John',last:'Doe'}),{code:'ROLLING_NAME_AVAILABILITY_UNAVAILABLE'});
  assert.equal(f.state.estimates,0);assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
 }
});
test('name preparation is encrypted, real ABI encoded and immutable across mutation/restart',async()=>{
  const f=fixture(),action={type:'name',first:'Private Sentinel',last:'Moss'};
  const prepared=await f.app.prepare(action);action.first='Different';
  assert.equal(f.state.sends,0);assert.equal(prepared.nameAvailability.anchor.blockNumber,1);assert.equal(prepared.nameAvailability.id,hex((await poseidon2HashWithSeparator(nameRegistration('Private Sentinel','Moss').preimage.map(n=>new Fr(n)),NAME_DOMAIN)).toBigInt()));assert.ok([...f.values.values()].every(v=>!v.includes('Private Sentinel')));
  const result=await f.restart().submitPrepared(prepared.intentId);
  assert.equal(result.status,'confirmed');assert.equal(f.state.sends,1);assert.equal(f.state.sent.payload.name,'register_name');
  assert.equal(f.state.sent.payload.args[1],16);assert.equal(result.action.first,'Private Sentinel');
  await assert.rejects(f.app.submitPrepared(prepared.intentId),{code:'ROLLING_RECOVERY_REQUIRED'});
});
test('all first-slice actions encode against the installed RollingBoard ABI',async()=>{
  const actions=[{type:'subboard',slug:'tiny-board',name:'Tiny',description:'Description',rules:''},
    {type:'post',deposit:'9',content:'héllo'}, {type:'reply',deposit:'9',content:'Reply',parent:'10',root:'11'},
    {type:'quote',deposit:'9',content:'Quote',reference:'10'}, {type:'repost',deposit:'9',content:'',reference:'10'},
    {type:'like',post:'10'},{type:'unlike',post:'10'},{type:'withdraw',deposit:'9'},{type:'screen',deposit:'9'}];
  for(const action of actions){const f=fixture(),p=await f.app.prepare(action);assert.equal(p.status,'prepared');
    assert.equal((await f.app.submitPrepared(p.intentId)).status,'confirmed');}
});
test('unknown send stays fenced across replacement instances; absent receipt never authorizes retry',async()=>{
  const f=fixture(),p=await f.app.prepare({type:'like',post:'5'});f.state.failSend=true;
  await assert.rejects(f.app.submitPrepared(p.intentId));assert.equal(f.state.sends,1);
  const replacement=f.restart();assert.equal((await replacement.reconcile(p.intentId)).status,'unknown');
  await assert.rejects(replacement.submitPrepared(p.intentId),{code:'ROLLING_RECOVERY_REQUIRED'});
  await assert.rejects(replacement.prepare({type:'unlike',post:'5'}),{code:'ROLLING_RECOVERY_REQUIRED'});
  assert.equal(f.state.sends,1);assert.equal((await replacement.readAccountStatus()).status,'recovering');
});
test('durable fence failure prevents send; successfully saved pre-send fence cannot be retried',async()=>{
  const f=fixture(),p=await f.app.prepare({type:'like',post:'5'});f.state.failCAS=true;
  await assert.rejects(f.app.submitPrepared(p.intentId),{code:'BB_JOURNAL_INVALID'});assert.equal(f.state.sends,0);
  f.state.failCAS=false;
  const original=f.options.contextGuard;let guards=0;
  f.options.contextGuard=async()=>{await original();if(++guards===4)throw Error('locked after fence');};
  await assert.rejects(f.restart().submitPrepared(p.intentId));assert.equal(f.state.sends,0);
  assert.equal((await f.app.reconcile(p.intentId)).status,'unknown');
});
test('saved fee ceiling and saved policy cannot be silently changed on submission',async()=>{
  const f=fixture(),p=await f.app.prepare({type:'post',deposit:'9',content:'Hi'});
  f.state.fee=11n;await assert.rejects(f.app.submitPrepared(p.intentId),{code:'ROLLING_FEE_CHANGED'});assert.equal(f.state.sends,0);
  f.state.fee=10n;f.state.policy=2;await assert.rejects(f.app.submitPrepared(p.intentId),/policy changed/);assert.equal(f.state.sends,0);
});
test('rejects arbitrary calls, fabricated Bok flow and oversized content without truncating',async()=>{
  for(const action of [{type:'call',method:'withdraw'}, {type:'bok',budget:'10'}, {type:'like',post:'5',from:hex(99)},
    {type:'post',deposit:'9',content:'😀'.repeat(249)}, {type:'reply',deposit:'9',content:'Hi',parent:'10'},
    {type:'subboard',slug:'bad--slug',name:'Hi',description:'Hi',rules:''}]){
    const f=fixture();await assert.rejects(f.app.prepare(action));assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
  }
});
test('private ownership and status reads never invoke publicReader, and do not overclaim eligibility',async()=>{
  const f=fixture(),id=hex((await ownershipPage())[0].name_id);assert.deepEqual(await f.app.ownedIdentities({cursor:8}),{identities:[id],records:[{id,first:'Jane',last:'Smith'}],nextCursor:null});
  assert.equal(f.state.privateReads[0].name,'owned_name_records');
  assert.equal(f.state.privateReads[0].args[1],8);
  const status=await f.app.readAccountStatus();assert.equal(status.status,'fee-ready');assert.equal(status.postEligibility,'requires-action-simulation');
  f.state.guard=false;await assert.rejects(f.app.ownedIdentities());await assert.rejects(f.app.readAccountStatus());
});
test('reconcile uses exact operation identity and preserves reverted outcomes',async()=>{
  const f=fixture(),p=await f.app.prepare({type:'like',post:'5'});f.state.failSend=true;await assert.rejects(f.app.submitPrepared(p.intentId));
  f.state.outcome={operation:'different',outcome:'success',txHash:hex(88)};assert.equal((await f.app.reconcile(p.intentId)).status,'unknown');
  f.state.outcome={operation:`ROLLING_WORKFLOW_V1:${p.intentId}`,outcome:'reverted',txHash:hex(77),receipt:{txHash:hex(77)}};
  assert.equal((await f.app.reconcile(p.intentId)).status,'reverted');assert.equal(f.state.sends,1);
});
test('CAS excludes concurrent writers from sending the same prepared intent twice',async()=>{
  const f=fixture(),p=await f.app.prepare({type:'like',post:'5'});
  const results=await Promise.allSettled([f.app.submitPrepared(p.intentId),f.restart().submitPrepared(p.intentId)]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.state.sends,1);
});

test('cancellation only before send, including cancellation/submission CAS race',async()=>{
  const f=fixture(),p=await f.app.prepare({type:'like',post:'5'});
  assert.equal((await f.app.cancelPrepared(p.intentId)).status,'cancelled');
  await assert.rejects(f.app.submitPrepared(p.intentId),{code:'ROLLING_RECOVERY_REQUIRED'});
  const next=await f.app.prepare({type:'unlike',post:'5'});
  const results=await Promise.allSettled([f.app.cancelPrepared(next.intentId),f.restart().submitPrepared(next.intentId)]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.ok(f.state.sends<=1);
  if(f.state.sends)await assert.rejects(f.app.cancelPrepared(next.intentId),{code:'ROLLING_RECOVERY_REQUIRED'});
  const u=fixture(),q=await u.app.prepare({type:'like',post:'5'});u.state.failSend=true;
  await assert.rejects(u.app.submitPrepared(q.intentId));
  await assert.rejects(u.restart().cancelPrepared(q.intentId),{code:'ROLLING_RECOVERY_REQUIRED'});
});
test('live private screening hint round-trips through encrypted store and actual ABI',async()=>{
  const f=fixture();f.state.hints=[{note:{schema_version:1,deposit_chain_id:9n,sequence:1n,post_id:8n,anchor_timestamp:100n,previous_link:3n,is_dummy:false},
    contract_address:new AztecAddress(new Fr(1n)),owner:f.options.accountSession.owner,randomness:20n,storage_slot:21n,
    metadata:{stage:1,maybe_note_nonce:22n}},null];
  const p=await f.app.prepare({type:'post',deposit:'9',content:'next'});
  assert.equal((await f.restart().submitPrepared(p.intentId)).status,'confirmed');
  assert.equal(f.state.sent.payload.args[3].note.sequence,hex(1));
});
test('canonical receipt lost after a reported success returns recovering; changed deployment fails closed',async()=>{
  const f=fixture(),p=await f.app.prepare({type:'like',post:'5'});await f.app.submitPrepared(p.intentId);
  f.state.outcome=null;assert.equal((await f.app.readAccountStatus()).status,'recovering');
  await assert.rejects(f.app.prepare({type:'unlike',post:'5'}),{code:'ROLLING_RECOVERY_REQUIRED'});
  f.options.deployment.network.version='2';await assert.rejects(f.app.ownedIdentities(),{code:'ROLLING_CONTEXT_CHANGED'});
});

test('wrong wallet node fails before any personalized wallet/utility call',async()=>{
  const f=fixture();f.options.accountSession.wallet.aztecNode={};
  f.options.accountSession.wallet.getChainInfo=()=>{assert.fail('must not query mismatched wallet');};
  f.options.accountSession.wallet.getAccounts=()=>{assert.fail('must not query mismatched wallet');};
  for(const action of [()=>f.app.readAccountStatus(),()=>f.app.ownedIdentities(),()=>f.app.prepare({type:'like',post:'5'})]){
    await assert.rejects(action(),{code:'ROLLING_CONTEXT_CHANGED'});
  }
  assert.equal(f.state.privateReads.length,0);assert.equal(f.state.estimates,0);assert.equal(f.state.sends,0);
});

class JournalTx {
  constructor(hash){this.hash=hash;}
  getTxHash(){return {toString:()=>this.hash};}
  toBuffer(){return Buffer.from(this.hash);}
  static fromBuffer(buffer){return new JournalTx(buffer.toString());}
}
async function realJournalFixture(base){
  const f=base??fixture(),receipts=new Map();let sequence=700;
  const node=f.options.accountSession.node;
  node.getTxReceipt=async hash=>receipts.get(hash.toString());
  node.getBlock=async()=>({hash:{toString:()=>hex(42)}});
  const scope={account:hex(3),chainId:'31337',version:'1',rollup:'0x'+'11'.repeat(20),board:hex(1),portal:'0x'+'22'.repeat(20)};
  const newJournal=()=>createL2Journal({storage:f.options.privateStore,walletSecret:hex(8),walletSalt:'0',scope,Tx:JournalTx,node,waitOptions:{timeoutMs:1000,intervalMs:1}});
  f.options.accountSession.journal=await newJournal();
  async function install(operation,status='checkpointed',result='success'){
    const journal=f.options.accountSession.journal,previous=await journal.assertCanStart();
    const tx=new JournalTx(hex(sequence++));journal.setOperation(operation);await journal.prepare(tx,previous);
    const receipt={txHash:tx.getTxHash(),status,executionResult:result,blockNumber:1,blockHash:{toString:()=>hex(42)}};
    receipts.set(tx.hash,receipt);return receipt;
  }
  f.options.accountSession.wallet.sendTx=async(_,opts)=>{
    f.state.sends++;const receipt=await install(opts.journalOperation);opts.transactionJournal.confirmed(receipt);return {receipt};
  };
  f.app=f.restart();
  return {...f,receipts,install,restartJournal:async()=>{f.options.accountSession.journal=await newJournal();return f.restart();}};
}
test('actual encrypted L2 journal and workflow coexist; restart acknowledges only canonical predecessor',async()=>{
  const f=await realJournalFixture(),first=await f.app.prepare({type:'like',post:'5'});
  await f.app.submitPrepared(first.intentId);assert.equal(f.values.size,2,'distinct authenticated ciphertext slots');
  let replacement=await f.restartJournal();
  assert.equal((await replacement.reconcile(first.intentId)).status,'confirmed');
  const second=await replacement.prepare({type:'unlike',post:'5'});
  replacement=await f.restartJournal(); // prepared next action survives another loss of in-memory acknowledgement
  assert.equal((await replacement.submitPrepared(second.intentId)).status,'confirmed');assert.equal(f.state.sends,2);
});
test('actual journal pending transaction arriving after prepare blocks before private simulation',async()=>{
  const f=await realJournalFixture(),p=await f.app.prepare({type:'like',post:'5'});
  await f.install('OTHER_OPERATION','pending');const estimates=f.state.estimates;
  await assert.rejects(f.app.submitPrepared(p.intentId),{code:'BB_RECOVERY_REQUIRED'});
  assert.equal(f.state.estimates,estimates);assert.equal(f.state.sends,0);
});
test('actual restarted reverted journal still requires finality, and reorg prevents acknowledgement',async()=>{
  const f=await realJournalFixture(),p=await f.app.prepare({type:'like',post:'5'});
  f.options.accountSession.wallet.sendTx=async(_,opts)=>{await f.install(opts.journalOperation,'checkpointed','reverted');throw Error('reverted');};
  await assert.rejects(f.app.submitPrepared(p.intentId));let replacement=await f.restartJournal();
  assert.equal((await replacement.reconcile(p.intentId)).status,'reverted');
  await assert.rejects(replacement.prepare({type:'unlike',post:'5'}),{code:'BB_TRANSACTION_FINALITY_PENDING'});
  const receipt=[...f.receipts.values()][0];receipt.status='finalized';
  replacement=await f.restartJournal();assert.equal((await replacement.prepare({type:'unlike',post:'5'})).status,'prepared');
  const g=await realJournalFixture(),q=await g.app.prepare({type:'like',post:'5'});await g.app.submitPrepared(q.intentId);
  g.options.accountSession.node.getBlock=async()=>({hash:{toString:()=>hex(999)}});
  await assert.rejects((await g.restartJournal()).reconcile(q.intentId),{code:'BB_SUBMISSION_UNKNOWN'});
});
test('missing factory PXE provenance rejects before private wallet calls',async()=>{
  const f=fixture();f.options.sdk.isPrivatePXEForNode=()=>false;
  f.options.accountSession.wallet.getChainInfo=()=>assert.fail('private call before provenance');
  await assert.rejects(f.app.readAccountStatus(),{code:'ROLLING_CONTEXT_CHANGED'});
});

test('unverified captured wallet submission route is rejected before personalized calls',async()=>{
  const f=fixture();f.options.sdk.isPrivateWalletForNode=()=>false;
  f.options.accountSession.wallet.getChainInfo=()=>assert.fail('private call before raw submission provenance');
  await assert.rejects(f.app.prepare({type:'like',post:'5'}),{code:'ROLLING_CONTEXT_CHANGED'});
  assert.equal(f.state.estimates,0);assert.equal(f.state.sends,0);
});
test('newly acknowledged but non-final reverted transaction blocks pre-estimation too',async()=>{
  const f=await realJournalFixture(),p=await f.app.prepare({type:'like',post:'5'});
  const receipt=await f.install('OTHER_OPERATION','checkpointed','reverted');f.options.accountSession.journal.confirmed(receipt);
  const estimates=f.state.estimates;
  await assert.rejects(f.app.submitPrepared(p.intentId),{code:'BB_TRANSACTION_FINALITY_PENDING'});
  assert.equal(f.state.estimates,estimates);assert.equal(f.state.sends,0);
});

// Actual SDK chain conversion, with only getNodeInfo replaced by a local value source.
test('installed BaseWallet field-valued chain identity passes strict application binding',async()=>{
  const f=fixture();let chainId=31337,rollupVersion=1;
  let installed=new BaseWallet({}, {getNodeInfo:async()=>({l1ChainId:chainId,rollupVersion})});
  f.options.accountSession.wallet.getChainInfo=()=>installed.getChainInfo();
  assert.ok((await installed.getChainInfo()).chainId instanceof Fr);
  assert.equal((await f.app.readAccountStatus()).status,'fee-ready');
  for(const change of [()=>{chainId=31338;},()=>{chainId=31337;rollupVersion=2;}]){
    change();installed=new BaseWallet({}, {getNodeInfo:async()=>({l1ChainId:chainId,rollupVersion})});
    const reads=f.state.privateReads.length;
    await assert.rejects(f.app.readAccountStatus(),{code:'ROLLING_CONTEXT_CHANGED'});
    assert.equal(f.state.privateReads.length,reads);assert.equal(f.state.sends,0);
  }
});
test('chain binding rejects malformed, missing and out-of-field identities before private reads',async()=>{
  for(const value of [undefined,null,true,-1,1.5,Number.MAX_SAFE_INTEGER+1,' 31337','031337','0x7a69',FIELD_MODULUS,{},
    {toBigInt:()=>FIELD_MODULUS},{toBigInt:()=>{throw Error('private detail');}}]){
    for(const key of ['chainId','version']){
      const f=fixture();f.options.accountSession.wallet.getChainInfo=async()=>({...{chainId:31337,version:1},[key]:value});
      await assert.rejects(f.app.readAccountStatus(),{code:'ROLLING_CONTEXT_CHANGED',message:'ROLLING_CONTEXT_CHANGED'});
      assert.equal(f.state.privateReads.length,0);assert.equal(f.state.sends,0);
    }
  }
});

// These fixtures use the installed decoder, not a hand-written null substitute.
test('actual SDK Option None and Some preserve post ABI bytes across encrypted reopen',async()=>{
 const hintsType=getFunctionReturnType(artifact.functions.find(f=>f.name==='get_screen_hints'));
 const post=artifact.functions.find(f=>f.name==='post');
 const hintAbi={...post,parameters:post.parameters.slice(-2)};
 for(const some of [false,true]){
  const fields=Array.from({length:28},()=>Fr.ZERO);
  if(some){fields[0]=new Fr(1n);fields[1]=new Fr(1n);fields[2]=new Fr(9n);fields[3]=new Fr(1n);fields[4]=new Fr(8n);fields[5]=new Fr(100n);fields[6]=new Fr(3n);fields[8]=new Fr(1n);fields[9]=new Fr(3n);fields[10]=new Fr(20n);fields[11]=new Fr(21n);fields[12]=new Fr(1n);fields[13]=new Fr(22n);}
  const decoded=decodeFromAbi(hintsType,fields);assert.equal(decoded[1],undefined);assert.equal(decoded[0]===undefined,!some);
  const f=fixture();f.state.hints=decoded;
  const p=await f.app.prepare({type:'post',deposit:'9',content:'Optional hint roundtrip'});
  const prepared=f.state.calls.at(-1).args.slice(-2);assert.equal(prepared[1],null);
  assert.deepEqual(encodeArguments(hintAbi,prepared).map(String),fields.map(String));
  assert.equal((await f.restart().submitPrepared(p.intentId)).status,'confirmed');
  assert.deepEqual(f.state.sent.payload.args.slice(-2),prepared);
  assert.deepEqual(encodeArguments(hintAbi,f.state.sent.payload.args.slice(-2)).map(String),fields.map(String));
 }
});
test('utility ABI rejects missing required hint fields and malformed tuples before saving',async()=>{
 const hintsType=getFunctionReturnType(artifact.functions.find(f=>f.name==='get_screen_hints'));
 const fields=Array.from({length:28},()=>Fr.ZERO);fields[0]=new Fr(1n);
 const decoded=decodeFromAbi(hintsType,fields);
 const badField=structuredClone(decoded);badField[0].note.schema_version=undefined;
 for(const hints of [[undefined],[undefined,undefined,undefined],badField,[{},undefined]]){
  const f=fixture();f.state.hints=hints;
  await assert.rejects(f.app.prepare({type:'post',deposit:'9',content:'Must reject'}),{code:'ROLLING_INVALID_RESPONSE'});
  assert.equal(f.state.estimates,0);assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
 }
});

// G05-A09/A10 cases bind to the normal processed protocol ABI above. RPC/session
// doubles model stale-version simulation; they do not replace actual proof acceptance.
test('profile actions encode with actual private ABI and survive encrypted restart',async()=>{
 const cases=[{type:'bio',name:'5',expectedVersion:'0',content:'é'.repeat(496)},
  {type:'bio',name:'5',expectedVersion:'0',content:''},
  {type:'avatar',name:'5',expectedVersion:'0',width:100,height:100,data:Buffer.alloc(8192,0xa5).toString('base64')},
  {type:'avatar',name:'5',expectedVersion:'0',width:0,height:0,data:''}];
 for(const action of cases){const f=fixture(),p=await f.app.prepare(action),call=f.state.calls.at(-1);assert.equal(f.state.sends,0);
  const abi=artifact.functions.find(fn=>fn.name===call.name);assert.equal(abi.functionType,'private');
  const encoded=encodeArguments(abi,call.args).map(value=>value.toBigInt());assert.equal(encoded.length,action.type==='bio'?35:270);assert.equal(encoded[0],5n);assert.equal(encoded[1],0n);
  const packed=action.type==='bio'?encoded.slice(2,34):encoded.slice(5);const recovered=Buffer.concat(packed.map(n=>Buffer.from(n.toString(16).padStart(64,'0'),'hex').subarray(1)));
  const expected=action.type==='bio'?Buffer.from(action.content):Buffer.from(action.data,'base64');assert.deepEqual(recovered.subarray(0,expected.length),expected);assert(recovered.subarray(expected.length).every(byte=>byte===0));
  const args=structuredClone(call.args);if(action.type==='bio'){assert.equal(args[2].length,32);assert.equal(args[3],new TextEncoder().encode(action.content).length);}
  else{assert.equal(args[5].length,265);assert.equal(args[4],Buffer.from(action.data,'base64').length);assert(BigInt(args[5][264])<(1n<<248n));assert.equal(BigInt(args[5][264])&((1n<<184n)-1n),0n);}
  assert.equal((await f.restart().submitPrepared(p.intentId)).status,'confirmed');assert.deepEqual(f.state.sent.payload.args,args);
 }
});
test('profile byte/version/dimension validation rejects without fee estimation or journal writes',async()=>{
 const bio={type:'bio',name:'5',expectedVersion:'0',content:'hi'},avatar={type:'avatar',name:'5',expectedVersion:'0',width:100,height:100,data:'AA=='};
 const actions=[{...bio,content:'é'.repeat(497)},{...bio,content:'\ud800'},{...bio,content:'x\0y'},{...bio,name:'0'},
  ...['01','-1','4294967296',' 0','1.0',0,null,undefined].map(expectedVersion=>({...bio,expectedVersion})),
  {...avatar,data:Buffer.alloc(8193).toString('base64')},...['AB==','AAB=','AA','AA==\n','__==','A==='].map(data=>({...avatar,data})),
  {...avatar,width:99},{...avatar,width:'100'},{...avatar,data:''},{...avatar,width:0,height:0},
  {...avatar,expectedVersion:'4294967296'}];
 for(const action of actions){const f=fixture();await assert.rejects(f.app.prepare(action));assert.equal(f.state.estimates,0);assert.equal(f.state.sends,0);assert.equal(f.values.size,0);}
});
test('stale profile version cannot be silently refreshed or sent after preparation',async()=>{
 for(const action of [{type:'bio',name:'5',expectedVersion:'0',content:'immutable'},
  {type:'avatar',name:'5',expectedVersion:'0',width:100,height:100,data:'AA=='}]){
  const f=fixture(),p=await f.app.prepare(action);f.state.profileVersion=1;
  await assert.rejects(f.restart().submitPrepared(p.intentId),/stale profile version/);assert.equal(f.state.sends,0);
  assert.equal((await f.app.reconcile(p.intentId)).status,'prepared');assert.equal(f.state.calls.at(-1).args[1],0);
 }
 const f=fixture();f.state.profileVersion=0xffffffff;await assert.rejects(f.app.prepare({type:'bio',name:'5',expectedVersion:'4294967295',content:''}),/profile version exhausted/);
 assert.equal(f.state.calls.at(-1).args[1],0xffffffff);assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
});
test('owned metadata preserves display case, 32-byte boundary and cursor with only private utility calls',async()=>{
 const f=fixture(),names=Array.from({length:8},(_,i)=>['A'.repeat(32),`Last ${String.fromCharCode(65+i)}`]);f.state.records=await ownershipPage(names);
 const result=await f.app.ownedIdentities({cursor:16});assert.equal(result.nextCursor,24);assert.deepEqual(result.records.map(r=>[r.first,r.last]),names);assert.equal(result.identities.length,8);
 assert.deepEqual(f.state.privateReads.map(r=>r.name),['owned_name_records']);assert.equal(f.state.privateReads[0].args[1],16);
});
test('native campaign SDK recovers an actual ABI-decoded nonempty ownership page',async()=>{
 const {loadRollingFixtureSDK}=await import('../../scripts/testing/rolling-application-fixture.mjs');
 const native=await loadRollingFixtureSDK(),f=fixture();
 f.state.records=await ownershipPage([['River','Stone']]);
 f.options.sdk.poseidon2HashWithSeparator=native.poseidon2HashWithSeparator;
 const id='0x2682de94a1e9e9ebdc321ce593be34853b1587f715bc9f147e8daae17c7cf76b';
 assert.deepEqual(await f.app.ownedIdentities(),{identities:[id],records:[{id,first:'River',last:'Stone'}],nextCursor:null});
 assert.equal(native.poseidon2HashWithSeparator,poseidon2HashWithSeparator);
 const {preimage}=nameRegistration('River','Stone');
 assert.equal((await native.poseidon2HashWithSeparator(preimage.map(n=>new native.Fr(n)),NAME_DOMAIN)).toString(),id);
 assert.equal(f.state.sends,0);assert.deepEqual(f.state.privateReads.map(r=>r.name),['owned_name_records']);
});
test('owned metadata rejects forged IDs, bad schema, missing fields, padding, reserved/unsupported names and duplicates',async()=>{
 const mutations=[page=>{page[0].name_id=6n;},page=>{page[0].schema=2;},page=>{delete page[0].first;},page=>{page[0].first[0]+=1n;},page=>{page[0].first[1]=1n;},
  page=>{page[0].first[0]=1n<<248n;},page=>{page[0].first_length=33;},page=>{page[0].first[0]=255n<<240n;},
  page=>{page[0].first_length=3;page[0].first=displayPack('Bok');},page=>{page[1]=structuredClone(page[0]);},
  page=>{page[1].schema=1;},page=>{page[1].last[0]=1n;},page=>{page[2]=page[0];page[0]=structuredClone(page[1]);}];
 for(const mutate of mutations){const f=fixture();f.state.records=await ownershipPage();mutate(f.state.records);await assert.rejects(f.app.ownedIdentities(),{code:'ROLLING_INVALID_RESPONSE'});assert.equal(f.state.sends,0);assert.deepEqual(f.state.privateReads.map(r=>r.name),['owned_name_records']);}
});
test('missing new metadata ABI fails closed without legacy or public lookup',async()=>{
 const f=fixture();f.options.deployment.board.artifact={...artifact,functions:artifact.functions.filter(fn=>fn.name!=='owned_name_records')};
 await assert.rejects(f.app.ownedIdentities(),{code:'ROLLING_ABI_MISMATCH'});assert.deepEqual(f.state.privateReads,[]);
});
test('account lock during local metadata hashing suppresses the private result',async()=>{
 const f=fixture();f.options.sdk.poseidon2HashWithSeparator=async(...args)=>{const value=await poseidon2HashWithSeparator(...args);f.state.guard=false;return value;};
 await assert.rejects(f.app.ownedIdentities());assert.deepEqual(f.state.privateReads.map(r=>r.name),['owned_name_records']);
});

test('selected profile versions use the guarded private utility without public ownership queries or mutations',async()=>{
 const f=fixture();f.state.profileState=decodeFromAbi(getFunctionReturnType([...artifact.functions,...artifact.nonDispatchPublicFunctions].find(fn=>fn.name==='profile_state')),[2n,0n,0n,3n,0n,100n,100n,8192n].map(n=>new Fr(n)));
 assert.deepEqual(await f.app.readProfile({name:'9'}),{name:hex(9),bioVersion:'2',avatarVersion:'3'});
 assert.deepEqual(f.state.privateReads.map(read=>read.name),['profile_state']);assert.equal(f.state.sends,0);assert.equal(f.state.estimates,0);assert.equal(f.values.size,0);
 f.state.guard=false;await assert.rejects(f.app.readProfile({name:'9'}));assert.equal(f.state.privateReads.length,1);
});
test('profile snapshots reject anonymous names and malformed or overflowing versions without saving an action',async()=>{
 for(const name of ['0','01',undefined]){const f=fixture();await assert.rejects(f.app.readProfile({name}));assert.equal(f.state.privateReads.length,0);}
 for(const key of ['bio_version','avatar_version'])for(const value of [undefined,-1,4294967296,true,false,'',' ','0','01','+1','0x1',0,1]){
  const f=fixture();f.state.profileState={bio_version:0n,bio_digest:0n,bio_length:0,avatar_version:0n,avatar_digest:0n,avatar_width:0,avatar_height:0,avatar_length:0,[key]:value};
  await assert.rejects(f.app.readProfile({name:'9'}));assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
 }
});

test('rejected subboard has a distinct pre-spend result without hiding malformed policy or outages',async()=>{
 const input={type:'post',deposit:'9',subboard:'17',name:'0',content:'A retained draft'};
 const rejected=fixture();rejected.state.effectivePolicy=[1n,1n,1n,2n,true];
 await assert.rejects(rejected.app.prepare(input),{code:'ROLLING_SUBBOARD_REJECTED'});
 for(const value of [null,[],[1n,1n,1n,2n], [1n,1n,1n,2n,'true']]){
  const malformed=fixture();malformed.state.effectivePolicy=value;
  await assert.rejects(malformed.app.prepare(input),error=>error.code==='ROLLING_INVALID_RESPONSE');
  assert.equal(malformed.state.estimates,0);assert.equal(malformed.state.sends,0);assert.equal(malformed.values.size,0);
 }
 const unavailable=fixture(),error=Object.assign(Error('test-only offline'),{code:'TEST_NODE_UNAVAILABLE'});unavailable.state.policyReadError=error;
 await assert.rejects(unavailable.app.prepare(input),e=>e===error);
 for(const f of [rejected,unavailable]){assert.equal(f.state.estimates,0);assert.equal(f.state.sends,0);assert.equal(f.values.size,0);assert(!f.state.privateReads.some(x=>x.name==='get_screen_hints'));}
 assert.equal(input.content,'A retained draft');
 const valid=fixture();await valid.app.prepare(input);assert.equal(valid.state.estimates,1);assert.equal(valid.state.sends,0);
});

// Labelled session doubles; actual normal ABI/decoder and encrypted persistence.
// These prove the adapter boundary, not on-chain maturity or a completed exit.
test('screen actual ABI snapshots None/Some pairs and submits once after explicit confirmation',async()=>{
 const hintsType=getFunctionReturnType(artifact.functions.find(f=>f.name==='get_screen_hints'));
 const screen=artifact.functions.find(f=>f.name==='screen');assert(screen);
 for(const count of [0,1,2]){
  const fields=Array.from({length:28},()=>Fr.ZERO);
  for(let i=0;i<count;i++){
   const offset=i*14,values=[1n,1n,9n,BigInt(i+1),BigInt(8+i),100n,3n,0n,1n,3n,20n,21n,1n,22n];
   values.forEach((n,j)=>{fields[offset+j]=new Fr(n);});
  }
  const f=fixture();f.state.hints=decodeFromAbi(hintsType,fields);
  const prepared=await f.app.prepare({type:'screen',deposit:'9'});assert.equal(prepared.status,'prepared');assert.equal(prepared.maximumFee,'10');
  assert.equal(f.state.sends,0);assert.deepEqual(f.state.privateReads.map(r=>r.name),['get_screen_hints']);
  const args=f.state.calls[0].args;assert.equal(args[0],hex(9));
  assert.deepEqual(encodeArguments(screen,args).map(String),[new Fr(9n),...fields].map(String));
  // A later utility response must not replace the confirmed immutable hints.
  f.state.hints=decodeFromAbi(hintsType,Array.from({length:28},()=>Fr.ZERO));
  const outcome=await f.restart().submitPrepared(prepared.intentId);assert.equal(outcome.status,'confirmed');
  assert.equal(f.state.sends,1);assert.equal(f.state.sent.payload.name,'screen');assert.deepEqual(f.state.sent.payload.args,args);
  assert.equal(f.state.privateReads.length,1);await assert.rejects(f.app.submitPrepared(prepared.intentId),{code:'ROLLING_RECOVERY_REQUIRED'});
 }
});
test('screen rejects malformed deposit, extra hints/content/call options and grandchild without child',async()=>{
 for(const action of [{type:'screen'},{type:'screen',deposit:'0'},{type:'screen',deposit:9},{type:'screen',deposit:'09'},
  {type:'screen',deposit:FIELD_MODULUS.toString()},{type:'screen',deposit:'9',child:null},{type:'screen',deposit:'9',content:''},{type:'screen',deposit:'9',from:hex(3)}]){
  const f=fixture();await assert.rejects(f.app.prepare(action),{code:'ROLLING_INVALID_ACTION'});assert.equal(f.state.privateReads.length,0);assert.equal(f.state.estimates,0);assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
 }
 const f=fixture(),type=getFunctionReturnType(artifact.functions.find(fn=>fn.name==='get_screen_hints')),fields=Array.from({length:28},()=>Fr.ZERO);fields[14]=new Fr(1n);
 f.state.hints=decodeFromAbi(type,fields);await assert.rejects(f.app.prepare({type:'screen',deposit:'9'}),{code:'ROLLING_HISTORY_UNAVAILABLE'});assert.equal(f.state.estimates,0);assert.equal(f.values.size,0);
});
test('screen propagates private hint and fee-simulation failures without saving or sending',async()=>{
 for(const phase of ['hintsReadError','screenError']){
  const f=fixture(),error=Error('Labelled screening failure');f.state[phase]=error;
  await assert.rejects(f.app.prepare({type:'screen',deposit:'9'}),e=>e===error);assert.equal(f.values.size,0);assert.equal(f.state.sends,0);
 }
 const f=fixture();f.state.hints=[{},undefined];await assert.rejects(f.app.prepare({type:'screen',deposit:'9'}),{code:'ROLLING_INVALID_RESPONSE'});assert.equal(f.values.size,0);assert.equal(f.state.estimates,0);
});
test('screen retains saved fee ceiling, permits pre-send cancellation and fences uncertain send',async()=>{
 const f=fixture(),p=await f.app.prepare({type:'screen',deposit:'9'});f.state.fee=11n;
 await assert.rejects(f.restart().submitPrepared(p.intentId),{code:'ROLLING_FEE_CHANGED'});assert.equal(f.state.sends,0);
 assert.equal((await f.app.cancelPrepared(p.intentId)).status,'cancelled');
 f.state.fee=10n;const next=await f.app.prepare({type:'screen',deposit:'9'});f.state.failSend=true;
 await assert.rejects(f.app.submitPrepared(next.intentId));assert.equal(f.state.sends,1);
 const replacement=f.restart();assert.equal((await replacement.reconcile(next.intentId)).status,'unknown');
 await assert.rejects(replacement.submitPrepared(next.intentId),{code:'ROLLING_RECOVERY_REQUIRED'});
 await assert.rejects(replacement.prepare({type:'screen',deposit:'9'}),{code:'ROLLING_RECOVERY_REQUIRED'});assert.equal(f.state.sends,1);
});
test('screen stale-state submission fails without refreshing immutable hints or spending',async()=>{
 const f=fixture(),p=await f.app.prepare({type:'screen',deposit:'9'}),error=Error('Labelled spent deposit simulation');
 f.state.screenError=error;await assert.rejects(f.restart().submitPrepared(p.intentId),e=>e===error);
 assert.equal(f.state.sends,0);assert.equal(f.state.privateReads.filter(r=>r.name==='get_screen_hints').length,1);
 assert.equal((await f.app.reconcile(p.intentId)).status,'prepared');assert.equal((await f.app.cancelPrepared(p.intentId)).status,'cancelled');
});

// Preference integration uses the normally processed d530 artifact. Only the
// transport/funding doubles are synthetic; ABI encoding and encrypted intent
// persistence use the production implementations. No chain acceptance claim.
const preferenceHead=(initialized,schema,revision,digest)=>decodeFromAbi(getFunctionReturnType(artifact.functions.find(f=>f.name==='preference_head')),
 [new Fr(initialized?1n:0n),new Fr(BigInt(schema)),new Fr(BigInt(revision)),new Fr(BigInt(digest))]);
test('preference and read marker encode actual ABI, preserve exact payer/journal and submit only after confirmation',async()=>{
 const cases=[
  [{type:'preference',expectedRevision:'0',kind:1,target:'42',enabled:true},'set_preference',[0n,1n,42n,1n]],
  [{type:'preference',expectedRevision:'18446744073709551615',kind:5,target:hex(0),enabled:false},'set_preference',[0xffffffffffffffffn,5n,0n,0n]],
  [{type:'read-marker',expectedRevision:'9007199254740993',thread:hex(42),throughBlock:'4294967295'},'mark_thread_read',[9007199254740993n,42n,0xffffffffn]],
 ];
 for(const [action,method,fields] of cases){
  const f=fixture();f.state.preferenceHead=preferenceHead(action.expectedRevision!=='0',1,action.expectedRevision,action.expectedRevision==='0'?'0':'11');const p=await f.app.prepare(action);assert.equal(p.status,'prepared');assert.equal(p.maximumFee,'10');assert.equal(f.state.sends,0);assert.deepEqual(f.state.privateReads.map(row=>row.name),['preference_head']);
  const call=f.state.calls[0],abi=artifact.functions.find(fn=>fn.name===method);assert(abi);assert.equal(call.name,method);
  assert.deepEqual(encodeArguments(abi,call.args).map(x=>x.toBigInt()),fields);
  const result=await f.restart().submitPrepared(p.intentId);assert.equal(result.status,'confirmed');assert.equal(f.state.sends,1);
  assert.equal(f.state.sent.opts.from.toString(),f.options.accountSession.owner.toString());assert.equal(f.state.sent.opts.transactionJournal,f.options.accountSession.journal);
  assert.equal(f.state.sent.opts.journalOperation,`ROLLING_WORKFLOW_V1:${p.intentId}`);assert.deepEqual(f.state.sent.payload.args,call.args);
  await assert.rejects(f.app.submitPrepared(p.intentId),{code:'ROLLING_RECOVERY_REQUIRED'});
 }
});
test('all five preference targets allow only their fixed ID shape before fee estimation',async()=>{
 for(const [kind,target] of [[1,'1'],[2,'0'],[2,'1'],[3,'1'],[4,'1'],[5,'0']]){
  const f=fixture();await f.app.prepare({type:'preference',expectedRevision:'0',kind,target,enabled:false});assert.equal(f.state.estimates,1);
 }
 const base={type:'preference',expectedRevision:'0',kind:1,target:'1',enabled:true};
 for(const patch of [{kind:0},{kind:6},{kind:'1'},{kind:1.5},{kind:null},{target:'0'},{kind:3,target:'0'},{kind:4,target:'0'},
  {kind:5,target:'1'},{target:'01'},{target:1},{target:FIELD_MODULUS.toString()},{enabled:1},{enabled:null},
  {expectedRevision:'01'},{expectedRevision:0},{expectedRevision:'-1'},{expectedRevision:'18446744073709551616'},{owner:hex(3)},{read_hash:hex(1)}]){
  const f=fixture();await assert.rejects(f.app.prepare({...base,...patch}),{code:'ROLLING_INVALID_ACTION'});assert.equal(f.state.estimates,0);assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
 }
 for(const key of ['expectedRevision','kind','target','enabled']){const f=fixture(),action={...base};delete action[key];await assert.rejects(f.app.prepare(action));assert.equal(f.state.estimates,0);}
});
test('read marker validates canonical revision/thread/block without accepting a caller header hash',async()=>{
 const base={type:'read-marker',expectedRevision:'0',thread:'1',throughBlock:'0'};
 for(const patch of [{thread:'0'},{thread:'01'},{thread:1},{throughBlock:0},{throughBlock:'01'},{throughBlock:'-1'},
  {throughBlock:'4294967296'},{expectedRevision:'18446744073709551616'},{readHash:hex(9)},{owner:hex(3)},{enabled:true}]){
  const f=fixture();await assert.rejects(f.app.prepare({...base,...patch}),{code:'ROLLING_INVALID_ACTION'});assert.equal(f.state.estimates,0);assert.equal(f.values.size,0);
 }
});
test('preference saved maximum and revision remain immutable on retry-free stale simulation failure',async()=>{
 const f=fixture(),action={type:'preference',expectedRevision:'7',kind:1,target:'42',enabled:true};
 f.state.preferenceHead=preferenceHead(true,1,7,11);const prepared=await f.app.prepare(action);action.expectedRevision='8';action.enabled=false;f.state.fee=11n;
 await assert.rejects(f.restart().submitPrepared(prepared.intentId),{code:'ROLLING_FEE_CHANGED'});assert.equal(f.state.sends,0);
 f.state.fee=10n;const error=Object.assign(Error('Labelled stale expected revision'),{code:'LABELLED_REVISION_REJECTED'});f.state.preferenceError=error;
 await assert.rejects(f.app.submitPrepared(prepared.intentId),e=>e===error);assert.equal(f.state.sends,0);
 const retained=await f.app.reconcile(prepared.intentId);assert.equal(retained.status,'prepared');assert.equal(retained.action.expectedRevision,'7');assert.equal(retained.action.enabled,true);
 assert.deepEqual(f.state.privateReads.map(row=>row.name),['preference_head']);assert.equal((await f.app.cancelPrepared(prepared.intentId)).status,'cancelled');
});
test('uncertain preference submit keeps durable fence across replacement without another send',async()=>{
 const f=fixture(),p=await f.app.prepare({type:'read-marker',expectedRevision:'0',thread:'42',throughBlock:'10'});f.state.failSend=true;
 await assert.rejects(f.app.submitPrepared(p.intentId));assert.equal(f.state.sends,1);const replacement=f.restart();
 assert.equal((await replacement.reconcile(p.intentId)).status,'unknown');
 await assert.rejects(replacement.submitPrepared(p.intentId),{code:'ROLLING_RECOVERY_REQUIRED'});
 await assert.rejects(replacement.prepare({type:'preference',expectedRevision:'1',kind:2,target:'0',enabled:true}),{code:'ROLLING_RECOVERY_REQUIRED'});
 assert.equal(f.state.sends,1);
});
test('head utility returns exact replay format through owner only without fees/journal/public lookup',async()=>{
 const f=fixture();assert.deepEqual(await f.app.readPreferenceHead(),{initialized:false,schema:1,revision:'0',digest:'0'});
 f.state.preferenceHead=preferenceHead(true,1,9007199254740993n,42);const head=await f.app.readPreferenceHead();
 assert.deepEqual(head,{initialized:true,schema:1,revision:'9007199254740993',digest:'42'});assert(Object.isFrozen(head));
 assert(f.state.privateReads.every(r=>r.name==='preference_head'&&r.args.length===1&&r.args[0]===f.options.accountSession.owner));
 assert.equal(f.state.estimates,0);assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
});
test('head read rejects inconsistent absence, schema, revision overflow and malformed utility output',async()=>{
 const cases=[preferenceHead(false,1,1,0),preferenceHead(false,1,0,1),preferenceHead(true,1,0,1),preferenceHead(true,1,1,0),preferenceHead(true,2,1,2),
  {initialized:true,schema:1n,revision:1n<<64n,digest:1n},{initialized:false,schema:1n,revision:0n,digest:0n,owner:hex(3)},undefined,null,[],
  {initialized:0,schema:1n,revision:0n,digest:0n}];
 for(const record of cases){const f=fixture();f.state.preferenceHead=record;await assert.rejects(f.app.readPreferenceHead());assert.equal(f.values.size,0);assert.equal(f.state.sends,0);}
});
test('head utility failures preserve errors and never masquerade as no preferences',async()=>{
 const f=fixture(),error=Object.assign(Error('Labelled unavailable scoped NHK'),{code:'BB_TRUSTED_NODE_UNAVAILABLE'});f.state.preferenceHeadError=error;
 await assert.rejects(f.app.readPreferenceHead(),e=>e===error);assert.equal(f.state.privateReads.length,1);assert.equal(f.values.size,0);
 await assert.rejects(createRollingApplication({}).readPreferenceHead(),{code:'ROLLING_LOCKED'});
});
test('account change during contract acquisition prevents personalized head read',async()=>{
 const f=fixture(),original=f.options.sdk.Contract.at;f.options.sdk.Contract.at=async()=>{f.options.accountSession.owner=new AztecAddress(new Fr(4n));return original();};
 await assert.rejects(f.app.readPreferenceHead(),{code:'ROLLING_CONTEXT_CHANGED'});assert.equal(f.state.privateReads.length,0);
});
test('head read is exclusive and account change during utility prevents returning old private state',async()=>{
 const f=fixture();let release,entered;const gate=new Promise(r=>release=r),active=new Promise(r=>entered=r);
 f.state.beforePreferenceHead=async()=>{entered();await gate;};const pending=f.app.readPreferenceHead();await active;
 await assert.rejects(f.app.readPreferenceHead(),{code:'ROLLING_BUSY'});f.options.accountSession.owner=new AztecAddress(new Fr(4n));release();
 await assert.rejects(pending,{code:'ROLLING_CONTEXT_CHANGED'});assert.equal(f.state.privateReads.length,1);assert.equal(f.values.size,0);
});
test('preference and read-marker initial simulation errors propagate without intent or send',async()=>{
 for(const action of [{type:'preference',expectedRevision:'0',kind:2,target:'0',enabled:true},{type:'read-marker',expectedRevision:'0',thread:'1',throughBlock:'1'}]){
  const f=fixture(),error=Error('Labelled constrained preference failure');f.state.preferenceError=error;
  await assert.rejects(f.app.prepare(action),e=>e===error);assert.equal(f.state.estimates,1);assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
 }
});

// Actual SDK signed-transaction serialization + encrypted CAS records; the proof,
// receipts, fork and private utility head below are labelled chain doubles.
async function replacementFixture({marker=false,initialCrash=false,action:requestedAction,base}={}){
 const f=base??fixture(),node=f.options.accountSession.node,receipts=new Map(),validations=new Map(),transactions=[];
 const initial=marker?{initialized:true,schema:1,revision:'1',digest:'11'}:{initialized:false,schema:1,revision:'0',digest:'0'};
 f.state.preferenceHead=preferenceHead(initial.initialized,1,initial.revision,initial.digest);
 node.getTxReceipt=async hash=>receipts.get(String(hash))??{txHash:hash,status:'dropped'};
 node.isValidTx=async tx=>validations.get(String(tx.getTxHash()))??{result:'invalid',reason:['Block header not found']};
 node.getBlock=async()=>({hash:hex(42)});let markerHash=hex(43);
 node.getBlockData=async height=>({header:{globalVariables:{blockNumber:height==='checkpointed'?1:height}},blockHash:height===10?markerHash:hex(42)});
 f.options.accountSession.wallet.pxe.sync=async()=>{f.state.syncs=(f.state.syncs??0)+1;};
 const scope={account:hex(3),chainId:'31337',version:'1',rollup:'0x'+'11'.repeat(20),board:hex(1),portal:'0x'+'22'.repeat(20)};
 const newJournal=()=>createL2Journal({storage:f.options.privateStore,walletSecret:hex(8),walletSalt:'0',scope,Tx,node,waitOptions:{timeoutMs:1000,readTimeoutMs:1000,intervalMs:1},contextGuard:f.options.contextGuard});
 f.options.accountSession.journal=await newJournal();
 f.options.accountSession.wallet.sendTx=async(_,opts)=>{
  const journal=f.options.accountSession.journal;journal.setOperation(opts.journalOperation);const prior=await journal.assertCanStart();
  const tx=Tx.random({randomProof:true});transactions.push(tx);await journal.prepare(tx,prior);
  if(f.state.beforeSubmit)await f.state.beforeSubmit(tx);
  if(f.state.crashAfterPrepare)throw Error('Labelled crash after journal prepare');
  if(opts.beforeSubmit)await opts.beforeSubmit(String(tx.getTxHash()));
  f.state.sends++;const receipt={txHash:tx.getTxHash(),status:'checkpointed',blockNumber:1,blockHash:hex(42),executionResult:'success',transactionFee:3n};
  receipts.set(String(tx.getTxHash()),receipt);journal.confirmed(receipt);
  f.state.preferenceHead=preferenceHead(true,1,BigInt(initial.revision)+1n,99);
  return {receipt};
 };
 node.sendTx=async tx=>{
  f.state.sends++;(f.state.resumedBytes??=[]).push(Buffer.from(tx.toBuffer()).toString('hex'));
  const receipt={txHash:tx.getTxHash(),status:'checkpointed',blockNumber:1,blockHash:hex(42),executionResult:'success',transactionFee:3n};
  receipts.set(String(tx.getTxHash()),receipt);f.state.preferenceHead=preferenceHead(true,1,BigInt(initial.revision)+1n,99);
 };
 f.app=f.restart();const action=requestedAction??(marker?{type:'read-marker',expectedRevision:'1',thread:'42',throughBlock:'10'}:{type:'preference',expectedRevision:'0',kind:1,target:'42',enabled:true});
 const prepared=await f.app.prepare(action);let confirmed;
 if(initialCrash){f.state.crashAfterPrepare=true;f.state.beforeSubmit=async tx=>validations.set(String(tx.getTxHash()),{result:'valid'});await assert.rejects(f.app.submitPrepared(prepared.intentId),/Labelled crash/);}
 else confirmed=await f.app.submitPrepared(prepared.intentId);
 const originalHash=String(transactions[0].getTxHash());
 function fork(){receipts.delete(originalHash);f.state.preferenceHead=preferenceHead(initial.initialized,1,initial.revision,initial.digest);markerHash=hex(44);}
 async function reopen(){f.options.accountSession.journal=await newJournal();f.app=f.restart();return f.app;}
 const review=()=>({expectedTxHash:originalHash,...(['preference','read-marker'].includes(action.type)?{expectedHead:{...initial}}:{}),...(marker?{expectedMarkerHash:markerHash}:{})});
 return {...f,prepared,confirmed,initial,originalHash,receipts,validations,transactions,fork,reopen,review};
}
test('replacement inspection is read-only across a fork and retains original canonical fee facts',async()=>{
 const f=await replacementFixture();f.fork();await f.reopen();const before=[...f.values];
 const result=await f.app.inspectRecovery(f.prepared.intentId);assert.deepEqual([...f.values],before);assert.equal(f.state.sends,1);
 assert.equal(result.status,'replacement-available');assert.equal(result.currentTxHash,f.originalHash);assert.deepEqual(result.head,f.initial);
 assert.deepEqual(result.inclusionHistory,[{txHash:f.originalHash,inclusions:[{blockNumber:1,blockHash:hex(42),executionResult:'success',transactionFee:'3'}]}]);
 result.inclusionHistory[0].inclusions[0].transactionFee='999';assert.equal((await f.app.inspectRecovery(f.prepared.intentId)).inclusionHistory[0].inclusions[0].transactionFee,'3');
});
for(const marker of [false,true])test(`explicit replacement preserves immutable ${marker?'marker':'initial preference'} and renews fee consent`,async()=>{
 const f=await replacementFixture({marker});f.fork();await f.reopen();f.state.fee=12n;
 const proposed=await f.app.prepareReplacement(f.prepared.intentId,f.review());assert.equal(f.state.sends,1);assert.equal(proposed.status,'replacement-prepared');assert.equal(proposed.maximumFee,'10');assert.equal(proposed.replacementReview.maximumFee,'12');
 assert.deepEqual(proposed.action,f.prepared.action);assert.equal(proposed.nonce,f.prepared.nonce);assert.equal(proposed.intentId,f.prepared.intentId);
 await f.reopen();const complete=await f.app.submitPrepared(proposed.intentId);assert.equal(complete.status,'confirmed');assert.equal(f.state.sends,2);assert.equal(f.state.syncs,1);
 const report=await f.app.inspectRecovery(proposed.intentId);assert.equal(report.status,'canonical');assert.equal(report.inclusionHistory.length,2);assert.equal(report.inclusionHistory[0].txHash,f.originalHash);assert.equal(report.inclusionHistory[1].txHash,complete.txHash);
 assert.deepEqual(complete.action,f.prepared.action);assert.equal(complete.nonce,f.prepared.nonce);
});
test('marker replacement requires explicit same-height new canonical hash and retains original context',async()=>{
 const f=await replacementFixture({marker:true});f.fork();await f.reopen();const snapshot=await f.app.inspectRecovery(f.prepared.intentId);
 assert.deepEqual(snapshot.originalMarker,{throughBlock:'10',blockHash:hex(43)});assert.deepEqual(snapshot.marker,{throughBlock:'10',blockHash:hex(44)});
 await assert.rejects(f.app.prepareReplacement(f.prepared.intentId,{...f.review(),expectedMarkerHash:hex(43)}),{code:'ROLLING_RECOVERY_CONTEXT_CHANGED'});
 const {expectedMarkerHash,...omitted}=f.review();await assert.rejects(f.app.prepareReplacement(f.prepared.intentId,omitted),{code:'ROLLING_RECOVERY_CONTEXT_CHANGED'});assert.equal(f.state.sends,1);
});
for(const reason of ['pending','unknown','canonical','head-advanced','wrong-head','wrong-hash'])test(`replacement fences ${reason} without a new proof or send`,async()=>{
 const f=await replacementFixture();f.fork();await f.reopen();const input=f.review();
 if(reason==='pending')f.receipts.set(f.originalHash,{txHash:f.originalHash,status:'pending'});
 if(reason==='unknown')f.validations.set(f.originalHash,{result:'invalid',reason:['Existing nullifier']});
 if(reason==='canonical')f.receipts.set(f.originalHash,{txHash:f.originalHash,status:'checkpointed',blockNumber:1,blockHash:hex(42),executionResult:'success',transactionFee:3n});
 if(reason==='head-advanced')f.state.preferenceHead=preferenceHead(true,1,1,99);
 if(reason==='wrong-head')input.expectedHead={initialized:false,schema:1,revision:'0',digest:'1'};
 if(reason==='wrong-hash')input.expectedTxHash=hex(123);
 const before=f.state.estimates;await assert.rejects(f.app.prepareReplacement(f.prepared.intentId,input));assert.equal(f.state.estimates,before);assert.equal(f.transactions.length,1);assert.equal(f.state.sends,1);
});
test('replacement fee growth needs renewed explicit review, not silent higher spending',async()=>{
 const f=await replacementFixture();f.fork();await f.reopen();await f.app.prepareReplacement(f.prepared.intentId,f.review());f.state.fee=11n;
 await assert.rejects(f.app.submitPrepared(f.prepared.intentId),{code:'ROLLING_FEE_CHANGED'});assert.equal(f.state.sends,1);
 const renewed=await f.app.prepareReplacement(f.prepared.intentId,f.review());assert.equal(renewed.replacementReview.maximumFee,'11');assert.equal(renewed.maximumFee,'10');await f.app.submitPrepared(renewed.intentId);assert.equal(f.state.sends,2);
});
for(const failure of ['head','marker','predecessor','account'])test(`replacement beforeSubmit rechecks ${failure} after proving and keeps signed evidence`,async()=>{
 const f=await replacementFixture({marker:failure==='marker'});f.fork();await f.reopen();await f.app.prepareReplacement(f.prepared.intentId,f.review());
 f.state.beforeSubmit=async()=>{if(failure==='head')f.state.preferenceHead=preferenceHead(true,1,7,77);if(failure==='marker')f.options.accountSession.node.getBlockData=async height=>({header:{globalVariables:{blockNumber:height}},blockHash:hex(45)});if(failure==='predecessor')f.receipts.set(f.originalHash,{txHash:f.originalHash,status:'pending'});if(failure==='account')f.state.guard=false;};
 await assert.rejects(f.app.submitPrepared(f.prepared.intentId));assert.equal(f.state.sends,1);assert.equal(f.transactions.length,2);
});
test('crash after replacement journal prepare stays unknown and cannot automatically reprove or resend',async()=>{
 const f=await replacementFixture();f.fork();await f.reopen();await f.app.prepareReplacement(f.prepared.intentId,f.review());f.state.crashAfterPrepare=true;
 f.state.beforeSubmit=async tx=>f.validations.set(String(tx.getTxHash()),{result:'valid'});
 await assert.rejects(f.app.submitPrepared(f.prepared.intentId));await f.reopen();const report=await f.app.inspectRecovery(f.prepared.intentId);assert.equal(report.status,'unknown');assert.equal(report.attempts.length,2);
 await assert.rejects(f.app.submitPrepared(f.prepared.intentId));await assert.rejects(f.app.prepareReplacement(f.prepared.intentId,{...f.review(),expectedTxHash:report.currentTxHash}));assert.equal(f.transactions.length,2);assert.equal(f.state.sends,1);
});
test('replacement review rejects accessor options before private work and snapshots data before awaiting',async()=>{
 const f=await replacementFixture();f.fork();await f.reopen();let reads=0;
 await assert.rejects(f.app.prepareReplacement(f.prepared.intentId,{...f.review(),get expectedTxHash(){reads++;throw Error('private');}}),{code:'ROLLING_INVALID_ACTION'});assert.equal(reads,0);
 const input=f.review(),guard=f.options.contextGuard;f.options.contextGuard=async()=>{input.expectedHead.revision='99';return guard();};
 const app=f.restart();const result=await app.prepareReplacement(f.prepared.intentId,input);assert.equal(result.replacementReview.head.revision,'0');
});
test('replacement option proxies cannot expose arbitrary diagnostic errors',async()=>{
 const f=fixture(),input=new Proxy({},{getOwnPropertyDescriptor(){throw Error('PRIVATE_SENTINEL');}});
 await assert.rejects(f.app.prepareReplacement(hex(1),input),error=>error.code==='ROLLING_INVALID_ACTION'&&!error.message.includes('PRIVATE_SENTINEL'));
});
test('ordinary preference confirmation retains fee facts once, and missing fees fail closed',async()=>{
 const f=await replacementFixture();const before=await f.app.inspectRecovery(f.prepared.intentId);await f.app.reconcile(f.prepared.intentId);const after=await f.app.inspectRecovery(f.prepared.intentId);assert.deepEqual(before.inclusionHistory,after.inclusionHistory);
 const g=fixture(),prepared=await g.app.prepare({type:'preference',expectedRevision:'0',kind:1,target:'42',enabled:true}),send=g.options.accountSession.wallet.sendTx;
 g.options.accountSession.wallet.sendTx=async(...args)=>{const result=await send(...args);delete g.state.outcome.receipt.transactionFee;return result;};
 await assert.rejects(g.app.submitPrepared(prepared.intentId),{code:'ROLLING_INVALID_RESPONSE'});assert.equal(g.state.sends,1);
 await assert.rejects(g.app.submitPrepared(prepared.intentId),{code:'ROLLING_RECOVERY_REQUIRED'});assert.equal(g.state.sends,1);
});
test('failed replacement review CAS preserves original ciphertext and inclusion facts',async()=>{
 const f=await replacementFixture();f.fork();await f.reopen();const before=[...f.values];f.state.failCAS=true;
 await assert.rejects(f.app.prepareReplacement(f.prepared.intentId,f.review()),{code:'BB_JOURNAL_INVALID'});assert.deepEqual([...f.values],before);assert.equal(f.transactions.length,1);
 f.state.failCAS=false;assert.equal((await f.app.inspectRecovery(f.prepared.intentId)).inclusionHistory[0].inclusions[0].transactionFee,'3');
});
test('account invalidation during recovery head lookup prevents disclosure and review writes',async()=>{
 const f=await replacementFixture();f.fork();await f.reopen();const before=[...f.values];f.state.beforePreferenceHead=async()=>{f.state.guard=false;};
 await assert.rejects(f.app.inspectRecovery(f.prepared.intentId));assert.deepEqual([...f.values],before);assert.equal(f.state.sends,1);
});
test('replacement inspection attributes a canonical predecessor without naming current candidate winner',async()=>{
 const f=await replacementFixture();f.fork();await f.reopen();await f.app.prepareReplacement(f.prepared.intentId,f.review());f.state.crashAfterPrepare=true;
 await assert.rejects(f.app.submitPrepared(f.prepared.intentId));const latest=String(f.transactions[1].getTxHash());
 f.receipts.set(f.originalHash,{txHash:f.originalHash,status:'checkpointed',blockNumber:1,blockHash:hex(42),executionResult:'success',transactionFee:3n});
 const report=await f.app.inspectRecovery(f.prepared.intentId);assert.equal(report.status,'canonical');assert.equal(report.currentTxHash,latest);assert.equal(report.attempts.find(row=>row.txHash===f.originalHash).status,'canonical');assert.notEqual(report.attempts.find(row=>row.txHash===latest).status,'canonical');
 await assert.rejects(f.app.prepareReplacement(f.prepared.intentId,{...f.review(),expectedTxHash:latest}));assert.equal(f.state.sends,1);
});
test('reopened account and inspection summaries restore detached replacement review and its exact ceiling',async()=>{
 const f=await replacementFixture();f.fork();await f.reopen();f.state.fee=12n;
 const proposed=await f.app.prepareReplacement(f.prepared.intentId,f.review());await f.reopen();
 const account=await f.app.readAccountStatus();assert.equal(account.status,'recovering');assert.equal(account.intent.status,'replacement-prepared');assert.deepEqual(account.intent.replacementReview,proposed.replacementReview);
 assert.equal(account.intent.maximumFee,'10');assert.deepEqual(account.intent.action,f.prepared.action);assert.equal(account.intent.nonce,f.prepared.nonce);
 account.intent.replacementReview.maximumFee='999';account.intent.replacementReview.head.revision='88';
 const inspected=await f.app.inspectRecovery(f.prepared.intentId);assert.deepEqual(inspected.intent.replacementReview,proposed.replacementReview);inspected.intent.replacementReview.maximumFee='777';
 assert.deepEqual((await f.app.readAccountStatus()).intent.replacementReview,proposed.replacementReview);
 f.state.fee=13n;await assert.rejects(f.app.submitPrepared(f.prepared.intentId),{code:'ROLLING_FEE_CHANGED'});assert.equal(f.state.sends,1);
 f.state.fee=12n;const confirmed=await f.app.submitPrepared(f.prepared.intentId);assert.equal(confirmed.status,'confirmed');assert.equal(confirmed.replacementReview.maximumFee,'12');assert.equal(confirmed.maximumFee,'10');assert.equal(f.state.sends,2);
});
test('same revision with a different authenticated preference digest is context-changed, not replacement authority',async()=>{
 const f=await replacementFixture({marker:true});f.fork();await f.reopen();f.state.preferenceHead=preferenceHead(true,1,1,12);
 const changed={...f.review(),expectedHead:{initialized:true,schema:1,revision:'1',digest:'12'}};
 const result=await f.app.inspectRecovery(f.prepared.intentId);assert.equal(result.status,'context-changed');
 await assert.rejects(f.app.prepareReplacement(f.prepared.intentId,changed),{code:'ROLLING_RECOVERY_REQUIRED'});assert.equal(f.state.sends,1);assert.equal(f.transactions.length,1);
});
test('initial preference preparation binds the full guarded head and refuses stale expected revision before fees',async()=>{
 const f=fixture();f.state.preferenceHead=preferenceHead(true,1,2,22);
 await assert.rejects(f.app.prepare({type:'preference',expectedRevision:'1',kind:1,target:'42',enabled:true}),{code:'ROLLING_RECOVERY_CONTEXT_CHANGED'});
 assert.equal(f.state.estimates,0);assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
 const g=await replacementFixture({marker:true});g.fork();await g.reopen();const snapshot=await g.app.inspectRecovery(g.prepared.intentId);assert.deepEqual(snapshot.originalPreferenceHead,g.initial);
 snapshot.originalPreferenceHead.digest='999';assert.deepEqual((await g.app.inspectRecovery(g.prepared.intentId)).originalPreferenceHead,g.initial);
});


// Exact saved-byte recovery: real SDK Tx serialization + AEAD journals, labelled
// node/proof doubles. No genuine transaction or fork acceptance is claimed.
async function savedResumeFixture({marker=false,replacement=false}={}){
 const f=await replacementFixture({marker,initialCrash:!replacement});
 if(replacement){f.fork();await f.reopen();f.state.fee=12n;await f.app.prepareReplacement(f.prepared.intentId,f.review());
  f.state.crashAfterPrepare=true;f.state.beforeSubmit=async tx=>f.validations.set(String(tx.getTxHash()),{result:'valid'});
  await assert.rejects(f.app.submitPrepared(f.prepared.intentId),/Labelled crash/);
 }
 await f.reopen();return {...f,hash:String(f.transactions.at(-1).getTxHash())};
}
for(const marker of [false,true])for(const replacement of [false,true])test(`saved-byte ${replacement?'replacement':'original'} ${marker?'marker':'preference'} resumes once after restart without estimate or proof`,async()=>{
 const f=await savedResumeFixture({marker,replacement}),id=f.prepared.intentId,before=[...f.values],estimates=f.state.estimates,proofs=f.transactions.length,sends=f.state.sends;
 const inspection=await f.app.inspectRecovery(id);assert.deepEqual([...f.values],before);assert.equal(f.state.sends,sends);
 assert.equal(inspection.exactResume.status,'resumable');assert.equal(inspection.exactResume.txHash,f.hash);
 assert.equal(inspection.exactResume.feeSource,replacement?'replacement':'original');assert.equal(inspection.exactResume.maximumFee,replacement?'12':'10');
 assert.equal(inspection.intent.maximumFee,'10');assert.deepEqual(inspection.intent.inclusionHistory,inspection.inclusionHistory);
 inspection.exactResume.maximumFee='999';inspection.intent.inclusionHistory.length=0;
 const restored=await f.app.readAccountStatus();assert.equal(restored.intent.maximumFee,'10');assert.equal(restored.intent.inclusionHistory.length,replacement?1:0);
 const result=await f.app.resumeSaved(id,{expectedTxHash:f.hash});assert.equal(result.status,'confirmed');assert.equal(result.txHash,f.hash);
 assert.deepEqual(result.action,f.prepared.action);assert.equal(result.nonce,f.prepared.nonce);assert.equal(result.maximumFee,'10');
 assert.equal(f.state.sends,sends+1);assert.equal(f.state.estimates,estimates);assert.equal(f.transactions.length,proofs);
 assert.deepEqual(f.state.resumedBytes,[Buffer.from(f.transactions.at(-1).toBuffer()).toString('hex')]);
 assert.equal(result.inclusionHistory.length,replacement?2:1);assert.equal(result.inclusionHistory.at(-1).inclusions[0].transactionFee,'3');
 // Canonical reconciliation is read-only at the transport even after its head advanced.
 assert.equal((await f.app.inspectRecovery(id)).exactResume.status,'canonical');
 await f.app.resumeSaved(id,{expectedTxHash:f.hash});assert.equal(f.state.sends,sends+1);
});
for(const state of ['pending','unknown','invalid','head','marker','wrong-hash'])test(`saved-byte recovery fences ${state} without new fees or transport`,async()=>{
 const f=await savedResumeFixture({marker:true}),before=[...f.values],sends=f.state.sends,estimates=f.state.estimates;
 if(state==='pending')f.receipts.set(f.hash,{txHash:f.hash,status:'pending'});
 if(state==='unknown')f.options.accountSession.node.getTxReceipt=async()=>{throw Error('Labelled unavailable');};
 if(state==='invalid')f.validations.set(f.hash,{result:'invalid',reason:['Existing nullifier']});
 if(state==='head')f.state.preferenceHead=preferenceHead(true,1,1,12);
 if(state==='marker')f.options.accountSession.node.getBlockData=async height=>({header:{globalVariables:{blockNumber:height}},blockHash:hex(99)});
 const view=await f.app.inspectRecovery(f.prepared.intentId);if(['head','marker'].includes(state))assert.equal(view.exactResume.status,'context-changed');
 await assert.rejects(f.app.resumeSaved(f.prepared.intentId,{expectedTxHash:state==='wrong-hash'?hex(999):f.hash}));
 assert.equal(f.state.sends,sends);assert.equal(f.state.estimates,estimates);assert.equal(f.transactions.length,1);assert.deepEqual([...f.values],before);
});
test('replacement quote cannot be attributed to unchanged old signed candidate',async()=>{
 const f=await replacementFixture();f.fork();await f.reopen();await f.app.prepareReplacement(f.prepared.intentId,f.review());
 f.validations.set(f.originalHash,{result:'valid'});
 const report=await f.app.inspectRecovery(f.prepared.intentId);assert.equal(report.exactResume.status,'unknown');assert.equal(report.exactResume.feeSource,null);assert.equal(report.exactResume.maximumFee,null);
 await assert.rejects(f.app.resumeSaved(f.prepared.intentId,{expectedTxHash:f.originalHash}),{code:'ROLLING_RECOVERY_REQUIRED'});assert.equal(f.state.sends,1);
});
for(const failure of ['head','marker','account','ciphertext'])test(`saved-byte beforeSubmit revalidates ${failure} after synchronization`,async()=>{
 const f=await savedResumeFixture({marker:true}),original=f.options.accountSession.wallet.pxe.sync;let syncs=0;
 f.options.accountSession.wallet.pxe.sync=async()=>{await original();if(++syncs===2){
  if(failure==='head')f.state.preferenceHead=preferenceHead(true,1,1,12);
  if(failure==='marker')f.options.accountSession.node.getBlockData=async height=>({header:{globalVariables:{blockNumber:height}},blockHash:hex(99)});
  if(failure==='account')f.state.guard=false;
  if(failure==='ciphertext'){for(const [key,value] of f.values)f.values.set(key,value+'x');}
 }};
 await assert.rejects(f.app.resumeSaved(f.prepared.intentId,{expectedTxHash:f.hash}));assert.equal(syncs,2);assert.equal(f.state.sends,0);
});
test('saved-byte options reject accessors and snapshot exact hash before asynchronous context checks',async()=>{
 const f=await savedResumeFixture();let reads=0;await assert.rejects(f.app.resumeSaved(f.prepared.intentId,{get expectedTxHash(){reads++;throw Error('PRIVATE_SENTINEL');}}),{code:'ROLLING_INVALID_ACTION'});assert.equal(reads,0);
 const input={expectedTxHash:f.hash},guard=f.options.contextGuard;f.options.contextGuard=async()=>{input.expectedTxHash=hex(999);await guard();};f.app=f.restart();
 await f.app.resumeSaved(f.prepared.intentId,input);assert.equal(f.state.sends,1);
});
test('saved-byte recovery owns the busy interval and cannot be concurrently confirmed',async()=>{
 const f=await savedResumeFixture();let release,entered;const gate=new Promise(r=>release=r),active=new Promise(r=>entered=r);
 f.options.accountSession.wallet.pxe.sync=async()=>{entered();await gate;};
 const pending=f.app.resumeSaved(f.prepared.intentId,{expectedTxHash:f.hash});await active;
 await assert.rejects(f.app.resumeSaved(f.prepared.intentId,{expectedTxHash:f.hash}),{code:'ROLLING_BUSY'});assert.equal(f.state.sends,0);
 release();await pending;assert.equal(f.state.sends,1);
});
test('unknown saved-byte send keeps bytes and intent; read reconciliation never rebroadcasts',async()=>{
 const f=await savedResumeFixture(),before=[...f.values];f.options.accountSession.node.sendTx=async tx=>{f.state.sends++;f.receipts.set(f.hash,{txHash:tx.getTxHash(),status:'pending'});throw Error('Labelled lost acknowledgement');};
 await assert.rejects(f.app.resumeSaved(f.prepared.intentId,{expectedTxHash:f.hash}));assert.equal(f.state.sends,1);assert.deepEqual([...f.values],before);
 await f.reopen();assert.equal((await f.app.reconcile(f.prepared.intentId)).status,'unknown');assert.equal((await f.app.inspectRecovery(f.prepared.intentId)).exactResume.status,'pending');
 await assert.rejects(f.app.resumeSaved(f.prepared.intentId,{expectedTxHash:f.hash}));assert.equal(f.state.sends,1);
});
test('saved-byte recovery never sends an ordinary action without signed bytes',async()=>{
 const f=fixture(),p=await f.app.prepare({type:'like',post:'5'});
 await assert.rejects(f.app.resumeSaved(p.intentId,{expectedTxHash:hex(77)}),{code:'ROLLING_RECOVERY_REQUIRED'});assert.equal(f.state.sends,0);
});

for(const predecessor of ['pending','unknown','canonical'])test(`saved replacement cannot bypass ${predecessor} predecessor through app recovery`,async()=>{
 const f=await savedResumeFixture({replacement:true}),sends=f.state.sends,estimates=f.state.estimates,before=[...f.values];
 if(predecessor==='pending')f.receipts.set(f.originalHash,{txHash:f.originalHash,status:'pending'});
 if(predecessor==='unknown')f.validations.set(f.originalHash,{result:'invalid',reason:['Existing nullifier']});
 if(predecessor==='canonical')f.receipts.set(f.originalHash,{txHash:f.originalHash,status:'checkpointed',blockNumber:1,blockHash:hex(42),executionResult:'success',transactionFee:3n});
 assert.equal((await f.app.inspectRecovery(f.prepared.intentId)).exactResume.status,'unknown');
 await assert.rejects(f.app.resumeSaved(f.prepared.intentId,{expectedTxHash:f.hash}));
 assert.equal(f.state.sends,sends);assert.equal(f.state.estimates,estimates);assert.deepEqual([...f.values],before);
});

for(const mutation of ['head','marker'])test(`saved-byte late predecessor ${mutation} change prevents broadcast`,async()=>{
 const f=await savedResumeFixture({marker:true,replacement:true}),node=f.options.accountSession.node,original=node.isValidTx;
 let changed=false;
 node.isValidTx=async tx=>{
  const result=await original(tx);
  // After the first app context check, during recover's retained predecessor
  // validation. The final app callback must observe this updated state.
  if(f.state.syncs>=1&&String(tx.getTxHash())===f.originalHash){changed=true;
   if(mutation==='head')f.state.preferenceHead=preferenceHead(true,1,1,999);
   else node.getBlockData=async height=>({header:{globalVariables:{blockNumber:height}},blockHash:hex(999)});
  }
  return result;
 };
 const sends=f.state.sends,estimates=f.state.estimates,proofs=f.transactions.length;
 await assert.rejects(f.app.resumeSaved(f.prepared.intentId,{expectedTxHash:f.hash}),{code:'ROLLING_RECOVERY_CONTEXT_CHANGED'});
 assert.equal(changed,true);assert.equal(f.state.sends,sends);assert.equal(f.state.estimates,estimates);assert.equal(f.transactions.length,proofs);
});

for(const mutation of ['head','marker'])test(`replacement late predecessor ${mutation} change prevents first broadcast`,async()=>{
 const f=await replacementFixture({marker:true});f.fork();await f.reopen();await f.app.prepareReplacement(f.prepared.intentId,f.review());
 const node=f.options.accountSession.node,original=node.isValidTx;let atFinalChecks=false,changed=false;
 f.state.beforeSubmit=async()=>{atFinalChecks=true;};
 node.isValidTx=async tx=>{
  const result=await original(tx);
  if(atFinalChecks&&String(tx.getTxHash())===f.originalHash){changed=true;
   if(mutation==='head')f.state.preferenceHead=preferenceHead(true,1,1,999);
   else node.getBlockData=async height=>({header:{globalVariables:{blockNumber:height}},blockHash:hex(999)});
  }
  return result;
 };
 const sends=f.state.sends;
 await assert.rejects(f.app.submitPrepared(f.prepared.intentId),{code:'ROLLING_RECOVERY_CONTEXT_CHANGED'});
 assert.equal(changed,true);assert.equal(f.state.sends,sends);assert.equal(f.transactions.length,2,'The proved candidate remains in the actual encrypted journal');
 assert.equal((await f.options.accountSession.journal.inspect()).txHash,String(f.transactions[1].getTxHash()));
});

function bokFixture(){
 const f=fixture();f.options.deployment.bok={address:hex(5),operator:hex(6),pluginId:hex(7),artifact:bokArtifact};
 const original=f.options.accountSession.wallet.sendTx;
 f.options.accountSession.wallet.sendTx=async(payload,opts)=>{
  if(f.state.beforeBokSubmit)await f.state.beforeBokSubmit();
  if(opts.beforeSubmit)await opts.beforeSubmit(hex(77));
  const result=await original(payload,opts);
  if(payload.name==='authorize_request'){
   const [id,target,budget]=payload.args;f.state.bokRequestId=id;f.state.bokCredit=1000n-BigInt(budget);
   const abi=bokArtifact.nonDispatchPublicFunctions.find(fn=>fn.name==='request');
   f.state.bokRequest=decodeFromAbi(getFunctionReturnType(abi),[1n,BigInt(target),0n,9999999999n,BigInt(budget),BigInt(budget),0n,0n,0n,0n,0n,0n,0n,0n].map(n=>new Fr(n)));
  }
  return result;
 };
 f.app=f.restart();return f;
}
const bokAction=()=>({type:'bok',deposit:'9',content:'Private Sentinel asks Bok to explain this post.',name:'0',subboard:'0',budget:'400'});
test('Bok uses real two-contract ABI and durable exact draft across separately confirmed fees',async()=>{
 const f=bokFixture();assert.deepEqual(await f.app.readBokStatus(),{available:true,availableCredit:'1000',pluginId:hex(7)});
 const prepared=await f.app.prepare(bokAction());assert.equal(prepared.stage,'bok-authorize');assert.equal(prepared.bok.budget,'400');assert.equal(f.state.sends,0);
 assert.equal(f.state.calls.at(-1).name,'authorize_request');const authArgs=structuredClone(f.state.calls.at(-1).args);
 const authorized=await f.restart().submitPrepared(prepared.intentId);assert.equal(authorized.status,'authorized');assert.equal(f.state.sends,1);
 const status=await f.restart().readAccountStatus();assert.equal(status.status,'recovering');assert.equal(status.intent.status,'authorized');
 await assert.rejects(f.restart().prepare({type:'name',first:'River',last:'Stone'}),{code:'ROLLING_RECOVERY_REQUIRED'});
 const post=await f.restart().prepareBokPost(prepared.intentId);assert.equal(post.stage,'bok-post');assert.notEqual(post.intentId,prepared.intentId);assert.equal(f.state.sends,1);
 const postArgs=f.state.calls.at(-1).args;assert.equal(f.state.calls.at(-1).name,'post_with_bok');assert.equal(postArgs[5],hex(7));assert.equal(postArgs[6],authArgs[0]);
 const draft=postArgs[2],preimage=[1n,31337n,1n,1n,5n,BigInt(draft.subboard),BigInt(draft.parent),BigInt(draft.root_reference),BigInt(draft.kind),BigInt(draft.name_id),BigInt(draft.reference),BigInt(postArgs[1]),BigInt(draft.length),...draft.message.map(BigInt)];
 assert.equal(authArgs[1],String(await poseidon2HashWithSeparator(preimage.map(n=>new Fr(n)),0x52434931)));
 assert.equal(post.bok.authorizationTxHash,hex(77));await assert.rejects(f.app.cancelPrepared(post.intentId),{code:'ROLLING_RECOVERY_REQUIRED'});
 const sent=await f.restart().submitPrepared(post.intentId);assert.equal(sent.status,'confirmed');assert.equal(f.state.sends,2);
 assert.deepEqual(f.state.sent.payload.args,postArgs);assert.equal((await f.restart().reconcile(post.intentId)).status,'confirmed');assert.equal(f.state.sends,2);
 assert([...f.values.values()].every(value=>!value.includes('Private Sentinel')));
});
test('Bok unavailable, disabled or mismatched plugin and insufficient credit never prepare a send',async()=>{
 const absent=fixture();assert.deepEqual(await absent.app.readBokStatus(),{available:false});await assert.rejects(absent.app.prepare(bokAction()),{code:'ROLLING_BOK_UNAVAILABLE'});
 for(const mutate of [f=>f.state.bokEnabled=false,f=>f.state.bokAdapter=8n,f=>f.state.bokCredit=399n]){
  const f=bokFixture();mutate(f);await assert.rejects(f.app.prepare(bokAction()));assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
 }
 for(const budget of ['0','-1','01',(1n<<128n).toString()]){const f=bokFixture();await assert.rejects(f.app.prepare({...bokAction(),budget}));assert.equal(f.state.sends,0);}
});
test('Bok unknown authorization outcome cannot advance or create a replacement request',async()=>{
 const f=bokFixture(),prepared=await f.app.prepare(bokAction());f.state.failSend=true;
 await assert.rejects(f.app.submitPrepared(prepared.intentId));assert.equal(f.state.sends,1);
 await assert.rejects(f.restart().prepareBokPost(prepared.intentId),{code:'ROLLING_RECOVERY_REQUIRED'});
 await assert.rejects(f.restart().prepare(bokAction()),{code:'ROLLING_RECOVERY_REQUIRED'});assert.equal(f.state.sends,1);
});
test('Bok continuation rechecks exact authorization, plugin, credit and fee before effects',async()=>{
 for(const change of ['target','state','plugin','fee']){
  const f=bokFixture(),prepared=await f.app.prepare(bokAction());await f.app.submitPrepared(prepared.intentId);
  if(change==='target')f.state.bokRequest.invocation_hash=new Fr(123);
  if(change==='state')f.state.bokRequest.state=2n;
  if(change==='plugin')f.state.bokEnabled=false;
  if(change==='fee'){
   const post=await f.app.prepareBokPost(prepared.intentId);f.state.fee=11n;
   await assert.rejects(f.app.submitPrepared(post.intentId),{code:'ROLLING_FEE_CHANGED'});
  }else await assert.rejects(f.app.prepareBokPost(prepared.intentId));
  assert.equal(f.state.sends,1);
 }
});

test('Bok final journal before-submit guard rejects late plugin revocation without sending',async()=>{
 const f=bokFixture(),prepared=await f.app.prepare(bokAction());f.state.beforeBokSubmit=async()=>{f.state.bokEnabled=false;};
 await assert.rejects(f.app.submitPrepared(prepared.intentId),{code:'ROLLING_BOK_UNAVAILABLE'});assert.equal(f.state.sends,0);
 assert.equal((await f.restart().readAccountStatus()).status,'recovering');
});

test('Bok authorization loses no exact request on continuation CAS failure or absent canonical outcome',async()=>{
 const f=bokFixture(),prepared=await f.app.prepare(bokAction());await f.app.submitPrepared(prepared.intentId);
 f.state.failCAS=true;await assert.rejects(f.restart().prepareBokPost(prepared.intentId));f.state.failCAS=false;
 assert.equal((await f.restart().readAccountStatus()).intent.intentId,prepared.intentId);assert.equal(f.state.sends,1);
 f.state.outcome={...f.state.outcome,outcome:'unknown'};await assert.rejects(f.restart().prepareBokPost(prepared.intentId),{code:'ROLLING_RECOVERY_REQUIRED'});assert.equal(f.state.sends,1);
});

test('Bok saved authorization and post cannot migrate to a changed adapter, operator or plugin after reopen',async()=>{
 for(const phase of ['prepared','authorized','post'])for(const key of ['address','operator','pluginId']){
  const f=bokFixture();let intent=await f.app.prepare(bokAction());
  if(phase!=='prepared')await f.app.submitPrepared(intent.intentId);
  if(phase==='post')intent=await f.app.prepareBokPost(intent.intentId);
  const before=[...f.values.entries()],sends=f.state.sends;f.options.deployment.bok[key]=hex(99);
  const reopened=f.restart();await assert.rejects(reopened.readAccountStatus(),{code:'ROLLING_CONTEXT_CHANGED'});
  await assert.rejects(reopened.submitPrepared(intent.intentId),{code:'ROLLING_CONTEXT_CHANGED'});
  if(phase==='authorized')await assert.rejects(reopened.prepareBokPost(intent.intentId),{code:'ROLLING_CONTEXT_CHANGED'});
  assert.equal(f.state.sends,sends);assert.deepEqual([...f.values.entries()],before);
 }
});

test('Bok continuation renews policy consent without changing its authorized target',async()=>{
 const f=bokFixture(),auth=await f.app.prepare(bokAction());await f.app.submitPrepared(auth.intentId);f.state.policy=2;
 const post=await f.restart().prepareBokPost(auth.intentId);assert.equal(post.bok.mainPolicyVersion,2);
 assert.equal(f.state.calls.at(-1).args[2].expected_main_policy_version,2);assert.equal(f.state.sends,1);
 await f.app.submitPrepared(post.intentId);assert.equal(f.state.sends,2);
});
test('Bok canonical post revert retains the funded draft across reopen and explicit fee-reviewed retry',async()=>{
 const f=bokFixture(),auth=await f.app.prepare(bokAction());await f.app.submitPrepared(auth.intentId);
 const first=await f.app.prepareBokPost(auth.intentId);await f.app.submitPrepared(first.intentId);const originalArgs=structuredClone(f.state.sent.payload.args);
 f.state.outcome={...f.state.outcome,outcome:'reverted'};const recovered=await f.restart().readAccountStatus();
 assert.equal(recovered.status,'recovering');assert.equal(recovered.intent.status,'bok-post-reverted');
 await assert.rejects(f.restart().prepare({type:'name',first:'River',last:'Stone'}),{code:'ROLLING_RECOVERY_REQUIRED'});
 await assert.rejects(f.restart().cancelPrepared(first.intentId),{code:'ROLLING_RECOVERY_REQUIRED'});
 f.state.policy=3;f.state.fee=12n;const retry=await f.restart().prepareBokPost(first.intentId);
 assert.equal(f.state.sends,2);assert.notEqual(retry.intentId,first.intentId);assert.equal(retry.maximumFee,'12');assert.equal(retry.bok.mainPolicyVersion,3);
 assert.equal(retry.bok.authorizationTxHash,auth.txHash??hex(77));
 const retriedArgs=f.state.calls.at(-1).args;assert.deepEqual(retriedArgs.slice(5),originalArgs.slice(5));
 assert.deepEqual({...retriedArgs[2],expected_main_policy_version:1},originalArgs[2]);
 await f.restart().submitPrepared(retry.intentId);assert.equal(f.state.sends,3);assert.equal(f.state.sent.payload.name,'post_with_bok');
 assert.equal(f.state.bokCredit,600n);
});
test('Bok post recovery never replaces unknown, nonfinal or changed funded requests',async()=>{
 for(const mutation of ['unknown','nonfinal','spent','scope']){
  const f=bokFixture(),auth=await f.app.prepare(bokAction());await f.app.submitPrepared(auth.intentId);const post=await f.app.prepareBokPost(auth.intentId);await f.app.submitPrepared(post.intentId);
  f.state.outcome={...f.state.outcome,outcome:mutation==='unknown'?'unknown':'reverted'};
  if(mutation==='nonfinal')f.options.accountSession.journal.assertCanStart=async()=>{throw Error('Original journal finality guard');};
  if(mutation==='spent')f.state.bokRequest.available=0n;
  if(mutation==='scope')f.options.deployment.bok.pluginId=hex(99);
  await assert.rejects(f.restart().prepareBokPost(post.intentId));assert.equal(f.state.sends,2);
  await assert.rejects(f.restart().prepare(bokAction()));assert.equal(f.state.sends,2);
 }
});

function moderatorFixture(){
 const f=fixture(),decode=(name,values)=>decodeFromAbi(getFunctionReturnType([...artifact.functions,...artifact.nonDispatchPublicFunctions].find(fn=>fn.name===name)),values.map(n=>new Fr(n)));
 f.state.moderator=3n;f.state.storageReads=[];f.state.responses={
  get_post:decode('get_post',[1n,0n,0n,8n,1n,0n,0n,9n,0n,10n,0n]),
  subboard_state:decode('subboard_state',[1n,8n,1n,0n,0n]),
  profile_state:decode('profile_state',[1n,8n,10n,2n,9n,100n,100n,100n]),
  avatar_moderation:decode('avatar_moderation',[0n,0n,0n,0n])};
 const node=f.options.accountSession.node;node.getBlockData=async height=>({header:{globalVariables:{blockNumber:height==='checkpointed'?7:height}},blockHash:hex(f.state.reorg&&height!=='checkpointed'?43:42)});
 node.getPublicStorageAt=async(ref,address,slot)=>{f.state.storageReads.push({ref,address:String(address),slot:String(slot)});assert.equal(String(slot),String(new Fr(BigInt(artifact.storageLayout.moderator.slot))));return new Fr(f.state.moderator);};
 const original=f.options.accountSession.wallet.sendTx;f.options.accountSession.wallet.sendTx=async(payload,opts)=>{if(f.state.beforeModeratorSubmit)await f.state.beforeModeratorSubmit();if(opts.beforeSubmit)await opts.beforeSubmit(hex(77));return original(payload,opts);};
 return {...f,decode};
}
const moderatorActions=[{type:'moderate-post',post:'8',reason:'Spam removal'},{type:'moderate-avatar',name:'7',reason:'Unsafe image'},{type:'reject-subboard',subboard:'9',reason:'Violates parent rules'},{type:'set-main-policy',rules:'Keep discussion civil.'}];
test('Moderator actions bind actual public ABI, canonical authority and separately confirmed fees without collateral',async()=>{
 for(const action of moderatorActions){
  const f=moderatorFixture();assert.deepEqual(await f.app.readModeratorStatus(),{authorized:true});const prepared=await f.app.prepare(action);
  assert.equal(prepared.moderation.mainVersion,1);assert.equal(f.state.sends,0);assert.equal(prepared.maximumFee,'10');
  assert(f.state.storageReads.every(row=>row.ref.hash===hex(42)&&row.address===hex(1)));
  assert(!f.state.privateReads.some(row=>row.name==='get_screen_hints'));const expected=({ 'moderate-post':'remove_post','moderate-avatar':'remove_avatar','reject-subboard':'reject_subboard','set-main-policy':'set_main_policy'})[action.type];
  assert.equal(f.state.calls.at(-1).name,expected);const sent=await f.restart().submitPrepared(prepared.intentId);assert.equal(sent.status,'confirmed');assert.equal(f.state.sends,1);assert.equal(f.state.sent.payload.name,expected);
  assert.equal((await f.restart().reconcile(prepared.intentId)).status,'confirmed');assert.equal(f.state.sends,1);
 }
});
test('Moderator capability rejects unauthorized, malformed and reorged storage without preparing effects',async()=>{
 for(const kind of ['unauthorized','zero','reorg','throw']){
  const f=moderatorFixture();if(kind==='unauthorized')f.state.moderator=99n;if(kind==='zero')f.state.moderator=0n;if(kind==='reorg')f.state.reorg=true;if(kind==='throw')f.options.accountSession.node.getPublicStorageAt=async()=>{throw 0;};
  if(kind==='unauthorized')assert.deepEqual(await f.app.readModeratorStatus(),{authorized:false});else await assert.rejects(f.app.readModeratorStatus());
  for(const action of moderatorActions)await assert.rejects(f.app.prepare(action));assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
 }
});
test('Moderator reviewed policy, target and authority are rechecked before submission and after preparation',async()=>{
 for(const when of ['before-submit','before-forward'])for(const kind of ['authority','policy','post','avatar','board']){
  const f=moderatorFixture(),action=moderatorActions[kind==='avatar'?1:kind==='board'?2:0],prepared=await f.app.prepare(action);
  const mutate=()=>{if(kind==='authority')f.state.moderator=99n;else if(kind==='policy')f.state.policy=2;else if(kind==='post')f.state.responses.get_post[2]=1n;else if(kind==='avatar')f.state.responses.profile_state.avatar_version=3n;else f.state.responses.subboard_state[3]=true;};
  if(when==='before-submit')mutate();else f.state.beforeModeratorSubmit=mutate;
  await assert.rejects(f.restart().submitPrepared(prepared.intentId));assert.equal(f.state.sends,0);
 }
});
test('Moderator immutable author semantics and bounded exact reasons reject invalid actions',async()=>{
 for(const action of [{type:'hide-post',post:'8'},...moderatorActions.map(a=>({...a,owner:hex(3)})),{...moderatorActions[0],post:'0'},{...moderatorActions[0],reason:'a'.repeat(218)},{...moderatorActions[0],reason:'x\0y'},{...moderatorActions[3],rules:'a'.repeat(993)}]){
  const f=moderatorFixture();await assert.rejects(f.app.prepare(action));assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
 }
});
test('Moderator unknown send preserves original journal operation and forbids a second action',async()=>{
 const f=moderatorFixture(),prepared=await f.app.prepare(moderatorActions[0]);f.state.failSend=true;await assert.rejects(f.app.submitPrepared(prepared.intentId));
 await assert.rejects(f.restart().prepare(moderatorActions[1]));assert.equal((await f.restart().reconcile(prepared.intentId)).status,'unknown');assert.equal(f.state.sends,1);
});

// Application boundaries use explicit receipt/estimation doubles below; actual ABI,
// encrypted workflow CAS, SDK BatchCall and payment payload are retained. This is
// not a live bridge/payment acceptance claim (the receipt module has its own actual
// SDK hash/witness tests). No public/legacy Bok client is supplied.
function topUpFixture(kind='private-fee'){
 const f=fundingFixture();f.options.sdk.BatchCall=BatchCall;
 const bridge={amount:'200',salt:hex(90),leafIndex:'3'},retained={recipientSalt:hex(91),bridgeSecret:hex(92),
  bokScope:{...f.options.deployment.network,portal:'0x'+'77'.repeat(20),recipient:hex(5),token:'0x'+'88'.repeat(20)}};
 f.options.deployment.bok={address:hex(5),operator:hex(6),pluginId:hex(7),artifact:bokArtifact};
 f.options.funding.loadAggregate=async()=>f.state.missingContext?null:kind==='bok'?retained:null;
 f.options.accountSession.node.getNodeInfo=async()=>({l1ContractAddresses:{feeJuicePortalAddress:'0x'+'55'.repeat(20),feeJuiceAddress:'0x'+'66'.repeat(20)}});
 f.options.sdk.prepareFundingClaim=async input=>{
  f.state.claimReads.push(input);await input.contextGuard();assert.equal(input.aggregateIntent,undefined);assert.equal(input.aggregateCustody,undefined);
  if(f.state.claimError)throw Object.assign(Error('Unavailable canonical receipt'),{code:'ROLLING_FUNDING_REORG'});
  if(input.kind==='private-fee')return {status:f.state.claimStatus??'claim-ready',claim:{contract:hex(2),kind:'private-fee-bridge',bridgeClaim:{...bridge,salt:f.state.changedClaim?hex(99):bridge.salt}}};
  assert.equal(input.kind,'bok');assert.deepEqual(input.secrets,{recipientSalt:hex(91),bridgeSecret:hex(92)});assert.deepEqual(input.scope,retained.bokScope);
  return {status:f.state.claimStatus??'claim-ready',claim:{contract:hex(5),method:'claim',args:['300',hex(91),f.state.changedClaim?hex(99):hex(92),'4']}};
 };
 f.state.payments=[];f.options.sdk.preparePrivateFeePayment=async input=>{f.state.payments.push(input);return {availableCredit:200n};};
 return {...f,retained,bridge,action:{type:kind==='bok'?'claim-bok':'claim-private-fee',receipt:f.receipt}};
}
for(const kind of ['private-fee','bok'])test(`top-up ${kind} prepares separately with active collateral and one confirmed private journal send`,async()=>{
 const f=topUpFixture(kind),app=f.restart(),prepared=await app.prepare(f.action);
 assert.equal(f.state.sends,0);assert.equal(f.state.estimates,1);assert.equal(f.state.claimReads.length,1);
 for(const value of [hex(90),hex(91),hex(92)]){assert(!JSON.stringify(prepared).includes(value));assert([...f.values.values()].every(row=>!row.includes(value)));}
 const result=await f.restart().submitPrepared(prepared.intentId);assert.equal(result.status,'confirmed');assert.equal(f.state.sends,1);assert.equal(f.state.claimReads.length,2);
 assert.equal((await f.restart().reconcile(prepared.intentId)).status,'confirmed');await assert.rejects(f.restart().submitPrepared(prepared.intentId),{code:'ROLLING_RECOVERY_REQUIRED'});assert.equal(f.state.sends,1);
 assert(f.state.claimReads.every(row=>row.kind===kind));assert(!f.state.calls.some(call=>['withdraw','claim_deposit'].includes(call.name)));
 if(kind==='bok')assert.equal(f.state.sent.payload.name,'claim');else{assert(f.state.sent.payload instanceof BatchCall);assert(f.state.payments.every(p=>p.claim.salt===hex(90)));}
});
test('top-up fee-only actual SDK empty batch merges only existing FeeJuice claim and mint-and-pay calls',async()=>{
 const f=topUpFixture(),prepared=await f.restart().prepare(f.action),interaction=f.state.calls[0];assert(interaction instanceof BatchCall);
 const application=await interaction.request();assert.equal(application.calls.length,0);
 const payer=AztecAddress.fromBigIntUnsafe(2n),salt=new Fr(90),secret=await derivePrivateFeeBridgeSecret({salt,owner:f.options.accountSession.owner});
 const payment=new PrivateMintAndPayFeePaymentMethod(payer,{amount:200n,secret,salt,leafIndex:new Fr(3)},10n);
 const payload=mergeExecutionPayloads([await payment.getExecutionPayload(),application]);
 assert.deepEqual(payload.calls.map(c=>c.name),['claim','mint_and_pay_fee']);assert.equal(payload.calls[0].args[2].toString(),secret.toString());assert.equal(payload.calls[1].to.toString(),hex(2));assert.equal(payload.calls[1].args[0].toString(),hex(200));assert.equal(payload.calls[1].args[3].toString(),hex(10));assert.equal(f.state.sends,0);
 await f.restart().cancelPrepared(prepared.intentId);
});
test('top-up Bok can bootstrap private fees in its existing single claim transaction',async()=>{
 const f=topUpFixture('bok'),action={...f.action,feeReceipt:{...f.receipt,txHash:hex(53)}};
 const prepared=await f.restart().prepare(action);assert.deepEqual(f.state.claimReads.map(x=>x.kind),['bok','private-fee']);
 assert.equal((await f.restart().submitPrepared(prepared.intentId)).status,'confirmed');assert.equal(f.state.sends,1);assert.equal(f.state.sent.payload.name,'claim');assert(f.state.payments.every(p=>p.claim.amount==='200'));
});
for(const kind of ['private-fee','bok'])for(const failure of ['claimError','waiting','changedClaim','fee','context'])test(`top-up ${kind} rejects ${failure} on reopen before durable send`,async()=>{
 const f=topUpFixture(kind),prepared=await f.restart().prepare(f.action),before=[...f.values.values()];
 if(failure==='waiting')f.state.claimStatus='waiting';else if(failure==='fee')f.state.fee=11n;else if(failure==='context')f.options.accountSession.owner=AztecAddress.fromBigIntUnsafe(99n);else f.state[failure]=true;
 await assert.rejects(f.restart().submitPrepared(prepared.intentId));assert.equal(f.state.sends,0);assert.deepEqual([...f.values.values()],before);
});
for(const kind of ['private-fee','bok'])test(`top-up ${kind} preserves unknown submission across restart without another estimation or send`,async()=>{
 const f=topUpFixture(kind),prepared=await f.restart().prepare(f.action);f.state.failSend=true;
 await assert.rejects(f.restart().submitPrepared(prepared.intentId));const count=f.state.estimates;
 assert.equal((await f.restart().reconcile(prepared.intentId)).status,'unknown');await assert.rejects(f.restart().submitPrepared(prepared.intentId),{code:'ROLLING_RECOVERY_REQUIRED'});
 await assert.rejects(f.restart().prepare(f.action),{code:'ROLLING_RECOVERY_REQUIRED'});assert.equal(f.state.sends,1);assert.equal(f.state.estimates,count);
});
test('top-up rejects private action fields, missing Bok custody and unavailable receipt without saving a claim',async()=>{
 for(const kind of ['private-fee','bok']){const f=topUpFixture(kind);await assert.rejects(f.restart().prepare({...f.action,secret:hex(90)}));assert.equal(f.values.size,0);assert.equal(f.state.sends,0);}
 const f=topUpFixture('bok');f.state.missingContext=true;await assert.rejects(f.restart().prepare(f.action),{code:'ROLLING_FUNDING_UNAVAILABLE'});assert.equal(f.values.size,0);
 const g=topUpFixture();g.options.sdk.prepareFundingClaim=verifyFundingClaim;await assert.rejects(g.restart().prepare(g.action),{code:'ROLLING_FUNDING_UNTRUSTED_NODE'});assert.equal(g.values.size,0);assert.equal(g.state.sends,0);
});

function collateralFixture(){const f=fixture();f.options.deployment.privateFee.artifact=bokArtifact;f.options.funding={verifyWithdrawal:async()=>f.state.refunded===true};f.app=f.restart();return f;}
test('RC22 balances page uses owned private utilities, exact zero fee and anchored maturity without public account lookup',async()=>{
 const f=collateralFixture();f.state.bokCredit=0n;const b=await f.app.readBalances();
 assert.equal(b.fee.available,'0');assert.equal(b.fee.withdrawal,'not-supported');assert.equal(b.collateral.deposits[0].amount,'100');assert.equal(b.collateral.deposits[0].eligible,true);assert.equal(b.collateral.nextCursor,null);assert.equal(b.bok,null);
 assert(f.state.privateReads.every(r=>!r.name.includes('public')));assert.equal(f.state.sends,0);
});
test('RC22 collateral reports screening debt and time lock independently and rejects exit preparation',async()=>{
 for(const [screened,last,time,reason]of [[0n,1n,50n,'screening-required'],[1n,1n,101n,'time-locked']]){
  const f=collateralFixture();f.state.responses={get_deposit_info:[1n,9n,100n,BigInt('0x'+'33'.repeat(20)),0n,1n,0n,screened,last,time]};
  assert.equal((await f.app.readBalances()).collateral.deposits[0].reason,reason);
  await assert.rejects(f.app.prepare({type:'withdraw',deposit:'9'}),{code:'ROLLING_WITHDRAWAL_NOT_READY'});assert.equal(f.state.sends,0);
 }
});
test('RC22 balances reject malformed owned deposits, stale anchors and noncontiguous pages',async()=>{
 for(const mode of ['identity','anchor','gap']){const f=collateralFixture();
  if(mode==='identity')f.state.responses={get_deposit_info:Array(10).fill(0n)};
  if(mode==='gap')f.state.responses={get_deposit_ids:[9n,0n,10n,...Array(7).fill(0n)]};
  if(mode==='anchor')f.options.accountSession.node.getBlockData=async()=>({header:{globalVariables:{blockNumber:1}},blockHash:hex(99)});
  await assert.rejects(f.app.readBalances());assert.equal(f.state.sends,0);
 }
});
test('RC22 exit preserves original depositor through encrypted reopen and blocks overwriting until verified refund',async()=>{
 const f=collateralFixture(),review=await f.app.prepare({type:'withdraw',deposit:'9'});assert.equal(review.maximumFee,'10');assert.equal(review.withdrawal.depositor,'0x'+'33'.repeat(20));
 const confirmed=await f.app.submitPrepared(review.intentId);assert.equal(confirmed.status,'confirmed');
 const reopened=f.restart();assert.equal((await reopened.readWithdrawal()).withdrawal.amount,'100');
 await assert.rejects(reopened.prepare({type:'like',post:'1'}),{code:'ROLLING_WITHDRAWAL_RECOVERY_REQUIRED'});
 assert.equal((await reopened.readAccountStatus()).status,'recovering');f.state.refunded=true;
 await reopened.prepare({type:'like',post:'1'});assert.equal(f.state.sends,1);
});
test('RC22 exit submit rechecks private receipt and never gates withdrawal on rejected public policy',async()=>{
 const f=collateralFixture();f.state.policyReadError=Error('rejected');const review=await f.app.prepare({type:'withdraw',deposit:'9'});
 f.state.responses={get_deposit_info:[1n,9n,101n,BigInt('0x'+'33'.repeat(20)),0n,0n,0n,0n,0n,50n]};
 await assert.rejects(f.app.submitPrepared(review.intentId),{code:'ROLLING_WITHDRAWAL_NOT_READY'});assert.equal(f.state.sends,0);
});
test('RC22 a moving PXE anchor fails balances even when the earlier block remains canonical',async()=>{
 const f=collateralFixture();let reads=0;f.options.accountSession.wallet.pxe.getSyncedBlockHeader=async()=>({globalVariables:{blockNumber:++reads===1?1:2,timestamp:100n},hash:async()=>hex(42)});
 await assert.rejects(f.app.readBalances(),{code:'ROLLING_CONTEXT_CHANGED'});assert.equal(f.state.sends,0);
});
test('RC22 collateral page continuation is bounded and a full page never implies exhaustion',async()=>{
 const f=collateralFixture();f.state.responses={get_deposit_ids:Array.from({length:10},(_,i)=>BigInt(i+1))};
 const original=f.options.sdk.Contract.at;f.options.sdk.Contract.at=async(...args)=>{const board=await original(...args);return {methods:new Proxy(board.methods,{get(target,name){if(name!=='get_deposit_info')return target[name];return(owner,id)=>({simulate:async()=>({result:[1n,BigInt(id),100n,BigInt('0x'+'33'.repeat(20)),0n,0n,0n,0n,0n,50n]})});}})};};
 const first=await f.app.readBalances(),page=await f.app.readBalances({cursor:first.collateral.nextCursor});assert.equal(page.collateral.deposits.length,10);assert.equal(typeof page.collateral.nextCursor,'string');assert.notEqual(page.collateral.nextCursor,first.collateral.nextCursor);assert.equal(page.collateral.complete,false);assert(f.state.privateReads.some(r=>r.name==='get_deposit_ids'&&r.args[1]===10));await assert.rejects(f.app.readBalances({cursor:first.collateral.nextCursor}),{code:'ROLLING_BALANCE_CURSOR_INVALID'});await assert.rejects(f.restart().readBalances({cursor:page.collateral.nextCursor}),{code:'ROLLING_BALANCE_CURSOR_INVALID'});
});
test('RC22 unresolved local fee reservation is explicit and never double-deducts private note balance',async()=>{
 const f=collateralFixture(),review=await f.app.prepare({type:'like',post:'1'});f.state.failSend=true;
 await assert.rejects(f.app.submitPrepared(review.intentId));const balances=await f.restart().readBalances();
 assert.equal(balances.fee.available,'1000');assert.deepEqual(balances.fee.pendingReservation,{status:'unresolved',maximumFee:'10'});assert.equal(f.state.sends,1);
});

// Labelled public snapshot transport and private ownership utilities. No live archive.
function bokAccountingFixture(ids=[11n]){
 const f=bokFixture(),instance={currentContractClassId:hex(90),originalContractClassId:hex(90),deployer:hex(3),salt:hex(4)};
 f.options.deployment.bok.instance=instance;f.options.deployment.bok.artifact=structuredClone(bokArtifact);
 if(!f.options.deployment.bok.artifact.functions.some(x=>x.name==='owned_requests'))f.options.deployment.bok.artifact.functions.push({name:'owned_requests',returnType:{kind:'array',length:8,type:{kind:'field'}}});
 f.state.responses={owned_requests:[...ids,...Array(8-ids.length).fill(0n)]};
 const descriptor={address:hex(5),classId:hex(90),operatorAddress:hex(6),deployer:hex(3),salt:hex(4),deployment:{blockNumber:1,blockHash:hex(42),txHash:hex(40)}};
 const row=id=>({requestId:hex(id),state:'2',sequence:'1',budget:'100',available:'40',reserved:'20',charged:'30',refunded:'10',position:{blockNumber:'1',blockHash:hex(42),txHash:hex(45),txIndexWithinBlock:'0',logIndexWithinTx:String(id)}});
 f.pages=[{schemaVersion:1,scope:{chainId:'31337',rollupVersion:'1',rollupAddress:f.options.deployment.network.rollup,boardAddress:hex(1),bok:descriptor},bokScope:descriptor,checkpoint:{number:1,hash:hex(42)},revision:'epoch:1:1',complete:true,requests:[row(11),row(12)],nextCursor:('a'.repeat(32)+':'+hex(12).slice(2)+':'+'b'.repeat(16))},{schemaVersion:1,scope:{chainId:'31337',rollupVersion:'1',rollupAddress:f.options.deployment.network.rollup,boardAddress:hex(1),bok:descriptor},bokScope:descriptor,checkpoint:{number:1,hash:hex(42)},revision:'epoch:1:1',complete:true,requests:[row(13)],nextCursor:null}];
 f.trace=[];f.options.readBokAccountingPage=async input=>{f.trace.push(structuredClone(input));return f.pages[input.cursor===null?0:1];};
 f.options.funding={resolveBokWithdrawal:async()=>({portal:'0x'+'22'.repeat(20),token:'0x'+'44'.repeat(20),recipient:hex(5)}),verifyWithdrawal:async()=>f.state.refunded===true};f.app=f.restart();return f;
}
async function finishBokAccounting(f){let page=await f.app.readBokAccounting();while(!page.complete)page=await f.app.readBokAccounting({cursor:page.nextCursor});return page;}
test('RC22 Bok accounting downloads identical complete public pages for disjoint private owners',async()=>{
 const a=bokAccountingFixture([11n]),b=bokAccountingFixture([13n]),empty=bokAccountingFixture([]);
 const result=await finishBokAccounting(a),other=await finishBokAccounting(b),none=await finishBokAccounting(empty);
 assert.deepEqual(a.trace,b.trace);assert.deepEqual(a.trace,empty.trace);assert.deepEqual(a.trace,[{limit:50,cursor:null},{limit:50,cursor:('a'.repeat(32)+':'+hex(12).slice(2)+':'+'b'.repeat(16))}]);assert.equal(result.available,'1000');assert.equal(result.totals.refunded,'10');assert.equal(result.requests[0].requestId,hex(11));assert.equal(other.requests[0].requestId,hex(13));assert.deepEqual(none.requests,[]);assert.equal(a.state.sends,0);assert(!a.state.privateReads.some(r=>r.name==='request'));
});
for(const change of ['missing','revision','checkpoint','conservation','order','scope','pxe','cursor'])test('RC22 Bok accounting rejects incomplete or changed '+change,async()=>{
 const f=bokAccountingFixture([11n]),first=await f.app.readBokAccounting();assert.equal(first.complete,false);assert.equal(f.trace.length,0);
 if(change==='missing')f.pages[0].requests.shift();if(change==='revision')f.pages[1].revision='changed';if(change==='checkpoint')f.pages[0].checkpoint.hash=hex(99);if(change==='conservation')f.pages[0].requests[0].reserved='21';if(change==='order')f.pages[1].requests[0].requestId=hex(11);if(change==='scope')f.pages[0].bokScope.address=hex(9);if(change==='pxe')f.options.accountSession.wallet.pxe.getSyncedBlockHeader=async()=>({globalVariables:{blockNumber:2,timestamp:101n},hash:async()=>hex(43)});
 await assert.rejects(async()=>{let page=await f.app.readBokAccounting({cursor:change==='cursor'?'wrong':first.nextCursor});while(!page.complete)page=await f.app.readBokAccounting({cursor:page.nextCursor});});assert.equal(f.state.sends,0);
});
test('RC22 Bok exit uses actual ABI and encrypted original scope, independent of rejected board/plugin',async()=>{
 const f=bokAccountingFixture();f.state.bokEnabled=false;f.state.effectivePolicy=[1n,1n,1n,1n,true];
 const action={type:'withdraw-bok',amount:'500',recipient:'0x'+'33'.repeat(20)},intent=await f.app.prepare(action);assert.equal(intent.withdrawal.kind,'bok');assert.equal(intent.withdrawal.amount,'500');assert.equal(f.state.calls.at(-1).name,'withdraw');assert.equal(f.state.calls.at(-1).args.length,3);
 await f.restart().submitPrepared(intent.intentId);assert.equal((await f.restart().readWithdrawal()).withdrawal.nonce,intent.withdrawal.nonce);await assert.rejects(f.restart().prepare({type:'name',first:'River',last:'Stone'}),{code:'ROLLING_WITHDRAWAL_RECOVERY_REQUIRED'});
 f.state.refunded=true;assert.equal((await f.restart().prepare({type:'name',first:'River',last:'Stone'})).status,'prepared');
});
test('RC22 Bok exit cannot spend reserved request credit or replace an unknown send',async()=>{
 const f=bokAccountingFixture();f.state.bokCredit=10n;await assert.rejects(f.app.prepare({type:'withdraw-bok',amount:'11',recipient:'0x'+'33'.repeat(20)}),{code:'ROLLING_BOK_CREDIT_INSUFFICIENT'});assert.equal(f.state.sends,0);
 const intent=await f.app.prepare({type:'withdraw-bok',amount:'10',recipient:'0x'+'33'.repeat(20)});f.state.failSend=true;await assert.rejects(f.app.submitPrepared(intent.intentId));await assert.rejects(f.restart().submitPrepared(intent.intentId),{code:'ROLLING_RECOVERY_REQUIRED'});assert.equal(f.state.sends,1);
});
test('RC22 request cancellation only selects owned unreserved waiting or active requests',async()=>{
 const f=bokAccountingFixture();await finishBokAccounting(f);await assert.rejects(f.app.prepare({type:'cancel-bok-request',requestId:hex(11)}),{code:'ROLLING_BOK_ACCOUNTING_INCOMPLETE'});
 f.pages[0].requests[0].available='60';f.pages[0].requests[0].reserved='0';await finishBokAccounting(f);const intent=await f.app.prepare({type:'cancel-bok-request',requestId:hex(11)});assert.equal(intent.action.type,'cancel-bok-request');assert.equal(f.state.calls.at(-1).name,'cancel');assert.equal(f.state.sends,0);
});

test('RC22 full private ownership page requires a distinct empty page before any uniform public fetch',async()=>{
 const f=bokAccountingFixture(Array.from({length:8},(_,i)=>BigInt(i+11)));let page=await f.app.readBokAccounting();assert.equal(page.phase,'owned-requests');assert.equal(f.trace.length,0);
 const first=page.nextCursor;f.state.responses.owned_requests=Array(8).fill(0n);page=await f.app.readBokAccounting({cursor:first});assert.equal(page.phase,'public-accounting');assert.equal(f.trace.length,0);
 assert.deepEqual(f.state.privateReads.filter(r=>r.name==='owned_requests').map(r=>r.args[1]),[0,8]);await assert.rejects(f.app.readBokAccounting({cursor:first}),{code:'ROLLING_BALANCE_CURSOR_INVALID'});assert.equal(f.state.sends,0);
});
for(const defect of ['zero-tail','duplicate','empty-continuation','deployment','negative','noncanonical-cursor'])test('RC22 accounting rejects '+defect,async()=>{
 const f=bokAccountingFixture();
 if(defect==='zero-tail')f.state.responses.owned_requests=[0n,11n,...Array(6).fill(0n)];
 if(defect==='duplicate')f.state.responses.owned_requests=[11n,11n,...Array(6).fill(0n)];
 if(defect==='empty-continuation')f.pages[0].requests=[];
 if(defect==='deployment')f.pages[0].bokScope.deployment.blockNumber=2;
 if(defect==='negative')f.pages[0].requests[0].available='-1';
 if(defect==='noncanonical-cursor')f.pages[0].nextCursor='';
 await assert.rejects(finishBokAccounting(f));assert.equal(f.state.sends,0);
});

test('RC22 real persistent-index cursor crosses both wallet accounting boundaries and resumes its producer',async t=>{
 // Real index, decoder, SQLite and cursor MAC. Finite canonical-node data and
 // the Bok accounting envelope adaptation are labelled doubles, not an archive.
 const {createRollingPersistentPublicIndex}=await import('./public-index.mjs'),{createRollingPublicSqliteStore}=await import('./public-sqlite.mjs');
 const {createUniformBokAccountingReader}=await import('../../apps/rolling/wallet-session.mjs');
 const {getContractClassFromArtifact}=await import('@aztec-labs/stdlib/contract'),{EventSelector,decodeFunctionSignature}=await import('@aztec-labs/stdlib/abi');
 const {computeLogTag}=await import('@aztec-labs/stdlib/hash'),{PublicLog}=await import('@aztec-labs/stdlib/logs'),{DomainSeparator}=await import('@aztec-labs/constants');
 const {mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const directory=mkdtempSync(join(tmpdir(),'bok-cursor-')),scope={chainId:'31337',rollupVersion:'1',rollupAddress:'0x'+'11'.repeat(20),boardAddress:hex(42),classId:(await getContractClassFromArtifact(artifact)).id.toString()};
 const store=createRollingPublicSqliteStore(directory,{scope});t.after(()=>{try{store.close();}finally{rmSync(directory,{recursive:true,force:true});}});
 const pack=text=>{const b=Buffer.alloc(32*31);Buffer.from(text).copy(b);return Array.from({length:32},(_,i)=>BigInt('0x'+b.subarray(i*31,i*31+31).toString('hex')));};
 const digest=text=>poseidon2HashWithSeparator([BigInt(Buffer.byteLength(text)),...pack(text)],0x52435431);
 const log=async(type,payload)=>{const abi=artifact.outputs.structs.events.find(e=>e.path==='RollingBoard::'+type),selector=await EventSelector.fromSignature(decodeFunctionSignature(type,abi.fields));return new PublicLog(AztecAddress.fromBigIntUnsafe(42n),[await computeLogTag(selector.toField(),DomainSeparator.EVENT_LOG_TAG),...encodeArguments({parameters:abi.fields},abi.fields.map(f=>payload[f.name]))]);};
 const logs=[await log('MainPolicyPublished',{schema:1,version:1,digest:await digest('Rules'),length:5,rules:pack('Rules')})];
 for(const id of [11,12])logs.push(await log('PostPublished',{schema:1,id,record:{subboard:0,parent:0,root:id,kind:1,name_id:0,reference:0,content_digest:await digest('Post')},timestamp:1,main_policy_version:1,local_policy_version:0,length:4,message:pack('Post')}));
 const wrap=value=>({toString:()=>value,equals:other=>other.toString()===value});
 const effect={txHash:wrap(hex(101)),publicLogs:logs,toBuffer:()=>Buffer.concat(logs.map(log=>log.toBuffer()))},block={hash:wrap(hex(42)),header:{globalVariables:{blockNumber:1,timestamp:1n}},body:{txEffects:[effect]}};
 const node={getNodeInfo:async()=>({l1ChainId:31337,rollupVersion:1,l1ContractAddresses:{rollupAddress:scope.rollupAddress}}),getContract:async()=>({currentContractClassId:scope.classId,originalContractClassId:scope.classId}),getBlockData:async number=>({blockHash:wrap(number===0?hex(41):hex(42)),header:{globalVariables:{blockNumber:number===0?0:1}}}),getBlock:async()=>block,getTxReceipt:async()=>({txHash:wrap(hex(101)),status:'checkpointed',executionResult:'success',blockNumber:1,blockHash:wrap(hex(42))}),getTxEffect:async()=>({data:effect,l2BlockNumber:1,l2BlockHash:wrap(hex(42))})};
 const index=await createRollingPersistentPublicIndex({node,artifact,scope,deployment:{blockNumber:1,blockHash:hex(42),txHash:hex(101)},storage:store});
 for(let steps=0;!index.status().complete;steps++){assert(steps<5);await index.step();}
 const first=index.query('feed',{limit:1});assert.equal(first.nextCursor.length,114);assert.match(first.nextCursor,/^[0-9a-f]{32}:[0-9a-f]{64}:[0-9a-f]{16}$/);
 const f=bokAccountingFixture([13n]);f.pages[0].nextCursor=first.nextCursor;const urls=[];
 f.options.readBokAccountingPage=createUniformBokAccountingReader({origin:'https://board.invalid',fetcher:async url=>{urls.push(url);const params=new URL(url).searchParams,cursor=params.get('cursor');assert.equal(params.get('limit'),'50');assert.deepEqual([...params.keys()],cursor?['limit','cursor']:['limit']);const actual=index.query('feed',{limit:1,...(cursor?{cursor}:{})});assert.equal(actual.nextCursor,cursor?null:first.nextCursor);return new Response(JSON.stringify(f.pages[cursor?1:0]));}});
 f.app=f.restart();const result=await finishBokAccounting(f);assert.equal(result.complete,true);assert.equal(result.requests[0].requestId,hex(13));assert.equal(urls.length,2);assert.equal(new URL(urls[1]).searchParams.get('cursor'),first.nextCursor);assert.equal(f.state.sends,0);
});

// Real installed expire ABI and encrypted workflow; deadline/settlement outcomes
// below are labelled simulation/node doubles, not contract execution acceptance.
function expiryFixture(){
 const f=bokAccountingFixture(),estimate=f.options.sdk.estimatePrivateFeeTransaction;
 f.options.sdk.estimatePrivateFeeTransaction=async input=>{if(input.interaction.name==='expire'&&f.state.expiryRejected)throw Error('Contract simulation: request not expired');return estimate(input);};
 f.app=f.restart();return f;
}
test('RC22 expiry privately selects an owned active reserved request and saves exact fee review encrypted',async()=>{
 const f=expiryFixture();await finishBokAccounting(f);f.state.bokEnabled=false;
 const intent=await f.app.prepare({type:'expire-bok-request',requestId:hex(11)});
 assert.equal(intent.maximumFee,'10');assert.equal(intent.status,'prepared');assert.equal(f.state.sends,0);
 assert.equal(f.state.calls.at(-1).name,'expire');assert.deepEqual(f.state.calls.at(-1).args,[hex(11)]);
 const abi=bokArtifact.functions.find(fn=>fn.name==='expire');assert.equal(abi.functionType,'private');assert.equal(encodeArguments(abi,[hex(11)]).length,1);
 assert([...f.values.values()].every(cipher=>!cipher.includes(hex(11))));assert.equal(intent.bokRequestScope,undefined);assert.equal(intent.refunded,undefined);
 assert(!f.state.privateReads.some(r=>r.name==='request'));assert(f.trace.every(r=>Object.keys(r).every(k=>['limit','cursor'].includes(k))));
 assert.equal((await f.restart().submitPrepared(intent.intentId)).status,'confirmed');assert.equal(f.state.sends,1);
 assert.equal((await f.restart().reconcile(intent.intentId)).status,'confirmed');assert.equal(f.state.sends,1);
});
for(const fault of ['missing-page','foreign','fenced','closed'])test('RC22 expiry rejects '+fault+' selection without estimation or send',async()=>{
 const f=expiryFixture();if(fault==='fenced'||fault==='closed')f.pages[0].requests[0].state=fault==='fenced'?'3':'4';
 if(fault!=='missing-page')await finishBokAccounting(f);
 await assert.rejects(f.app.prepare({type:'expire-bok-request',requestId:hex(fault==='foreign'?12:11)}),{code:'ROLLING_BOK_ACCOUNTING_INCOMPLETE'});
 assert.equal(f.state.estimates,0);assert.equal(f.state.sends,0);
});
test('RC22 expiry relies on simulation deadline at preparation and repeats it before submission',async()=>{
 const f=expiryFixture();await finishBokAccounting(f);f.state.expiryRejected=true;
 await assert.rejects(f.app.prepare({type:'expire-bok-request',requestId:hex(11)}),/not expired/);assert.equal(f.state.sends,0);
 f.state.expiryRejected=false;const intent=await f.app.prepare({type:'expire-bok-request',requestId:hex(11)});f.state.expiryRejected=true;
 await assert.rejects(f.restart().submitPrepared(intent.intentId),/not expired/);assert.equal(f.state.sends,0);
 assert.equal((await f.restart().reconcile(intent.intentId)).status,'prepared');
});
test('RC22 expiry preserves fee ceiling and original Bok scope across restart',async()=>{
 const f=expiryFixture();await finishBokAccounting(f);const intent=await f.app.prepare({type:'expire-bok-request',requestId:hex(11)});
 f.state.fee=11n;await assert.rejects(f.restart().submitPrepared(intent.intentId),{code:'ROLLING_FEE_CHANGED'});assert.equal(f.state.sends,0);
 f.state.fee=10n;f.options.deployment.bok.operator=hex(99);await assert.rejects(f.restart().submitPrepared(intent.intentId),{code:'ROLLING_CONTEXT_CHANGED'});assert.equal(f.state.sends,0);
});
test('RC22 expiry unknown send stays recoverable without reprepare or retransmission',async()=>{
 const f=expiryFixture();await finishBokAccounting(f);const intent=await f.app.prepare({type:'expire-bok-request',requestId:hex(11)});f.state.failSend=true;
 await assert.rejects(f.app.submitPrepared(intent.intentId));assert.equal(f.state.sends,1);
 const app=f.restart();assert.equal((await app.reconcile(intent.intentId)).status,'unknown');
 await assert.rejects(app.submitPrepared(intent.intentId),{code:'ROLLING_RECOVERY_REQUIRED'});await assert.rejects(app.prepare({type:'expire-bok-request',requestId:hex(11)}),{code:'ROLLING_RECOVERY_REQUIRED'});assert.equal(f.state.sends,1);
 f.state.outcome={operation:f.state.sent.opts.journalOperation,outcome:'success',txHash:hex(77),receipt:{txHash:hex(77),status:'checkpointed',blockNumber:1,blockHash:hex(42)}};
 assert.equal((await app.reconcile(intent.intentId)).status,'confirmed');assert.equal(f.state.sends,1);
});
test('RC22 expiry accounting keeps unknown reserved liability fenced and never adds returned credit twice',async()=>{
 const f=expiryFixture();await finishBokAccounting(f);const intent=await f.app.prepare({type:'expire-bok-request',requestId:hex(11)});await f.app.submitPrepared(intent.intentId);
 // Canonical public snapshots are controlled here. First only unreserved40
 // returns, then reconciliation charges7 of the20 reservation and returns13.
 Object.assign(f.pages[0].requests[0],{state:'3',available:'0',reserved:'20',charged:'30',refunded:'50'});f.state.bokCredit=1040n;
 let page=await finishBokAccounting(f);assert.equal(page.available,'1040');assert.equal(page.totals.reserved,'20');assert.equal(page.totals.refunded,'50');assert.equal(page.totals.charged,'30');
 await assert.rejects(f.app.prepare({type:'expire-bok-request',requestId:hex(11)}),{code:'ROLLING_BOK_ACCOUNTING_INCOMPLETE'});
 Object.assign(f.pages[0].requests[0],{state:'4',sequence:'2',reserved:'0',charged:'37',refunded:'63'});f.state.bokCredit=1053n;
 page=await finishBokAccounting(f);assert.equal(page.available,'1053');assert.equal(page.totals.reserved,'0');assert.equal(page.totals.charged,'37');assert.equal(page.totals.refunded,'63');assert.equal(f.state.sends,1);
});

// Real ABI/encrypted workflow; canonical node and transaction execution are labelled doubles.
async function interruptedBokFixture(){
 const f=bokFixture();f.options.sdk.TxHash=TxHash;
 f.options.accountSession.node.getTxReceipt=async tx=>{assert(tx instanceof TxHash);if(f.state.authReadError)throw Error('unavailable');return {status:'checkpointed',executionResult:'success',txHash:hex(77),blockNumber:1,blockHash:hex(f.state.authReorg?43:42)};};
 f.app=f.restart();const prepared=await f.app.prepare(bokAction());await f.app.submitPrepared(prepared.intentId);return {...f,authorizedId:prepared.intentId};
}
test('Bok interrupted authorization releases only its original request and cancelling review restores encrypted draft',async()=>{
 const f=await interruptedBokFixture(),request=f.state.bokRequestId;
 await assert.rejects(f.app.prepare({type:'name',first:'River',last:'Stone'}),{code:'ROLLING_RECOVERY_REQUIRED'});
 const review=await f.restart().prepareBokRelease(f.authorizedId,{type:'cancel-bok-request'});
 assert.equal(review.action.requestId,request);assert.deepEqual(f.state.calls.at(-1).args,[request]);assert.equal(f.state.sends,1);assert.equal(review.bokRelease.sourceIntentId,f.authorizedId);
 const restored=await f.restart().cancelPrepared(review.intentId);assert.equal(restored.status,'authorized');assert.equal(restored.action.content,bokAction().content);
 await assert.rejects(f.app.prepare({type:'name',first:'River',last:'Stone'}),{code:'ROLLING_RECOVERY_REQUIRED'});
 const again=await f.restart().prepareBokRelease(f.authorizedId,{type:'cancel-bok-request'});const result=await f.restart().submitPrepared(again.intentId);
 assert.equal(result.status,'confirmed');assert.equal(f.state.sends,2);assert.equal(f.state.sent.payload.name,'cancel');assert.deepEqual(f.state.sent.payload.args,[request]);
 assert([...f.values.values()].every(v=>!v.includes('Private Sentinel')));
});
test('Bok interrupted release rejects unknown authorization, foreign input, changed request and canonical reorg',async()=>{
 for(const mode of ['unknown','extra','wrong-id','reorg','unavailable','target','reserved','closed','scope']){
  const f=await interruptedBokFixture();let id=f.authorizedId,input={type:'cancel-bok-request'};
  if(mode==='unknown')f.state.outcome.outcome='unknown';if(mode==='extra')input.requestId=hex(99);if(mode==='wrong-id')id=hex(99);
  if(mode==='reorg')f.state.authReorg=true;if(mode==='unavailable')f.state.authReadError=true;
  if(mode==='target')f.state.bokRequest.invocation_hash=hex(99);if(mode==='reserved')f.state.bokRequest.reserved='0x01';if(mode==='closed')f.state.bokRequest.state='0x04';
  if(mode==='scope')f.options.deployment.bok.operator=hex(99);
  await assert.rejects(f.restart().prepareBokRelease(id,input));assert.equal(f.state.sends,1);assert.equal(f.state.estimates,2);
 }
});
test('Bok interrupted expiry enforces actual simulation deadline and preserves reserved liability',async()=>{
 const f=await interruptedBokFixture();f.state.bokRequest.reserved='0x14';
 const estimate=f.options.sdk.estimatePrivateFeeTransaction;f.options.sdk.estimatePrivateFeeTransaction=async input=>{if(input.interaction.name==='expire'&&!f.state.expired)throw Error('Request not expired');return estimate(input);};
 await assert.rejects(f.restart().prepareBokRelease(f.authorizedId,{type:'expire-bok-request'}),/Request not expired/);assert.equal(f.state.sends,1);
 f.state.expired=true;const review=await f.restart().prepareBokRelease(f.authorizedId,{type:'expire-bok-request'});f.state.expired=false;
 await assert.rejects(f.restart().submitPrepared(review.intentId),/Request not expired/);assert.equal(f.state.sends,1);
 f.state.expired=true;await f.restart().submitPrepared(review.intentId);assert.equal(f.state.sends,2);assert.equal(f.state.sent.payload.name,'expire');assert.equal(f.state.bokRequest.reserved,'0x14','No client-side reservation deletion');
});
test('Bok interrupted release rechecks fee and original canonical authorization at actual send boundary',async()=>{
 for(const mode of ['fee','reorg','send-race']){
  const f=await interruptedBokFixture(),review=await f.restart().prepareBokRelease(f.authorizedId,{type:'cancel-bok-request'});
  if(mode==='fee')f.state.fee=11n;if(mode==='reorg')f.state.authReorg=true;if(mode==='send-race')f.state.beforeBokSubmit=async()=>{f.state.authReorg=true;};
  await assert.rejects(f.restart().submitPrepared(review.intentId));assert.equal(f.state.sends,1);
 }
});
test('Bok interrupted release unknown submission is retained and never automatically retried',async()=>{
 const f=await interruptedBokFixture(),review=await f.restart().prepareBokRelease(f.authorizedId,{type:'cancel-bok-request'});f.state.failSend=true;
 await assert.rejects(f.restart().submitPrepared(review.intentId));assert.equal(f.state.sends,2);
 await assert.rejects(f.restart().prepareBokRelease(review.intentId,{type:'cancel-bok-request'}),{code:'ROLLING_RECOVERY_REQUIRED'});
 await assert.rejects(f.restart().submitPrepared(review.intentId),{code:'ROLLING_RECOVERY_REQUIRED'});assert.equal(f.state.sends,2);
});
test('Bok interrupted reverted post can release without re-enabling a rejected plugin or publishing again',async()=>{
 const f=await interruptedBokFixture(),post=await f.app.prepareBokPost(f.authorizedId);await f.app.submitPrepared(post.intentId);f.state.outcome.outcome='reverted';
 assert.equal((await f.restart().reconcile(post.intentId)).status,'bok-post-reverted');f.state.bokEnabled=false;
 const review=await f.restart().prepareBokRelease(post.intentId,{type:'cancel-bok-request'});const restored=await f.restart().cancelPrepared(review.intentId);assert.equal(restored.status,'bok-post-reverted');
 const again=await f.restart().prepareBokRelease(post.intentId,{type:'cancel-bok-request'});await f.restart().submitPrepared(again.intentId);assert.equal(f.state.sends,3);assert.equal(f.state.sent.payload.name,'cancel');
});
test('Bok interrupted reverted release keeps original identity through another cancelled fee review',async()=>{
 const f=await interruptedBokFixture(),first=await f.app.prepareBokRelease(f.authorizedId,{type:'cancel-bok-request'});await f.app.submitPrepared(first.intentId);f.state.outcome.outcome='reverted';
 assert.equal((await f.restart().reconcile(first.intentId)).status,'bok-release-reverted');
 await assert.rejects(f.restart().prepare({type:'name',first:'River',last:'Stone'}),{code:'ROLLING_RECOVERY_REQUIRED'});
 const second=await f.restart().prepareBokRelease(first.intentId,{type:'expire-bok-request'});assert.equal(second.bokRelease.sourceIntentId,f.authorizedId);
 assert.equal((await f.restart().cancelPrepared(second.intentId)).status,'bok-release-reverted');assert.equal(f.state.sends,2);
});

function bokReplyFixture(){
 const f=bokFixture();f.state.responses={get_post:[true,{subboard:0n,parent:0n,root:11n,kind:1n,name_id:0n,reference:0n,content_digest:0n},0n,100n,0n]};return f;
}
const bokReply=()=>({...bokAction(),parent:'12',root:'11'});
test('Bok reply preserves canonical thread across authorization, reopen and exact post ABI',async()=>{
 const f=bokReplyFixture(),auth=await f.app.prepare(bokReply()),authArgs=structuredClone(f.state.calls.at(-1).args);await f.app.submitPrepared(auth.intentId);
 const post=await f.restart().prepareBokPost(auth.intentId),args=f.state.calls.at(-1).args;
 assert.equal(args[2].parent,hex(12));assert.equal(args[2].root_reference,hex(11));assert.deepEqual(post.action,bokReply());
 // Independently reproduce the contract's complete draft binding with the real
 // hash. Root-post defaults previously hid missing reply fields in authorization.
 const d=args[2],preimage=[1n,31337n,1n,1n,5n,BigInt(d.subboard),BigInt(d.parent),BigInt(d.root_reference),BigInt(d.kind),BigInt(d.name_id),BigInt(d.reference),BigInt(args[1]),BigInt(d.length),...d.message.map(BigInt)];
 const target=String(await poseidon2HashWithSeparator(preimage.map(n=>new Fr(n)),0x52434931));
 assert.equal(authArgs[1],target);assert.equal(args[6],authArgs[0]);
 const rootDefaults=[...preimage];rootDefaults[6]=0n;rootDefaults[7]=0n;
 assert.notEqual(authArgs[1],String(await poseidon2HashWithSeparator(rootDefaults.map(n=>new Fr(n)),0x52434931)));
 await f.restart().submitPrepared(post.intentId);assert.equal(f.state.sends,2);assert.deepEqual(f.state.sent.payload.args,args);
});
test('legacy Bok reply target mismatch is refused before post estimation and remains releasable',async()=>{
 const f=bokReplyFixture();f.options.sdk.TxHash=TxHash;
 f.options.accountSession.node.getTxReceipt=async tx=>{assert(tx instanceof TxHash);return {status:'checkpointed',executionResult:'success',txHash:hex(77),blockNumber:1,blockHash:hex(42)};};
 f.options.sdk.poseidon2HashWithSeparator=async(fields,domain)=>{
  const old=[...fields];if(domain===0x52434931){old[6]=Fr.ZERO;old[7]=Fr.ZERO;}return poseidon2HashWithSeparator(old,domain);
 };
 const auth=await f.app.prepare(bokReply());await f.app.submitPrepared(auth.intentId);
 f.options.sdk.poseidon2HashWithSeparator=poseidon2HashWithSeparator;
 const estimates=f.state.estimates,original=await f.restart().reconcile(auth.intentId);
 await assert.rejects(f.restart().prepareBokPost(auth.intentId),{code:'ROLLING_INTENT_CHANGED'});
 assert.equal(f.state.estimates,estimates);assert.equal(f.state.sends,1);assert.deepEqual(await f.restart().reconcile(auth.intentId),original);
 const release=await f.restart().prepareBokRelease(auth.intentId,{type:'cancel-bok-request'});
 assert.equal(release.action.type,'cancel-bok-request');assert.equal(f.state.sends,1);
});
test('Bok reply rejects malformed pairs, foreign thread, removed or missing parent before authorization',async()=>{
 for(const changes of [{parent:'12',root:'0'},{parent:'0',root:'11'},{parent:'bad'},{root:'13'},{subboard:'2'}]){
  const f=bokReplyFixture();await assert.rejects(f.app.prepare({...bokReply(),...changes}));assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
 }
 for(const index of [0,2]){const f=bokReplyFixture();f.state.responses.get_post[index]=index===0?false:1n;await assert.rejects(f.app.prepare(bokReply()),{code:'ROLLING_PARENT_UNAVAILABLE'});assert.equal(f.values.size,0);}
});
test('Bok reply rechecks parent at authorization send, post review and final send without authorizing twice',async()=>{
 for(const phase of ['authorization','review','post','late']){
  const f=bokReplyFixture(),auth=await f.app.prepare(bokReply());
  if(phase==='authorization'){f.state.responses.get_post[2]=1n;await assert.rejects(f.app.submitPrepared(auth.intentId));assert.equal(f.state.sends,0);continue;}
  await f.app.submitPrepared(auth.intentId);
  if(phase==='review'){f.state.responses.get_post[1].root=13n;await assert.rejects(f.restart().prepareBokPost(auth.intentId));assert.equal(f.state.sends,1);continue;}
  const post=await f.restart().prepareBokPost(auth.intentId);
  if(phase==='late')f.state.beforeBokSubmit=async()=>{f.state.responses.get_post[2]=1n;};else f.state.responses.get_post[2]=1n;
  await assert.rejects(f.restart().submitPrepared(post.intentId));assert.equal(f.state.sends,1);
 }
});
test('Bok reply rejects moving or noncanonical PXE parent snapshot',async()=>{
 for(const changed of ['move','reorg']){const f=bokReplyFixture();let reads=0;
  if(changed==='move')f.options.accountSession.wallet.pxe.getSyncedBlockHeader=async()=>({globalVariables:{blockNumber:++reads,timestamp:100n},hash:async()=>hex(42)});
  else f.options.accountSession.node.getBlockData=async n=>({header:{globalVariables:{blockNumber:n}},blockHash:hex(43)});
  await assert.rejects(f.app.prepare(bokReply()),{code:'ROLLING_CONTEXT_CHANGED'});assert.equal(f.values.size,0);
 }
});

// W03 ordinary-action recovery uses the same real Tx/AEAD journal fixture above.
// Chain, proof and funding authorities remain explicitly labelled doubles.
for(const kind of ['post','claim-deposit','withdraw'])for(const replacing of [false,true])test(`ordinary ${kind} ${replacing?'missing-anchor replacement':'saved bytes'} survives restart with immutable consent`,async()=>{
 const base=kind==='claim-deposit'?fundingFixture():fixture();
 const action=kind==='post'?{type:kind,deposit:'9',content:'Saved original post'}:kind==='withdraw'?{type:kind,deposit:'9'}:{type:kind,receipt:base.receipt};
 const f=await replacementFixture({base,action,initialCrash:!replacing});
 if(replacing){f.fork();await f.reopen();f.state.fee=12n;const inspected=await f.app.inspectRecovery(f.prepared.intentId);assert.equal(inspected.status,'replacement-available');
  const reviewed=await f.app.prepareReplacement(f.prepared.intentId,f.review());assert.equal(reviewed.replacementReview.maximumFee,'12');assert.deepEqual(reviewed.action,action);assert.equal(reviewed.nonce,f.prepared.nonce);
  f.state.crashAfterPrepare=true;f.state.beforeSubmit=async tx=>f.validations.set(String(tx.getTxHash()),{result:'valid'});await assert.rejects(f.app.submitPrepared(f.prepared.intentId),/Labelled crash/);
 }
 await f.reopen();const id=f.prepared.intentId,hash=String(f.transactions.at(-1).getTxHash()),before=[...f.values],sends=f.state.sends,estimates=f.state.estimates,proofs=f.transactions.length;
 const inspection=await f.app.inspectRecovery(id);assert.equal(inspection.exactResume.status,'resumable');assert.equal(inspection.exactResume.maximumFee,replacing?'12':'10');assert.deepEqual([...f.values],before);
 const result=await f.app.resumeSaved(id,{expectedTxHash:hash});assert.equal(result.status,'confirmed');assert.equal(result.txHash,hash);assert.deepEqual(result.action,action);assert.equal(result.nonce,f.prepared.nonce);
 assert.equal(f.state.estimates,estimates);assert.equal(f.transactions.length,proofs);assert.equal(f.state.sends,sends+1);assert.deepEqual(f.state.resumedBytes,[Buffer.from(f.transactions.at(-1).toBuffer()).toString('hex')]);
 await f.app.resumeSaved(id,{expectedTxHash:hash});assert.equal(f.state.sends,sends+1);
});

for(const mutation of ['pending','unknown','nullifier-invalid','fee','wrong-hash','policy','account','ciphertext'])test(`ordinary recovery fences ${mutation} without a new financial action`,async()=>{
 const f=await replacementFixture({action:{type:'post',deposit:'9',content:'Immutable'},initialCrash:true});await f.reopen();const hash=f.originalHash,before=[...f.values],estimates=f.state.estimates;
 if(mutation==='pending')f.receipts.set(hash,{txHash:hash,status:'pending'});
 if(mutation==='unknown')f.options.accountSession.node.getTxReceipt=async()=>{throw Error('Labelled RPC uncertainty');};
 if(mutation==='nullifier-invalid')f.validations.set(hash,{result:'invalid',reason:['Existing nullifier']});
 if(mutation==='policy')f.state.policy=2;
 if(mutation==='account')f.state.guard=false;
 if(mutation==='ciphertext')for(const [key,value]of f.values)f.values.set(key,value+'x');
 if(mutation==='fee'){f.validations.set(hash,{result:'invalid',reason:['Block header not found']});await f.app.prepareReplacement(f.prepared.intentId,{expectedTxHash:hash});f.state.fee=11n;await assert.rejects(f.app.submitPrepared(f.prepared.intentId),{code:'ROLLING_FEE_CHANGED'});}
 else await assert.rejects(f.app.resumeSaved(f.prepared.intentId,{expectedTxHash:mutation==='wrong-hash'?hex(999):hash}));
 assert.equal(f.state.sends,0);assert.equal(f.transactions.length,1);if(!['fee','ciphertext'].includes(mutation))assert.deepEqual([...f.values],before);if(mutation!=='fee')assert.equal(f.state.estimates,estimates);
});
for(const kind of ['post','claim-deposit','withdraw','moderate-post','bok','bio'])for(const phase of ['inspection','final-send'])test(`ordinary ${kind} changed context at ${phase} vetoes saved-byte recovery`,async()=>{
 const base=kind==='claim-deposit'?fundingFixture():kind==='moderate-post'?moderatorFixture():kind==='bok'?bokFixture():fixture();
 const action=kind==='post'?{type:kind,deposit:'9',content:'Immutable'}:kind==='claim-deposit'?{type:kind,receipt:base.receipt}:kind==='withdraw'?{type:kind,deposit:'9'}:kind==='moderate-post'?moderatorActions[0]:kind==='bok'?bokAction():{type:kind,name:'7',expectedVersion:'0',content:'Saved bio'};
 const f=await replacementFixture({base,action,initialCrash:true});await f.reopen();const hash=f.originalHash;
 const mutate=()=>{
  if(kind==='post')f.state.policy=2;
  if(kind==='claim-deposit')f.state.claimError=true;
  if(kind==='withdraw')f.state.responses={get_deposit_info:[1n,9n,100n,BigInt('0x'+'33'.repeat(20)),0n,1n,0n,0n,1n,50n]};
  if(kind==='moderate-post')f.state.moderator=99n;
  if(kind==='bok')f.state.bokEnabled=false;
  if(kind==='bio')f.state.responses={profile_state:decodeFromAbi(getFunctionReturnType([...artifact.functions,...artifact.nonDispatchPublicFunctions].find(fn=>fn.name==='profile_state')),[1n,0n,0n,0n,0n,0n,0n,0n].map(n=>new Fr(n)))};
 };
 if(phase==='inspection'){mutate();await assert.rejects(f.app.inspectRecovery(f.prepared.intentId));}
 else{assert.equal((await f.app.inspectRecovery(f.prepared.intentId)).exactResume.status,'resumable');let calls=0;f.options.accountSession.wallet.pxe.sync=async()=>{if(++calls===2)mutate();};await assert.rejects(f.app.resumeSaved(f.prepared.intentId,{expectedTxHash:hash}));assert.equal(calls,2);}
 assert.equal(f.state.sends,0);assert.equal(f.transactions.length,1);
});

for(const kind of ['claim-private-fee','claim-bok'])test(`ordinary ${kind} recovery preserves the existing funded receipt`,async()=>{
 const base=topUpFixture(kind==='claim-bok'?'bok':'private-fee'),f=await replacementFixture({base,action:base.action,initialCrash:true});await f.reopen();
 const snapshot=await f.app.inspectRecovery(f.prepared.intentId);assert.equal(snapshot.exactResume.status,'resumable');const estimates=f.state.estimates;
 f.state.changedClaim=true;await assert.rejects(f.app.resumeSaved(f.prepared.intentId,{expectedTxHash:f.originalHash}),{code:'ROLLING_FUNDING_MISMATCH'});assert.equal(f.state.sends,0);
 f.state.changedClaim=false;assert.equal((await f.app.resumeSaved(f.prepared.intentId,{expectedTxHash:f.originalHash})).status,'confirmed');assert.equal(f.state.sends,1);assert.equal(f.state.estimates,estimates);assert.equal(f.transactions.length,1);
});
for(const kind of ['post','claim-deposit','withdraw','moderate-post','bok'])test(`ordinary ${kind} replacement rechecks context after the new proof is journalled`,async()=>{
 const base=kind==='claim-deposit'?fundingFixture():kind==='moderate-post'?moderatorFixture():kind==='bok'?bokFixture():fixture();
 const action=kind==='post'?{type:kind,deposit:'9',content:'Immutable'}:kind==='claim-deposit'?{type:kind,receipt:base.receipt}:kind==='withdraw'?{type:kind,deposit:'9'}:kind==='moderate-post'?moderatorActions[0]:bokAction();
 const f=await replacementFixture({base,action,initialCrash:true});f.validations.set(f.originalHash,{result:'invalid',reason:['Block header not found']});await f.reopen();
 await f.app.prepareReplacement(f.prepared.intentId,{expectedTxHash:f.originalHash});f.state.crashAfterPrepare=false;f.state.beforeSubmit=async()=>{
  if(kind==='post')f.state.policy=2;
  if(kind==='claim-deposit')f.state.claimError=true;
  if(kind==='withdraw')f.state.responses={get_deposit_info:[1n,9n,100n,BigInt('0x'+'33'.repeat(20)),0n,1n,0n,0n,1n,50n]};
  if(kind==='moderate-post')f.state.moderator=99n;
  if(kind==='bok')f.state.bokEnabled=false;
 };
 await assert.rejects(f.app.submitPrepared(f.prepared.intentId));assert.equal(f.state.sends,0);assert.equal(f.transactions.length,2);assert.equal((await f.options.accountSession.journal.inspect()).txHash,String(f.transactions[1].getTxHash()));
});
test('ordinary unknown fence with an empty authenticated Tx journal remains unresolved',async()=>{
 const f=fixture(),node=f.options.accountSession.node;
 const scope={account:hex(3),chainId:'31337',version:'1',rollup:'0x'+'11'.repeat(20),board:hex(1),portal:'0x'+'22'.repeat(20)};
 f.options.accountSession.journal=await createL2Journal({storage:f.options.privateStore,walletSecret:hex(8),walletSalt:'0',scope,Tx,node,contextGuard:f.options.contextGuard});
 f.options.accountSession.wallet.sendTx=async()=>{throw Error('Labelled interrupted wallet before transaction persistence');};
 const app=f.restart(),prepared=await app.prepare({type:'like',post:'5'});await assert.rejects(app.submitPrepared(prepared.intentId),/interrupted wallet/);
 assert.equal(await f.options.accountSession.journal.inspect(),null);assert.equal((await app.reconcile(prepared.intentId)).status,'unknown');
 const before=[...f.values],view=await app.inspectRecovery(prepared.intentId);assert.equal(view.status,'empty');assert.equal(view.exactResume.status,'empty');
 await assert.rejects(app.resumeSaved(prepared.intentId,{expectedTxHash:hex(77)}),{code:'ROLLING_RECOVERY_REQUIRED'});
 await assert.rejects(app.prepareReplacement(prepared.intentId,{expectedTxHash:hex(77)}),{code:'ROLLING_RECOVERY_REQUIRED'});
 await assert.rejects(app.submitPrepared(prepared.intentId),{code:'ROLLING_RECOVERY_REQUIRED'});
 assert.deepEqual([...f.values],before);assert.equal(f.state.sends,0);
});

// New protocol only: actual encrypted workflow/L2 CAS; proof/network remain
// labelled doubles. The engine's mandatory checkpoint ordering is tested in
// test-receipt-baseline, not inferred from this application-port double.
async function preproofFixture(base){
 const f=await realJournalFixture(base);let epoch='a'.repeat(64),serial=900;
 Object.assign(f.options.privateStore,{readRecoveryEpoch:async()=>epoch,ensureRecoveryEpoch:async()=>epoch??='b'.repeat(64),rotateRecoveryEpoch:async()=>epoch='c'.repeat(64)});
 f.options.accountSession.wallet.pxe.sync=async()=>{};
 const cap={checkpoint:async()=>{const p=await f.options.accountSession.journal.assertCanStart();return {encoded:p.encoded};},send:async(payload,opts,lifecycle)=>{
  f.state.proofs=(f.state.proofs??0)+1;const journal=f.options.accountSession.journal;journal.setOperation(opts.journalOperation);const prior=await journal.assertCanStart();
  await lifecycle.guard('pre-proof');if(f.state.interrupt==='proof')throw Error('proof interrupted');
  if(f.state.pauseProof)await f.state.pauseProof;if(f.state.beforeJournal)await f.state.beforeJournal();await lifecycle.guard('pre-proof');
  const tx=new JournalTx(hex(serial++));await journal.prepare(tx,prior);f.state.signedHash=tx.hash;
  if(f.state.interrupt==='journal')throw Error('journal interruption');
  await lifecycle.signed(tx.hash);if(f.state.interrupt==='signed')throw Error('signed interruption');
  if(f.state.beforeBroadcast)await f.state.beforeBroadcast();await lifecycle.guard('signed');
  f.state.sends++;if(f.state.afterBroadcast)await f.state.afterBroadcast(payload);const receipt={txHash:tx.getTxHash(),status:'checkpointed',executionResult:'success',blockNumber:1,blockHash:{toString:()=>hex(42)},transactionFee:2n};
  f.receipts.set(tx.hash,receipt);journal.confirmed(receipt);return {receipt};
 }};
 f.options.accountSession.preproofRecovery=Object.freeze(cap);f.app=f.restart();
 return {...f,setEpoch:value=>epoch=value};
}
test('positive pre-proof crash reload renews fees explicitly and preserves exact action before one send',async()=>{
 const f=await preproofFixture(),prepared=await f.app.prepare({type:'like',post:'5'});f.state.interrupt='proof';
 await assert.rejects(f.app.submitPrepared(prepared.intentId),/proof interrupted/);assert.equal(f.state.sends,0);assert.equal(await f.options.accountSession.journal.inspect(),null);
 const resumed=await f.restartJournal(),view=await resumed.inspectRecovery(prepared.intentId);assert.equal(view.status,'pre-proof-review');
 f.state.fee=22n;const review=await resumed.prepareInterrupted(prepared.intentId);assert.equal(review.maximumFee,'22');assert.deepEqual(review.action,prepared.action);assert.equal(review.nonce,prepared.nonce);assert.equal(review.status,'prepared');assert.equal(f.state.sends,0);
 f.state.interrupt=null;const result=await resumed.submitPrepared(prepared.intentId);assert.equal(result.status,'confirmed');assert.equal(f.state.sends,1);assert.equal(f.state.proofs,2);
});
for(const loss of ['missing','restored','unsupported'])test(`positive pre-proof ${loss} provenance never authorizes renewed preparation`,async()=>{
 const f=await preproofFixture(),p=await f.app.prepare({type:'like',post:'5'});f.state.interrupt='proof';await assert.rejects(f.app.submitPrepared(p.intentId));
 if(loss==='missing')f.setEpoch(null);if(loss==='restored')await f.options.privateStore.rotateRecoveryEpoch();if(loss==='unsupported')delete f.options.accountSession.preproofRecovery;
 const app=f.restart();assert.notEqual((await app.inspectRecovery(p.intentId)).status,'pre-proof-review');
 const before=[...f.values];await assert.rejects(app.prepareInterrupted(p.intentId),{code:'ROLLING_RECOVERY_REQUIRED'});assert.deepEqual([...f.values],before);assert.equal(f.state.sends,0);
 if(loss==='missing')assert.equal(await f.options.privateStore.readRecoveryEpoch(),null,'inspection must not initialize authority');
});
for(const phase of ['journal','signed'])test(`positive pre-proof signed bytes win after ${phase} interruption`,async()=>{
 const f=await preproofFixture(),p=await f.app.prepare({type:'like',post:'5'});f.state.interrupt=phase;await assert.rejects(f.app.submitPrepared(p.intentId));
 assert.equal((await f.options.accountSession.journal.inspect()).txHash,f.state.signedHash);const before=[...f.values];
 await assert.rejects(f.restart().prepareInterrupted(p.intentId),{code:'ROLLING_RECOVERY_REQUIRED'});assert.deepEqual([...f.values],before);assert.equal(f.state.sends,0);assert.equal(f.state.proofs,1);
});
test('positive pre-proof predecessor stays exact and canonically acknowledged after reload',async()=>{
 const f=await preproofFixture(),first=await f.app.prepare({type:'like',post:'5'});await f.app.submitPrepared(first.intentId);
 const p=await f.app.prepare({type:'unlike',post:'5'});f.state.interrupt='proof';await assert.rejects(f.app.submitPrepared(p.intentId));
 const resumed=await f.restartJournal();assert.equal((await resumed.inspectRecovery(p.intentId)).status,'pre-proof-review');
 f.receipts.clear();await assert.rejects(resumed.prepareInterrupted(p.intentId),{code:'BB_SUBMISSION_UNKNOWN'});assert.equal(f.state.sends,1);
});
test('positive pre-proof late proof is vetoed after exact workflow revocation, before signed journal',async()=>{
 const f=await preproofFixture(),p=await f.app.prepare({type:'like',post:'5'});let release,entered;
 const started=new Promise(r=>entered=r);f.state.pauseProof=new Promise(r=>release=r);
 const original=f.options.accountSession.preproofRecovery;
 // The engine test separately validates the immutable capability; this double
 // exposes the suspended lifecycle to test a second application's exact CAS.
 f.options.accountSession.preproofRecovery={...original,send:async(...args)=>{const lifecycle=args[2],guard=lifecycle.guard;args[2]={...lifecycle,guard:async phase=>{await guard(phase);if(phase==='pre-proof')entered();}};return original.send(...args);}};
 const pending=f.restart().submitPrepared(p.intentId);await started;
 const next=await f.restart().prepareInterrupted(p.intentId);assert.equal(next.status,'prepared');release();await assert.rejects(pending,{code:'ROLLING_RECOVERY_REQUIRED'});
 assert.equal(await f.options.accountSession.journal.inspect(),null);assert.equal(f.state.sends,0);
});
test('positive pre-proof restoration/account revocation before broadcast preserves signed bytes and prevents send',async()=>{
 for(const change of ['epoch','account']){
  const f=await preproofFixture(),p=await f.app.prepare({type:'like',post:'5'});
  f.state.beforeBroadcast=async()=>{if(change==='epoch')await f.options.privateStore.rotateRecoveryEpoch();else f.state.guard=false;};
  await assert.rejects(f.app.submitPrepared(p.intentId));assert.equal(f.state.sends,0);assert.equal((await f.options.accountSession.journal.inspect()).txHash,f.state.signedHash);
 }
});

test('positive pre-proof renewed review cannot be submitted after financial restore invalidates provenance',async()=>{
 const f=await preproofFixture(),p=await f.app.prepare({type:'like',post:'5'});f.state.interrupt='proof';await assert.rejects(f.app.submitPrepared(p.intentId));
 await f.app.prepareInterrupted(p.intentId);await f.options.privateStore.rotateRecoveryEpoch();f.state.interrupt=null;
 await assert.rejects(f.restart().submitPrepared(p.intentId),{code:'ROLLING_RECOVERY_REQUIRED'});assert.equal(f.state.sends,0);assert.equal(f.state.proofs,1);
});

test('signed replacement remains authoritative after an earlier positive pre-proof renewed review',async()=>{
 const f=await replacementFixture({initialCrash:true,action:{type:'like',post:'5'}});f.validations.set(f.originalHash,{result:'invalid',reason:['Block header not found']});await f.reopen();
 const scope={account:hex(3),chainId:'31337',version:'1',rollup:'0x'+'11'.repeat(20),board:hex(1),portal:'0x'+'22'.repeat(20)};
 const slot=await createEncryptedJournalSlot({storage:f.options.privateStore,walletSecret:hex(8),walletSalt:'0',scopeText:JSON.stringify(['ROLLING_WORKFLOW_V1',l2JournalScopeText(scope)]),keyDomain:'ROLLING_WORKFLOW_V1'}),prior=await slot.read();
 await slot.write(prior,{...prior.value,preproofReview:{version:1,epoch:'a'.repeat(64),attempt:hex(100),predecessor:'b'.repeat(64)}});
 const review=await f.app.prepareReplacement(f.prepared.intentId,{expectedTxHash:f.originalHash});assert.equal(review.status,'replacement-prepared');
 f.state.crashAfterPrepare=false;assert.equal((await f.app.submitPrepared(f.prepared.intentId)).status,'confirmed');assert.equal(f.transactions.length,2);assert.equal(f.state.sends,1);
});

for(const context of ['marker','head'])for(const boundary of ['renewal','fee-estimate','submission','journal','broadcast'])test(`positive pre-proof preserves ${context} context at ${boundary}`,async()=>{
 const f=await preproofFixture(),action={type:'read-marker',expectedRevision:'0',thread:'42',throughBlock:'10'};
 const p=await f.app.prepare(action);f.state.interrupt='proof';await assert.rejects(f.app.submitPrepared(p.intentId),/proof interrupted/);
 const mutate=()=>{if(context==='head')f.state.preferenceHead=preferenceHead(true,1,1,11);else f.options.accountSession.node.getBlockData=async height=>({header:{globalVariables:{blockNumber:height==='checkpointed'?1:height}},blockHash:hex(43)});};
 if(boundary==='renewal')mutate();
 if(boundary==='fee-estimate'){const estimate=f.options.sdk.estimatePrivateFeeTransaction;f.options.sdk.estimatePrivateFeeTransaction=async input=>{const result=await estimate(input);mutate();return result;};}
 if(['renewal','fee-estimate'].includes(boundary)){
  const before=[...f.values];await assert.rejects(f.app.prepareInterrupted(p.intentId),{code:'ROLLING_RECOVERY_CONTEXT_CHANGED'});assert.deepEqual([...f.values],before);
 }else{
  await f.app.prepareInterrupted(p.intentId);f.state.interrupt=null;
  if(boundary==='submission')mutate();if(boundary==='journal')f.state.beforeJournal=mutate;if(boundary==='broadcast')f.state.beforeBroadcast=mutate;
  await assert.rejects(f.app.submitPrepared(p.intentId),{code:'ROLLING_RECOVERY_CONTEXT_CHANGED'});
 }
 assert.equal(f.state.sends,0);
 const signed=await f.options.accountSession.journal.inspect();
 if(boundary==='broadcast')assert.equal(signed.txHash,f.state.signedHash,'late veto keeps exact signed candidate');else assert.equal(signed,null,'meaning changes before preparation cannot create signed bytes');
});
test('positive pre-proof renewed Bok authorization advances to a distinct post attempt',async()=>{
 const f=await preproofFixture(bokFixture());
 f.state.afterBroadcast=async payload=>{if(payload.name==='authorize_request'){
  const [id,target,budget]=payload.args;f.state.bokRequestId=id;f.state.bokCredit=1000n-BigInt(budget);
  const abi=bokArtifact.nonDispatchPublicFunctions.find(fn=>fn.name==='request');
  f.state.bokRequest=decodeFromAbi(getFunctionReturnType(abi),[1n,BigInt(target),0n,9999999999n,BigInt(budget),BigInt(budget),0n,0n,0n,0n,0n,0n,0n,0n].map(n=>new Fr(n)));
 }};
 const authorization=await f.app.prepare(bokAction());f.state.interrupt='proof';await assert.rejects(f.app.submitPrepared(authorization.intentId),/proof interrupted/);
 const renewed=await f.app.prepareInterrupted(authorization.intentId);assert.deepEqual(renewed.action,authorization.action);f.state.interrupt=null;
 assert.equal((await f.app.submitPrepared(authorization.intentId)).status,'authorized');
 const post=await f.restart().prepareBokPost(authorization.intentId);assert.notEqual(post.intentId,authorization.intentId);assert.equal(post.bok.authorizationTxHash,f.state.signedHash);assert.equal(post.bok.requestId,authorization.bok.requestId);assert.deepEqual(post.action,authorization.action);
 assert.equal((await f.restart().submitPrepared(post.intentId)).status,'confirmed');assert.equal(f.state.sends,2);
});

for(const action of [{type:'preference',expectedRevision:'0',kind:1,target:'42',enabled:true},{type:'read-marker',expectedRevision:'0',thread:'42',throughBlock:'10'}])test(`positive pre-proof unchanged ${action.type} context renews and sends once`,async()=>{
 const f=await preproofFixture(),p=await f.app.prepare(action);f.state.interrupt='proof';await assert.rejects(f.app.submitPrepared(p.intentId),/proof interrupted/);
 const renewed=await f.restart().prepareInterrupted(p.intentId);assert.deepEqual(renewed.action,action);assert.equal(renewed.nonce,p.nonce);f.state.interrupt=null;
 const result=await f.restart().submitPrepared(p.intentId);assert.equal(result.status,'confirmed');assert.equal(f.state.sends,1);assert.equal(f.state.proofs,2);
});
