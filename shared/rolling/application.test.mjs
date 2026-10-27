import {deriveMasterNullifierHidingSecretKey,computeAppNullifierHidingKey} from '@aztec-labs/stdlib/keys';
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
import {BlockHash} from '@aztec-labs/stdlib/block';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {encodeArguments,loadContractArtifact,decodeFromAbi,getFunctionReturnType} from '@aztec-labs/stdlib/abi';
import {createL2Journal,l2JournalScopeText} from '../l2-journal.mjs';
import {createEncryptedJournalSlot} from '../journal-record.mjs';
import {Tx,TxHash,MinedTxReceipt,PendingTxReceipt,DroppedTxReceipt,mergeExecutionPayloads} from '@aztec-labs/stdlib/tx';
import {BatchCall,Contract} from '@aztec-labs/aztec.js/contracts';
import {PrivateMintAndPayFeePaymentMethod} from '../private-fee-payment.mjs';
import {SimulationError} from '@aztec-labs/stdlib/errors';
import {derivePrivateFeeBridgeSecret,isPrivateFeeCreditFailure} from '../private-fee-client.mjs';
import {prepareFundingClaim as verifyFundingClaim} from './funding-receipts.mjs';
import {BaseWallet} from '@aztec-labs/wallet-sdk/base-wallet';
import {FIELD_MODULUS} from './invocation.mjs';
import {createRollingApplication,createPendingWithdrawalSlot} from './application.mjs';
import {advanceAggregateClaim} from './aggregate-wallet.mjs';
import {createSynchronizedRollingApplication} from './synchronized-application.mjs';
import {executeRollingAction} from '../../apps/rolling/wallet-action.mjs';
import {executeAutomaticWithdrawal} from '../../apps/rolling/automatic-withdrawal.mjs';
const hex=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const artifact=loadContractArtifact(JSON.parse(fs.readFileSync(process.env.ROLLING_TEST_ARTIFACT??new URL('../../billboard/target/rolling_contract-RollingBoard.json',import.meta.url))));
// REQUIRED: run only after normal profile-protocol build/processing. Never invent
// or patch an ABI to make these cases pass against an older application artifact.
const feeArtifact=loadContractArtifact(JSON.parse(fs.readFileSync(new URL('../../billboard/target/private_fee_contract-PrivateFPC.json',import.meta.url))));
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
    if(name==='get_deposit_ids'&&state.beforeDepositIds)await state.beforeDepositIds();
    if(state.responses&&Object.hasOwn(state.responses,name))return {result:state.responses[name]};
    if(name==='effective_policy'&&state.policyReadError)throw state.policyReadError;
    if(name==='get_screen_hints'&&state.beforeHintsRead)await state.beforeHintsRead();
    if(name==='get_screen_hints'&&state.hintsReadError)throw state.hintsReadError;
    const replies={balance_of:state.bokCredit??1000n,get_plugin:{adapter:AztecAddress.fromBigIntUnsafe(state.bokAdapter??5n),enabled:state.bokEnabled!==false},request:state.bokRequest,profile_state:state.profileState??decodeFromAbi(getFunctionReturnType([...artifact.functions,...artifact.nonDispatchPublicFunctions].find(f=>f.name==='profile_state')),Array.from({length:8},()=>Fr.ZERO)),owned_name_records:('records' in state)?state.records:await ownershipPage(),get_deposit_info:[1n,9n,100n,BigInt('0x'+'33'.repeat(20)),0n,0n,0n,0n,0n,50n,56n],get_deposit_ids:[9n,0n,0n,0n,0n,0n,0n,0n,0n,0n],
      main_policy:[BigInt(state.policy),1n],effective_policy:('effectivePolicy' in state)?state.effectivePolicy:[BigInt(state.policy),1n,1n,2n,false],get_screen_hints:state.hints??decodeFromAbi(getFunctionReturnType(artifact.functions.find(f=>f.name==='get_screen_hints')),Array.from({length:28},()=>Fr.ZERO))};
    return {result:replies[name],...(name==='get_screen_hints'&&state.noteHashWitnessHints?{noteHashWitnessHints:state.noteHashWitnessHints}:{})};
  }})})};
  const feeContract={methods:new Proxy(board.methods,{get:(methods,name)=>name!=='balance_of'?methods[name]:(...args)=>({name,args,simulate:async()=>{
    state.privateReads.push({name,args,contract:'private-fee'});
    await state.beforeFeeBalance?.();if(state.feeReadError)throw state.feeReadError;
    return {result:state.feeCredit??100n};
  }})})};
  const journal={assertCanStart:async()=>{},inspectOutcome:async()=>state.outcome,inspect:async()=>state.outcome,confirmed:()=>{}};
  const owner=new AztecAddress(new Fr(3n));
  const wallet={getAccounts:async()=>[owner],getChainInfo:async()=>({chainId:31337,version:1}),sendTx:async(payload,opts)=>{
    state.sends++;state.sent={payload,opts};assert.ok([...values.values()].every(x=>!x.includes('Private Sentinel')));
    assert.equal(opts.transactionJournal,journal);if(state.failSend)throw Error('unknown after send');
    state.outcome={operation:opts.journalOperation,outcome:'success',txHash:hex(77),receipt:{txHash:hex(77),status:'checkpointed',blockNumber:1,blockHash:hex(42),transactionFee:2n}};return {receipt:{}};
  }};
  const node={getTxReceipt:async()=>({...state.outcome?.receipt,executionResult:state.outcome?.outcome==='success'?'success':'reverted'}),getBlockData:async height=>({header:{globalVariables:{blockNumber:['checkpointed','proposed'].includes(height)?1:height}},blockHash:hex(42)}),getPublicStorageAt:async(reference,address,slot)=>{const pluginId=state.pluginId??deployment.bok?.pluginId,pluginSlot=pluginId===undefined?null:await deriveStorageSlotInMap(new Fr(BigInt(artifact.storageLayout.plugins.slot)),new Fr(BigInt(pluginId)));if(pluginSlot!==null&&[0n,1n].some(offset=>BigInt(slot.toString())===BigInt(pluginSlot.toString())+offset)){(state.pluginReads??=[]).push({reference,address:String(address),slot:String(slot)});if(state.beforePluginRead)await state.beforePluginRead(slot);return new Fr(BigInt(slot.toString())===BigInt(pluginSlot.toString())?BigInt(state.bokAdapter??5):BigInt(state.pluginEnabledValue??(state.bokEnabled!==false?1:0)));}if(BigInt(slot.toString())===BigInt(artifact.storageLayout.main_version.slot)){(state.policyReads??=[]).push({reference,address:String(address)});if(state.beforePolicyRead)await state.beforePolicyRead();return new Fr(state.policy);}(state.nameReads??=[]).push({reference,address:address.toString(),slot:slot.toString()});if(state.nameReadError)throw state.nameReadError;if(state.beforeNameRead)await state.beforeNameRead();return new Fr(state.nameRegistered??0n);}};wallet.aztecNode=node;wallet.pxe={prepareBoardActionState:async input=>{(state.readinessPreparations??=[]).push(input);},node:{getL1ToL2MessageMembershipWitness:async()=>{throw Error('Unexpected fixture membership read');}},getSyncedBlockHeader:async()=>({globalVariables:{blockNumber:1,timestamp:100n},hash:async()=>hex(42)})};let random=100n;
  const sdk={deriveMasterNullifierHidingSecretKey,computeAppNullifierHidingKey,TxHash,poseidon2HashWithSeparator,deriveStorageSlotInMap,Fr:class extends Fr {static random(){return new Fr(random++);}},AztecAddress,encodeArguments,Contract:{at:address=>String(address)===hex(2)?feeContract:board},isTrustedPrivateNode:n=>n===node,isPrivateWalletForNode:(w,n)=>w===wallet&&n===node,isPrivatePXEForNode:(p,n)=>p===wallet.pxe&&n===node,
    inspectTrustedNode:async()=>{if(!state.guard)throw Error('stale trusted node');},
    prefetchBokClaimWitnesses:async input=>{(state.bokClaimWitnessPrefetches??=[]).push(input);},prefetchBoardClaimWitnesses:async input=>{(state.claimWitnessPrefetches??=[]).push(input);},prefetchOrdinaryPostWitnesses:async input=>{(state.witnessPrefetches??=[]).push(input);},likeFeeBudget:()=>({maximumFee:100n}),ordinaryPostFeeBudget:()=>({maximumFee:100n}),normalizePrivateFeeGasSettings:()=>({maximumFee:100n}),preparePrivateFeePayment:async()=>({availableCredit:100n}),estimatePrivateFeeTransaction:async input=>{
      await input.guard();state.estimates++;state.calls.push(input.interaction);
      if(input.interaction.name==='screen'&&state.screenError)throw state.screenError;
      if(['set_bio','set_avatar'].includes(input.interaction.name)){assert.equal(input.interaction.args[1],state.profileVersion??0,'stale profile version');assert((state.profileVersion??0)<0xffffffff,'profile version exhausted');}
      if(input.interaction.name==='post')assert.equal(input.interaction.args[2].expected_main_policy_version,state.policy,'policy changed');
      return {maximumFee:state.fee,payload:input.interaction,gasSettings:{ceiling:state.fee}};
    }};
  const deployment={board:{address:hex(1),artifact,instance:{address:hex(1),currentContractClassId:hex(12),originalContractClassId:hex(12)}},network:{chainId:'31337',version:'1',rollup:'0x'+'11'.repeat(20)},
    portal:'0x'+'22'.repeat(20),privateFee:{address:hex(2),artifact:feeArtifact,gasSettings:{}}};
  const accountSession={owner,wallet,node,journal,walletSecret:hex(8),walletSalt:'0'};
  const options={sdk,deployment,accountSession,privateStore,readPublicLikePage:async({posts})=>({schemaVersion:1,complete:true,scope:{chainId:deployment.network.chainId,rollupVersion:deployment.network.version,rollupAddress:deployment.network.rollup,boardAddress:hex(1)},checkpoint:{number:1,hash:hex(42)},confirmationCheckpoint:{number:1,hash:hex(42)},revision:"1",postIds:posts,items:[],nextCursor:null}),publicReader:new Proxy({},{get(){throw Error('Private access to public reader');}}),contextGuard:async()=>{assert.ok(state.guard);}};
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
  f.state.claimReads.push(input);assert.deepEqual(input.aggregateIntent,retained.intent);assert.deepEqual(input.aggregateCustody,retained.aggregateCustody);
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
test('invalid name drafts remain correctable before availability, fees or journal writes',async()=>{
 const f=fixture();
 for(const [first,last] of [['Bok','Lane'],['A'.repeat(33),'Lane'],['René','Lane'],['River','123'],[' ','Lane']]){
  await assert.rejects(f.app.prepare({type:'name',first,last}),{code:'ROLLING_NAME_INVALID'});
  assert.equal(f.state.estimates,0);assert.equal(f.state.sends,0);assert.equal(f.values.size,0);assert.equal(f.state.nameReads?.length??0,0);
 }
 const prepared=await f.app.prepare({type:'name',first:'River',last:'Lane'});
 assert.equal(prepared.status,'prepared');assert.equal(f.state.sends,0);assert.equal(f.state.estimates,1);
 // An existing intent remains authoritative; another invalid draft cannot make
 // a pending action look like a harmless form error or discard its journal.
 const saved=[...f.values.values()];
 await assert.rejects(f.app.prepare({type:'name',first:'Bok',last:'Lane'}),{code:'ROLLING_RECOVERY_REQUIRED'});
 assert.deepEqual([...f.values.values()],saved);assert.equal(f.state.estimates,1);
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
    {type:'like',post:'10'},{type:'withdraw',deposit:'9'},{type:'screen',deposit:'9'}];
  for(const action of actions){const f=fixture(),p=await f.app.prepare(action);assert.equal(p.status,'prepared');
    assert.equal((await f.app.submitPrepared(p.intentId)).status,'confirmed');}
});
test('unknown send stays fenced across replacement instances; absent receipt never authorizes retry',async()=>{
  const f=fixture(),p=await f.app.prepare({type:'like',post:'5'});f.state.failSend=true;
  await assert.rejects(f.app.submitPrepared(p.intentId));assert.equal(f.state.sends,1);
  const replacement=f.restart();assert.equal((await replacement.reconcile(p.intentId)).status,'unknown');
  await assert.rejects(replacement.submitPrepared(p.intentId),{code:'ROLLING_RECOVERY_REQUIRED'});
  await assert.rejects(replacement.prepare({type:'like',post:'5'}),{code:'ROLLING_RECOVERY_REQUIRED'});
  assert.equal(f.state.sends,1);assert.equal((await replacement.readAccountStatus()).status,'recovering');
});
test('durable fence failure prevents send; successfully saved pre-send fence cannot be retried',async()=>{
  const f=fixture(),p=await f.app.prepare({type:'like',post:'5'});f.state.failCAS=true;
  await assert.rejects(f.app.submitPrepared(p.intentId),{code:'BB_JOURNAL_INVALID'});assert.equal(f.state.sends,0);
  f.state.failCAS=false;
  const original=f.options.contextGuard,write=f.options.privateStore.compareAndSwap;let fenced=false;
  f.options.privateStore.compareAndSwap=async(...args)=>{await write(...args);fenced=true;};
  f.options.contextGuard=async()=>{await original();if(fenced)throw Error('locked after fence');};
  await assert.rejects(f.restart().submitPrepared(p.intentId));assert.equal(f.state.sends,0);
  assert.equal((await f.app.reconcile(p.intentId)).status,'unknown');
});
const displayedRules=(subboard='0',overrides={})=>({chainId:'31337',rollupVersion:'1',boardAddress:hex(1),subboard,parentVersion:'1',localVersion:subboard==='0'?'0':'1',...overrides});
for(const subboard of ['0','7'])test('displayed posting rules bind canonical preparation before durable write: '+subboard,async()=>{
 const f=fixture(),rules=displayedRules(subboard),action={type:'post',subboard,deposit:'9',content:'Displayed rules'};
 const prepared=await f.app.prepare(action,{immediate:true,postingRules:rules});assert.equal(prepared.status,'prepared');assert.equal(f.state.estimates,0);assert.equal(f.values.size,1);
 const call=f.state.privateReads.find(row=>row.name==='effective_policy');if(subboard==='0')assert.equal(f.state.policyReads.length,1);else assert(call);
});
for(const changed of ['parentVersion','localVersion','boardAddress','chainId','rollupVersion','subboard'])test('changed displayed '+changed+' fails before intent, estimate or send',async()=>{
 const f=fixture(),rules=displayedRules('0',{[changed]:changed==='boardAddress'?hex(99):'2'});
 await assert.rejects(f.app.prepare({type:'post',subboard:'0',deposit:'9',content:'Unsent'}, {immediate:true,postingRules:rules}),{code:'ROLLING_POSTING_RULES_CHANGED'});
 assert.equal(f.values.size,0);assert.equal(f.state.estimates,0);assert.equal(f.state.sends,0);
});
test('displayed rules are captured before asynchronous preparation and reject non-post use',async()=>{
 const f=fixture(),rules=displayedRules();f.state.beforePolicyRead=()=>{rules.parentVersion='99';};
 assert.equal((await f.app.prepare({type:'post',deposit:'9',content:'Captured'}, {immediate:true,postingRules:rules})).status,'prepared');
 const other=fixture();await assert.rejects(other.app.prepare({type:'like',post:'5'},{immediate:true,postingRules:displayedRules()}),{code:'ROLLING_INVALID_ACTION'});assert.equal(other.values.size,0);
});
test('rejected subboard with displayed rules leaves no unsigned intent',async()=>{
 const f=fixture();f.state.effectivePolicy=[1n,1n,1n,2n,true];
 await assert.rejects(f.app.prepare({type:'post',subboard:'7',deposit:'9',content:'Unsent'},{immediate:true,postingRules:displayedRules('7')}),{code:'ROLLING_SUBBOARD_REJECTED'});assert.equal(f.values.size,0);assert.equal(f.state.sends,0);
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
  const next=await f.app.prepare({type:'like',post:'5'});
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
  await assert.rejects(f.app.prepare({type:'like',post:'5'}),{code:'ROLLING_RECOVERY_REQUIRED'});
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
  getTxHash(){return TxHash.fromString(this.hash);}
  toBuffer(){return Buffer.from(this.hash);}
  static fromBuffer(buffer){return new JournalTx(buffer.toString());}
}
async function realJournalFixture(base){
  const f=base??fixture(),receipts=new Map();let sequence=700;
  const node=f.options.accountSession.node;
  node.getTxReceipt=async hash=>receipts.get(hash.toString());
  node.getBlock=async()=>({hash:{toString:()=>hex(42)}});
  const scope={account:hex(3),chainId:'31337',version:'1',rollup:'0x'+'11'.repeat(20),board:hex(1),portal:'0x'+'22'.repeat(20)};
  const newJournal=()=>createL2Journal({storage:f.options.privateStore,walletSecret:hex(8),walletSalt:'0',scope,Tx:JournalTx,node,waitOptions:{timeoutMs:1000,intervalMs:1},operationScope:f.options.accountSession.operationScope,contextGuard:f.options.contextGuard});
  f.options.accountSession.journal=await newJournal();
  async function install(operation,status='checkpointed',result='success'){
    const journal=f.options.accountSession.journal,previous=await journal.assertCanStart();
    const tx=new JournalTx(hex(sequence++));journal.setOperation(operation);await journal.prepare(tx,previous);
    const receipt=status==='pending'?new PendingTxReceipt(tx.getTxHash()):MinedTxReceipt.from({txHash:tx.getTxHash(),status,executionResult:result,transactionFee:0n,blockNumber:1,blockHash:BlockHash.fromString(hex(42)),slotNumber:1,txIndexInBlock:0,epochNumber:0});
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
  const second=await replacement.prepare({type:'like',post:'5'});
  replacement=await f.restartJournal(); // prepared next action survives another loss of in-memory acknowledgement
  assert.equal((await replacement.submitPrepared(second.intentId)).status,'confirmed');assert.equal(f.state.sends,2);
});
test('actual journal pending transaction arriving after prepare blocks before private simulation',async()=>{
  const f=await realJournalFixture(),p=await f.app.prepare({type:'like',post:'5'});
  await f.install('OTHER_OPERATION','pending');const estimates=f.state.estimates;
  await assert.rejects(f.app.submitPrepared(p.intentId),{code:'BB_RECOVERY_REQUIRED'});
  assert.equal(f.state.estimates,estimates);assert.equal(f.state.sends,0);
});
test('actual restarted checkpointed revert permits the next action, and reorg prevents acknowledgement',async()=>{
  const f=await realJournalFixture(),p=await f.app.prepare({type:'like',post:'5'});
  f.options.accountSession.wallet.sendTx=async(_,opts)=>{await f.install(opts.journalOperation,'checkpointed','reverted');throw Error('reverted');};
  await assert.rejects(f.app.submitPrepared(p.intentId));let replacement=await f.restartJournal();
  assert.equal((await replacement.reconcile(p.intentId)).status,'reverted');
  assert.equal((await replacement.prepare({type:'like',post:'5'})).status,'prepared');
  assert.equal([...f.receipts.values()][0].status,'checkpointed');
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
for(const reorg of [false,true])test(`acknowledged checkpointed revert rechecks its canonical anchor before estimation: ${reorg}`,async()=>{
  const f=await realJournalFixture(),p=await f.app.prepare({type:'like',post:'5'});
  const receipt=await f.install('OTHER_OPERATION','checkpointed','reverted');f.options.accountSession.journal.confirmed(receipt);
  const estimates=f.state.estimates;
  if(reorg){
    f.options.accountSession.node.getBlock=async()=>({hash:{toString:()=>hex(999)}});
    await assert.rejects(f.app.submitPrepared(p.intentId),{code:'BB_SUBMISSION_UNKNOWN'});
    assert.equal(f.state.estimates,estimates);assert.equal(f.state.sends,0);
  }else{
    assert.equal((await f.app.submitPrepared(p.intentId)).status,'confirmed');
    assert(f.state.estimates>estimates);assert.equal(f.state.sends,1);
    assert.equal(receipt.status,'checkpointed');
  }
});

// Actual SDK chain conversion, with only getNodeInfo replaced by a local value source.
test('installed BaseWallet field-valued chain identity passes strict application binding',async()=>{
  const f=fixture();let chainId=31337,rollupVersion=1;
  let installed=new BaseWallet({}, {getNodeInfo:async()=>({l1ChainId:chainId,rollupVersion})});
  f.options.accountSession.wallet.getChainInfo=()=>installed.getChainInfo();f.app=f.restart();
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

// Actual SDK signed-transaction serialization + encrypted CAS records; the proof,
// receipts and fork below are labelled chain doubles.
// SDK receipt variants retain the methods consumed by the installed waitForTx.
async function replacementFixture({initialCrash=false,action:requestedAction,base}={}){
 const f=base??fixture(),node=f.options.accountSession.node,receipts=new Map(),validations=new Map(),transactions=[];
 node.getTxReceipt=async hash=>receipts.get(String(hash))??new DroppedTxReceipt(TxHash.fromString(String(hash)));
 node.isValidTx=async tx=>validations.get(String(tx.getTxHash()))??{result:'invalid',reason:['Block header not found']};
 node.getBlock=async()=>({hash:hex(42)});
 node.getBlockData=async height=>({header:{globalVariables:{blockNumber:['checkpointed','proposed'].includes(height)?1:height}},blockHash:hex(42)});
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
  f.state.sends++;const receipt=MinedTxReceipt.from({txHash:tx.getTxHash(),status:'checkpointed',blockNumber:1,blockHash:BlockHash.fromString(hex(42)),executionResult:'success',transactionFee:3n,slotNumber:1,txIndexInBlock:0,epochNumber:0});
  receipts.set(String(tx.getTxHash()),receipt);journal.confirmed(receipt);
  return {receipt};
 };
 node.sendTx=async tx=>{
  f.state.sends++;(f.state.resumedBytes??=[]).push(Buffer.from(tx.toBuffer()).toString('hex'));
  const receipt=MinedTxReceipt.from({txHash:tx.getTxHash(),status:'checkpointed',blockNumber:1,blockHash:BlockHash.fromString(hex(42)),executionResult:'success',transactionFee:3n,slotNumber:1,txIndexInBlock:0,epochNumber:0});
  receipts.set(String(tx.getTxHash()),receipt);
 };
 f.app=f.restart();const action=requestedAction??{type:'like',post:'42'};
 const prepared=await f.app.prepare(action);let confirmed;
 if(initialCrash){f.state.crashAfterPrepare=true;f.state.beforeSubmit=async tx=>validations.set(String(tx.getTxHash()),{result:'valid'});await assert.rejects(f.app.submitPrepared(prepared.intentId),/Labelled crash/);}
 else confirmed=await f.app.submitPrepared(prepared.intentId);
 const originalHash=String(transactions[0].getTxHash());
 function fork(){receipts.delete(originalHash);}
 async function reopen(){f.options.accountSession.journal=await newJournal();f.app=f.restart();return f.app;}
 const review=()=>({expectedTxHash:originalHash});
 return {...f,prepared,confirmed,originalHash,receipts,validations,transactions,fork,reopen,review};
}
test('replacement inspection is read-only across a fork and retains original attempt and fee ceiling',async()=>{
 const f=await replacementFixture();f.fork();await f.reopen();const before=[...f.values];
 const result=await f.app.inspectRecovery(f.prepared.intentId);assert.deepEqual([...f.values],before);assert.equal(f.state.sends,1);
 assert.equal(result.status,'replacement-available');assert.equal(result.currentTxHash,f.originalHash);assert.equal(result.head,null);
 assert.equal(result.intent.maximumFee,'10');assert.equal(result.attempts[0].txHash,f.originalHash);
});
test('explicit replacement preserves immutable like and renews fee consent',async()=>{
 const f=await replacementFixture();f.fork();await f.reopen();f.state.fee=12n;
 const proposed=await f.app.prepareReplacement(f.prepared.intentId,f.review());assert.equal(f.state.sends,1);assert.equal(proposed.status,'replacement-prepared');assert.equal(proposed.maximumFee,'10');assert.equal(proposed.replacementReview.maximumFee,'12');
 assert.deepEqual(proposed.action,f.prepared.action);assert.equal(proposed.nonce,f.prepared.nonce);assert.equal(proposed.intentId,f.prepared.intentId);
 await f.reopen();const complete=await f.app.submitPrepared(proposed.intentId);assert.equal(complete.status,'confirmed');assert.equal(f.state.sends,2);assert.equal(f.state.syncs,2,'ordinary action replacement retains its fresh context synchronization');
 const report=await f.app.inspectRecovery(proposed.intentId);assert.equal(report.status,'canonical');assert.equal(report.attempts.length,2);assert.equal(report.attempts[0].txHash,f.originalHash);assert.equal(report.currentTxHash,complete.txHash);
 assert.deepEqual(complete.action,f.prepared.action);assert.equal(complete.nonce,f.prepared.nonce);
});

for(const reason of ['pending','unknown','canonical','wrong-hash'])test(`replacement fences ${reason} without a new proof or send`,async()=>{
 const f=await replacementFixture();f.fork();await f.reopen();const input=f.review();
 if(reason==='pending')f.receipts.set(f.originalHash,new PendingTxReceipt(TxHash.fromString(f.originalHash)));
 if(reason==='unknown')f.validations.set(f.originalHash,{result:'invalid',reason:['Existing nullifier']});
 if(reason==='canonical')f.receipts.set(f.originalHash,MinedTxReceipt.from({txHash:TxHash.fromString(f.originalHash),status:'checkpointed',blockNumber:1,blockHash:BlockHash.fromString(hex(42)),executionResult:'success',transactionFee:3n,slotNumber:1,txIndexInBlock:0,epochNumber:0}));
 if(reason==='wrong-hash')input.expectedTxHash=hex(123);
 const before=f.state.estimates;await assert.rejects(f.app.prepareReplacement(f.prepared.intentId,input));assert.equal(f.state.estimates,before);assert.equal(f.transactions.length,1);assert.equal(f.state.sends,1);
});
test('replacement fee growth needs renewed explicit review, not silent higher spending',async()=>{
 const f=await replacementFixture();f.fork();await f.reopen();await f.app.prepareReplacement(f.prepared.intentId,f.review());f.state.fee=11n;
 await assert.rejects(f.app.submitPrepared(f.prepared.intentId),{code:'ROLLING_FEE_CHANGED'});assert.equal(f.state.sends,1);
 const renewed=await f.app.prepareReplacement(f.prepared.intentId,f.review());assert.equal(renewed.replacementReview.maximumFee,'11');assert.equal(renewed.maximumFee,'10');await f.app.submitPrepared(renewed.intentId);assert.equal(f.state.sends,2);
});
for(const failure of ['predecessor','account'])test(`replacement beforeSubmit rechecks ${failure} after proving and keeps signed evidence`,async()=>{
 const f=await replacementFixture();f.fork();await f.reopen();await f.app.prepareReplacement(f.prepared.intentId,f.review());
 f.state.beforeSubmit=async()=>{if(failure==='predecessor')f.receipts.set(f.originalHash,new PendingTxReceipt(TxHash.fromString(f.originalHash)));if(failure==='account')f.state.guard=false;};
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
 const input=f.review(),guard=f.options.contextGuard;f.options.contextGuard=async()=>{input.expectedTxHash=hex(999);return guard();};
 const app=f.restart();const result=await app.prepareReplacement(f.prepared.intentId,input);assert.equal(result.replacementReview.sourceTxHash,f.originalHash);
});
test('replacement option proxies cannot expose arbitrary diagnostic errors',async()=>{
 const f=fixture(),input=new Proxy({},{getOwnPropertyDescriptor(){throw Error('PRIVATE_SENTINEL');}});
 await assert.rejects(f.app.prepareReplacement(hex(1),input),error=>error.code==='ROLLING_INVALID_ACTION'&&!error.message.includes('PRIVATE_SENTINEL'));
});

test('failed replacement review CAS preserves original ciphertext and fee ceiling',async()=>{
 const f=await replacementFixture();f.fork();await f.reopen();const before=[...f.values];f.state.failCAS=true;
 await assert.rejects(f.app.prepareReplacement(f.prepared.intentId,f.review()),{code:'BB_JOURNAL_INVALID'});assert.deepEqual([...f.values],before);assert.equal(f.transactions.length,1);
 f.state.failCAS=false;assert.equal((await f.app.inspectRecovery(f.prepared.intentId)).intent.maximumFee,'10');
});

test('replacement inspection attributes a canonical predecessor without naming current candidate winner',async()=>{
 const f=await replacementFixture();f.fork();await f.reopen();await f.app.prepareReplacement(f.prepared.intentId,f.review());f.state.crashAfterPrepare=true;
 await assert.rejects(f.app.submitPrepared(f.prepared.intentId));const latest=String(f.transactions[1].getTxHash());
 f.receipts.set(f.originalHash,MinedTxReceipt.from({txHash:TxHash.fromString(f.originalHash),status:'checkpointed',blockNumber:1,blockHash:BlockHash.fromString(hex(42)),executionResult:'success',transactionFee:3n,slotNumber:1,txIndexInBlock:0,epochNumber:0}));
 const report=await f.app.inspectRecovery(f.prepared.intentId);assert.equal(report.status,'canonical');assert.equal(report.currentTxHash,latest);assert.equal(report.attempts.find(row=>row.txHash===f.originalHash).status,'canonical');assert.notEqual(report.attempts.find(row=>row.txHash===latest).status,'canonical');
 await assert.rejects(f.app.prepareReplacement(f.prepared.intentId,{...f.review(),expectedTxHash:latest}));assert.equal(f.state.sends,1);
});
test('reopened account and inspection summaries restore detached replacement review and its exact ceiling',async()=>{
 const f=await replacementFixture();f.fork();await f.reopen();f.state.fee=12n;
 const proposed=await f.app.prepareReplacement(f.prepared.intentId,f.review());await f.reopen();
 const account=await f.app.readAccountStatus();assert.equal(account.status,'recovering');assert.equal(account.intent.status,'replacement-prepared');assert.deepEqual(account.intent.replacementReview,proposed.replacementReview);
 assert.equal(account.intent.maximumFee,'10');assert.deepEqual(account.intent.action,f.prepared.action);assert.equal(account.intent.nonce,f.prepared.nonce);
 account.intent.replacementReview.maximumFee='999';
 const inspected=await f.app.inspectRecovery(f.prepared.intentId);assert.deepEqual(inspected.intent.replacementReview,proposed.replacementReview);inspected.intent.replacementReview.maximumFee='777';
 assert.deepEqual((await f.app.readAccountStatus()).intent.replacementReview,proposed.replacementReview);
 f.state.fee=13n;await assert.rejects(f.app.submitPrepared(f.prepared.intentId),{code:'ROLLING_FEE_CHANGED'});assert.equal(f.state.sends,1);
 f.state.fee=12n;const confirmed=await f.app.submitPrepared(f.prepared.intentId);assert.equal(confirmed.status,'confirmed');assert.equal(confirmed.replacementReview.maximumFee,'12');assert.equal(confirmed.maximumFee,'10');assert.equal(f.state.sends,2);
});

// Exact saved-byte recovery: real SDK Tx serialization + AEAD journals, labelled
// node/proof doubles. No genuine transaction or fork acceptance is claimed.
async function savedResumeFixture({replacement=false}={}){
 const f=await replacementFixture({initialCrash:!replacement});
 if(replacement){f.fork();await f.reopen();f.state.fee=12n;await f.app.prepareReplacement(f.prepared.intentId,f.review());
  f.state.crashAfterPrepare=true;f.state.beforeSubmit=async tx=>f.validations.set(String(tx.getTxHash()),{result:'valid'});
  await assert.rejects(f.app.submitPrepared(f.prepared.intentId),/Labelled crash/);
 }
 await f.reopen();return {...f,hash:String(f.transactions.at(-1).getTxHash())};
}
for(const replacement of [false,true])test(`saved-byte ${replacement?'replacement':'original'} like resumes once after restart without estimate or proof`,async()=>{
 const f=await savedResumeFixture({replacement}),id=f.prepared.intentId,before=[...f.values],estimates=f.state.estimates,proofs=f.transactions.length,sends=f.state.sends;
 const inspection=await f.app.inspectRecovery(id);assert.deepEqual([...f.values],before);assert.equal(f.state.sends,sends);
 assert.equal(inspection.exactResume.status,'resumable');assert.equal(inspection.exactResume.txHash,f.hash);
 assert.equal(inspection.exactResume.feeSource,replacement?'replacement':'original');assert.equal(inspection.exactResume.maximumFee,replacement?'12':'10');
 assert.equal(inspection.intent.maximumFee,'10');assert.equal(inspection.intent.action.type,'like');
 inspection.exactResume.maximumFee='999';
 const restored=await f.app.readAccountStatus();assert.equal(restored.intent.maximumFee,'10');assert.equal(restored.intent.action.type,'like');
 const result=await f.app.resumeSaved(id,{expectedTxHash:f.hash});assert.equal(result.status,'confirmed');assert.equal(result.txHash,f.hash);
 assert.deepEqual(result.action,f.prepared.action);assert.equal(result.nonce,f.prepared.nonce);assert.equal(result.maximumFee,'10');
 assert.equal(f.state.sends,sends+1);assert.equal(f.state.estimates,estimates);assert.equal(f.transactions.length,proofs);
 assert.deepEqual(f.state.resumedBytes,[Buffer.from(f.transactions.at(-1).toBuffer()).toString('hex')]);
 assert.equal((await f.options.accountSession.journal.inspect()).txHash,f.hash);
 // Canonical reconciliation is read-only at the transport even after its head advanced.
 assert.equal((await f.app.inspectRecovery(id)).exactResume.status,'canonical');
 await f.app.resumeSaved(id,{expectedTxHash:f.hash});assert.equal(f.state.sends,sends+1);
});
for(const state of ['pending','unknown','invalid','wrong-hash'])test(`saved-byte recovery fences ${state} without new fees or transport`,async()=>{
 const f=await savedResumeFixture(),before=[...f.values],sends=f.state.sends,estimates=f.state.estimates;
 if(state==='pending')f.receipts.set(f.hash,new PendingTxReceipt(TxHash.fromString(f.hash)));
 if(state==='unknown')f.options.accountSession.node.getTxReceipt=async()=>{throw Error('Labelled unavailable');};
 if(state==='invalid')f.validations.set(f.hash,{result:'invalid',reason:['Existing nullifier']});
 const view=await f.app.inspectRecovery(f.prepared.intentId);
 await assert.rejects(f.app.resumeSaved(f.prepared.intentId,{expectedTxHash:state==='wrong-hash'?hex(999):f.hash}));
 assert.equal(f.state.sends,sends);assert.equal(f.state.estimates,estimates);assert.equal(f.transactions.length,1);assert.deepEqual([...f.values],before);
});
test('replacement quote cannot be attributed to unchanged old signed candidate',async()=>{
 const f=await replacementFixture();f.fork();await f.reopen();await f.app.prepareReplacement(f.prepared.intentId,f.review());
 f.validations.set(f.originalHash,{result:'valid'});
 const report=await f.app.inspectRecovery(f.prepared.intentId);assert.equal(report.exactResume.status,'unknown');assert.equal(report.exactResume.feeSource,null);assert.equal(report.exactResume.maximumFee,null);
 await assert.rejects(f.app.resumeSaved(f.prepared.intentId,{expectedTxHash:f.originalHash}),{code:'ROLLING_RECOVERY_REQUIRED'});assert.equal(f.state.sends,1);
});
for(const failure of ['account','ciphertext'])test(`saved-byte beforeSubmit revalidates ${failure} after synchronization`,async()=>{
 const f=await savedResumeFixture(),original=f.options.accountSession.wallet.pxe.sync;let syncs=0;
 f.options.accountSession.wallet.pxe.sync=async()=>{await original();if(++syncs===2){
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
 const f=await savedResumeFixture(),before=[...f.values];f.options.accountSession.node.sendTx=async tx=>{f.state.sends++;f.receipts.set(f.hash,new PendingTxReceipt(tx.getTxHash()));throw Error('Labelled lost acknowledgement');};
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
 if(predecessor==='pending')f.receipts.set(f.originalHash,new PendingTxReceipt(TxHash.fromString(f.originalHash)));
 if(predecessor==='unknown')f.validations.set(f.originalHash,{result:'invalid',reason:['Existing nullifier']});
 if(predecessor==='canonical')f.receipts.set(f.originalHash,MinedTxReceipt.from({txHash:TxHash.fromString(f.originalHash),status:'checkpointed',blockNumber:1,blockHash:BlockHash.fromString(hex(42)),executionResult:'success',transactionFee:3n,slotNumber:1,txIndexInBlock:0,epochNumber:0}));
 assert.equal((await f.app.inspectRecovery(f.prepared.intentId)).exactResume.status,'unknown');
 await assert.rejects(f.app.resumeSaved(f.prepared.intentId,{expectedTxHash:f.hash}));
 assert.equal(f.state.sends,sends);assert.equal(f.state.estimates,estimates);assert.deepEqual([...f.values],before);
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
const moderatorActions=[{type:'moderate-post',post:'8',reason:'Spam removal'},{type:'moderate-avatar',name:'7',reason:'Unsafe image'},{type:'reject-subboard',subboard:'9',reason:'Violates parent rules'},{type:'set-main-policy',rules:'Keep discussion civil.'},{type:'transfer-moderator',successor:hex(99)}];
test('Moderator actions bind actual public ABI, canonical authority and separately confirmed fees without collateral',async()=>{
 for(const action of moderatorActions){
  const f=moderatorFixture();assert.deepEqual(await f.app.readModeratorStatus(),{authorized:true});const prepared=await f.app.prepare(action);
  assert.equal(prepared.moderation.mainVersion,1);assert.equal(f.state.sends,0);assert.equal(prepared.maximumFee,'10');
  assert(f.state.storageReads.every(row=>row.ref.hash===hex(42)&&row.address===hex(1)));
  assert(!f.state.privateReads.some(row=>row.name==='get_screen_hints'));const expected=({ 'moderate-post':'remove_post','moderate-avatar':'remove_avatar','reject-subboard':'reject_subboard','set-main-policy':'set_main_policy','transfer-moderator':'transfer_moderator'})[action.type];
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

function collateralFixture(){const f=fixture();f.options.funding={verifyWithdrawal:async()=>f.state.refunded===true};f.app=f.restart();return f;}
test('RC22 balances page uses owned private utilities, exact zero fee and anchored maturity without public account lookup',async()=>{
 const f=collateralFixture();f.state.feeCredit=0n;const b=await f.app.readBalances();
 assert.equal(b.fee.available,'0');assert.equal(b.fee.withdrawal,'not-supported');assert.equal(b.collateral.deposits[0].amount,'100');assert.equal(b.collateral.deposits[0].depositId,hex(56));assert.equal(b.collateral.deposits[0].eligible,true);assert.equal(b.collateral.nextCursor,null);assert.equal(b.bok,null);
 assert(f.state.privateReads.every(r=>!r.name.includes('public')));assert.equal(f.state.sends,0);
});
test('RC22 collateral reports screening debt and time lock independently and rejects exit preparation',async()=>{
 for(const [screened,last,time,reason]of [[0n,1n,50n,'screening-required'],[1n,1n,101n,'time-locked']]){
  const f=collateralFixture();f.state.responses={get_deposit_info:[1n,9n,100n,BigInt('0x'+'33'.repeat(20)),0n,1n,0n,screened,last,time,56n]};
  assert.equal((await f.app.readBalances()).collateral.deposits[0].reason,reason);
  await assert.rejects(f.app.prepare({type:'withdraw',deposit:'9'}),{code:'ROLLING_WITHDRAWAL_NOT_READY'});assert.equal(f.state.sends,0);
 }
});
test('RC22 balances reject malformed owned deposits, stale anchors and noncontiguous pages',async()=>{
 for(const mode of ['identity','anchor','gap']){const f=collateralFixture();
  if(mode==='identity')f.state.responses={get_deposit_info:Array(11).fill(0n)};
  if(mode==='gap')f.state.responses={get_deposit_ids:[9n,0n,10n,...Array(7).fill(0n)]};
  if(mode==='anchor')f.options.accountSession.node.getBlockData=async()=>({header:{globalVariables:{blockNumber:1}},blockHash:hex(99)});
  await assert.rejects(f.app.readBalances());assert.equal(f.state.sends,0);
 }
});
test('RC22 exit preserves original depositor independently of unrelated private actions',async()=>{
 const f=collateralFixture(),review=await f.app.prepare({type:'withdraw',deposit:'9'});assert.equal(review.maximumFee,'10');assert.equal(review.withdrawal.depositor,'0x'+'33'.repeat(20));
 const confirmed=await f.app.submitPrepared(review.intentId);assert.equal(confirmed.status,'confirmed');
 const reopened=f.restart();assert.equal((await reopened.readWithdrawal()).withdrawal.amount,'100');
 const status=await reopened.readAccountStatus();assert.equal(status.status,'fee-ready');assert.equal(status.pendingWithdrawal.intentId,review.intentId);
 await reopened.prepare({type:'like',post:'1'});assert.equal(f.state.sends,1);assert.equal((await reopened.readWithdrawal()).intentId,review.intentId);
});
test('RC22 exit submit rechecks private receipt and never gates withdrawal on rejected public policy',async()=>{
 const f=collateralFixture();f.state.policyReadError=Error('rejected');const review=await f.app.prepare({type:'withdraw',deposit:'9'});
 f.state.responses={get_deposit_info:[1n,9n,101n,BigInt('0x'+'33'.repeat(20)),0n,0n,0n,0n,0n,50n,56n]};
 await assert.rejects(f.app.submitPrepared(review.intentId),{code:'ROLLING_WITHDRAWAL_NOT_READY'});assert.equal(f.state.sends,0);
});
test('RC22 a moving PXE anchor fails balances even when the earlier block remains canonical',async()=>{
 const f=collateralFixture();let reads=0;f.options.accountSession.wallet.pxe.getSyncedBlockHeader=async()=>({globalVariables:{blockNumber:++reads===1?1:2,timestamp:100n},hash:async()=>hex(42)});
 await assert.rejects(f.app.readBalances(),{code:'ROLLING_CONTEXT_CHANGED'});assert.equal(f.state.sends,0);
});
test('RC22 collateral page continuation is bounded and a full page never implies exhaustion',async()=>{
 const f=collateralFixture();f.state.responses={get_deposit_ids:Array.from({length:10},(_,i)=>BigInt(i+1))};
 const original=f.options.sdk.Contract.at;f.options.sdk.Contract.at=async(...args)=>{const board=await original(...args);return {methods:new Proxy(board.methods,{get(target,name){if(name!=='get_deposit_info')return target[name];return(owner,id)=>({simulate:async()=>({result:[1n,BigInt(id),100n,BigInt('0x'+'33'.repeat(20)),0n,0n,0n,0n,0n,50n,56n]})});}})};};
 const first=await f.app.readBalances(),page=await f.app.readBalances({cursor:first.collateral.nextCursor});assert.equal(page.collateral.deposits.length,10);assert.equal(typeof page.collateral.nextCursor,'string');assert.notEqual(page.collateral.nextCursor,first.collateral.nextCursor);assert.equal(page.collateral.complete,false);assert(f.state.privateReads.some(r=>r.name==='get_deposit_ids'&&r.args[1]===10));await assert.rejects(f.app.readBalances({cursor:first.collateral.nextCursor}),{code:'ROLLING_BALANCE_CURSOR_INVALID'});await assert.rejects(f.restart().readBalances({cursor:page.collateral.nextCursor}),{code:'ROLLING_BALANCE_CURSOR_INVALID'});
});
test('RC22 unresolved local fee reservation is explicit and never double-deducts private note balance',async()=>{
 const f=collateralFixture();f.state.feeCredit=1000n;const review=await f.app.prepare({type:'like',post:'1'});f.state.failSend=true;
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
 await f.restart().submitPrepared(intent.intentId);assert.equal((await f.restart().readWithdrawal()).withdrawal.nonce,intent.withdrawal.nonce);
 assert.equal((await f.restart().prepare({type:'name',first:'River',last:'Stone'})).status,'prepared');
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
test('RC22 accounting advances an empty proposed-only public page without changing confirmed funds',async()=>{
 const f=bokAccountingFixture([13n]);f.pages[0].requests=[];
 const result=await finishBokAccounting(f);
 assert.equal(f.trace.length,2);assert.equal(result.available,'1000');
 assert.deepEqual(result.requests.map(r=>r.requestId),[hex(13)]);
 assert.equal(result.totals.refunded,'10');assert.equal(f.state.sends,0);
});
test('RC22 accounting rejects a cycle across empty public pages',async()=>{
 const f=bokAccountingFixture([]),a=f.pages[0].nextCursor,b='c'.repeat(32)+':'+hex(14).slice(2)+':'+'d'.repeat(16);
 let reads=0;f.options.readBokAccountingPage=async()=>({...f.pages[0],requests:[],nextCursor:++reads===2?b:a});f.app=f.restart();
 await assert.rejects(finishBokAccounting(f),{code:'ROLLING_INVALID_RESPONSE'});
 assert.equal(reads,3);assert.equal(f.state.sends,0);
});
for(const defect of ['zero-tail','duplicate','deployment','negative','noncanonical-cursor'])test('RC22 accounting rejects '+defect,async()=>{
 const f=bokAccountingFixture();
 if(defect==='zero-tail')f.state.responses.owned_requests=[0n,11n,...Array(6).fill(0n)];
 if(defect==='duplicate')f.state.responses.owned_requests=[11n,11n,...Array(6).fill(0n)];
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
 const directory=fs.realpathSync(mkdtempSync(join(tmpdir(),'bok-cursor-'))),scope={chainId:'31337',rollupVersion:'1',rollupAddress:'0x'+'11'.repeat(20),boardAddress:hex(42),classId:(await getContractClassFromArtifact(artifact)).id.toString()};
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
 if(mutation==='pending')f.receipts.set(hash,new PendingTxReceipt(TxHash.fromString(hash)));
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
  if(kind==='withdraw')f.state.responses={get_deposit_info:[1n,9n,100n,BigInt('0x'+'33'.repeat(20)),0n,1n,0n,0n,1n,50n,56n]};
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
  if(kind==='withdraw')f.state.responses={get_deposit_info:[1n,9n,100n,BigInt('0x'+'33'.repeat(20)),0n,1n,0n,0n,1n,50n,56n]};
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
 const cap={checkpoint:async options=>{(f.state.checkpointOptions??=[]).push(options);const p=await f.options.accountSession.journal.assertCanStart(options);return {encoded:p.encoded};},send:async(payload,opts,lifecycle)=>{
  f.state.proofs=(f.state.proofs??0)+1;const journal=f.options.accountSession.journal;journal.setOperation(opts.journalOperation);const prior=await journal.assertCanStart();
  await lifecycle.guard('preparing');if(f.state.interrupt==='proof')throw Error('proof interrupted');
  if(f.state.pauseProof)await f.state.pauseProof;if(f.state.beforeJournal)await f.state.beforeJournal();await lifecycle.guard('pre-proof');
  const tx=new JournalTx(hex(serial++));await journal.prepare(tx,prior);f.state.signedHash=tx.hash;
  if(f.state.interrupt==='journal')throw Error('journal interruption');
  await lifecycle.signed(tx.hash);if(f.state.interrupt==='signed')throw Error('signed interruption');
  if(f.state.beforeBroadcast)await f.state.beforeBroadcast();await lifecycle.guard('signed');
  f.state.sends++;if(f.state.afterBroadcast)await f.state.afterBroadcast(payload);const receipt=MinedTxReceipt.from({txHash:tx.getTxHash(),status:'checkpointed',executionResult:'success',blockNumber:1,blockHash:BlockHash.fromString(hex(42)),transactionFee:2n,slotNumber:1,txIndexInBlock:0,epochNumber:0});
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
for(const loss of ['missing','restored','unsupported'])test(`positive pre-proof ${loss} provenance with a completed predecessor remains inspectable and closed`,async()=>{
 const f=await preproofFixture(),first=await f.app.prepare({type:'like',post:'5'});await f.app.submitPrepared(first.intentId);
 const p=await f.app.prepare({type:'like',post:'5'});f.state.interrupt='proof';await assert.rejects(f.app.submitPrepared(p.intentId));
 if(loss==='missing')f.setEpoch(null);if(loss==='restored')await f.options.privateStore.rotateRecoveryEpoch();if(loss==='unsupported')delete f.options.accountSession.preproofRecovery;
 const before=[...f.values],app=await f.restartJournal(),view=await app.inspectRecovery(p.intentId);
 assert.equal(view.status,'unknown');assert.equal(view.currentTxHash,null);assert.deepEqual(view.attempts,[]);assert.equal(view.exactResume.status,'empty');
 await assert.rejects(app.prepareInterrupted(p.intentId),{code:'ROLLING_RECOVERY_REQUIRED'});assert.deepEqual([...f.values],before);assert.equal(f.state.sends,1);
});
for(const phase of ['journal','signed'])test(`positive pre-proof signed bytes win after ${phase} interruption`,async()=>{
 const f=await preproofFixture(),p=await f.app.prepare({type:'like',post:'5'});f.state.interrupt=phase;await assert.rejects(f.app.submitPrepared(p.intentId));
 assert.equal((await f.options.accountSession.journal.inspect()).txHash,f.state.signedHash);const before=[...f.values];
 await assert.rejects(f.restart().prepareInterrupted(p.intentId),{code:'ROLLING_RECOVERY_REQUIRED'});assert.deepEqual([...f.values],before);assert.equal(f.state.sends,0);assert.equal(f.state.proofs,1);
});
async function aggregateInterruptedFixture(usdc=false,{legacy=false,interrupt='proof',includeBok=true}={}){
 const base=aggregateClaimFixture(usdc);
 if(!includeBok){delete base.action.bokReceipt;delete base.options.deployment.bok;delete base.retained.bokScope;delete base.retained.recipientSalt;delete base.retained.bridgeSecret;base.options.resolveBok=async()=>assert.fail('Two-leg claim must not resolve Bok');}
 const f=await preproofFixture(base);
 const first=await f.app.prepare({type:'like',post:'5'});await f.app.submitPrepared(first.intentId);
 const p=await f.app.prepare(f.action);f.state.interrupt=interrupt;await assert.rejects(f.app.submitPrepared(p.intentId));
 const scope={account:hex(3),chainId:'31337',version:'1',rollup:'0x'+'11'.repeat(20),board:hex(1),portal:'0x'+'22'.repeat(20)};
 const slot=await createEncryptedJournalSlot({storage:f.options.privateStore,walletSecret:hex(8),walletSalt:'0',scopeText:JSON.stringify(['ROLLING_WORKFLOW_V1',l2JournalScopeText(scope)]),keyDomain:'ROLLING_WORKFLOW_V1'});
 if(legacy){const before=await slot.read(),next={...before.value};delete next.fundingFee;await slot.write(before,next);}
 await f.options.privateStore.rotateRecoveryEpoch();const app=await f.restartJournal();return {...f,p,slot,app};
}
for(const usdc of [false,true])for(const includeBok of [false,true])test(`restored ${usdc?'USDC':'ETH'} ${includeBok?'three':'two'}-leg aggregate pre-proof claim renews only original bridged payment and preserves predecessor`,async()=>{
 const f=await aggregateInterruptedFixture(usdc,{legacy:!usdc,includeBok}),before=await f.slot.read();
 assert.equal((await f.app.inspectRecovery(f.p.intentId)).status,'aggregate-claim-review');
 const journal=await f.options.accountSession.preproofRecovery.checkpoint();
 f.state.fee=25n;const review=await f.app.prepareInterrupted(f.p.intentId),after=await f.slot.read();
 assert.equal(review.maximumFee,'25');assert.deepEqual(review.action,f.p.action);assert.equal(review.nonce,f.p.nonce);
 assert.deepEqual(after.value.preproofHistory,[before.value.preproof]);assert.equal(after.value.preproofReview.epoch,await f.options.privateStore.readRecoveryEpoch());
 assert.equal(after.value.preproofReview.predecessor,before.value.preproof.predecessor);assert.deepEqual(await f.options.accountSession.preproofRecovery.checkpoint(),journal);
 assert.deepEqual(after.value.fundingFee,{amount:'200',salt:hex(90),leafIndex:'3'});assert.equal(f.state.sends,1);
 if(!includeBok){assert.equal(after.value.fundingBok,undefined);assert.equal(after.value.action.bokReceipt,undefined);assert(f.state.claimReads.every(row=>['collateral','private-fee'].includes(row.kind)));}
 f.state.interrupt=null;assert.equal((await f.app.submitPrepared(f.p.intentId)).status,'confirmed');assert.equal(f.state.sends,2);
 assert(f.state.payments.slice(2).every(row=>row.claim?.amount==='200'&&row.claim.salt===hex(90)&&row.claim.leafIndex==='3'));
});
for(const change of ['signed','missing-custody','wrong-kind','mixed-receipt','changed-claim','changed-fee','spent-bridge','predecessor-reorg','epoch-during-estimate'])test(`restored aggregate pre-proof ${change} cannot renew or send`,async()=>{
 const f=await aggregateInterruptedFixture(false,{interrupt:change==='signed'?'journal':'proof'});
 if(change==='missing-custody')f.state.missingContext=true;
 if(change==='wrong-kind')f.retained.intent.expected.kind='deposit';
 if(change==='mixed-receipt'){const before=await f.slot.read();await f.slot.write(before,{...before.value,action:{...before.value.action,feeReceipt:{...before.value.action.feeReceipt,txHash:hex(99)}}});}
 if(change==='changed-claim')f.state.changedClaim=true;
 if(change==='changed-fee'){const original=f.options.sdk.prepareFundingClaim;f.options.sdk.prepareFundingClaim=async input=>{const out=await original(input);if(input.kind==='private-fee')out.claim.bridgeClaim.salt=hex(99);return out;};}
 if(change==='spent-bridge'){f.options.sdk.estimatePrivateFeeTransaction=async input=>{assert(input.prepared);throw Object.assign(Error('native duplicate setup nullifier'),{code:'PRIVATE_FEE_PREPARATION_FAILED'});};}
 if(change==='predecessor-reorg')f.receipts.clear();
 if(change==='epoch-during-estimate'){const original=f.options.sdk.estimatePrivateFeeTransaction;f.options.sdk.estimatePrivateFeeTransaction=async input=>{const out=await original(input);f.setEpoch('d'.repeat(64));return out;};}
 const before=[...f.values];await assert.rejects(f.app.prepareInterrupted(f.p.intentId));assert.deepEqual([...f.values],before);assert.equal(f.state.sends,1);
});
test('restored aggregate pre-proof renewed review retains bridge identity through final submission',async()=>{
 const f=await aggregateInterruptedFixture();await f.app.prepareInterrupted(f.p.intentId);const before=[...f.values];
 const original=f.options.sdk.prepareFundingClaim;f.options.sdk.prepareFundingClaim=async input=>{const out=await original(input);if(input.kind==='private-fee')out.claim.bridgeClaim.leafIndex='99';return out;};
 f.state.interrupt=null;await assert.rejects(f.app.submitPrepared(f.p.intentId),{code:'ROLLING_FUNDING_MISMATCH'});assert.deepEqual([...f.values],before);assert.equal(f.state.sends,1);
});
test('positive pre-proof predecessor stays exact and canonically acknowledged after reload',async()=>{
 const f=await preproofFixture(),first=await f.app.prepare({type:'like',post:'5'});await f.app.submitPrepared(first.intentId);
 const p=await f.app.prepare({type:'like',post:'5'});f.state.interrupt='proof';await assert.rejects(f.app.submitPrepared(p.intentId));
 const resumed=await f.restartJournal();assert.equal((await resumed.inspectRecovery(p.intentId)).status,'pre-proof-review');
 f.receipts.clear();await assert.rejects(resumed.prepareInterrupted(p.intentId),{code:'BB_SUBMISSION_UNKNOWN'});assert.equal(f.state.sends,1);
});
test('positive pre-proof late proof is vetoed after exact workflow revocation, before signed journal',async()=>{
 const f=await preproofFixture(),p=await f.app.prepare({type:'like',post:'5'});let release,entered;
 const started=new Promise(r=>entered=r);f.state.pauseProof=new Promise(r=>release=r);
 const original=f.options.accountSession.preproofRecovery;
 // The engine test separately validates the immutable capability; this double
 // exposes the suspended lifecycle to test a second application's exact CAS.
 f.options.accountSession.preproofRecovery={...original,send:async(...args)=>{const lifecycle=args[2],guard=lifecycle.guard;args[2]={...lifecycle,guard:async phase=>{await guard(phase);if(phase==='preparing')entered();}};return original.send(...args);}};
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

test('funding prepare preserves the state needed by the session waiter without saving a claim',async()=>{
 for(const reason of ['l1-finality','l2-delivery']){
  const f=fundingFixture();f.options.sdk.prepareFundingClaim=async()=>({status:'waiting',reason});
  await assert.rejects(f.restart().prepare({type:'claim-deposit',receipt:f.receipt}),{code:'ROLLING_FUNDING_NOT_READY',reason});
  assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
 }
});

 test('empty recovery journal rejects a missing intent without dereferencing null or writing state',async()=>{
  const f=fixture();
  for(const id of [undefined,null,'',hex(999)])await assert.rejects(f.app.inspectRecovery(id),{code:'ROLLING_INTENT_NOT_FOUND'});
  assert.equal(f.values.size,0);assert.equal(f.state.sends,0);
 });

test('moderator transfer rejects zero/self and authority changes before submission',async()=>{
 for(const successor of ['0',hex(3)]){const f=moderatorFixture();await assert.rejects(f.app.prepare({type:'transfer-moderator',successor}));assert.equal(f.state.sends,0);}
 const f=moderatorFixture(),p=await f.app.prepare({type:'transfer-moderator',successor:hex(99)});
 assert.equal(p.moderation.successor,hex(99));f.state.moderator=99n;
 assert.deepEqual(await f.app.readModeratorStatus(),{authorized:false});await assert.rejects(f.app.submitPrepared(p.intentId),{code:'ROLLING_MODERATOR_REQUIRED'});assert.equal(f.state.sends,0);
});

test('funding receipt fences check local identity without repeating network attestation per read',async()=>{
 const f=fundingFixture(),counts={node:0,chain:0,accounts:0};
 for(const [object,name,key]of [[f.options.sdk,'inspectTrustedNode','node'],[f.options.accountSession.wallet,'getChainInfo','chain'],[f.options.accountSession.wallet,'getAccounts','accounts']]){const original=object[name];object[name]=async(...args)=>{counts[key]++;return original(...args);};}
 const original=f.options.sdk.prepareFundingClaim;
 f.options.sdk.prepareFundingClaim=async input=>{const before={...counts};for(let i=0;i<20;i++)await input.contextGuard();assert.deepEqual(counts,before);return original(input);};
 f.app=f.restart();await f.app.prepare({type:'claim-deposit',receipt:f.receipt});assert.equal(counts.node,1);assert.equal(counts.chain,1);assert.equal(counts.accounts,1);assert.equal(f.state.sends,0);
});
for(const change of ['local-owner','network-chain'])test('funding verification refuses '+change+' changes before using a derived claim',async()=>{
 const f=fundingFixture(),original=f.options.sdk.prepareFundingClaim;
 f.options.sdk.prepareFundingClaim=async input=>{const result=await original(input);if(change==='local-owner'){f.options.accountSession.owner=AztecAddress.fromBigIntUnsafe(99n);await input.contextGuard();}else f.options.accountSession.wallet.getChainInfo=async()=>({chainId:1,version:1});return result;};
 f.app=f.restart();await assert.rejects(f.app.prepare({type:'claim-deposit',receipt:f.receipt}),{code:'ROLLING_CONTEXT_CHANGED'});assert.equal(f.state.estimates,0);assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
});

for(const immediate of [false,true])test('stuck deposit cancellation retains refund identity, immediate='+immediate, async () => {
 const f = fundingFixture();
 const receipt = {...f.receipt, depositId:hex(56)};
 let checks = 0;
 f.options.sdk.prepareFundingClaim = async input => {
  checks++;
  assert.equal(input.kind, 'collateral-cancel');
  assert.equal(input.owner, f.options.accountSession.owner.toString());
  assert.equal(input.secrets, undefined);
  assert.equal(input.aggregateIntent, undefined);
  assert.deepEqual(input.receipt, receipt);
  return {status:'claim-ready', claim:{contract:hex(1), method:'cancel_deposit', args:[receipt.sender,receipt.amount,receipt.depositId,receipt.leafIndex]}};
 };
 const app = f.restart();
 const prepared = await app.prepare({type:'cancel-deposit',receipt},immediate?{immediate:true}:undefined);
 assert.equal(f.state.estimates,immediate?0:1);assert.equal(prepared.maximumFee,immediate?'100':'10');
 assert.deepEqual(prepared.withdrawal,{kind:'cancelled-collateral',depositor:receipt.sender,amount:receipt.amount,depositId:receipt.depositId,eligible:true});
 const result = await app.submitPrepared(prepared.intentId);
 assert.equal(result.status,'confirmed');
 assert.equal(f.state.sends,1);
 assert.equal(f.state.sent.payload.name,'cancel_deposit');assert.equal(f.state.estimates,immediate?1:2);
 assert.equal(checks,2);
 assert.equal((await app.readWithdrawal()).withdrawal.depositId,receipt.depositId);
});


test('lazy Bok resolver is not needed for account status or ordinary post preparation',async()=>{
 const f=bokFixture(),verified=f.options.deployment.bok;delete f.options.deployment.bok;let resolutions=0;
 f.options.resolveBok=async()=>{resolutions++;throw Error('Optional plugin unavailable');};
 let app=f.restart();assert.equal((await app.readAccountStatus()).status,'fee-ready');
 await app.prepare({type:'post',deposit:'9',content:'An ordinary post',name:'0',subboard:'0'});assert.equal(resolutions,0);assert.equal(f.state.sends,0);
 await assert.rejects(app.readBokStatus(),/Optional plugin unavailable/);assert.equal(resolutions,1);
 f.options.resolveBok=async()=>{resolutions++;return verified;};app=f.restart();
 assert.equal((await app.readBokStatus()).available,true);assert.equal(resolutions,2);
 assert.equal((await app.readBokStatus()).available,true);assert.equal(resolutions,2);
});

test('immediate post skips review estimation but submission estimates and enforces configured fee ceiling',async()=>{
 const f=fixture(),action={type:'post',subboard:'0',name:'0',deposit:'9',content:'One click'};
 const prepared=await f.app.prepare(action,{immediate:true});assert.equal(prepared.maximumFee,'100');assert.equal(f.state.estimates,0);assert.equal(f.state.sends,0);
 f.state.fee=101n;await assert.rejects(f.app.submitPrepared(prepared.intentId),{code:'ROLLING_FEE_CHANGED'});assert.equal(f.state.estimates,1);assert.equal(f.state.sends,0);
 f.state.fee=10n;await f.app.submitPrepared(prepared.intentId);assert.equal(f.state.estimates,2);assert.equal(f.state.sends,1);
});
test('immediate preparation rejects malformed or unconfigured financial actions and caller fee overrides',async()=>{
 for(const options of [{immediate:false},{immediate:true,maximumFee:'999'}])await assert.rejects(fixture().app.prepare({type:'post',subboard:'0',name:'0',deposit:'9',content:'One click'},options));
 for(const action of [{type:'withdraw-bok',amount:'1',recipient:'0x'+'33'.repeat(20)},{type:'cancel-deposit',receipt:{}},{type:'transfer-moderator',moderator:hex(4)}])await assert.rejects(fixture().app.prepare(action,{immediate:true}));
});

test('immediate Bok authorizes and publishes in one exact batch, estimate and send',async()=>{
 const f=bokFixture();f.options.sdk.BatchCall=class {constructor(wallet,interactions){assert.equal(wallet,f.options.accountSession.wallet);this.name='batch';this.interactions=interactions;}};
 const app=f.restart(),prepared=await app.prepare(bokAction(),{immediate:true});assert.equal(prepared.stage,'bok-atomic');assert.equal(f.state.estimates,0);assert.equal(prepared.maximumFee,'100');
 const result=await app.submitPrepared(prepared.intentId);assert.equal(result.status,'confirmed');assert.equal(f.state.estimates,1);assert.equal(f.state.sends,1);
 const [authorize,post]=f.state.sent.payload.interactions;assert.equal(authorize.name,'authorize_request');assert.equal(post.name,'post_with_bok');assert.equal(authorize.args[0],post.args[6]);assert.equal(post.args[5],f.options.deployment.bok.pluginId);assert.equal(authorize.args[2],bokAction().budget);
 assert.equal((await app.reconcile(prepared.intentId)).status,'confirmed');assert.equal(f.state.sends,1);
});
for(const priorOutcome of ['success','reverted'])test(`terminal ${priorOutcome} atomic Bok history permits the same account after plugin replacement`,async()=>{
 const f=bokFixture();f.options.sdk.BatchCall=class {constructor(wallet,interactions){this.name='batch';this.interactions=interactions;}};
 const app=f.restart(),prepared=await app.prepare(bokAction(),{immediate:true});await app.submitPrepared(prepared.intentId);
 f.state.outcome.outcome=priorOutcome;await app.reconcile(prepared.intentId);
 f.options.deployment.bok={...f.options.deployment.bok,address:hex(95),operator:hex(96),pluginId:hex(97)};f.state.bokAdapter=95n;f.state.privateReads.length=0;
 const reopened=f.restart(),status=await reopened.readAccountStatus();
 assert.equal(status.status,'fee-ready');assert.deepEqual(status.depositIds.map(BigInt),[9n]);assert.equal(status.privateFeeCredit,'100');assert.equal(f.state.sends,1);
 assert(!f.state.privateReads.some(row=>['get_plugin','request'].includes(row.name)||(row.name==='balance_of'&&row.contract!=='private-fee')));
 assert.equal(f.state.privateReads.filter(row=>row.contract==='private-fee').length,1);
 await assert.rejects(reopened.submitPrepared(prepared.intentId),{code:'ROLLING_CONTEXT_CHANGED'});
 await assert.rejects(reopened.reconcile(prepared.intentId),{code:'ROLLING_CONTEXT_CHANGED'});
 const post=await reopened.prepare({type:'post',deposit:'9',content:'Same account, ordinary post',name:'0',subboard:'0'},{immediate:true});
 assert.equal((await reopened.submitPrepared(post.intentId)).status,'confirmed');assert.equal(f.state.sends,2);assert.equal(f.state.sent.payload.name,'post');
});
test('terminal Bok history does not require the optional plugin resolver for direct fresh preparation',async()=>{
 const f=bokFixture();f.options.sdk.BatchCall=class {constructor(wallet,interactions){this.name='batch';this.interactions=interactions;}};
 const app=f.restart(),prepared=await app.prepare(bokAction(),{immediate:true});await app.submitPrepared(prepared.intentId);
 delete f.options.deployment.bok;f.options.resolveBok=async()=>{throw Error('Historical plugin must not be loaded');};
 await f.restart().prepare({type:'post',deposit:'9',content:'Same account',name:'0',subboard:'0'},{immediate:true});assert.equal(f.state.sends,1);
});
for(const canonical of ['unknown','missing','other-operation'])test(`terminal prior-plugin history still blocks when its canonical receipt is ${canonical}`,async()=>{
 const f=bokFixture();f.options.sdk.BatchCall=class {constructor(wallet,interactions){this.name='batch';this.interactions=interactions;}};
 const app=f.restart(),prepared=await app.prepare(bokAction(),{immediate:true});await app.submitPrepared(prepared.intentId);
 f.options.deployment.bok.pluginId=hex(97);
 if(canonical==='missing')f.state.outcome=null;else if(canonical==='unknown')f.state.outcome.outcome='unknown';else f.state.outcome.operation='different-operation';
 const before=[...f.values.entries()],estimates=f.state.estimates,reopened=f.restart();assert.equal((await reopened.readAccountStatus()).status,'recovering');
 await assert.rejects(reopened.prepare({type:'post',deposit:'9',content:'Must wait',name:'0',subboard:'0'},{immediate:true}),{code:'ROLLING_RECOVERY_REQUIRED'});
 assert.equal(f.state.sends,1);assert.equal(f.state.estimates,estimates);assert.deepEqual([...f.values.entries()],before);
});
test('prior-plugin reverted legacy post and release retain their funded continuation',async()=>{
 for(const kind of ['post','release']){
  const f=await interruptedBokFixture(),intent=kind==='post'?await f.app.prepareBokPost(f.authorizedId):await f.app.prepareBokRelease(f.authorizedId,{type:'cancel-bok-request'});
  await f.app.submitPrepared(intent.intentId);f.state.outcome.outcome='reverted';await f.app.reconcile(intent.intentId);
  f.options.deployment.bok.pluginId=hex(97);const before=[...f.values.entries()],reopened=f.restart();
  await assert.rejects(reopened.readAccountStatus(),{code:'ROLLING_CONTEXT_CHANGED'});
  await assert.rejects(reopened.prepare({type:'post',deposit:'9',content:'Cannot discard funded continuation',name:'0',subboard:'0'},{immediate:true}),{code:'ROLLING_CONTEXT_CHANGED'});
  assert.equal(f.state.sends,2);assert.deepEqual([...f.values.entries()],before);
 }
});
test('prior-plugin withdrawal retains its outstanding refund independently of later actions',async()=>{
 const f=bokAccountingFixture(),intent=await f.app.prepare({type:'withdraw-bok',amount:'500',recipient:'0x'+'33'.repeat(20)});await f.app.submitPrepared(intent.intentId);
 f.options.deployment.bok.pluginId=hex(97);const reopened=f.restart();
 const status=await reopened.readAccountStatus();assert.equal(status.status,'fee-ready');assert.equal(status.pendingWithdrawal.intentId,intent.intentId);
 await reopened.prepare({type:'post',deposit:'9',content:'Refund pending',name:'0',subboard:'0'},{immediate:true});
 assert.equal(f.state.sends,1);assert.equal((await reopened.readWithdrawal()).withdrawal.nonce,intent.withdrawal.nonce);
});
test('immediate Bok batch relies on strict contract simulation and enforces total fee before sending',async()=>{
 for(const change of ['credit','parent','plugin','fee']){
  const f=bokFixture();f.options.sdk.BatchCall=class {constructor(wallet,interactions){this.interactions=interactions;}};
  // Labelled contract-simulation rejection: the actual contract assertions are
  // authorize_request.subtract and RollingBoard._publish, not utility preflights.
  const estimate=f.options.sdk.estimatePrivateFeeTransaction;
  f.options.sdk.estimatePrivateFeeTransaction=async input=>{
   const result=await estimate(input);
   if(f.state.simulationFailure)throw Error('Contract simulation: '+f.state.simulationFailure);
   return result;
  };
  const app=f.restart(),prepared=await app.prepare(bokAction(),{immediate:true});
  if(change==='fee')f.state.fee=101n;else f.state.simulationFailure=change;
  await assert.rejects(app.submitPrepared(prepared.intentId),change==='fee'?{code:'ROLLING_FEE_CHANGED'}:/Contract simulation/);
  assert.equal(f.state.estimates,1);assert.equal(f.state.sends,0);
 }
});
test('warm atomic Bok reply uses one screening utility, anchored policy storage, one strict estimate and one send',async()=>{
 const f=bokFixture();f.options.sdk.BatchCall=class {constructor(wallet,interactions){this.name='batch';this.interactions=interactions;}};
 const app=f.restart();await app.readBokStatus();f.state.privateReads.length=0;
 const prepared=await app.prepare({...bokAction(),parent:'10',root:'1'},{immediate:true});
 assert.equal(prepared.bok.availableCredit,null);assert.equal(f.state.estimates,0);
 await app.submitPrepared(prepared.intentId);
 assert.deepEqual(f.state.privateReads.map(value=>value.name),['get_screen_hints']);assert.deepEqual(f.state.policyReads,[{reference:{hash:hex(42)},address:hex(1)}]);
 assert.equal(f.state.estimates,1);assert.equal(f.state.sends,1);assert.equal(f.state.sent.opts.beforeSubmit,undefined);
});
test('cold atomic Bok binds immutable adapter once, and refuses a wrong deployment before simulation',async()=>{
 for(const wrong of [false,true]){
  const f=bokFixture();f.options.sdk.BatchCall=class {constructor(wallet,interactions){this.interactions=interactions;}};
  if(wrong)f.state.bokAdapter=8n;const app=f.restart();
  if(wrong){await assert.rejects(app.prepare(bokAction(),{immediate:true}),{code:'ROLLING_BOK_UNAVAILABLE'});assert.equal(f.state.estimates,0);assert.equal(f.state.sends,0);}
  else{const prepared=await app.prepare(bokAction(),{immediate:true});await app.submitPrepared(prepared.intentId);}
  assert.equal(f.state.privateReads.filter(row=>row.name==='get_plugin').length,0);assert.equal(f.state.pluginReads.length,2);
  assert.equal(f.state.privateReads.filter(row=>['balance_of','get_post'].includes(row.name)).length,0);
 }
});

test('a shared account flow attests network once and a new flow validates again',async()=>{
 const f=fixture();let scope={},checks=0;f.options.accountSession.operationScope=()=>scope;
 const inspect=f.options.sdk.inspectTrustedNode;f.options.sdk.inspectTrustedNode=async(...args)=>{checks++;return inspect(...args);};f.app=f.restart();
 await f.app.readAccountStatus();await f.app.prepare({type:'post',subboard:'0',name:'0',deposit:'9',content:'One flow'},{immediate:true});assert.equal(checks,1);
 scope={};await f.app.readAccountStatus();assert.equal(checks,2);
});
test('immediate collateral claim saves configured cap without a review simulation',async()=>{
 const f=fundingFixture(),prepared=await f.app.prepare({type:'claim-deposit',receipt:f.receipt},{immediate:true});assert.equal(f.state.estimates,0);assert.equal(prepared.maximumFee,'100');
 await f.app.submitPrepared(prepared.intentId);assert.equal(f.state.estimates,1);assert.equal(f.state.sends,1);
});

for(const usdc of [false,true])test(`immediate ${usdc?'USDC':'ETH'} aggregate claim keeps bridged payment and submits with one estimation`,async()=>{
 const f=aggregateClaimFixture(usdc),app=f.restart(),prepared=await app.prepare(f.action,{immediate:true});
 assert.equal(f.state.estimates,0);assert.equal(f.state.sends,0);assert.equal(prepared.maximumFee,'100');assert.equal(f.state.payments.length,1);
 const result=await app.submitPrepared(prepared.intentId);assert.equal(result.status,'confirmed');assert.equal(f.state.estimates,1);assert.equal(f.state.sends,1);
 assert.deepEqual(f.state.sent.payload.interactions.map(call=>call.name),['claim_deposit','claim']);assert(f.state.payments.every(p=>p.claim.amount==='200'));
});

test('Bok claim receives a detached authenticated purchase router scope only on its own receipt',async()=>{
 const f=topUpFixture('bok'),purchase={router:'0x'+'aa'.repeat(20),routerCodeHash:hex(95)};
 f.options.funding.bokTopupScope=purchase;const app=f.restart();purchase.router='0x'+'bb'.repeat(20);
 const prepared=await app.prepare({...f.action,feeReceipt:{...f.receipt,txHash:hex(53)}},{immediate:true});
 assert.equal(f.state.estimates,0);assert.equal(f.state.claimReads[0].bokTopupScope.router,'0x'+'aa'.repeat(20));assert.equal(f.state.claimReads[1].bokTopupScope,undefined);
 assert.equal((await app.submitPrepared(prepared.intentId)).status,'confirmed');assert.equal(f.state.sends,1);
});

for(const action of [{type:'like',post:'42'},{type:'name',first:'River',last:'Moss'},{type:'bio',name:'5',expectedVersion:'0',content:'Exact bio'},{type:'avatar',name:'5',expectedVersion:'0',width:0,height:0,data:''}])test(`immediate ${action.type} retains exact action and one submission estimate`,async()=>{
 const f=fixture(),prepared=await f.app.prepare(action,{immediate:true});assert.equal(f.state.estimates,0);assert.equal(f.state.sends,0);assert.equal(prepared.maximumFee,'100');
 assert.equal((await f.app.submitPrepared(prepared.intentId)).status,'confirmed');assert.equal(f.state.estimates,1);assert.equal(f.state.sends,1);assert.deepEqual(prepared.action,action);
});

test('immediate actions retain name admission and profile/fee submission checks',async()=>{
 const named=fixture();named.state.nameRegistered=1n;await assert.rejects(named.app.prepare({type:'name',first:'River',last:'Moss'},{immediate:true}),{code:'ROLLING_NAME_TAKEN'});assert.equal(named.state.sends,0);
 for(const [action,change] of [
  [{type:'bio',name:'5',expectedVersion:'0',content:'Exact bio'},f=>{f.state.profileVersion=1;}],
  [{type:'avatar',name:'5',expectedVersion:'0',width:0,height:0,data:''},f=>{f.state.profileVersion=1;}],
  [{type:'like',post:'42'},f=>{f.state.fee=101n;}],
 ]){const f=fixture(),prepared=await f.app.prepare(action,{immediate:true});change(f);await assert.rejects(f.app.submitPrepared(prepared.intentId),undefined,action.type);assert.equal(f.state.sends,0);}
});

test('posting policy storage overlaps screening and rejects a changed canonical anchor before saving',async()=>{
 for(const reorg of [false,true]){
  const f=fixture(),gate=Promise.withResolvers(),entered=Promise.withResolvers();let reads=0;
  const arrive=async()=>{if(++reads===2)entered.resolve();await gate.promise;};
  f.state.beforePolicyRead=arrive;f.state.beforeHintsRead=arrive;
  if(reorg)f.options.accountSession.node.getBlockData=async height=>({header:{globalVariables:{blockNumber:height}},blockHash:hex(43)});
  const pending=f.app.prepare({type:'post',deposit:'9',subboard:'0',name:'0',content:'Parallel preparation'},{immediate:true});
  await entered.promise;assert.equal(reads,2);assert.equal(f.values.size,0);gate.resolve();
  if(reorg){await assert.rejects(pending,{code:'ROLLING_CONTEXT_CHANGED'});assert.equal(f.values.size,0);}
  else{assert.equal((await pending).status,'prepared');assert.equal(f.state.estimates,0);}
 }
});

test('application reauthenticates the same-flow predecessor before and after proof',async()=>{
 const f=await preproofFixture(),prepared=await f.app.prepare({type:'like',post:'5'});await f.app.submitPrepared(prepared.intentId);
 assert.deepEqual(f.state.checkpointOptions.map(options=>options?.fresh===true),[false,false,false]);assert.equal(f.state.sends,1);
});

for(const separate of [false,true])test(`real application canonical predecessor reads across ${separate?'separate prepare/submit':'one executeAction'} scopes`,async()=>{
 let owner={};const base=fixture();base.options.accountSession.operationScope=()=>owner;
 const f=await preproofFixture(base),first=await f.app.prepare({type:'like',post:'5'});await f.app.submitPrepared(first.intentId);
 const predecessor=(await f.options.accountSession.journal.inspect()).txHash,node=f.options.accountSession.node,originalReceipt=node.getTxReceipt,originalBlock=node.getBlock;let receiptReads=0,blockReads=0;
 node.getTxReceipt=async hash=>{if(String(hash)===predecessor)receiptReads++;return originalReceipt(hash);};node.getBlock=async(...args)=>{blockReads++;return originalBlock(...args);};
 owner={};const action={type:'like',post:'5'};
 if(separate){const prepared=await f.app.prepare(action,{immediate:true});owner={};await f.app.submitPrepared(prepared.intentId);}else await executeRollingAction(f.app,action);
 assert.equal(receiptReads,separate?2:1,'One canonical observation per owned flow, exact journal checks at both proof boundaries');assert.equal(blockReads,separate?3:2,'Predecessor blocks plus the new outcome block');assert.equal(f.state.sends,2);
});

for(const reorg of [false,true])test(`cancelled unsent draft then reload acknowledges only its canonical predecessor: ${reorg}`,async()=>{
 const f=await realJournalFixture(),first=await f.app.prepare({type:'like',post:'5'});await f.app.submitPrepared(first.intentId);
 const draft=await f.app.prepare({type:'like',post:'5'},{immediate:true});await f.app.cancelPrepared(draft.intentId);
 const reopened=await f.restartJournal();
 if(reorg){f.options.accountSession.node.getBlock=async()=>({hash:{toString:()=>hex(999)}});await assert.rejects(reopened.prepare({type:'like',post:'6'},{immediate:true}),{code:'BB_SUBMISSION_UNKNOWN'});}
 else assert.equal((await reopened.prepare({type:'like',post:'6'},{immediate:true})).status,'prepared');
 assert.equal(f.state.sends,1);
});
test('cold Bok binding uses pinned native map storage without invoking the actual public getter simulation',async()=>{
 const f=bokFixture(),at=f.options.sdk.Contract.at;let fullSimulations=0;
 f.options.accountSession.wallet.simulateTx=async()=>{fullSimulations++;throw Error('Full wallet simulation must not read plugin registration');};
 f.options.sdk.Contract.at=(address,artifact,wallet)=>{const mocked=at(address,artifact,wallet),actual=Contract.at(AztecAddress.fromStringUnsafe(address.toString()),artifact,wallet);return {methods:new Proxy(mocked.methods,{get(target,name){return name==='get_plugin'?actual.methods.get_plugin:target[name];}})};};
 f.options.sdk.BatchCall=class {constructor(wallet,interactions){this.name='batch';this.interactions=interactions;}};
 const getter=artifact.nonDispatchPublicFunctions.find(fn=>fn.name==='get_plugin');assert.equal(getter.functionType,'public');
 const app=f.restart(),prepared=await app.prepare(bokAction(),{immediate:true});await app.submitPrepared(prepared.intentId);
 assert.equal(fullSimulations,0);assert.equal(f.state.pluginReads.length,2);assert(f.state.pluginReads.every(read=>read.reference.hash===hex(42)&&read.address===hex(1)));
 const slot=await deriveStorageSlotInMap(new Fr(BigInt(artifact.storageLayout.plugins.slot)),new Fr(7));assert.deepEqual(f.state.pluginReads.map(read=>BigInt(read.slot)),[slot.toBigInt(),slot.toBigInt()+1n]);
 assert.equal(f.state.sends,1);
});
for(const failure of ['unregistered','wrong-adapter','malformed-enabled','reorg','changed-anchor','context','transport','layout'])test(`anchored plugin binding rejects ${failure} before submission`,async()=>{
 const f=bokFixture();f.options.sdk.BatchCall=class {constructor(wallet,interactions){this.interactions=interactions;}};
 if(failure==='unregistered')f.state.bokAdapter=0n;
 if(failure==='wrong-adapter')f.state.bokAdapter=8n;
 if(failure==='malformed-enabled')f.state.pluginEnabledValue=2n;
 if(failure==='reorg')f.options.accountSession.node.getBlockData=async()=>({header:{globalVariables:{blockNumber:1}},blockHash:hex(43)});
 if(failure==='changed-anchor')f.state.beforePluginRead=async()=>{f.options.accountSession.wallet.pxe.getSyncedBlockHeader=async()=>({globalVariables:{blockNumber:2,timestamp:100n},hash:async()=>hex(43)});};
 if(failure==='context')f.state.beforePluginRead=async()=>{f.options.accountSession.owner=AztecAddress.fromBigIntUnsafe(4n);};
 if(failure==='transport')f.state.beforePluginRead=async()=>{throw Error('read unavailable');};
 if(failure==='layout'){const altered=structuredClone(artifact);altered.nonDispatchPublicFunctions.find(fn=>fn.name==='get_plugin').returnType.fields[1].type={kind:'field'};f.options.deployment.board.artifact=altered;}
 await assert.rejects(f.restart().prepare(bokAction(),{immediate:true}));assert.equal(f.state.sends,0);assert.equal(f.state.estimates,0);
});
test('disabled registered Bok can prepare atomically but status remains unavailable and action validation remains authoritative',async()=>{
 const f=bokFixture();f.state.bokEnabled=false;f.options.sdk.BatchCall=class {constructor(wallet,interactions){this.interactions=interactions;}};
 const app=f.restart();assert.deepEqual(await app.readBokStatus(),{available:false});const prepared=await app.prepare(bokAction(),{immediate:true});assert.equal(prepared.bok.phase,'atomic');assert.equal(f.state.sends,0);
});

test('parallel plugin storage reads drain the sibling before releasing a failed operation',async()=>{
 const f=bokFixture(),base=await deriveStorageSlotInMap(new Fr(BigInt(artifact.storageLayout.plugins.slot)),new Fr(7));let entered,release,finished=false;
 const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve),original=f.options.accountSession.node.getPublicStorageAt;
 f.options.accountSession.node.getPublicStorageAt=(ref,address,slot)=>{if(slot.toBigInt()===base.toBigInt()){entered();return gate.then(()=>new Fr(5));}if(slot.toBigInt()===base.toBigInt()+1n)throw Error('read failed');return original(ref,address,slot);};
 const pending=f.restart().prepare(bokAction(),{immediate:true}).finally(()=>{finished=true;});const rejected=assert.rejects(pending,/read failed/);await started;await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false);release();await rejected;assert.equal(f.state.sends,0);
});

test('final policy anchor RPC overlaps a queued local header only after the storage read completes',{timeout:3000},async()=>{
 const f=fixture(),storage=Promise.withResolvers(),storageEntered=Promise.withResolvers(),header=Promise.withResolvers(),headerEntered=Promise.withResolvers(),blockEntered=Promise.withResolvers();
 let headerReads=0,blockReads=0,storageFinished=false;
 const originalHeader=f.options.accountSession.wallet.pxe.getSyncedBlockHeader;
 f.state.beforePolicyRead=async()=>{storageEntered.resolve();await storage.promise;storageFinished=true;};
 f.options.accountSession.wallet.pxe.getSyncedBlockHeader=async()=>{
  if(++headerReads===2){assert.equal(storageFinished,true);headerEntered.resolve();await header.promise;}
  return originalHeader();
 };
 f.options.accountSession.node.getBlockData=async height=>{assert.equal(storageFinished,true);blockReads++;blockEntered.resolve();return {header:{globalVariables:{blockNumber:height}},blockHash:hex(42)};};
 const pending=f.app.prepare({type:'post',deposit:'9',content:'Independent final anchor reads'},{immediate:true});
 await storageEntered.promise;assert.equal(blockReads,0);storage.resolve();
 await Promise.all([headerEntered.promise,blockEntered.promise]);assert.equal(blockReads,1);assert.equal(f.values.size,0);
 header.resolve();assert.equal((await pending).status,'prepared');assert.equal(f.state.estimates,0);
});
for(const failed of ['header','block'])test(`final anchor ${failed} failure drains its independent sibling before releasing the action`,{timeout:3000},async()=>{
 const f=fixture(),held=Promise.withResolvers(),entered=Promise.withResolvers(),failure=Error('Exact '+failed+' failure');let headerReads=0,finished=false;
 const originalHeader=f.options.accountSession.wallet.pxe.getSyncedBlockHeader;
 f.options.accountSession.wallet.pxe.getSyncedBlockHeader=async()=>{
  if(++headerReads===2){if(failed==='header')throw failure;entered.resolve();await held.promise;}
  return originalHeader();
 };
 f.options.accountSession.node.getBlockData=height=>{
  if(failed==='block')throw failure;
  entered.resolve();return held.promise.then(()=>({header:{globalVariables:{blockNumber:height}},blockHash:hex(42)}));
 };
 const pending=f.app.prepare({type:'post',deposit:'9',content:'Drain failed read'},{immediate:true}).finally(()=>{finished=true;});
 const rejection=assert.rejects(pending,error=>error===failure);await entered.promise;await new Promise(resolve=>setImmediate(resolve));
 assert.equal(finished,false);assert.equal(f.values.size,0);held.resolve();await rejection;assert.equal(f.state.sends,0);
});
for(const changed of ['local-anchor','canonical-block','context'])test(`parallel final anchor checks reject ${changed} without saving an intent`,{timeout:3000},async()=>{
 const f=fixture(),scope={};f.options.accountSession.operationScope=()=>scope;let headerReads=0;const originalHeader=f.options.accountSession.wallet.pxe.getSyncedBlockHeader;
 f.options.accountSession.wallet.pxe.getSyncedBlockHeader=async()=>++headerReads===2&&changed==='local-anchor'?{globalVariables:{blockNumber:2,timestamp:100n},hash:async()=>hex(43)}:originalHeader();
 f.options.accountSession.node.getBlockData=async height=>{
  if(changed==='context')f.state.guard=false;
  return {header:{globalVariables:{blockNumber:height}},blockHash:hex(changed==='canonical-block'?43:42)};
 };
 await assert.rejects(f.app.prepare({type:'post',deposit:'9',content:'Changed anchor'},{immediate:true}),changed==='context'?undefined:{code:'ROLLING_CONTEXT_CHANGED'});
 assert.equal(f.values.size,0);assert.equal(f.state.estimates,0);assert.equal(f.state.sends,0);
});

for(const bok of [false,true])test(`immediate ${bok?'Bok':'post'} overlaps fee preparation with arguments and consumes it once`,async()=>{
 const f=bok?bokFixture():fixture();let scope={};f.options.accountSession.operationScope=()=>scope;
 if(bok)f.options.sdk.BatchCall=class {constructor(wallet,interactions){this.interactions=interactions;}};
 const hints=Promise.withResolvers(),payment=Promise.withResolvers(),both=Promise.withResolvers();let entered=0,payments=0;
 const arrive=()=>{if(++entered===2)both.resolve();};
 f.state.beforeHintsRead=async()=>{arrive();await hints.promise;};
 f.options.sdk.preparePrivateFeePayment=async()=>{payments++;arrive();await payment.promise;return {availableCredit:100n};};
 const app=f.restart(),action=bok?bokAction():{type:'post',deposit:'9',content:'Overlapping independent reads'};
 const pending=app.prepare(action,{immediate:true});await both.promise;
 assert.equal(entered,2);assert.equal(f.values.size,0);assert.equal(f.state.sends,0);
 hints.resolve();payment.resolve();const intent=await pending;
 assert.equal((await app.submitPrepared(intent.intentId)).status,'confirmed');
 assert.equal(payments,1);assert.equal(f.state.estimates,1);assert.equal(f.state.sends,1);
});
for(const failAt of ['arguments','payment'])test(`concurrent preparation drains its sibling after ${failAt} fails`,async()=>{
 const f=fixture(),scope={};f.options.accountSession.operationScope=()=>scope;
 const started=Promise.withResolvers(),sibling=Promise.withResolvers();let entered=0,settled=false;
 const arrive=()=>{if(++entered===2)started.resolve();};const failure=Error(failAt);
 f.state.beforeHintsRead=async()=>{arrive();if(failAt==='arguments')throw failure;await sibling.promise;};
 f.options.sdk.preparePrivateFeePayment=async()=>{arrive();if(failAt==='payment')throw failure;await sibling.promise;return {availableCredit:100n};};
 const app=f.restart(),pending=app.prepare({type:'post',deposit:'9',content:'Drain failures'},{immediate:true});
 const checked=assert.rejects(pending,error=>error===failure).then(()=>{settled=true;});
 await started.promise;await Promise.resolve();assert.equal(settled,false);assert.equal(f.values.size,0);
 sibling.resolve();await checked;assert.equal(f.values.size,0);assert.equal(f.state.sends,0);
});
for(const boundary of ['scope','application'])test(`prepared payment is not reused across a different ${boundary}`,async()=>{
 const f=fixture();let scope={},payments=0;f.options.accountSession.operationScope=()=>scope;
 f.options.sdk.preparePrivateFeePayment=async()=>{payments++;return {availableCredit:100n};};
 let app=f.restart();const intent=await app.prepare({type:'post',deposit:'9',content:'Fresh boundary'},{immediate:true});
 assert.equal(payments,1);if(boundary==='scope')scope={};else app=f.restart();
 await app.submitPrepared(intent.intentId);assert.equal(payments,2);assert.equal(f.state.sends,1);
});
test('concurrent fee preparation rejects a replaced flow after draining reads',async()=>{
 const f=fixture();let scope={};f.options.accountSession.operationScope=()=>scope;
 const entered=Promise.withResolvers(),gate=Promise.withResolvers();
 f.options.sdk.preparePrivateFeePayment=async()=>{entered.resolve();await gate.promise;return {availableCredit:100n};};
 const app=f.restart(),pending=app.prepare({type:'post',deposit:'9',content:'Flow identity'},{immediate:true});
 await entered.promise;scope={};gate.resolve();await assert.rejects(pending,{code:'ROLLING_CONTEXT_CHANGED'});
 assert.equal(f.values.size,0);assert.equal(f.state.sends,0);
});

test('concurrent fee preparation cannot relabel an old PXE result after replacement',async()=>{
 const f=fixture(),scope={};f.options.accountSession.operationScope=()=>scope;
 const entered=Promise.withResolvers(),gate=Promise.withResolvers();
 f.options.sdk.preparePrivateFeePayment=async()=>{entered.resolve();await gate.promise;return {availableCredit:100n};};
 const app=f.restart(),pending=app.prepare({type:'post',deposit:'9',content:'PXE identity'},{immediate:true});
 await entered.promise;const old=f.options.accountSession.wallet.pxe;f.options.accountSession.wallet.pxe={...old};
 gate.resolve();await assert.rejects(pending,{code:'ROLLING_CONTEXT_CHANGED'});assert.equal(f.values.size,0);assert.equal(f.state.sends,0);
});
test('a rewritten encrypted intent does not inherit its previous fee preparation',async()=>{
 const f=fixture();const flow={};let payments=0;f.options.accountSession.operationScope=()=>flow;
 f.options.sdk.preparePrivateFeePayment=async()=>{payments++;return {availableCredit:100n};};
 const app=f.restart(),intent=await app.prepare({type:'post',deposit:'9',content:'Record identity'},{immediate:true});
 const scope={account:hex(3),chainId:'31337',version:'1',rollup:'0x'+'11'.repeat(20),board:hex(1),portal:'0x'+'22'.repeat(20)};
 const slot=await createEncryptedJournalSlot({storage:f.options.privateStore,walletSecret:hex(8),walletSalt:'0',scopeText:JSON.stringify(['ROLLING_WORKFLOW_V1',l2JournalScopeText(scope)]),keyDomain:'ROLLING_WORKFLOW_V1'});
 const saved=await slot.read();await slot.write(saved,saved.value);
 await app.submitPrepared(intent.intentId);assert.equal(payments,2);assert.equal(f.state.sends,1);
});

test('prefetched public readiness is reused by the same flow without private work and expires with its owner',async()=>{
 const f=fixture();let scope={},checks=0;f.options.accountSession.operationScope=()=>scope;
 const inspect=f.options.sdk.inspectTrustedNode;f.options.sdk.inspectTrustedNode=async(...args)=>{checks++;return inspect(...args);};f.app=f.restart();
 const reads=f.state.privateReads.length;await f.app.prefetchContext();assert.equal(f.state.privateReads.length,reads);assert.equal(checks,1);
 await f.app.prepare({type:'post',subboard:'0',name:'0',deposit:'9',content:'One prefetched flow'},{immediate:true});assert.equal(checks,1);
 scope={};await f.app.prefetchContext();assert.equal(checks,2);
});


test('main-board policy anchor precedes private utilities and its public read overlaps both',{timeout:3000},async()=>{
 const f=fixture(),scope={};f.options.accountSession.operationScope=()=>scope;
 const headerGate=Promise.withResolvers(),headerEntered=Promise.withResolvers(),readsGate=Promise.withResolvers(),readsEntered=Promise.withResolvers();
 let headers=0,started=0;const originalHeader=f.options.accountSession.wallet.pxe.getSyncedBlockHeader;
 const arrive=()=>{assert.equal(headers,1);if(++started===3)readsEntered.resolve();};
 f.options.accountSession.wallet.pxe.getSyncedBlockHeader=async()=>{
  if(++headers===1){headerEntered.resolve();await headerGate.promise;}
  return originalHeader();
 };
 f.state.beforeHintsRead=async()=>{arrive();await readsGate.promise;};
 f.state.beforePolicyRead=async()=>{arrive();await readsGate.promise;};
 f.options.sdk.preparePrivateFeePayment=async()=>{arrive();await readsGate.promise;return {availableCredit:100n};};
 const app=f.restart(),pending=app.prepare({type:'post',deposit:'9',content:'One anchor, concurrent reads'},{immediate:true});
 await headerEntered.promise;assert.equal(started,0);headerGate.resolve();await readsEntered.promise;
 assert.equal(f.values.size,0);readsGate.resolve();assert.equal((await pending).status,'prepared');
 assert.equal(headers,2);assert.equal(f.state.policyReads.length,1);assert.equal(f.state.privateReads.filter(r=>r.name==='get_screen_hints').length,1);
 assert.equal(f.state.sends,0);
});
for(const replacement of ['scope','pxe'])test(`main-board anchor rejects ${replacement} replacement before launching sibling work`,{timeout:3000},async()=>{
 const f=fixture();let scope={};f.options.accountSession.operationScope=()=>scope;
 const entered=Promise.withResolvers(),gate=Promise.withResolvers();let payments=0;
 const originalHeader=f.options.accountSession.wallet.pxe.getSyncedBlockHeader;
 f.options.accountSession.wallet.pxe.getSyncedBlockHeader=async()=>{entered.resolve();await gate.promise;return originalHeader();};
 f.options.sdk.preparePrivateFeePayment=async()=>{payments++;return {availableCredit:100n};};
 const app=f.restart(),pending=app.prepare({type:'post',deposit:'9',content:'Exact anchor owner'},{immediate:true});
 const rejected=assert.rejects(pending,{code:'ROLLING_CONTEXT_CHANGED'});await entered.promise;
 if(replacement==='scope')scope={};else f.options.accountSession.wallet.pxe={...f.options.accountSession.wallet.pxe};
 gate.resolve();await rejected;assert.equal(payments,0);assert.equal(f.state.privateReads.length,0);assert.equal(f.values.size,0);assert.equal(f.state.sends,0);
});

test('ordinary posting credit gate creates no workflow intent or L2 submission',async()=>{
 const f=fixture();f.options.sdk.ordinaryPostFeeBudget=()=>{throw Object.assign(Error('credit gate'),{code:'BB_POST_FEE_CREDIT_REQUIRED'});};
 const app=f.restart();await assert.rejects(app.prepare({type:'post',subboard:'0',name:'0',deposit:'9',content:'Keep this unsent draft'},{immediate:true}),{code:'BB_POST_FEE_CREDIT_REQUIRED'});
 assert.equal(f.values.size,0);assert.equal(f.state.sends,0);assert.equal(f.state.estimates,0);assert.equal(f.state.sent,undefined);
});
test('ordinary submit binds its arithmetic quote to the verified board',async()=>{
 const f=fixture(),estimate=f.options.sdk.estimatePrivateFeeTransaction;let quoted;
 f.options.sdk.estimatePrivateFeeTransaction=async input=>{quoted=input.ordinaryPost;return estimate(input);};
 const app=f.restart(),prepared=await app.prepare({type:'post',subboard:'0',name:'0',deposit:'9',content:'Fixed profile'},{immediate:true});
 await app.submitPrepared(prepared.intentId);assert.equal(quoted,f.options.deployment.board.instance);assert.equal(f.state.sends,1);
});


for(const kind of ['post','like'])for(const predecessor of [false,true])test(`native ${kind} credit failure with predecessor=${predecessor} cancels only its unsigned attempt and allows a fresh post`,async()=>{
 const f=await preproofFixture();
 if(predecessor){const first=await f.app.prepare({type:'like',post:'5'});await f.app.submitPrepared(first.intentId);}f.options.sdk.isPrivateFeeCreditFailure=isPrivateFeeCreditFailure;
 const original=f.options.accountSession.preproofRecovery;let failNext=true;
 f.options.accountSession.preproofRecovery=Object.freeze({...original,send:async(payload,opts,lifecycle)=>{
  if(failNext){failNext=false;await lifecycle.guard('pre-proof');
   await opts.onProvingFailure(new SimulationError('Assertion failed: Balance too low',[{contractAddress:AztecAddress.fromFieldUnsafe(new Fr(2)),functionName:'pay_fee'}]));
   assert.fail('Native shortage must reject before transaction creation');
  }return original.send(payload,opts,lifecycle);
 }});
 const app=f.restart(),action=kind==='like'?{type:'like',post:'5'}:{type:'post',subboard:'0',name:'0',deposit:'9',content:'Keep this draft'};
 const first=await app.prepare(action,{immediate:true});await assert.rejects(app.submitPrepared(first.intentId),{code:kind==='like'?'BB_LIKE_FEE_CREDIT_REQUIRED':'BB_POST_FEE_CREDIT_REQUIRED'});
 assert.equal((await app.reconcile(first.intentId)).status,'cancelled');const previous=await f.options.accountSession.journal.inspect();assert.equal(!!previous,predecessor);assert.equal(f.state.sends,Number(predecessor));
 const next=await app.prepare(action,{immediate:true});assert.notEqual(next.intentId,first.intentId);assert.equal((await app.submitPrepared(next.intentId)).status,'confirmed');assert.equal(f.state.sends,Number(predecessor)+1);
});
for(const mismatch of ['other-contract','other-error','other-function','not-native'])test('credit error classification rejects '+mismatch,()=>{
 const error=new SimulationError(mismatch==='other-error'?'Assertion failed: unrelated':'Assertion failed: Balance too low',[{contractAddress:AztecAddress.fromFieldUnsafe(new Fr(mismatch==='other-contract'?99:2)),functionName:mismatch==='other-function'?'mint':'pay_fee'}]);
 assert.equal(isPrivateFeeCreditFailure(mismatch==='not-native'?{getOriginalMessage:()=>error.getOriginalMessage(),getCallStack:()=>error.getCallStack()}:error,hex(2)),false);
});

test('a late credit-labelled error cannot discard an already journalled transaction',async()=>{
 const f=await preproofFixture();f.options.sdk.isPrivateFeeCreditFailure=isPrivateFeeCreditFailure;
 const original=f.options.accountSession.preproofRecovery;f.state.interrupt='journal';
 f.options.accountSession.preproofRecovery=Object.freeze({...original,send:async(payload,opts,lifecycle)=>{
  try{return await original.send(payload,opts,lifecycle);}catch{
   await opts.onProvingFailure(new SimulationError('Assertion failed: Balance too low',[{contractAddress:AztecAddress.fromFieldUnsafe(new Fr(2)),functionName:'pay_fee'}]));
  }
 }});
 const app=f.restart(),first=await app.prepare({type:'post',subboard:'0',name:'0',deposit:'9',content:'Signed record must survive'},{immediate:true});
 await assert.rejects(app.submitPrepared(first.intentId),{code:'ROLLING_RECOVERY_REQUIRED'});
 assert.equal((await f.options.accountSession.journal.inspect()).txHash,f.state.signedHash);assert.equal(f.state.sends,0);
 f.receipts.set(f.state.signedHash,new PendingTxReceipt(TxHash.fromString(f.state.signedHash)));assert.notEqual((await app.reconcile(first.intentId)).status,'cancelled');
});

test('ordinary preparation binds witness prefetch to the selected board, route and hints',async()=>{
 const f=fixture();await f.app.prepare({type:'post',deposit:'9',content:'Prefetch actual history'},{immediate:true});
 assert.equal(f.state.witnessPrefetches.length,1);
 const input=f.state.witnessPrefetches[0];
 assert.equal(input.board,f.options.deployment.board.instance);assert.equal(input.artifact,f.options.deployment.board.artifact);
 assert.equal(input.wallet,f.options.accountSession.wallet);assert.equal(input.node,f.options.accountSession.node);
 assert.equal(input.hints.length,2);
});

for(const replaceScope of [false,true])test(`predecessor read overlaps owned readiness; ${replaceScope?'new owner rechecks':'same owner reuses exact journal'}`,async()=>{
 let owner={};const base=fixture();base.options.accountSession.operationScope=()=>owner;
 const f=await preproofFixture(base),first=await f.app.prepare({type:'like',post:'5'});await f.app.submitPrepared(first.intentId);
 const journal=f.options.accountSession.journal,node=f.options.accountSession.node,previous=(await journal.inspect()).txHash;
 const read=node.getTxReceipt.bind(node),inspect=f.options.sdk.inspectTrustedNode;
 let receiptReads=0,started=0;const gate=Promise.withResolvers(),entered=Promise.withResolvers();
 owner={};
 const arrive=async()=>{if(++started===2)entered.resolve();await gate.promise;};
 node.getTxReceipt=async hash=>{if(String(hash)===previous){receiptReads++;if(receiptReads===1)await arrive();}return read(hash);};
 f.options.sdk.inspectTrustedNode=async(...args)=>{await arrive();return inspect(...args);};
 f.app=f.restart();const pending=f.app.prefetchContext({predecessor:true});await entered.promise;
 assert.equal(receiptReads,1);gate.resolve();await pending;
 f.options.sdk.inspectTrustedNode=inspect;if(replaceScope)owner={};
 await f.app.prepare({type:'like',post:'5'},{immediate:true});
 assert.equal(receiptReads,replaceScope?2:1);
});
test('owned prefetch drains a pending predecessor when readiness fails',async()=>{
 let owner={};const base=fixture();base.options.accountSession.operationScope=()=>owner;
 const f=await preproofFixture(base),first=await f.app.prepare({type:'like',post:'5'});await f.app.submitPrepared(first.intentId);owner={};
 const node=f.options.accountSession.node,read=node.getTxReceipt.bind(node),gate=Promise.withResolvers(),entered=Promise.withResolvers();
 node.getTxReceipt=async hash=>{entered.resolve();await gate.promise;return read(hash);};
 f.options.sdk.inspectTrustedNode=async()=>{throw Error('readiness failed');};f.app=f.restart();
 let settled=false;const pending=f.app.prefetchContext({predecessor:true}).finally(()=>settled=true);const observed=assert.rejects(pending,/readiness failed/);
 await entered.promise;await new Promise(r=>setImmediate(r));assert.equal(settled,false);gate.resolve();await observed;
});
test('synchronized ordinary policy uses exact hash and local anchor without another canonical RPC',async()=>{
 const f=fixture(),scope={synchronized:true};f.options.accountSession.operationScope=()=>scope;let canonical=0;
 f.options.accountSession.node.getBlockData=async()=>{canonical++;throw Error('duplicate canonical read');};f.app=f.restart();
 const result=await f.app.prepare({type:'post',deposit:'9',subboard:'0',name:'0',content:'Exact owned anchor'},{immediate:true});
 assert.equal(result.status,'prepared');assert.equal(canonical,0);assert.deepEqual(f.state.policyReads.map(r=>r.reference),[{hash:hex(42)}]);
});
test('synchronized ordinary policy rejects changed local anchor before storing intent',async()=>{
 const f=fixture(),scope={synchronized:true};f.options.accountSession.operationScope=()=>scope;
 let changed=false;f.state.beforePolicyRead=()=>{changed=true;};
 f.options.accountSession.wallet.pxe.getSyncedBlockHeader=async()=>({globalVariables:{blockNumber:1,timestamp:100n},hash:async()=>hex(changed?43:42)});f.app=f.restart();
 await assert.rejects(f.app.prepare({type:'post',deposit:'9',subboard:'0',name:'0',content:'Reject changed anchor'},{immediate:true}),{code:'ROLLING_CONTEXT_CHANGED'});assert.equal(f.values.size,0);
});
test('predecessor reuse rejects a replacement authenticated journal in the same owner',async()=>{
 const owner={},base=fixture();base.options.accountSession.operationScope=()=>owner;const f=await realJournalFixture(base);
 const first=await f.app.prepare({type:'like',post:'5'});await f.app.submitPrepared(first.intentId);
 await f.app.prefetchContext({predecessor:true});await f.install('OTHER_OPERATION','pending');
 const sends=f.state.sends;await assert.rejects(f.app.prepare({type:'like',post:'5'},{immediate:true}),{code:'ROLLING_RECOVERY_REQUIRED'});assert.equal(f.state.sends,sends);
});

for(const grouped of [false,true])test(`history prefetch ${grouped?'overlaps owned execution':'is awaited by standalone preparation'}`,async()=>{
 const f=fixture(),scope=grouped?{preparationReads:[]}:{};f.options.accountSession.operationScope=()=>scope;
 const gate=Promise.withResolvers(),entered=Promise.withResolvers();let settled=false;
 f.options.sdk.prefetchOrdinaryPostWitnesses=async()=>{entered.resolve();await gate.promise;};f.app=f.restart();
 const preparing=f.app.prepare({type:'post',deposit:'9',content:'Parallel history'},{immediate:true}).then(result=>{settled=true;return result;});
 await entered.promise;if(grouped){await preparing;assert.equal(scope.preparationReads.length,1);assert.equal(settled,true);}
 else{await new Promise(r=>setImmediate(r));assert.equal(settled,false);}
 gate.resolve();await preparing;if(grouped)await Promise.all(scope.preparationReads);assert.equal(f.state.sends,0);
});
test('failed speculative history read does not override actual native execution authority',async()=>{
 const f=fixture(),scope={preparationReads:[]};f.options.accountSession.operationScope=()=>scope;
 f.options.sdk.prefetchOrdinaryPostWitnesses=async()=>{throw Error('transient prefetch failure');};f.app=f.restart();
 const prepared=await f.app.prepare({type:'post',deposit:'9',content:'Native execution retries the required read'},{immediate:true});
 assert.equal((await Promise.allSettled(scope.preparationReads))[0].status,'rejected');
 assert.equal((await f.app.submitPrepared(prepared.intentId)).status,'confirmed');assert.equal(f.state.sends,1);
});

for(const kind of ['post','like'])for(const replaceScope of [false,true])test(`${kind} fee metadata overlaps readiness and ${replaceScope?'new operation refreshes':'same operation reuses once'}`,async()=>{
 const f=fixture();let scope={preparationReads:[]};f.options.accountSession.operationScope=()=>scope;
 let started=0,payments=0;const gate=Promise.withResolvers(),entered=Promise.withResolvers(),inspect=f.options.sdk.inspectTrustedNode;
 const arrive=async()=>{if(++started===2)entered.resolve();await gate.promise;};
 f.options.sdk.inspectTrustedNode=async(...args)=>{await arrive();return inspect(...args);};
 f.options.sdk.preparePrivateFeePayment=async input=>{assert.equal(input.creditCheck,kind==='post'?'ordinary-post-proof':'qualified-like-proof');payments++;await arrive();return {creditCheck:input.creditCheck,metadata:'owned'};};f.app=f.restart();
 const reading=f.app.prefetchContext(kind==='post'?{ordinaryPayment:true}:{likePayment:true});await entered.promise;assert.equal(payments,1);assert.equal(f.state.privateReads.length,0);gate.resolve();await reading;
 if(replaceScope)scope={preparationReads:[]};
 const prepared=await f.app.prepare(kind==='post'?{type:'post',deposit:'9',content:'Early ordinary payment'}:{type:'like',post:'42'},{immediate:true});await f.app.submitPrepared(prepared.intentId);
 assert.equal(payments,replaceScope?2:1);
});
for(const kind of ['post','like'])for(const failure of ['readiness','payment'])test(`${kind} payment prefetch ${failure} failure drains independent preparation`,async()=>{
 const f=fixture(),scope={preparationReads:[]};f.options.accountSession.operationScope=()=>scope;
 const gate=Promise.withResolvers(),entered=Promise.withResolvers();let settled=false;
 f.options.sdk.inspectTrustedNode=async()=>{if(failure==='readiness')throw Error(failure);entered.resolve();await gate.promise;};
 f.options.sdk.preparePrivateFeePayment=async()=>{if(failure==='payment')throw Error(failure);entered.resolve();await gate.promise;return {};};f.app=f.restart();
 const work=f.app.prefetchContext(kind==='post'?{ordinaryPayment:true}:{likePayment:true}).finally(()=>settled=true),observed=assert.rejects(work,new RegExp(failure));
 await entered.promise;await new Promise(r=>setImmediate(r));assert.equal(settled,false);gate.resolve();await observed;assert.equal(f.values.size,0);assert.equal(f.state.sends,0);
});
for(const kind of ['post','like'])for(const replacement of ['scope','pxe'])test(`early ${kind} payment rejects ${replacement} replacement before publishing its owned result`,async()=>{
 const f=fixture();let scope={preparationReads:[]};f.options.accountSession.operationScope=()=>scope;
 const entered=Promise.withResolvers(),gate=Promise.withResolvers();f.options.sdk.preparePrivateFeePayment=async()=>{entered.resolve();await gate.promise;return {};};f.app=f.restart();
 const work=f.app.prefetchContext(kind==='post'?{ordinaryPayment:true}:{likePayment:true}),rejected=assert.rejects(work,{code:'ROLLING_CONTEXT_CHANGED'});await entered.promise;
 if(replacement==='scope')scope={};else f.options.accountSession.wallet.pxe={...f.options.accountSession.wallet.pxe};gate.resolve();await rejected;assert.equal(f.values.size,0);assert.equal(f.state.sends,0);
});

test('automatic withdrawal readiness observes the oldest post deadline at the exact account anchor',async()=>{
 const f=fixture();f.state.responses={get_deposit_info:[1n,9n,100n,BigInt('0x'+'33'.repeat(20)),0n,1n,0n,0n,1n,150n,56n]};
 f.state.hints=[{note:{schema_version:1,deposit_chain_id:9n,sequence:1n,post_id:8n,anchor_timestamp:80n,previous_link:3n,is_dummy:false},
  contract_address:new AztecAddress(new Fr(1n)),owner:f.options.accountSession.owner,randomness:20n,storage_slot:21n,metadata:{stage:1,maybe_note_nonce:22n}},null];
 const exists=await deriveStorageSlotInMap(new Fr(BigInt(artifact.storageLayout.post_exists.slot)),new Fr(8n));
 const deadline=await deriveStorageSlotInMap(new Fr(BigInt(artifact.storageLayout.post_flag_deadline.slot)),new Fr(8n));
 const reads=[];f.options.accountSession.node.getPublicStorageAt=async(reference,address,slot)=>{
  reads.push({reference,address:String(address),slot:String(slot)});
  assert.deepEqual(reference,{hash:hex(42)});
  if(String(slot)===String(exists))return Fr.ONE;
  assert.equal(String(slot),String(deadline));return new Fr(200n);
 };
 const result=await f.app.readWithdrawalReadiness('9');
 assert.deepEqual(result,{anchor:{blockNumber:1,blockHash:hex(42),timestamp:'100'},screenedSequence:'0',needsScreening:true,readyAt:'200'});
 assert.equal(reads.length,2);assert.equal(f.state.sends,0);
});
test('automatic withdrawal readiness skips history reads for an already checked deposit',async()=>{
 const f=fixture(),result=await f.app.readWithdrawalReadiness('9');
 assert.equal(result.needsScreening,false);assert.equal(result.readyAt,'50');
 assert.deepEqual(f.state.privateReads.map(v=>v.name),['get_deposit_info']);assert.equal(f.state.sends,0);
});
test('automatic withdrawal readiness rejects missing consecutive history without submitting',async()=>{
 const f=fixture();f.state.responses={get_deposit_info:[1n,9n,100n,BigInt('0x'+'33'.repeat(20)),0n,1n,0n,0n,1n,50n,56n]};
 await assert.rejects(f.app.readWithdrawalReadiness('9'),{code:'ROLLING_HISTORY_UNAVAILABLE'});assert.equal(f.state.sends,0);
});

function automaticWithdrawalFixture(needsScreening=false){
 const f=collateralFixture(),checked=()=>[1n,9n,100n,BigInt('0x'+'33'.repeat(20)),0n,1n,0n,1n,1n,50n,56n];
 f.state.responses={get_deposit_info:checked()};
 if(needsScreening){
  f.state.responses.get_deposit_info[7]=0n;
  f.state.hints=[{note:{schema_version:1,deposit_chain_id:9n,sequence:1n,post_id:8n,anchor_timestamp:80n,previous_link:3n,is_dummy:false},
   contract_address:new AztecAddress(new Fr(1n)),owner:f.options.accountSession.owner,randomness:20n,storage_slot:21n,metadata:{stage:1,maybe_note_nonce:22n}},null];
  f.options.accountSession.node.getPublicStorageAt=async()=>Fr.ONE;
 }
 const send=f.options.accountSession.wallet.sendTx;
 f.options.accountSession.wallet.sendTx=async(payload,options)=>{
  const result=await send(payload,options);
  if(payload.name==='screen'){
   if(f.state.screenOutcome)f.state.outcome.outcome=f.state.screenOutcome;
   else f.state.responses.get_deposit_info=checked();
  }
  return result;
 };
 f.run=()=>executeAutomaticWithdrawal({application:f.app,deposit:'9',guard:async()=>{},waitUntil:async()=>assert.fail('Unexpected timestamp wait')});
 return f;
}
test('automatic withdrawal uses real application immediate preparation and submission for an eligible deposit',async()=>{
 const f=automaticWithdrawalFixture(),result=await f.run();
 assert.equal(result.status,'confirmed');assert.equal(result.action.type,'withdraw');
 assert.deepEqual(f.state.calls.map(call=>call.name),['withdraw']);assert.equal(f.state.sends,1);assert.equal(f.state.estimates,1);
});
test('automatic withdrawal uses real application screen then withdraw after confirmed cursor advancement',async()=>{
 const f=automaticWithdrawalFixture(true),result=await f.run();
 assert.equal(result.status,'confirmed');assert.equal(result.action.type,'withdraw');
 assert.deepEqual(f.state.calls.map(call=>call.name),['screen','withdraw']);assert.equal(f.state.sends,2);assert.equal(f.state.estimates,2);
});
for(const needsScreening of [false,true])test(`automatic withdrawal retains fee ceiling before ${needsScreening?'screen':'withdraw'} send`,async()=>{
 const f=automaticWithdrawalFixture(needsScreening);f.state.fee=101n;
 await assert.rejects(f.run(),{code:'ROLLING_FEE_CHANGED'});assert.equal(f.state.sends,0);assert.equal(f.state.estimates,1);
});
for(const outcome of ['reverted','pending','throw'])test(`automatic withdrawal real application stops after ${outcome} screening`,async()=>{
 const f=automaticWithdrawalFixture(true);
 if(outcome==='throw'){f.state.failSend=true;await assert.rejects(f.run(),/unknown after send/);}
 else{f.state.screenOutcome=outcome;assert.equal((await f.run()).status,outcome==='pending'?'unknown':'reverted');}
 assert.deepEqual(f.state.calls.map(call=>call.name),['screen']);assert.equal(f.state.sends,1);
});
test('automatic withdrawal readiness drains a failed public read and held sibling before releasing the application',async()=>{
 const f=automaticWithdrawalFixture(true),held=Promise.withResolvers(),entered=Promise.withResolvers(),failure=Error('Read failed');let calls=0,settled=false;
 f.options.accountSession.node.getPublicStorageAt=async()=>{
  const order=++calls;if(calls===2)entered.resolve();if(order===1)throw failure;await held.promise;return Fr.ONE;
 };
 const work=f.app.readWithdrawalReadiness('9');work.then(()=>settled=true,()=>settled=true);
 const rejection=assert.rejects(work,e=>e===failure);await entered.promise;await new Promise(resolve=>setImmediate(resolve));
 assert.equal(settled,false);await assert.rejects(f.app.readBalances(),{code:'ROLLING_BUSY'});
 held.resolve();await rejection;assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
});

test('same-operation canonical policy overlaps predecessor reads exactly once before intent writes',{timeout:3000},async()=>{
 const f=fixture(),scope={synchronized:true};f.options.accountSession.operationScope=()=>scope;
 const journal=Promise.withResolvers(),policy=Promise.withResolvers(),both=Promise.withResolvers();let starts=0;
 const arrive=()=>{if(++starts===2)both.resolve();};
 f.options.accountSession.journal.assertCanStart=async()=>{arrive();await journal.promise;};
 f.state.beforePolicyRead=async()=>{arrive();await policy.promise;};f.app=f.restart();
 const preparing=f.app.prepare({type:'post',deposit:'9',content:'Parallel policy'},{immediate:true});
 await both.promise;assert.equal(f.values.size,0);assert.equal(f.state.privateReads.length,0);
 policy.resolve();await new Promise(r=>setImmediate(r));assert.equal(f.values.size,0);
 journal.resolve();const intent=await preparing;assert.equal(intent.status,'prepared');assert.equal(f.state.policyReads.length,1);
 assert.deepEqual(f.state.policyReads[0].reference,{hash:hex(42)});assert.equal(f.state.sends,0);
});
for(const failAt of ['policy','journal'])test(`same-operation policy overlap drains sibling after ${failAt} failure`,{timeout:3000},async()=>{
 const f=fixture(),scope={synchronized:true};f.options.accountSession.operationScope=()=>scope;
 const held=Promise.withResolvers(),both=Promise.withResolvers();let starts=0,settled=false;const failure=Error(failAt);
 const run=async kind=>{if(++starts===2)both.resolve();if(kind===failAt)throw failure;await held.promise;};
 f.options.accountSession.journal.assertCanStart=()=>run('journal');f.state.beforePolicyRead=()=>run('policy');f.app=f.restart();
 const preparing=f.app.prepare({type:'post',deposit:'9',content:'Drained failure'},{immediate:true});
 const rejected=assert.rejects(preparing,error=>error===failure).finally(()=>{settled=true;});
 await both.promise;await new Promise(r=>setImmediate(r));assert.equal(settled,false);assert.equal(f.values.size,0);
 held.resolve();await rejected;assert.equal(f.values.size,0);assert.equal(f.state.sends,0);
});
for(const replace of ['scope','pxe'])test(`same-operation policy overlap rejects ${replace} replacement during predecessor wait`,{timeout:3000},async()=>{
 const f=fixture();let scope={synchronized:true};f.options.accountSession.operationScope=()=>scope;
 const held=Promise.withResolvers(),policyDone=Promise.withResolvers();
 f.options.accountSession.journal.assertCanStart=async()=>{await held.promise;};f.state.beforePolicyRead=async()=>{policyDone.resolve();};f.app=f.restart();
 const preparing=f.app.prepare({type:'post',deposit:'9',content:'Owned policy'},{immediate:true});
 const rejected=assert.rejects(preparing,{code:'ROLLING_CONTEXT_CHANGED'});await policyDone.promise;await new Promise(r=>setImmediate(r));
 if(replace==='scope')scope={synchronized:true};else f.options.accountSession.wallet.pxe={...f.options.accountSession.wallet.pxe};
 held.resolve();await rejected;assert.equal(f.values.size,0);assert.equal(f.state.sends,0);
});

test('native synchronized policy is consumed once at its exact scope and anchor without another policy RPC',async()=>{
 const f=fixture(),scope={};f.options.accountSession.operationScope=()=>scope;f.app=f.restart();
 await f.app.prefetchPostingPolicy(async read=>({anchor:{number:1,hash:hex(42)},value:await read({number:1,hash:hex(42)})}));scope.synchronized=true;
 const result=await f.app.prepare({type:'post',deposit:'9',content:'Captured source policy'},{immediate:true});assert.equal(result.status,'prepared');assert.equal(f.state.policyReads.length,1);assert.equal(f.values.size,1);
});
for(const replace of ['scope','pxe','anchor'])test(`native synchronized policy rejects ${replace} replacement before storing an intent`,async()=>{
 const f=fixture();let scope={};f.options.accountSession.operationScope=()=>scope;f.app=f.restart();
 await f.app.prefetchPostingPolicy(async read=>({anchor:{number:1,hash:hex(42)},value:await read({number:1,hash:hex(42)})}));
 if(replace==='scope'){
  const before=scope;scope={synchronized:true};await f.app.prepare({type:'post',deposit:'9',content:'Fresh operation'},{immediate:true});assert.equal(f.state.policyReads.length,2);assert.notEqual(scope,before);return;
 }
 scope.synchronized=true;if(replace==='pxe')f.options.accountSession.wallet.pxe={...f.options.accountSession.wallet.pxe};
 else f.options.accountSession.wallet.pxe.getSyncedBlockHeader=async()=>({globalVariables:{blockNumber:2,timestamp:100n},hash:async()=>hex(43)});
 await assert.rejects(f.app.prepare({type:'post',deposit:'9',content:'Changed captured context'},{immediate:true}),{code:'ROLLING_CONTEXT_CHANGED'});assert.equal(f.values.size,0);assert.equal(f.state.sends,0);
});
test('failed native synchronization never publishes its provisional policy into preparation',async()=>{
 const f=fixture(),scope={};f.options.accountSession.operationScope=()=>scope;f.app=f.restart();
 await assert.rejects(f.app.prefetchPostingPolicy(async read=>{await read({number:1,hash:hex(42)});throw Error('native reorg');}),/native reorg/);
 scope.synchronized=true;await f.app.prepare({type:'post',deposit:'9',content:'Fresh successful synchronization'},{immediate:true});assert.equal(f.state.policyReads.length,2);
});

for(const present of [false,true])test(`selected native screening metadata remains advisory and reaches owned preparation present=${present}`,async()=>{
 const f=fixture(),scope={preparationReads:[]};f.options.accountSession.operationScope=()=>scope;
 const metadata={board:hex(1),owner:hex(3),anchorHash:hex(42),hashes:[]};if(present)f.state.noteHashWitnessHints=metadata;f.app=f.restart();
 const prepared=await f.app.prepare({type:'post',deposit:'9',content:'Exact native selection'},{immediate:true});
 await Promise.all(scope.preparationReads);assert.equal(f.state.witnessPrefetches.length,1);
 const input=f.state.witnessPrefetches[0];assert.equal(input.owner.toString(),hex(3));assert.equal(input.noteHashWitnessHints,present?metadata:undefined);
 assert.equal(f.state.privateReads.filter(read=>read.name==='get_screen_hints').length,1);assert.equal(f.state.sends,0);assert.equal((await f.app.submitPrepared(prepared.intentId)).status,'confirmed');assert.equal(f.state.sends,1);
});

// Separate calls/anchors and interrupted proof renewal must read current state.

for(const action of [{type:'subboard',slug:'new-board',name:'New',description:'Exact description',rules:'Exact rules'},...moderatorActions])test('manual '+action.type+' immediately submits exact input under generic ceiling',async()=>{
 const f=moderatorActions.includes(action)?moderatorFixture():fixture();
 const prepared=await f.app.prepare(action,{immediate:true});
 assert.equal(prepared.maximumFee,'100');assert.equal(f.state.estimates,0);assert.equal(f.state.sends,0);assert.deepEqual(prepared.action,action);
 const encoded=structuredClone(prepared.encoded);
 const result=await f.app.submitPrepared(prepared.intentId);assert.equal(result.status,'confirmed');assert.equal(f.state.estimates,1);assert.equal(f.state.sends,1);
 assert.deepEqual(result.encoded,encoded);assert.equal((await f.app.reconcile(prepared.intentId)).status,'confirmed');assert.equal(f.state.sends,1);
});
for(const mode of ['authority','fee'])test('immediate moderator action rejects changed '+mode+' before send',async()=>{
 const f=moderatorFixture(),prepared=await f.app.prepare(moderatorActions[4],{immediate:true});
 if(mode==='authority')f.state.moderator=99n;else f.state.fee=101n;
 await assert.rejects(f.app.submitPrepared(prepared.intentId),{code:mode==='authority'?'ROLLING_MODERATOR_REQUIRED':'ROLLING_FEE_CHANGED'});assert.equal(f.state.sends,0);
});
test('immediate Bok withdrawal keeps exact recipient and pending Ethereum refund after one estimate',async()=>{
 const f=bokAccountingFixture(),action={type:'withdraw-bok',amount:'500',recipient:'0x'+'33'.repeat(20)};
 const intent=await f.app.prepare(action,{immediate:true});assert.equal(f.state.estimates,0);assert.equal(intent.maximumFee,'100');assert.deepEqual(intent.action,action);
 await f.app.submitPrepared(intent.intentId);assert.equal(f.state.estimates,1);assert.equal(f.state.sends,1);
 const saved=await f.app.readWithdrawal();assert.equal(saved.withdrawal.depositor,action.recipient);assert.equal(saved.withdrawal.amount,action.amount);assert.equal(saved.withdrawal.nonce,intent.withdrawal.nonce);
 await f.app.prepare({type:'post',deposit:'9',content:'Refund remains available'},{immediate:true});assert.equal((await f.app.readWithdrawal()).intentId,intent.intentId);assert.equal(f.state.sends,1);
});


for(const kind of ['aggregate','private-fee','bok'])test(`immediate ${kind} claim reuses fee preparation only under the same held operation and encrypted intent`,async()=>{
 const f=kind==='aggregate'?aggregateClaimFixture():topUpFixture(kind);if(kind==='bok')f.action.feeReceipt={...f.receipt,leafIndex:'3'};
 const held={synchronized:true};f.options.accountSession.operationScope=()=>held;
 const app=f.restart(),prepared=await app.prepare(f.action,{immediate:true});assert.equal(f.state.payments.length,1);assert.equal(f.state.estimates,0);
 assert.equal((await app.submitPrepared(prepared.intentId)).status,'confirmed');assert.equal(f.state.payments.length,1);assert.equal(f.state.estimates,1);assert.equal(f.state.sends,1);
 assert(f.state.claimReads.every(input=>input.operationScope===held));
 const feeReads=f.state.claimReads.filter(input=>input.kind==='private-fee');assert.equal(feeReads.length,2,'Submission still revalidates the fee receipt and canonical anchor');
});
for(const boundary of ['new-operation','no-synchronized-owner','new-application'])test(`claim fee preparation is fresh across ${boundary}`,async()=>{
 const f=topUpFixture();let held=boundary==='no-synchronized-owner'?{}:{synchronized:true};f.options.accountSession.operationScope=()=>held;
 const app=f.restart(),prepared=await app.prepare(f.action,{immediate:true});if(boundary==='new-operation')held={synchronized:true};
 assert.equal((await (boundary==='new-application'?f.restart():app).submitPrepared(prepared.intentId)).status,'confirmed');assert.equal(f.state.payments.length,2);
 if(boundary==='no-synchronized-owner')assert(f.state.claimReads.every(input=>input.operationScope===undefined));
});
for(const change of ['receipt','owner'])test(`same-operation claim payment reuse stops before proving when ${change} changes`,async()=>{
 const f=topUpFixture();let held={synchronized:true};f.options.accountSession.operationScope=()=>held;const app=f.restart(),prepared=await app.prepare(f.action,{immediate:true});
 if(change==='receipt')f.state.claimError=true;
 else{const verify=f.options.sdk.prepareFundingClaim;f.options.sdk.prepareFundingClaim=async input=>{held={synchronized:true};return verify(input);};}
 await assert.rejects(app.submitPrepared(prepared.intentId));assert.equal(f.state.sends,0);assert.equal(f.state.estimates,0);
});

for(const action of [{type:'like',post:'8'},{type:'subboard',slug:'new-board',name:'New',description:'Exact',rules:''},{type:'screen',deposit:'9'},{type:'withdraw',deposit:'9'},...moderatorActions])test('generic action '+action.type+' reuses exactly owned generic payment once',async()=>{
 const f=moderatorActions.includes(action)?moderatorFixture():fixture(),scope={synchronized:true};let payments=0;
 f.options.accountSession.operationScope=()=>scope;f.options.sdk.preparePrivateFeePayment=async input=>{payments++;assert.equal(input.creditCheck,['like','unlike'].includes(action.type)?'qualified-like-proof':undefined,'Only separately qualified likes omit the balance read');return {availableCredit:100n};};f.app=f.restart();
 const prepared=await f.app.prepare(action,{immediate:true});assert.equal(payments,1);assert.equal(f.state.estimates,0);assert.equal(prepared.maximumFee,'100');
 assert.equal((await f.app.submitPrepared(prepared.intentId)).status,'confirmed');assert.equal(payments,1);assert.equal(f.state.estimates,1);assert.equal(f.state.sends,1);
});
for(const failed of [null,'authority','payment'])test('generic moderation authority and payment overlap and drain, failure='+failed,async()=>{
 const f=moderatorFixture(),scope={synchronized:true},entered=Promise.withResolvers(),release=Promise.withResolvers();let calls=0,settled=false;
 f.options.accountSession.operationScope=()=>scope;const arrive=()=>{if(++calls===2)entered.resolve();};
 const read=f.options.accountSession.node.getPublicStorageAt;
 f.options.accountSession.node.getPublicStorageAt=async(...args)=>{arrive();if(failed==='authority')throw Error('authority');await release.promise;return read(...args);};
 f.options.sdk.preparePrivateFeePayment=async()=>{arrive();if(failed==='payment')throw Error('payment');await release.promise;return {availableCredit:100n};};f.app=f.restart();
 const work=f.app.prepare(moderatorActions[0],{immediate:true}).finally(()=>settled=true),observed=failed?assert.rejects(work,new RegExp(failed)):work;
 await entered.promise;assert.equal(calls,2);assert.equal(settled,false);assert.equal(f.values.size,0);assert.equal(f.state.sends,0);
 release.resolve();await observed;if(failed)assert.equal(f.values.size,0);assert.equal(f.state.sends,0);
});
for(const change of ['scope','pxe'])test('generic payment preparation rejects changed '+change+' before intent',async()=>{
 const f=moderatorFixture();let scope={synchronized:true};const entered=Promise.withResolvers(),release=Promise.withResolvers();
 f.options.accountSession.operationScope=()=>scope;f.options.sdk.preparePrivateFeePayment=async()=>{entered.resolve();await release.promise;return {availableCredit:100n};};f.app=f.restart();
 const work=f.app.prepare(moderatorActions[0],{immediate:true}),observed=assert.rejects(work,{code:'ROLLING_CONTEXT_CHANGED'});await entered.promise;
 if(change==='scope')scope={synchronized:true};else f.options.accountSession.wallet.pxe={...f.options.accountSession.wallet.pxe};release.resolve();await observed;assert.equal(f.values.size,0);assert.equal(f.state.sends,0);
});

function proposedFixture(){
 const f=fixture();f.options.accountSession.proposedTransactions=true;let acknowledgements=0;
 f.options.accountSession.journal.included=async receipt=>{assert.equal(receipt.status,'proposed');acknowledgements++;};
 const send=f.options.accountSession.wallet.sendTx;
 f.options.accountSession.wallet.sendTx=async(...args)=>{const result=await send(...args);f.state.outcome.receipt.status=args[1].confirmationTier==='proposed'?'proposed':'checkpointed';return result;};
 return {...f,app:f.restart(),acknowledgements:()=>acknowledgements};
}
test('proposed ordinary name completes included and next post uses normal native preparation without checkpoint',async()=>{
 const f=proposedFixture();
 const named=await executeRollingAction(f.app,{type:'name',first:'River',last:'Lane'});
 assert.equal(named.status,'included');assert.equal(f.state.sent.opts.confirmationTier,'proposed');assert.equal(f.acknowledgements(),1);
 assert.equal((await f.app.readAccountStatus()).status,'fee-ready');
 const post=await executeRollingAction(f.app,{type:'post',deposit:'9',name:named.nameAvailability.id,content:'Next proposed action'});
 assert.equal(post.status,'included');assert.equal(f.state.sends,2);assert(f.state.privateReads.some(row=>row.name==='get_screen_hints'));
 assert.equal(f.state.outcome.receipt.status,'proposed');
});

for(const kind of ['collateral','private-fee','bok'])test(`proposed ${kind} claim completes at exact inclusion without bypassing bridge validation`,async()=>{
 const f=kind==='collateral'?fundingFixture():topUpFixture(kind),action=kind==='collateral'?{type:'claim-deposit',receipt:f.receipt}:f.action;
 f.options.accountSession.proposedTransactions=true;let acknowledgements=0;
 f.options.accountSession.journal.included=async receipt=>{assert.equal(receipt.status,'proposed');acknowledgements++;};
 const send=f.options.accountSession.wallet.sendTx;f.options.accountSession.wallet.sendTx=async(...args)=>{const result=await send(...args);f.state.outcome.receipt.status='proposed';return result;};
 const result=await executeRollingAction(f.restart(),action);assert.equal(result.status,'included');assert.equal(f.state.sent.opts.confirmationTier,'proposed');assert.equal(acknowledgements,1);assert(f.state.claimReads.length>0);assert.equal(f.state.sends,1);
});
test('proposed outcome cannot authorize next action once exact native journal reports no successful inclusion',async()=>{
 const f=proposedFixture();await executeRollingAction(f.app,{type:'name',first:'River',last:'Lane'});
 f.state.outcome={...f.state.outcome,outcome:'pending',receipt:null};
 await assert.rejects(executeRollingAction(f.app,{type:'post',deposit:'9',content:'No orphan descendants'}),{code:'ROLLING_RECOVERY_REQUIRED'});
 assert.equal(f.state.sends,1);
});

for(const kind of ['private-fee','bok'])test(`held ${kind} claim uses only its exact native membership cache`,async()=>{
 const f=topUpFixture(kind),scope={synchronized:true};f.options.accountSession.operationScope=()=>scope;
 const raw=f.options.accountSession.node,cached=f.options.accountSession.wallet.pxe.node;
 await f.restart().prepare(f.action,{immediate:true});assert(f.state.claimReads.length>0);
 assert(f.state.claimReads.every(input=>input.node===raw&&input.membershipNode===cached&&input.operationScope===scope));assert.equal(f.state.sends,0);
});
for(const change of ['cached-node','route'])test(`claim refuses native membership cache ${change} replacement during verification`,async()=>{
 const f=topUpFixture('bok'),scope={synchronized:true};f.options.accountSession.operationScope=()=>scope;
 const verify=f.options.sdk.prepareFundingClaim;
 f.options.sdk.prepareFundingClaim=async input=>{
  if(change==='cached-node')f.options.accountSession.wallet.pxe.node={getL1ToL2MessageMembershipWitness:async()=>null};else f.options.sdk.isPrivatePXEForNode=()=>false;
  return verify(input);
 };
 await assert.rejects(f.restart().prepare(f.action,{immediate:true}),{code:'ROLLING_CONTEXT_CHANGED'});assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
});


test('immediate like uses only its exact class bound; reviewed and other actions retain generic estimation',async()=>{
 for(const [type,immediate]of [['like',true],['like',false],['bio',true]]){
  const f=fixture(),scope={synchronized:true},seen=[];f.options.accountSession.operationScope=()=>scope;
  f.options.sdk.preparePrivateFeePayment=async input=>{seen.push(input.creditCheck);return input.creditCheck?{creditCheck:input.creditCheck}:{availableCredit:100n};};
  const estimate=f.options.sdk.estimatePrivateFeeTransaction;let requested;
  f.options.sdk.estimatePrivateFeeTransaction=async input=>{requested=input;return estimate(input);};
  const app=f.restart(),action=type==='bio'?{type,name:'5',expectedVersion:'0',content:'Profile'}:{type,post:'42'};
  const prepared=await app.prepare(action,immediate?{immediate:true}:undefined);await app.submitPrepared(prepared.intentId);
  if(immediate&&type!=='bio'){assert.deepEqual(seen,['qualified-like-proof']);assert.equal(requested.qualifiedLike,f.options.deployment.board.instance);assert.equal(requested.ordinaryPost,undefined);}
  else{assert(seen.every(value=>value===undefined));assert.equal(requested.qualifiedLike,undefined);}
  assert.equal(f.state.sends,1);
 }
});
test('like qualification failure cannot save a workflow or begin a proof',async()=>{
 const f=fixture();f.options.sdk.likeFeeBudget=()=>{throw Object.assign(Error('mismatch'),{code:'BB_LIKE_FEE_PROFILE_MISMATCH'});};
 await assert.rejects(f.restart().prepare({type:'like',post:'42'},{immediate:true}),{code:'BB_LIKE_FEE_PROFILE_MISMATCH'});assert.equal(f.values.size,0);assert.equal(f.state.sends,0);assert.equal(f.state.estimates,0);
});


test('early payment cannot cross from ordinary posting mode into qualified likes',async()=>{
 const f=fixture(),scope={preparationReads:[]},seen=[];f.options.accountSession.operationScope=()=>scope;
 f.options.sdk.preparePrivateFeePayment=async input=>{seen.push(input.creditCheck);return {creditCheck:input.creditCheck};};f.app=f.restart();
 await f.app.prefetchContext({ordinaryPayment:true});const prepared=await f.app.prepare({type:'like',post:'42'},{immediate:true});await f.app.submitPrepared(prepared.intentId);
 assert.deepEqual(seen,['ordinary-post-proof','qualified-like-proof']);assert.equal(f.state.sends,1);
});

function proposedScreenFixture(){
 const f=automaticWithdrawalFixture(true),send=f.options.accountSession.wallet.sendTx;let included=0;
 f.options.accountSession.proposedTransactions=true;
 f.options.accountSession.journal.included=async receipt=>{assert.equal(receipt.status,'proposed');included++;};
 f.options.accountSession.wallet.sendTx=async(...args)=>{const result=await send(...args);f.state.outcome.receipt.status=args[1].confirmationTier==='proposed'?'proposed':'checkpointed';return result;};
 f.app=f.restart();return {...f,included:()=>included};
}
test('included screening and collateral exit retain exact proposed predecessor policy',async()=>{
 const f=proposedScreenFixture(),tiers=[],send=f.options.accountSession.wallet.sendTx;
 f.options.accountSession.wallet.sendTx=async(...args)=>{tiers.push(args[1].confirmationTier);return send(...args);};
 const result=await f.run();assert.equal(result.status,'included');assert.equal(result.action.type,'withdraw');assert.deepEqual(tiers,['proposed','proposed']);assert.equal(f.included(),3);assert.equal(f.state.sends,2);
});
test('included screening orphan cannot authorize subsequent collateral exit',async()=>{
 const f=proposedScreenFixture();const screened=await executeRollingAction(f.app,{type:'screen',deposit:'9'});assert.equal(screened.status,'included');
 f.state.outcome={...f.state.outcome,outcome:'pending',receipt:null};
 await assert.rejects(executeRollingAction(f.app,{type:'withdraw',deposit:'9'}),{code:'ROLLING_RECOVERY_REQUIRED'});assert.equal(f.state.sends,1);
});
test('included screening does not waive native deposit time lock before exit preparation',async()=>{
 const f=proposedScreenFixture();assert.equal((await executeRollingAction(f.app,{type:'screen',deposit:'9'})).status,'included');
 f.state.responses.get_deposit_info[9]=500n;
 await assert.rejects(executeRollingAction(f.app,{type:'withdraw',deposit:'9'}),{code:'ROLLING_WITHDRAWAL_NOT_READY'});assert.equal(f.state.sends,1);
});

test('included screening synchronizes consecutive private note state before preparing the exit',async()=>{
 const {createSynchronizedRollingApplication}=await import('./synchronized-application.mjs');
 const f=proposedScreenFixture(),scope={synchronized:false},send=f.options.accountSession.wallet.sendTx;let pendingNote,steps=0;
 f.options.accountSession.wallet.sendTx=async(...args)=>{const prior=f.state.responses.get_deposit_info;const result=await send(...args);if(args[0].name==='screen'){pendingNote=f.state.responses.get_deposit_info;f.state.responses.get_deposit_info=prior;}return result;};
 const application=createSynchronizedRollingApplication({application:f.app,operationScope:()=>scope,contextGuard:async()=>{},synchronize:async()=>{steps++;if(pendingNote){f.state.responses.get_deposit_info=pendingNote;pendingNote=null;}}});
 const result=await executeAutomaticWithdrawal({application,deposit:'9',guard:async()=>{},waitUntil:async()=>assert.fail('no cooldown')});
 assert.equal(result.status,'included');assert.equal(steps,2);assert.equal(pendingNote,null);assert.deepEqual(f.state.calls.map(call=>call.name),['screen','withdraw']);
});

function proposedBokActionFixture(f=bokFixture()){
 f.options.accountSession.proposedTransactions=true;let acknowledgements=0;
 f.options.accountSession.journal.included=async receipt=>{assert.equal(receipt.status,'proposed');acknowledgements++;};
 f.options.sdk.BatchCall=class {constructor(wallet,interactions){assert.equal(wallet,f.options.accountSession.wallet);this.name='batch';this.interactions=interactions;}};
 const send=f.options.accountSession.wallet.sendTx;f.options.accountSession.wallet.sendTx=async(...args)=>{const result=await send(...args);f.state.outcome.receipt.status=args[1].confirmationTier==='proposed'?'proposed':'checkpointed';return result;};
 f.app=f.restart();f.acknowledgements=()=>acknowledgements;return f;
}
test('atomic Bok publishes at included policy and permits a fresh native ordinary successor without checkpoint',async()=>{
 const f=proposedBokActionFixture();const result=await executeRollingAction(f.app,bokAction());
 assert.equal(result.status,'included');assert.equal(result.bok.phase,'atomic');assert.equal(f.state.sent.opts.confirmationTier,'proposed');assert.equal(f.state.sends,1);
 assert.deepEqual(f.state.sent.payload.interactions.map(call=>call.name),['authorize_request','post_with_bok']);assert.equal((await f.app.readAccountStatus()).status,'fee-ready');
 const next=await executeRollingAction(f.app,{type:'post',deposit:'9',content:'Next private note spend'});assert.equal(next.status,'included');assert.equal(f.state.sends,2);
});
test('split Bok authorization keeps its original checkpoint boundary',async()=>{
 const f=proposedBokActionFixture(),prepared=await f.app.prepare(bokAction());const result=await f.app.submitPrepared(prepared.intentId);
 assert.equal(result.status,'authorized');assert.equal(f.state.sent.opts.confirmationTier,'checkpointed');assert.equal(f.acknowledgements(),0);
});
test('orphaned atomic Bok inclusion blocks a successor without automatic resubmission',async()=>{
 const f=proposedBokActionFixture();await executeRollingAction(f.app,bokAction());f.state.outcome={...f.state.outcome,outcome:'pending',receipt:null};
 await assert.rejects(executeRollingAction(f.app,{type:'post',deposit:'9',content:'Must not spend orphan change'}),{code:'ROLLING_RECOVERY_REQUIRED'});assert.equal(f.state.sends,1);
});
for(const type of ['cancel-bok-request','expire-bok-request'])test(`immediate ${type} uses private-owned accounting at exact proposed anchor and one submission`,async()=>{
 const f=proposedBokActionFixture(expiryFixture());if(type==='cancel-bok-request')Object.assign(f.pages[0].requests[0],{available:'60',reserved:'0'});
 await finishBokAccounting(f);assert(f.trace.every(input=>JSON.stringify(input.snapshot)===JSON.stringify({number:1,hash:hex(42)})));assert(f.trace.every(input=>!Object.hasOwn(input,'requestId')));
 const result=await executeRollingAction(f.app,{type,requestId:hex(11)});assert.equal(result.status,'included');assert.equal(f.state.sent.opts.confirmationTier,'proposed');assert.equal(f.state.estimates,1);assert.equal(f.state.sends,1);
 assert.equal(f.state.sent.payload.name,type==='cancel-bok-request'?'cancel':'expire');assert.deepEqual(f.state.sent.payload.args,[hex(11)]);
});
for(const type of ['cancel-bok-request','expire-bok-request'])for(const changed of ['foreign','anchor','finalized','scope'])test(`immediate ${type} refuses ${changed} before send even with old accounting`,async()=>{
 const f=proposedBokActionFixture(expiryFixture());if(type==='cancel-bok-request')Object.assign(f.pages[0].requests[0],{available:'60',reserved:'0'});await finishBokAccounting(f);
 if(changed==='anchor')f.options.accountSession.wallet.pxe.getSyncedBlockHeader=async()=>({globalVariables:{blockNumber:2,timestamp:101n},hash:async()=>hex(43)});
 if(changed==='finalized'){const estimate=f.options.sdk.estimatePrivateFeeTransaction;f.options.sdk.estimatePrivateFeeTransaction=async input=>{if(['cancel','expire'].includes(input.interaction.name))throw Error('Request not cancellable or expirable');return estimate(input);};}
 if(changed==='scope'){const prepare=f.app.prepare;f.app={...f.app,prepare:async(...args)=>{const result=await prepare(...args);f.options.deployment.bok.operator=hex(99);return result;}};}
 await assert.rejects(executeRollingAction(f.app,{type,requestId:hex(changed==='foreign'?12:11)}));assert.equal(f.state.sends,0);
});
test('immediate cancellation still rejects an unresolved reservation before proof or send',async()=>{
 const f=proposedBokActionFixture(expiryFixture());await finishBokAccounting(f);
 await assert.rejects(executeRollingAction(f.app,{type:'cancel-bok-request',requestId:hex(11)}),{code:'ROLLING_BOK_ACCOUNTING_INCOMPLETE'});assert.equal(f.state.estimates,0);assert.equal(f.state.sends,0);
});


test('claim verification receives the existing application measurement capability unchanged',async()=>{
 const f=fundingFixture(),stages=[];f.options.measure=async(stage,operation)=>{stages.push(stage);return operation();};
 const verify=f.options.sdk.prepareFundingClaim;f.options.sdk.prepareFundingClaim=async input=>{assert.equal(input.measure,f.options.measure);return input.measure('action.claim-receipt',()=>verify(input));};
 const prepared=await f.restart().prepare({type:'claim-deposit',receipt:f.receipt});assert(prepared.intentId);assert(stages.includes('action.claim-receipt'));assert.equal(f.state.sends,0);
});

function pendingExitFixture(){
 const f=proposedFixture(),send=f.options.accountSession.wallet.sendTx;let tx=80n;
 const receipts=new Map();
 f.options.accountSession.wallet.sendTx=async(...args)=>{const result=await send(...args);f.state.outcome.txHash=hex(++tx);f.state.outcome.receipt.txHash=f.state.outcome.txHash;f.state.outcome.receipt.executionResult='success';receipts.set(f.state.outcome.txHash,structuredClone(f.state.outcome.receipt));return result;};
 f.options.accountSession.node.getTxReceipt=async hash=>receipts.get(String(hash))??{txHash:String(hash),status:'dropped'};
 return {...f,receipts};
}
test('pending exit survives a new included action and encrypted application reopen without Ethereum payment',async()=>{
 const f=pendingExitFixture();const result=await executeRollingAction(f.app,{type:'withdraw',deposit:'9'});
 assert.equal(result.status,'included');assert.equal(f.state.sent.opts.confirmationTier,'proposed');
 const next=await executeRollingAction(f.app,{type:'name',first:'Exit',last:'Owner'});assert.equal(next.status,'included');
 const reopened=f.restart(),saved=await reopened.readWithdrawal();assert.equal(saved.txHash,result.txHash);assert.equal(saved.intentId,result.intentId);assert.equal(saved.withdrawal.depositor,result.withdrawal.depositor);
 const status=await reopened.readAccountStatus();assert.equal(status.status,'fee-ready');assert.equal(status.pendingWithdrawal.txHash,result.txHash);assert.equal(f.state.sends,2);
 await assert.rejects(reopened.prepare({type:'withdraw',deposit:'9'},{immediate:true}),{code:'ROLLING_WITHDRAWAL_PENDING'});assert.equal(f.state.sends,2);
});
test('pending exit read detects orphan and changed canonical block without replay or latest-workflow mutation',async()=>{
 const f=pendingExitFixture();const exit=await executeRollingAction(f.app,{type:'withdraw',deposit:'9'});await executeRollingAction(f.app,{type:'name',first:'Exit',last:'Next'});
 const before=[...f.values];f.receipts.set(exit.txHash,{txHash:exit.txHash,status:'dropped'});assert.equal((await f.app.readWithdrawal()).status,'unknown');assert.deepEqual([...f.values],before);assert.equal(f.state.sends,2);
 f.receipts.set(exit.txHash,{txHash:exit.txHash,status:'proposed',executionResult:'success',blockNumber:1,blockHash:hex(99)});
 await assert.rejects(f.app.readWithdrawal(),{code:'ROLLING_WITHDRAWAL_RECOVERY_REQUIRED'});assert.deepEqual([...f.values],before);
});
test('pending exit is saved before workflow can advance and CAS failure preserves signed exit for reconciliation',async()=>{
 const f=pendingExitFixture(),cas=f.options.privateStore.compareAndSwap;let writes=0;
 f.options.privateStore.compareAndSwap=async(...args)=>{writes++;if(writes===3)throw Error('pending slot write failed');return cas(...args);};
 await assert.rejects(executeRollingAction(f.app,{type:'withdraw',deposit:'9'}));assert.equal(f.state.sends,1);
 f.options.privateStore.compareAndSwap=cas;const current=await (await createEncryptedJournalSlot({storage:f.options.privateStore,walletSecret:f.options.accountSession.walletSecret,walletSalt:f.options.accountSession.walletSalt,scopeText:JSON.stringify(['ROLLING_WORKFLOW_V1',l2JournalScopeText({account:f.options.accountSession.owner.toString(),chainId:'31337',version:'1',rollup:f.options.deployment.network.rollup,board:hex(1),portal:f.options.deployment.portal})]),keyDomain:'ROLLING_WORKFLOW_V1'})).read();
 assert.equal(current.value.action.type,'withdraw');
 const resumed=await f.app.reconcile(current.value.id);assert.equal(resumed.status,'included');assert.equal((await f.app.readWithdrawal()).txHash,resumed.txHash);assert.equal(f.state.sends,1);
});

test('a paid exit tombstone is not resurrected and a second exit freshly verifies its Ethereum payment',async()=>{
 const f=pendingExitFixture();let verified=0,canonical=true;
 f.options.funding={verifyWithdrawal:async saved=>{verified++;assert.equal(saved.paymentStatus,'refunded');assert.equal(saved.ethereumTxHash,hex(900));return canonical;}};
 const app=f.restart(),exit=await executeRollingAction(app,{type:'withdraw',deposit:'9'});
 const scope={account:f.options.accountSession.owner.toString(),chainId:'31337',version:'1',rollup:f.options.deployment.network.rollup,board:hex(1),portal:f.options.deployment.portal};
 const slot=await createPendingWithdrawalSlot({storage:f.options.privateStore,walletSecret:f.options.accountSession.walletSecret,walletSalt:f.options.accountSession.walletSalt,scope});
 const saved=await slot.read();await slot.write(saved,{...saved.value,paymentStatus:'refunded',ethereumTxHash:hex(900)});
 assert.equal((await app.readAccountStatus()).pendingWithdrawal,null);assert.equal((await slot.read()).value.paymentStatus,'refunded');assert.equal(verified,0);
 await executeRollingAction(app,{type:'name',first:'Paid',last:'Exit'});assert.equal(verified,0);
 canonical=false;const before=(await slot.read()).encoded;
 await assert.rejects(app.prepare({type:'withdraw',deposit:'9'},{immediate:true}),{code:'ROLLING_WITHDRAWAL_RECOVERY_REQUIRED'});assert.equal(verified,1);assert.equal((await slot.read()).encoded,before);
 canonical=true;const next=await executeRollingAction(app,{type:'withdraw',deposit:'9'});assert.equal(next.status,'included');assert.notEqual(next.txHash,exit.txHash);assert.equal(verified,2);assert.equal((await slot.read()).value.txHash,next.txHash);assert.equal(f.state.sends,3);
});
test('pending exit remains visible when a newer independent action requires reconciliation',async()=>{
 const f=pendingExitFixture(),exit=await executeRollingAction(f.app,{type:'withdraw',deposit:'9'});
 const next=await f.app.prepare({type:'name',first:'New',last:'Action'},{immediate:true});
 const status=await f.app.readAccountStatus();assert.equal(status.status,'recovering');assert.equal(status.intent.intentId,next.intentId);assert.equal(status.pendingWithdrawal.txHash,exit.txHash);assert.equal(f.state.sends,1);
});


test('funding workflow inspection omits unrelated private balance/deposit utilities but account readiness retains them',async()=>{
 const f=fixture();let payments=0;const payment=f.options.sdk.preparePrivateFeePayment;
 f.options.sdk.preparePrivateFeePayment=(...args)=>{payments++;return payment(...args);};
 assert.deepEqual(await f.app.readFundingState(),{status:'ready'});assert.equal(payments,0);assert.equal(f.state.privateReads.length,0);
 assert.equal((await f.app.readAccountStatus()).status,'fee-ready');assert.equal(payments,0);assert(f.state.privateReads.some(r=>r.name==='get_deposit_ids'));assert(f.state.privateReads.some(r=>r.contract==='private-fee'&&r.name==='balance_of'));
 assert.deepEqual(await createRollingApplication({}).readFundingState(),{status:'locked'});
});
test('funding workflow inspection preserves current saved intent and freshly rejects lost terminal authority',async()=>{
 const f=fixture(),prepared=await f.app.prepare({type:'like',post:'5'});
 let result=await f.restart().readFundingState();assert.equal(result.status,'recovering');assert.equal(result.intent.intentId,prepared.intentId);
 await f.app.submitPrepared(prepared.intentId);f.state.privateReads.length=0;
 assert.deepEqual(await f.restart().readFundingState(),{status:'ready'});assert.equal(f.state.privateReads.length,0);
 f.state.outcome=null;result=await f.restart().readFundingState();assert.equal(result.status,'recovering');assert.equal(result.intent.status,'unknown');assert.equal(result.intent.intentId,prepared.intentId);
});
test('funding workflow holds its read lease and rejects an owner replacement while encrypted storage is pending',async()=>{
 const f=fixture(),entered=Promise.withResolvers(),held=Promise.withResolvers(),read=f.options.privateStore.read;
 f.options.privateStore.read=async key=>{entered.resolve();await held.promise;return read(key);};
 const pending=f.app.readFundingState();await entered.promise;
 await assert.rejects(f.app.readFundingState(),{code:'ROLLING_BUSY'});
 f.options.accountSession.owner=AztecAddress.fromBigIntUnsafe(99n);held.resolve();
 await assert.rejects(pending,{code:'ROLLING_CONTEXT_CHANGED'});assert.equal(f.state.sends,0);assert.equal(f.state.privateReads.length,0);
});

for(const amount of [0n,17n,(1n<<128n)-1n])test(`standalone fee credit reads only anchored native balance: ${amount}`,async()=>{
 const f=collateralFixture();f.state.feeCredit=amount;
 const result=await f.app.readPrivateFeeCredit();
 assert.equal(result.availableCredit,String(amount));assert.equal(result.anchor.blockNumber,1);assert.equal(result.anchor.blockHash,hex(42));
 assert.deepEqual(f.state.privateReads.map(x=>x.name),['balance_of']);assert.equal(f.state.privateReads[0].args[0],f.options.accountSession.owner);
 assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
});
for(const change of ['overflow','canonical','anchor','owner'])test(`standalone fee credit rejects ${change} before presenting a balance`,async()=>{
 const f=collateralFixture(),native=f.options.sdk.Contract.at;const entered=Promise.withResolvers(),held=Promise.withResolvers();
 f.options.sdk.Contract.at=async(...input)=>{const contract=await native(...input);return {methods:{balance_of:(...args)=>({simulate:async()=>{entered.resolve();await held.promise;return contract.methods.balance_of(...args).simulate();}})}};};f.app=f.restart();
 const pending=f.app.readPrivateFeeCredit();await entered.promise;
 if(change==='overflow')f.state.feeCredit=1n<<128n;
 if(change==='canonical')f.options.accountSession.node.getBlockData=async()=>({header:{globalVariables:{blockNumber:1}},blockHash:hex(43)});
 if(change==='anchor')f.options.accountSession.wallet.pxe.getSyncedBlockHeader=async()=>({globalVariables:{blockNumber:2,timestamp:100n},hash:async()=>hex(43)});
 if(change==='owner')f.state.guard=false;
 held.resolve();await assert.rejects(pending);assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
});

for(const phase of ['prepare','submit'])for(const mode of ['success','balance-failure','scope-failure','anchor','canonical','owner','scope-change'])test(`Bok withdrawal independent read wave drains ${phase} ${mode}`,{timeout:3000},async()=>{
 const f=bokAccountingFixture(),action={type:'withdraw-bok',amount:'500',recipient:'0x'+'33'.repeat(20)};
 const prepared=phase==='submit'?await f.app.prepare(action):null;
 const before=new Map(f.values),native=f.options.sdk.Contract.at,resolve=f.options.funding.resolveBokWithdrawal;
 const balance=Promise.withResolvers(),scope=Promise.withResolvers(),entered=Promise.withResolvers(),failure=Error('labelled read failure');let balanceReads=0,scopeReads=0,settled=false;
 const started=()=>{if(balanceReads&&scopeReads)entered.resolve();};
 f.options.sdk.Contract.at=async(...args)=>{
  const contract=await native(...args);if(args[0].toString()!==hex(5))return contract;
  return {methods:new Proxy(contract.methods,{get:(methods,key)=>key!=='balance_of'?methods[key]:(...values)=>({simulate:async()=>{
   balanceReads++;started();await balance.promise;if(mode==='balance-failure')throw failure;return methods.balance_of(...values).simulate();
  }})})};
 };
 f.options.funding.resolveBokWithdrawal=async()=>{scopeReads++;started();await scope.promise;if(mode==='scope-failure')throw failure;const result=await resolve();return mode==='scope-change'?{...result,recipient:hex(6)}:result;};
 f.app=f.restart();
 const pending=(phase==='prepare'?f.app.prepare(action,{immediate:true}):f.app.submitPrepared(prepared.intentId)).finally(()=>settled=true);
 const observed=mode==='success'?pending:assert.rejects(pending,mode.endsWith('failure')?error=>error===failure:undefined);
 await entered.promise;assert.equal(balanceReads,1);assert.equal(scopeReads,1);assert.equal(f.state.sends,0);assert.deepEqual(f.values,before);
 if(mode==='scope-failure')scope.resolve();else balance.resolve();await new Promise(setImmediate);
 assert.equal(settled,false,'a completed or failed sibling cannot release the operation');assert.equal(f.state.sends,0);assert.deepEqual(f.values,before);
 if(mode==='anchor')f.options.accountSession.wallet.pxe.getSyncedBlockHeader=async()=>({globalVariables:{blockNumber:2,timestamp:100n},hash:async()=>hex(43)});
 if(mode==='canonical')f.options.accountSession.node.getBlockData=async number=>({header:{globalVariables:{blockNumber:number}},blockHash:hex(43)});
 if(mode==='owner')f.state.guard=false;
 balance.resolve();scope.resolve();const result=await observed;
 if(mode==='success'){assert.equal(result.status,phase==='prepare'?'prepared':'confirmed');assert.equal(f.state.sends,phase==='prepare'?0:1);}
 else{assert.equal(f.state.sends,0);assert.deepEqual(f.values,before);}
});

function moderationWave(f,{authority,policy}){
 const node=f.options.accountSession.node,storage=node.getPublicStorageAt,at=f.options.sdk.Contract.at;
 node.getPublicStorageAt=async(...args)=>{await authority();return storage(...args);};
 f.options.sdk.Contract.at=async(...args)=>{const board=await at(...args);return {methods:new Proxy(board.methods,{get:(methods,name)=>name!=='main_policy'?methods[name]:(...values)=>({simulate:async()=>{await policy();return methods[name](...values).simulate();}})})};};
 return f.restart();
}
for(const action of moderatorActions)test('moderation wave starts independent authority and policy for '+action.type,async()=>{
 const f=moderatorFixture(),entered=Promise.withResolvers(),gate=Promise.withResolvers();let starts=0;
 const enter=async()=>{if(++starts===2)entered.resolve();await gate.promise;};const app=moderationWave(f,{authority:enter,policy:enter});
 const work=app.prepare(action);await entered.promise;assert.equal(starts,2);assert.equal(f.values.size,0);assert.equal(f.state.sends,0);
 await assert.rejects(app.readModeratorStatus(),{code:'ROLLING_BUSY'});gate.resolve();assert((await work).moderation);assert.equal(starts,2);
});
for(const phase of ['prepare','submit'])for(const failing of ['authority','policy'])test('moderation wave '+phase+' drains '+failing+' failure before releasing lease',async()=>{
 const f=moderatorFixture(),prepared=phase==='submit'?await f.app.prepare(moderatorActions[0]):null;
 const before=[...f.values],entered=Promise.withResolvers(),gate=Promise.withResolvers();let starts=0,done=false;
 const branch=name=>()=>{if(++starts===2)entered.resolve();if(name===failing)throw Error(name+' unavailable');return gate.promise;};
 const app=moderationWave(f,{authority:branch('authority'),policy:branch('policy')});
 const work=(phase==='submit'?app.submitPrepared(prepared.intentId):app.prepare(moderatorActions[0])).then(()=>assert.fail('must reject'),error=>{done=true;assert.match(error.message,new RegExp(failing+' unavailable'));});
 await entered.promise;assert.equal(done,false);await assert.rejects(app.readModeratorStatus(),{code:'ROLLING_BUSY'});gate.resolve();await work;
 assert.equal(f.state.sends,0);assert.deepEqual([...f.values],before);
});
for(const defect of ['unauthorized','fork','owner'])test('moderation wave rejects '+defect+' while independent policy is held',async()=>{
 const f=moderatorFixture(),entered=Promise.withResolvers(),gate=Promise.withResolvers();let done=false;
 const app=moderationWave(f,{authority:async()=>{if(defect==='unauthorized')f.state.moderator=99n;if(defect==='fork')f.state.reorg=true;},policy:async()=>{entered.resolve();await gate.promise;}});
 const work=app.prepare(moderatorActions[0]).then(()=>assert.fail('must reject'),()=>{done=true;});await entered.promise;if(defect==='owner')f.state.guard=false;
 assert.equal(done,false);gate.resolve();await work;assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
});

test('withdrawal observation reuses readiness only for same owned immediate preparation; submission still rereads',async()=>{
 const f=automaticWithdrawalFixture(),scope={synchronized:true};f.options.accountSession.operationScope=()=>scope;f.app=f.restart();
 await f.app.readWithdrawalReadiness('9');
 const prepared=await f.app.prepare({type:'withdraw',deposit:'9'},{immediate:true});
 assert.equal(f.state.privateReads.filter(r=>r.name==='get_deposit_info').length,1);
 f.state.responses.get_deposit_info[2]=101n;
 await assert.rejects(f.app.submitPrepared(prepared.intentId),{code:'ROLLING_WITHDRAWAL_NOT_READY'});
 assert.equal(f.state.privateReads.filter(r=>r.name==='get_deposit_info').length,2);assert.equal(f.state.sends,0);
});
test('withdrawal observation reuses exact selected screening hints once',async()=>{
 const f=automaticWithdrawalFixture(true),scope={synchronized:true};f.options.accountSession.operationScope=()=>scope;f.app=f.restart();
 await f.app.readWithdrawalReadiness('9');const prepared=await f.app.prepare({type:'screen',deposit:'9'},{immediate:true});
 assert.equal(f.state.privateReads.filter(r=>r.name==='get_screen_hints').length,1);
 assert.equal((await f.app.submitPrepared(prepared.intentId)).status,'confirmed');assert.equal(f.state.sends,1);
});
for(const change of ['operation','anchor','cached-node','unsynchronized','review'])test(`withdrawal observation is not reused after ${change}`,async()=>{
 const f=automaticWithdrawalFixture();let scope={synchronized:true};f.options.accountSession.operationScope=()=>scope;f.app=f.restart();
 await f.app.readWithdrawalReadiness('9');
 if(change==='operation')scope={synchronized:true};
 if(change==='unsynchronized')scope.synchronized=false;
 if(change==='cached-node')f.options.accountSession.wallet.pxe.node={};
 if(change==='anchor'){
  f.options.accountSession.wallet.pxe.getSyncedBlockHeader=async()=>({globalVariables:{blockNumber:2,timestamp:101n},hash:async()=>hex(43)});
  f.options.accountSession.node.getBlockData=async height=>({header:{globalVariables:{blockNumber:height}},blockHash:hex(43)});
 }
 f.state.responses.get_deposit_info[2]=102n;
 const prepared=await f.app.prepare({type:'withdraw',deposit:'9'},change==='review'?undefined:{immediate:true});
 assert.equal(prepared.withdrawal.amount,'102');assert.equal(f.state.privateReads.filter(r=>r.name==='get_deposit_info').length,2);
});
test('withdrawal observation rejects an orphaned readiness anchor before creating intent',async()=>{
 const f=automaticWithdrawalFixture(),scope={synchronized:true};f.options.accountSession.operationScope=()=>scope;f.app=f.restart();
 await f.app.readWithdrawalReadiness('9');f.options.accountSession.node.getBlockData=async()=>({header:{globalVariables:{blockNumber:1}},blockHash:hex(99)});
 await assert.rejects(f.app.prepare({type:'withdraw',deposit:'9'},{immediate:true}),{code:'ROLLING_CONTEXT_CHANGED'});assert.equal(f.values.size,0);assert.equal(f.state.sends,0);
});
test('withdrawal observation cannot cross exact deposit or route identity',async()=>{
 for(const change of ['deposit','owner','route']){
  const f=automaticWithdrawalFixture(),scope={synchronized:true};f.options.accountSession.operationScope=()=>scope;f.app=f.restart();await f.app.readWithdrawalReadiness('9');
  if(change==='deposit')f.state.responses.get_deposit_info[1]=10n;
  if(change==='owner')f.options.accountSession.owner=new AztecAddress(new Fr(4n));
  if(change==='route')f.state.guard=false;
  if(change==='deposit'){
   await f.app.prepare({type:'withdraw',deposit:'10'},{immediate:true});assert.equal(f.state.privateReads.filter(r=>r.name==='get_deposit_info').length,2);
  }else{await assert.rejects(f.app.prepare({type:'withdraw',deposit:'9'},{immediate:true}));assert.equal(f.values.size,0);}
  assert.equal(f.state.sends,0);
 }
});
test('withdrawal observation retains maturity check and never promotes time-locked credit',async()=>{
 const f=automaticWithdrawalFixture(),scope={synchronized:true};f.options.accountSession.operationScope=()=>scope;f.state.responses.get_deposit_info[9]=101n;f.app=f.restart();
 assert.equal((await f.app.readWithdrawalReadiness('9')).readyAt,'101');await assert.rejects(f.app.prepare({type:'withdraw',deposit:'9'},{immediate:true}),{code:'ROLLING_WITHDRAWAL_NOT_READY'});assert.equal(f.values.size,0);assert.equal(f.state.sends,0);
});
test('withdrawal observation cannot survive operation replacement while predecessor is held',async()=>{
 const f=automaticWithdrawalFixture();let scope={synchronized:true};f.options.accountSession.operationScope=()=>scope;f.app=f.restart();await f.app.readWithdrawalReadiness('9');
 const entered=Promise.withResolvers(),release=Promise.withResolvers();f.options.accountSession.journal.assertCanStart=async()=>{entered.resolve();await release.promise;};
 const preparing=f.app.prepare({type:'withdraw',deposit:'9'},{immediate:true});await entered.promise;scope={synchronized:true};release.resolve();
 await assert.rejects(preparing,{code:'ROLLING_CONTEXT_CHANGED'});assert.equal(f.values.size,0);assert.equal(f.state.sends,0);
});

for(const type of ['withdraw-bok','cancel-bok-request','expire-bok-request'])for(const changeScope of [false,true])test(`Bok fee wave: ${type} ${changeScope?'new operation refreshes':'same operation reuses'} metadata`,async()=>{
 const f=bokAccountingFixture();let scope={synchronized:true},payments=0;f.options.accountSession.operationScope=()=>scope;
 f.options.sdk.preparePrivateFeePayment=async()=>{payments++;return {availableCredit:100n};};f.app=f.restart();
 if(type!=='withdraw-bok'){f.pages[0].requests[0].available='60';f.pages[0].requests[0].reserved='0';await finishBokAccounting(f);}
 const action=type==='withdraw-bok'?{type,amount:'500',recipient:'0x'+'33'.repeat(20)}:{type,requestId:hex(11)};
 const intent=await f.app.prepare(action,{immediate:true});assert.equal(payments,1);assert.equal(f.state.estimates,0);
 if(changeScope)scope={synchronized:true};await f.app.submitPrepared(intent.intentId);assert.equal(payments,changeScope?2:1);assert.equal(f.state.estimates,1);assert.equal(f.state.sends,1);
});
for(const failure of [null,'balance','portal','payment','owner'])test(`Bok fee wave: withdrawal ${failure??'success'} drains actual credit, portal and fee reads`,async()=>{
 const f=bokAccountingFixture(),held=Promise.withResolvers(),entered=Promise.withResolvers(),seen=new Set(),error=Error('wave failed');let scope={synchronized:true},done=false;
 f.options.accountSession.operationScope=()=>scope;
 const wait=async name=>{seen.add(name);if(seen.size===3)entered.resolve();if(name===failure)throw error;await held.promise;};
 const native=f.options.sdk.Contract.at,resolve=f.options.funding.resolveBokWithdrawal;
 f.options.sdk.Contract.at=async(...args)=>{const contract=await native(...args);if(String(args[0])!==hex(5))return contract;return {methods:new Proxy(contract.methods,{get:(methods,key)=>key!=='balance_of'?methods[key]:(...values)=>({simulate:async()=>{await wait('balance');return methods.balance_of(...values).simulate();}})})};};
 f.options.funding.resolveBokWithdrawal=async()=>{await wait('portal');return resolve();};f.options.sdk.preparePrivateFeePayment=async()=>{await wait('payment');return {availableCredit:100n};};f.app=f.restart();
 const pending=f.app.prepare({type:'withdraw-bok',amount:'500',recipient:'0x'+'33'.repeat(20)},{immediate:true}).finally(()=>done=true),result=failure?assert.rejects(pending,failure==='owner'?{code:'ROLLING_CONTEXT_CHANGED'}:e=>e===error):pending;
 await entered.promise;await new Promise(setImmediate);assert.equal(done,false);assert.equal(f.values.size,0);assert.equal(f.state.sends,0);if(failure==='owner')scope={synchronized:true};held.resolve();await result;if(failure)assert.equal(f.values.size,0);
});

for(const type of ['cancel-bok-request','expire-bok-request'])for(const failure of ['anchor','payment'])test(`Bok fee wave: ${type} drains ${failure} failure with its held sibling`,async()=>{
 const f=bokAccountingFixture(),scope={synchronized:true};f.options.accountSession.operationScope=()=>scope;f.app=f.restart();
 f.pages[0].requests[0].available='60';f.pages[0].requests[0].reserved='0';await finishBokAccounting(f);
 const before=new Map(f.values),gate=Promise.withResolvers(),entered=Promise.withResolvers(),seen=new Set(),error=Error('release wave failed');let done=false;
 const wait=async name=>{seen.add(name);if(seen.size===2)entered.resolve();if(name===failure)throw error;await gate.promise;};
 const block=f.options.accountSession.node.getBlockData;f.options.accountSession.node.getBlockData=async(...args)=>{await wait('anchor');return block(...args);};
 f.options.sdk.preparePrivateFeePayment=async()=>{await wait('payment');return {availableCredit:100n};};
 const pending=f.app.prepare({type,requestId:hex(11)},{immediate:true}).finally(()=>done=true),rejected=assert.rejects(pending);
 await entered.promise;await new Promise(setImmediate);assert.equal(done,false);assert.deepEqual(f.values,before);assert.equal(f.state.sends,0);gate.resolve();await rejected;assert.deepEqual(f.values,before);
});

for(const mode of ['success','payment','availability','both','taken','fork','owner','scope','input-mutation'])test('name read wave overlaps and drains '+mode,{timeout:5000},async()=>{
 const f=fixture(),entered=Promise.withResolvers(),gate=Promise.withResolvers();let scope={synchronized:true},starts=0,payments=0,settled=false;
 const arrive=()=>{if(++starts===2)entered.resolve();};f.options.accountSession.operationScope=()=>scope;
 f.options.sdk.preparePrivateFeePayment=()=>{payments++;arrive();if(['payment','both'].includes(mode))throw Error('payment unavailable');return gate.promise.then(()=>({availableCredit:100n}));};
 f.state.beforeNameRead=async()=>{arrive();if(['availability','both'].includes(mode))throw Error('availability unavailable');await gate.promise;};
 const app=f.restart(),input={type:'name',first:'River',last:'Lane'};
 const work=app.prepare(input,{immediate:true}).finally(()=>settled=true);
 const succeeds=['success','input-mutation'].includes(mode),observed=succeeds?work:assert.rejects(work,error=>{
  if(['payment','both'].includes(mode))assert.equal(error.message,'payment unavailable');
  else if(mode==='taken')assert.equal(error.code,'ROLLING_NAME_TAKEN');
  else if(['availability','fork','owner'].includes(mode))assert.equal(error.code,'ROLLING_NAME_AVAILABILITY_UNAVAILABLE');
  else assert.equal(error.code,'ROLLING_CONTEXT_CHANGED');return true;
 });
 await entered.promise;assert.equal(settled,false);assert.equal(f.values.size,0);assert.equal(f.state.estimates,0);await assert.rejects(app.readModeratorStatus(),{code:'ROLLING_BUSY'});
 if(mode==='taken')f.state.nameRegistered=1n;
 if(mode==='fork')f.options.accountSession.node.getBlockData=async n=>({header:{globalVariables:{blockNumber:n}},blockHash:hex(43)});
 if(mode==='owner')f.options.accountSession.owner=new AztecAddress(new Fr(99n));
 if(mode==='scope')scope={synchronized:true};
 if(mode==='input-mutation')input.first='Changed';gate.resolve();const result=await observed;
 assert.equal(starts,2);assert.equal(payments,1);assert.equal(f.state.nameReads.length,1);assert.equal(f.state.sends,0);
 if(succeeds){assert.equal(result.action.first,'River');assert.equal(result.nameAvailability.anchor.blockHash,hex(42));assert.equal((await app.submitPrepared(result.intentId)).status,'confirmed');assert.equal(payments,1);assert.equal(f.state.nameReads.length,1);assert.equal(f.state.estimates,1);}
 else assert.equal(f.values.size,0);
});

function moderationTargetWave(f,{authority=()=>{},policy=()=>{},target=()=>{}}={}){
 const node=f.options.accountSession.node,storage=node.getPublicStorageAt,at=f.options.sdk.Contract.at;
 node.getPublicStorageAt=async(...args)=>{await authority();return storage(...args);};
 f.options.sdk.Contract.at=async(...args)=>{const board=await at(...args);return {methods:new Proxy(board.methods,{get:(methods,name)=>(...values)=>({simulate:async()=>{
  if(name==='main_policy')await policy();else if(['get_post','profile_state','avatar_moderation','subboard_state'].includes(name))await target(name);
  return methods[name](...values).simulate();
 }})})};};return f.restart();
}
for(const phase of ['prepare','submit'])for(const action of moderatorActions.slice(0,3))test('moderation target wave '+phase+' starts '+action.type+' before authority completes',{timeout:5000},async()=>{
 const f=moderatorFixture(),saved=phase==='submit'?await f.app.prepare(action):null,entered=Promise.withResolvers(),gate=Promise.withResolvers(),seen=[];
 let starts=0;const first=name=>async()=>{seen.push(name);if(++starts===3)entered.resolve();await gate.promise;};
 const app=moderationTargetWave(f,{authority:first('authority'),policy:first('policy'),target:async name=>{seen.push(name);if(name!=='avatar_moderation'){if(++starts===3)entered.resolve();await gate.promise;}}});
 const prior=f.state.privateReads.length,work=phase==='prepare'?app.prepare(action):app.submitPrepared(saved.intentId);
 await entered.promise;assert.equal(f.state.sends,0);await assert.rejects(app.readModeratorStatus(),{code:'ROLLING_BUSY'});gate.resolve();await work;
 const expected=['main_policy',...(action.type==='moderate-post'?['get_post']:action.type==='moderate-avatar'?['profile_state','avatar_moderation']:['subboard_state'])];
 const reads=f.state.privateReads.slice(prior).map(r=>r.name);for(const name of expected)assert.equal(reads.filter(v=>v===name).length,phase==='prepare'?1:2,'each existing pre-send boundary reads once');
});
for(const failing of ['authority','policy','target'])test('moderation target wave drains '+failing+' failure',{timeout:5000},async()=>{
 const f=moderatorFixture(),entered=Promise.withResolvers(),gate=Promise.withResolvers();let starts=0,settled=false;
 const branch=name=>()=>{if(++starts===3)entered.resolve();if(name===failing)throw Error(name+' failed');return gate.promise;};
 const app=moderationTargetWave(f,{authority:branch('authority'),policy:branch('policy'),target:branch('target')});
 const observed=assert.rejects(app.prepare(moderatorActions[0]).finally(()=>settled=true),new RegExp(failing+' failed'));
 await entered.promise;assert.equal(settled,false);assert.equal(f.values.size,0);await assert.rejects(app.readModeratorStatus(),{code:'ROLLING_BUSY'});gate.resolve();await observed;assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
});
for(const defect of ['unauthorized','malformed-policy','invalid-reason','fork','owner'])test('moderation target wave preserves '+defect+' priority and fences',{timeout:5000},async()=>{
 const f=moderatorFixture(),entered=Promise.withResolvers(),gate=Promise.withResolvers();let settled=false;
 if(defect==='unauthorized')f.state.moderator=99n;
 if(defect==='malformed-policy')f.state.responses.main_policy=[];
 const action={...moderatorActions[0],...(defect==='invalid-reason'?{reason:''}:{})};
 const app=moderationTargetWave(f,{target:async()=>{entered.resolve();await gate.promise;if(['unauthorized','malformed-policy','invalid-reason'].includes(defect))throw Error('target failure must not win');}});
 const observed=assert.rejects(app.prepare(action).finally(()=>settled=true),error=>{assert.notEqual(error.message,'target failure must not win');if(defect==='unauthorized')assert.equal(error.code,'ROLLING_MODERATOR_REQUIRED');if(defect==='malformed-policy')assert.equal(error.code,'ROLLING_INVALID_RESPONSE');return true;});
 await entered.promise;assert.equal(settled,false);
 if(defect==='fork')f.state.reorg=true;if(defect==='owner')f.state.guard=false;gate.resolve();await observed;assert.equal(f.values.size,0);assert.equal(f.state.sends,0);
});

for(const change of ['receipt','canonical-block'])test(`explicit reconciliation ignores same-operation permit after ${change} changes`,async()=>{
 const owner={},base=fixture();base.options.accountSession.operationScope=()=>owner;
 const f=await realJournalFixture(base),prepared=await f.app.prepare({type:'like',post:'5'});await f.app.submitPrepared(prepared.intentId);
 const journal=f.options.accountSession.journal;await journal.inspectOutcome({reuse:false});
 const node=f.options.accountSession.node,read=node.getTxReceipt;let reads=0;node.getTxReceipt=async hash=>{reads++;return read(hash);};
 await journal.inspectOutcome({reuse:true});assert.equal(reads,0,'fixture holds a canonical permit under the same operation');
 if(change==='canonical-block'){node.getBlock=async()=>({hash:{toString:()=>hex(999)}});await assert.rejects(f.app.reconcile(prepared.intentId),{code:'BB_SUBMISSION_UNKNOWN'});}
 else{const hash=[...f.receipts.keys()][0];f.receipts.set(hash,new PendingTxReceipt(TxHash.fromString(hash)));assert.notEqual((await f.app.reconcile(prepared.intentId)).status,'confirmed');}
 assert.equal(reads,1,'explicit reconciliation reads the exact signed transaction again');
});

for(const usdc of [false,true])for(const includeBok of [false,true])test(`claim verification wave ${usdc?'USDC':'ETH'} signup ${includeBok?'with':'without'} Bok drains before writing and reuses payment`,async()=>{
 const f=aggregateClaimFixture(usdc),scope={synchronized:true},gate=Promise.withResolvers(),started=Promise.withResolvers(),kinds=[];
 f.options.accountSession.operationScope=()=>scope;if(!includeBok)delete f.action.bokReceipt;
 const verify=f.options.sdk.prepareFundingClaim;
 f.options.sdk.prepareFundingClaim=async input=>{kinds.push(input.kind);if(kinds.length===(includeBok?3:2))started.resolve();await gate.promise;return verify(input);};
 const app=f.restart(),work=app.prepare(f.action,{immediate:true});await started.promise;
 assert.deepEqual(new Set(kinds),new Set(includeBok?['collateral','bok','private-fee']:['collateral','private-fee']));
 assert.equal(f.values.size,0);assert.equal(f.state.payments.length,0);assert.equal(f.state.sends,0);
 gate.resolve();const prepared=await work;assert.equal(f.state.payments.length,1);assert.equal(f.state.estimates,0);
 assert.equal((await app.submitPrepared(prepared.intentId)).status,'confirmed');assert.equal(f.state.payments.length,1);assert.equal(f.state.sends,1);
 assert.equal(f.state.claimReads.length,includeBok?6:4,'each receipt is independently revalidated at submission');
 const payload=f.state.sent.payload;if(includeBok)assert.deepEqual(payload.interactions.map(call=>call.name),['claim_deposit','claim']);else assert.equal(payload.name,'claim_deposit');
});
for(const kind of ['collateral','bok','private-fee'])for(const sync of [false,true])test(`claim verification wave drains other receipts on ${kind} ${sync?'sync':'async'} failure`,async()=>{
 const f=aggregateClaimFixture(),scope={synchronized:true},gate=Promise.withResolvers(),started=Promise.withResolvers();let calls=0,settled=false;
 f.options.accountSession.operationScope=()=>scope;const verify=f.options.sdk.prepareFundingClaim;
 f.options.sdk.prepareFundingClaim=input=>{if(++calls===3)started.resolve();if(input.kind===kind){if(sync)throw Error(kind);return Promise.reject(Error(kind));}return gate.promise.then(()=>verify(input));};
 const app=f.restart(),work=app.prepare(f.action,{immediate:true}).finally(()=>settled=true),rejected=assert.rejects(work,new RegExp(kind));
 await started.promise;await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);assert.equal(f.values.size,0);
 await assert.rejects(app.prepare(f.action,{immediate:true}),{code:'ROLLING_BUSY'});
 gate.resolve();await rejected;assert.equal(f.values.size,0);assert.equal(f.state.sends,0);
});
for(const change of ['scope','wallet','pxe','cached-node','owner'])test(`claim verification wave rejects ${change} replacement before saving intent`,async()=>{
 const f=aggregateClaimFixture(),gate=Promise.withResolvers(),started=Promise.withResolvers();let scope={synchronized:true},calls=0;
 f.options.accountSession.operationScope=()=>scope;const verify=f.options.sdk.prepareFundingClaim;
 f.options.sdk.prepareFundingClaim=async input=>{if(++calls===3)started.resolve();await gate.promise;return verify(input);};
 const work=f.restart().prepare(f.action,{immediate:true}),rejected=assert.rejects(work,{code:'ROLLING_CONTEXT_CHANGED'});await started.promise;
 const session=f.options.accountSession;
 if(change==='scope')scope={synchronized:true};if(change==='wallet')session.wallet={...session.wallet};if(change==='pxe')session.wallet.pxe={...session.wallet.pxe};if(change==='cached-node')session.wallet.pxe.node={...session.wallet.pxe.node};if(change==='owner')session.owner=new AztecAddress(new Fr(999));
 gate.resolve();await rejected;assert.equal(f.values.size,0);assert.equal(f.state.sends,0);
});
test('claim verification wave preserves original error priority and detached input',async()=>{
 const f=aggregateClaimFixture(),scope={synchronized:true},gate=Promise.withResolvers(),started=Promise.withResolvers();let calls=0;
 f.options.accountSession.operationScope=()=>scope;const action=structuredClone(f.action);
 f.options.sdk.prepareFundingClaim=async input=>{if(++calls===3)started.resolve();await gate.promise;assert.equal(input.receipt.amount,input.kind==='collateral'?'100':input.kind==='bok'?'300':'200');throw Error(input.kind);};
 const work=f.restart().prepare(action,{immediate:true}),rejected=assert.rejects(work,/collateral/);await started.promise;action.receipt.amount='999';action.feeReceipt.amount='999';action.bokReceipt.amount='999';gate.resolve();await rejected;assert.equal(f.values.size,0);
});

test('submit consumes only journal-owned completion and reconcile still freshly authenticates receipt',async()=>{
 const owner={},base=fixture();base.options.accountSession.operationScope=()=>owner;
 const f=await realJournalFixture(base),journal=f.options.accountSession.journal,node=f.options.accountSession.node;
 let reads=0,completionReads;const read=node.getTxReceipt;node.getTxReceipt=async hash=>{reads++;return read(hash);};
 f.options.accountSession.wallet.sendTx=async(_,opts)=>{
  f.state.sends++;const receipt=await f.install(opts.journalOperation);
  await journal.waitForCompletion(receipt.txHash.toString());completionReads=reads;journal.confirmed(receipt);return {receipt};
 };
 const app=f.restart(),p=await app.prepare({type:'like',post:'5'}),result=await app.submitPrepared(p.intentId);
 assert.equal(result.status,'confirmed');assert.equal(result.txHash,[...f.receipts.keys()][0]);assert.equal(reads,completionReads,'no second post-wallet receipt read');assert.equal(f.state.sends,1);
 f.receipts.set(result.txHash,new PendingTxReceipt(TxHash.fromString(result.txHash)));
 assert.equal((await app.reconcile(p.intentId)).status,'unknown');assert.equal(reads,completionReads+1,'external reconciliation remains fresh');
});

for(const mode of ['fee-ready','fee-needed','collateral-pending','deposit-error','exit-error','fee-error','owner-change'])test(`account readiness drains collateral, exit and fee wave: ${mode}`,async()=>{
 const f=fixture(),gates=Array.from({length:3},()=>Promise.withResolvers()),entered=new Set();let reads=0,settled=false;
 const errors=[Error('deposit'),Error('exit'),Error('fee')],original=f.options.privateStore.read;
 f.options.privateStore.read=async key=>{if(++reads===2){entered.add(1);await gates[1].promise;if(mode==='exit-error')throw errors[1];}return original(key);};
 f.state.beforeDepositIds=async()=>{entered.add(0);await gates[0].promise;if(mode==='deposit-error')throw errors[0];};
 if(mode==='collateral-pending')f.state.responses={get_deposit_ids:Array(10).fill(0n)};
 f.state.feeCredit=mode==='fee-needed'?0n:77n;f.state.beforeFeeBalance=async()=>{entered.add(2);await gates[2].promise;if(mode==='fee-error'||mode==='deposit-error'||mode==='exit-error')throw errors[2];};
 const result=f.app.readAccountStatus().finally(()=>settled=true);result.catch(()=>{});
 while(entered.size!==3)await new Promise(setImmediate);
 await assert.rejects(f.app.readFundingState(),{code:'ROLLING_BUSY'});
 if(mode==='owner-change')f.options.accountSession.owner=AztecAddress.fromBigIntUnsafe(99n);
 gates[mode==='exit-error'?1:0].resolve();await new Promise(setImmediate);assert.equal(settled,false);
 gates[2].resolve();await new Promise(setImmediate);assert.equal(settled,false,'third branch still owns the read');
 for(const gate of gates)gate.resolve();
 if(mode==='exit-error')await assert.rejects(result,{code:'BB_JOURNAL_INVALID'});
 else if(mode.endsWith('-error'))await assert.rejects(result,error=>error===errors[{'deposit-error':0,'fee-error':2}[mode]]);
 else if(mode==='owner-change')await assert.rejects(result,{code:'ROLLING_CONTEXT_CHANGED'});
 else{const value=await result;assert.equal(value.status,mode);assert.equal(value.pendingWithdrawal,null);if(mode!=='fee-needed')assert.equal(value.privateFeeCredit,'77');assert.deepEqual(value.depositIds,mode==='collateral-pending'?[]:[hex(9)]);}
 assert.equal(f.state.privateReads.filter(row=>row.name==='get_deposit_ids').length,1);assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
});

for(const usdc of [false,true])for(const includeBok of [false,true])test(`aggregate custody recovered once per owned prepare and submit: USDC=${usdc}, Bok=${includeBok}`,async()=>{
 const f=aggregateClaimFixture(usdc),scope={synchronized:true};f.options.accountSession.operationScope=()=>scope;if(!includeBok)delete f.action.bokReceipt;
 let loads=0;const load=f.options.funding.loadAggregate;f.options.funding.loadAggregate=async(...args)=>{loads++;return load(...args);};
 const app=f.restart(),prepared=await app.prepare(f.action,{immediate:true});assert.equal(loads,1);assert.equal(f.state.claimReads.length,includeBok?3:2);
 assert.equal((await app.submitPrepared(prepared.intentId)).status,'confirmed');assert.equal(loads,2,'submission freshly recovers custody once, then shares its exact immutable context');assert.equal(f.state.claimReads.length,includeBok?6:4);assert.equal(f.state.sends,1);
});
for(const change of ['scope','owner','failure'])test(`shared aggregate custody never escapes held ${change}`,async()=>{
 const f=aggregateClaimFixture(),gate=Promise.withResolvers(),entered=Promise.withResolvers();let scope={synchronized:true},loads=0;
 f.options.accountSession.operationScope=()=>scope;f.options.funding.loadAggregate=async()=>{loads++;entered.resolve();await gate.promise;if(change==='failure')throw Error('custody unavailable');return f.retained;};
 const work=f.restart().prepare(f.action,{immediate:true}),rejected=assert.rejects(work,change==='failure'?/custody unavailable/:{code:'ROLLING_CONTEXT_CHANGED'});await entered.promise;
 if(change==='scope')scope={synchronized:true};if(change==='owner')f.options.accountSession.owner=AztecAddress.fromBigIntUnsafe(99n);gate.resolve();await rejected;assert.equal(loads,1);assert.equal(f.state.claimReads.length,0);assert.equal(f.values.size,0);assert.equal(f.state.sends,0);
});

for(const includeBok of [false,true])test('Board claim immutable reads join the receipt wave '+includeBok,async()=>{
 const f=aggregateClaimFixture(),scope={synchronized:true},gate=Promise.withResolvers(),started=Promise.withResolvers();let count=0,seen;
 f.options.accountSession.operationScope=()=>scope;if(!includeBok)delete f.action.bokReceipt;
 const verify=f.options.sdk.prepareFundingClaim;
 f.options.sdk.prepareFundingClaim=async input=>{if(++count===(includeBok?4:3))started.resolve();await gate.promise;return verify(input);};
 f.options.sdk.prefetchBoardClaimWitnesses=async input=>{seen=input;if(++count===(includeBok?4:3))started.resolve();await gate.promise;};
 const work=f.restart().prepare(f.action,{immediate:true});await started.promise;
 assert.equal(f.values.size,0);assert.equal(f.state.sends,0);assert.equal(seen.wallet,f.options.accountSession.wallet);assert.equal(seen.node,f.options.accountSession.node);
 gate.resolve();await work;assert.equal(count,includeBok?4:3);
});
test('Board claim immutable read failure drains receipt reads without creating an intent',async()=>{
 const f=aggregateClaimFixture(),scope={synchronized:true},gate=Promise.withResolvers(),started=Promise.withResolvers();let count=0,settled=false;
 f.options.accountSession.operationScope=()=>scope;const verify=f.options.sdk.prepareFundingClaim;
 f.options.sdk.prepareFundingClaim=async input=>{if(++count===3)started.resolve();await gate.promise;return verify(input);};
 f.options.sdk.prefetchBoardClaimWitnesses=()=>{throw Error('immutable read failed');};
 const work=f.restart().prepare(f.action,{immediate:true}).finally(()=>settled=true),rejected=assert.rejects(work,/immutable read failed/);
 await started.promise;await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);gate.resolve();await rejected;assert.equal(f.values.size,0);assert.equal(f.state.sends,0);
});
for(const kind of ['private-fee','bok'])test('Board claim immutable reads exclude standalone '+kind,async()=>{
 const f=topUpFixture(kind);f.options.accountSession.operationScope=()=>scope;const scope={synchronized:true};
 f.options.sdk.prefetchBoardClaimWitnesses=()=>assert.fail('standalone claim must not read Board immutables');await f.restart().prepare(f.action,{immediate:true});assert.equal(f.state.sends,0);
});


function synchronizedFundingFixture({included=false}={}){
 const f=fixture(),scope={};f.options.accountSession.proposedTransactions=included;f.options.accountSession.journal.included=async receipt=>{assert.equal(receipt.status,'proposed');};f.options.accountSession.operationScope=()=>scope;f.app=f.restart();
 let syncs=0,contexts=0;
 const app=createSynchronizedRollingApplication({application:f.app,operationScope:()=>scope,contextGuard:f.options.contextGuard,synchronize:async()=>{syncs++;},prepareContext:async()=>{contexts++;}});
 return {...f,wrapped:app,scope,counts:()=>({syncs,contexts})};
}
test('empty funding workflow authenticates local storage without a native sync, then preparation takes a fresh anchor',async()=>{
 const f=synchronizedFundingFixture();assert.deepEqual(await f.wrapped.readFundingState(),{status:'ready'});
 assert.deepEqual(f.counts(),{syncs:0,contexts:0});assert.equal(f.scope.synchronized,undefined);assert.equal(f.state.privateReads.length,0);assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
 const prepared=await f.wrapped.prepare({type:'like',post:'5'});assert.equal(prepared.status,'prepared');assert.deepEqual(f.counts(),{syncs:1,contexts:1});assert.equal(f.scope.synchronized,true);assert.equal(f.state.sends,0);
});
for(const status of ['prepared','cancelled','unknown'])test(`pre-sync funding probe retains synchronized handling for saved ${status} workflow`,async()=>{
 const f=synchronizedFundingFixture(),prepared=await f.app.prepare({type:'like',post:'5'});
 if(status==='cancelled')await f.app.cancelPrepared(prepared.intentId);
 if(['confirmed','unknown'].includes(status))await f.app.submitPrepared(prepared.intentId);
 if(status==='unknown')f.state.outcome=null;
 const sends=f.state.sends,priorPrivateReads=f.state.privateReads.length;
 if(status!=='unknown')assert.equal(await f.app.readFundingState({beforeSync:true}),null);
 const result=await f.wrapped.readFundingState();assert.deepEqual(f.counts(),{syncs:1,contexts:1});assert.equal(f.state.sends,sends);assert.equal(f.state.privateReads.length,priorPrivateReads);
 assert.equal(result.status,['prepared','unknown'].includes(status)?'recovering':'ready');
 if(status==='unknown')assert.equal(result.intent.status,'unknown');
});
test('empty funding probe retains the encrypted-slot lease and rejects owner replacement before readiness',async()=>{
 const f=synchronizedFundingFixture(),entered=Promise.withResolvers(),held=Promise.withResolvers(),read=f.options.privateStore.read;
 f.options.privateStore.read=async key=>{entered.resolve();await held.promise;return read(key);};
 const pending=f.wrapped.readFundingState();await entered.promise;await assert.rejects(f.app.readFundingState(),{code:'ROLLING_BUSY'});
 f.options.accountSession.owner=AztecAddress.fromBigIntUnsafe(99n);held.resolve();await assert.rejects(pending,{code:'ROLLING_CONTEXT_CHANGED'});
 assert.deepEqual(f.counts(),{syncs:0,contexts:0});assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
});
test('empty funding readiness does not authorize overwriting a subsequently saved workflow',async()=>{
 const f=synchronizedFundingFixture();assert.deepEqual(await f.wrapped.readFundingState(),{status:'ready'});
 const prior=await f.app.prepare({type:'like',post:'5'}),saved=[...f.values];
 await assert.rejects(f.wrapped.prepare({type:'like',post:'6'}),{code:'ROLLING_RECOVERY_REQUIRED'});
 assert.deepEqual(f.counts(),{syncs:1,contexts:1});assert.deepEqual([...f.values],saved);assert.equal(f.state.sends,0);
 assert.equal((await f.app.readFundingState()).intent.intentId,prior.intentId);
});
test('empty funding probe rejects storage failure and invalid probe options without native reads or writes',async()=>{
 const f=synchronizedFundingFixture();let invoked=0;
 for(const option of [{beforeSync:false},{get beforeSync(){invoked++;return true;}},{beforeSync:true,extra:1}])await assert.rejects(f.app.readFundingState(option),{code:'ROLLING_INVALID_ACTION'});
 assert.equal(invoked,0);const error=Error('encrypted storage unavailable');f.options.privateStore.read=async()=>{throw error;};
 await assert.rejects(f.wrapped.readFundingState(),{code:'BB_JOURNAL_INVALID'});assert.deepEqual(f.counts(),{syncs:0,contexts:0});assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
});

for(const mode of ['success','discovery-failure','scope-change','wallet-change','pxe-change','owner-change'])test('account readiness native preparation boundary '+mode,{timeout:3000},async()=>{
 const f=fixture();let scope={synchronized:true};f.options.accountSession.operationScope=()=>scope;
 const gate=Promise.withResolvers(),entered=Promise.withResolvers(),exitGate=Promise.withResolvers(),exitEntered=Promise.withResolvers();let balances=0,seen,settled=false,reads=0;
 const read=f.options.privateStore.read;f.options.privateStore.read=async key=>{if(++reads===2){exitEntered.resolve();await exitGate.promise;}return read(key);};
 f.options.accountSession.wallet.pxe.prepareBoardActionState=async input=>{seen=input;entered.resolve();await gate.promise;if(mode==='discovery-failure')throw Error('discovery failed');};
 f.state.feeCredit=77n;f.state.beforeFeeBalance=()=>{balances++;};f.options.sdk.preparePrivateFeePayment=()=>assert.fail('Status cannot prepare payment');f.app=f.restart();
 const work=f.app.readAccountStatus().finally(()=>{settled=true;});work.catch(()=>{});await Promise.all([entered.promise,exitEntered.promise]);
 assert.equal(seen.method,'get_deposit_ids');assert.equal(seen.owner.toString(),hex(3));assert.equal(seen.board.toString(),hex(1));assert.equal(seen.privateFee.toString(),hex(2));
 assert.equal(f.state.privateReads.length,0);assert.equal(balances,0,'both utilities wait for native discovery');await assert.rejects(f.app.readFundingState(),{code:'ROLLING_BUSY'});
 if(mode==='scope-change')scope={synchronized:true};if(mode==='wallet-change')f.options.accountSession.wallet={...f.options.accountSession.wallet};
 if(mode==='pxe-change')f.options.accountSession.wallet.pxe={...f.options.accountSession.wallet.pxe};if(mode==='owner-change')f.options.accountSession.owner=AztecAddress.fromBigIntUnsafe(99n);
 gate.resolve();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(settled,false,'discovery result cannot release the operation before the pending-exit sibling drains');await assert.rejects(f.app.readFundingState(),{code:'ROLLING_BUSY'});
 assert.equal(f.state.privateReads.length,mode==='success'?2:0);exitGate.resolve();
 if(mode==='success'){const result=await work;assert.equal(result.status,'fee-ready');assert.equal(result.privateFeeCredit,'77');assert.equal(f.state.privateReads.filter(x=>x.name==='get_deposit_ids').length,1);}
 else await assert.rejects(work,mode==='discovery-failure'?/discovery failed/:{code:'ROLLING_CONTEXT_CHANGED'});
 assert.equal(balances,mode==='success'?1:0);assert.equal(f.state.estimates,0);assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
});
for(const bothFail of [false,true])test('account readiness fee failure drains held deposit utility '+bothFail,{timeout:3000},async()=>{
 const f=fixture(),scope={synchronized:true},ids=Promise.withResolvers(),idsEntered=Promise.withResolvers(),feeEntered=Promise.withResolvers();let settled=false;
 f.options.accountSession.operationScope=()=>scope;
 f.state.beforeDepositIds=async()=>{idsEntered.resolve();await ids.promise;if(bothFail)throw Error('deposit first');};
 f.state.beforeFeeBalance=()=>{feeEntered.resolve();throw Error('fee second');};f.options.sdk.preparePrivateFeePayment=()=>assert.fail('Status cannot prepare payment');f.app=f.restart();
 const work=f.app.readAccountStatus().finally(()=>{settled=true;}),rejection=assert.rejects(work,bothFail?/deposit first/:/fee second/);
 await Promise.all([idsEntered.promise,feeEntered.promise]);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(settled,false);assert.equal(f.state.readinessPreparations.length,1);await assert.rejects(f.app.readFundingState(),{code:'ROLLING_BUSY'});
 ids.resolve();await rejection;assert.equal(f.state.estimates,0);assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
 assert.deepEqual(await f.app.readFundingState(),{status:'ready'},'failed read releases its lease only after every sibling settles');
});
for(const change of ['scope','wallet','pxe','owner'])test('account readiness rejects late context change while fee result is held '+change,{timeout:3000},async()=>{
 const f=fixture(),feeGate=Promise.withResolvers(),feeEntered=Promise.withResolvers(),idsEntered=Promise.withResolvers();let scope={synchronized:true},settled=false;
 f.options.accountSession.operationScope=()=>scope;f.state.beforeDepositIds=()=>idsEntered.resolve();
 f.state.feeCredit=77n;f.state.beforeFeeBalance=async()=>{feeEntered.resolve();await feeGate.promise;};f.app=f.restart();
 const work=f.app.readAccountStatus().finally(()=>{settled=true;}),rejection=assert.rejects(work,{code:'ROLLING_CONTEXT_CHANGED'});
 await Promise.all([feeEntered.promise,idsEntered.promise]);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(settled,false);assert.equal(f.state.privateReads.filter(x=>x.name==='get_deposit_ids').length,1);
 if(change==='scope')scope={synchronized:true};if(change==='wallet')f.options.accountSession.wallet={...f.options.accountSession.wallet};
 if(change==='pxe')f.options.accountSession.wallet.pxe={...f.options.accountSession.wallet.pxe};if(change==='owner')f.options.accountSession.owner=AztecAddress.fromBigIntUnsafe(99n);
 feeGate.resolve();await rejection;assert.equal(f.state.estimates,0);assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
});
test('account readiness recovering saved work does not discover unrelated contracts',async()=>{
 const f=fixture();const saved=await f.app.prepare({type:'post',deposit:'9',content:'Saved current work'});
 const scope={synchronized:true};f.options.accountSession.operationScope=()=>scope;f.options.accountSession.wallet.pxe.prepareBoardActionState=()=>assert.fail('Unrelated discovery');f.app=f.restart();
 const result=await f.app.readAccountStatus();assert.equal(result.status,'recovering');assert.equal(result.intent.intentId,saved.intentId);
});

for(const mode of ['standalone','ETH','USDC','ETH+Bok'])test(`fee custody wave overlaps independent requests and stays fresh: ${mode}`,async()=>{
 const f=mode==='standalone'?topUpFixture():aggregateClaimFixture(mode==='USDC'),scope={synchronized:true};
 if(mode!=='standalone'&&mode!=='ETH+Bok')delete f.action.bokReceipt;
 f.options.accountSession.operationScope=()=>scope;
 const load=f.options.funding.loadAggregate,info=f.options.accountSession.node.getNodeInfo;
 let phase,loads=0,infos=0;
 f.options.funding.loadAggregate=async(...args)=>{loads++;phase.starts[0]=performance.now();phase.entered[0].resolve();await phase.gates[0].promise;phase.ends[0]=performance.now();return load(...args);};
 f.options.accountSession.node.getNodeInfo=async(...args)=>{infos++;phase.starts[1]=performance.now();phase.entered[1].resolve();await phase.gates[1].promise;phase.ends[1]=performance.now();return info(...args);};
 const app=f.restart();let prepared;
 for(const boundary of ['prepare','submit']){
  phase={gates:[Promise.withResolvers(),Promise.withResolvers()],entered:[Promise.withResolvers(),Promise.withResolvers()],starts:[],ends:[]};
  const current=phase;let settled=false;
  const work=(boundary==='prepare'?app.prepare(f.action,{immediate:true}):app.submitPrepared(prepared.intentId)).finally(()=>settled=true);
  if(boundary==='prepare'||mode==='standalone'){
   await Promise.all(current.entered.map(value=>value.promise));
   assert.equal(f.state.claimReads.filter(value=>value.kind==='private-fee').length,boundary==='prepare'?0:1);
   assert.equal(settled,false);assert.equal(f.state.sends,0);
   current.gates[0].resolve();await new Promise(setImmediate);assert.equal(settled,false);
   current.gates[1].resolve();
  }else{
   // Submit still checks collateral first. Its freshly recovered custody is
   // shared with the fee leg; this patch does not change that authority order.
   await current.entered[0].promise;current.gates[0].resolve();await current.entered[1].promise;current.gates[1].resolve();
  }
  const result=await work;if(boundary==='prepare')prepared=result;else assert.equal(result.status,'confirmed');
  if(boundary==='prepare'||mode==='standalone')assert(current.starts[0]<=current.ends[1]&&current.starts[1]<=current.ends[0],'both actual request intervals overlap');
 }
 assert.equal(loads,2);assert.equal(infos,2);assert.equal(f.state.sends,1);
});
for(const branch of ['custody','metadata'])for(const synchronous of [false,true])test(`fee custody wave drains ${branch} ${synchronous?'synchronous':'asynchronous'} rejection`,async()=>{
 const f=topUpFixture(),entered=[Promise.withResolvers(),Promise.withResolvers()],gate=Promise.withResolvers(),error=Error(branch);let settled=false;
 const failure=()=>{if(synchronous)throw error;return Promise.reject(error);};
 f.options.funding.loadAggregate=()=>{entered[0].resolve();return branch==='custody'?failure():gate.promise.then(()=>null);};
 const info=f.options.accountSession.node.getNodeInfo;f.options.accountSession.node.getNodeInfo=()=>{entered[1].resolve();return branch==='metadata'?failure():gate.promise.then(()=>info());};
 const app=f.restart(),work=app.prepare(f.action,{immediate:true}).finally(()=>settled=true),rejected=assert.rejects(work,value=>value===error);
 await Promise.all(entered.map(value=>value.promise));await new Promise(setImmediate);assert.equal(settled,false);
 await assert.rejects(app.prepare(f.action,{immediate:true}),{code:'ROLLING_BUSY'});
 gate.resolve();await rejected;assert.equal(f.state.claimReads.length,0);assert.equal(f.values.size,0);assert.equal(f.state.sends,0);
});
test('fee custody wave retains custody error priority when both reads fail',async()=>{
 const f=topUpFixture(),first=Error('custody'),second=Error('metadata');
 f.options.funding.loadAggregate=()=>{throw first;};f.options.accountSession.node.getNodeInfo=()=>{throw second;};
 await assert.rejects(f.restart().prepare(f.action,{immediate:true}),value=>value===first);assert.equal(f.state.claimReads.length,0);assert.equal(f.values.size,0);
});
for(const mutation of ['owner','node','portal'])test(`fee custody wave fences changed ${mutation} before claim authority`,async()=>{
 const f=topUpFixture(),gate=Promise.withResolvers(),entered=Promise.withResolvers(),info=f.options.accountSession.node.getNodeInfo;
 f.options.funding.loadAggregate=async()=>{entered.resolve();await gate.promise;return null;};
 f.options.accountSession.node.getNodeInfo=async()=>{await gate.promise;return info();};
 const app=f.restart(),work=app.prepare(f.action,{immediate:true});work.catch(()=>{});await entered.promise;
 if(mutation==='owner')f.options.accountSession.owner=AztecAddress.fromBigIntUnsafe(99n);
 if(mutation==='node'){const node={...f.options.accountSession.node};f.options.accountSession.node=node;f.options.accountSession.wallet.aztecNode=node;}
 if(mutation==='portal')f.options.deployment.portal='0x'+'ff'.repeat(20);
 gate.resolve();await assert.rejects(work,{code:'ROLLING_CONTEXT_CHANGED'});assert.equal(f.state.claimReads.length,0);assert.equal(f.values.size,0);assert.equal(f.state.sends,0);
});

for(const type of ['preference','read-marker'])test(`removed on-chain ${type} action cannot prepare or spend`,async()=>{
 const f=fixture();assert.equal(f.app.readPreferenceHead,undefined);
 await assert.rejects(f.app.prepare({type}),{code:'ROLLING_INVALID_ACTION'});assert.equal(f.state.estimates,0);assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
});


for(const phase of ['included','confirmed'])test('synchronized status ignores only completed ordinary history and still discovers actual native state: '+phase,async()=>{
 const f=phase==='included'?proposedFixture():fixture(),intent=await f.app.prepare({type:'like',post:'5'});assert.equal((await f.app.submitPrepared(intent.intentId)).status,phase);
 const scope={synchronized:true};f.options.accountSession.operationScope=()=>scope;
 let inspections=0;f.options.accountSession.journal.inspectOutcome=async()=>{inspections++;return null;};
 const app=f.restart(),before=[...f.values.entries()],reads=f.state.privateReads.length;
 const status=await app.readAccountStatus();assert.equal(status.status,'fee-ready');assert.equal(inspections,0);
 assert(f.state.privateReads.length>reads);assert(f.state.privateReads.some(x=>x.name==='get_deposit_ids'));
 assert.deepEqual([...f.values.entries()],before,'status never rewrites confirmed history');
 assert.equal((await app.readFundingState()).status,'recovering');assert.equal(inspections,1,'funding authority still inspects receipt');
 await assert.rejects(app.prepare({type:'like',post:'6'}),{code:'ROLLING_RECOVERY_REQUIRED'});assert.equal(inspections,2);
});
for(const synchronized of [false,undefined])test('status historical shortcut requires synchronized native operation: '+synchronized,async()=>{
 const f=fixture(),intent=await f.app.prepare({type:'like',post:'5'});await f.app.submitPrepared(intent.intentId);
 f.options.accountSession.operationScope=()=>synchronized===undefined?null:{synchronized};
 let inspections=0;f.options.accountSession.journal.inspectOutcome=async()=>{inspections++;return null;};
 assert.equal((await f.restart().readAccountStatus()).status,'recovering');assert.equal(inspections,1);
});
test('pending withdrawal keeps ordinary history on the canonical status path',async()=>{
 const f=collateralFixture(),exit=await f.app.prepare({type:'withdraw',deposit:'9'});await f.app.submitPrepared(exit.intentId);
 const intent=await f.app.prepare({type:'like',post:'5'});await f.app.submitPrepared(intent.intentId);
 const scope={synchronized:true};f.options.accountSession.operationScope=()=>scope;
 let inspections=0;f.options.accountSession.journal.inspectOutcome=async()=>{inspections++;return null;};
 const status=await f.restart().readAccountStatus();assert.equal(status.status,'recovering');assert.equal(inspections,1);assert.equal(status.pendingWithdrawal.intentId,exit.intentId);
});

for(const mode of ['empty','funded','unsynchronized','pending-exit','recovering'])test('opening collateral classification '+mode,async()=>{
 const f=mode==='pending-exit'?collateralFixture():fixture();
 if(mode==='pending-exit'){const exit=await f.app.prepare({type:'withdraw',deposit:'9'});await f.app.submitPrepared(exit.intentId);}
 if(mode==='recovering')await f.app.prepare({type:'like',post:'5'});
 const scope={synchronized:mode!=='unsynchronized'};f.options.accountSession.operationScope=()=>scope;
 if(mode!=='funded')f.state.responses={get_deposit_ids:Array(10).fill(0n)};
 let fees=0;f.state.feeCredit=77n;f.state.beforeFeeBalance=()=>{fees++;};
 const app=f.restart(),before=[...f.values.entries()],readStart=f.state.privateReads.length;
 const result=await app.readAccountStatus({opening:true});
 assert.equal(result.status,mode==='recovering'?'recovering':mode==='funded'?'fee-ready':'collateral-pending');
 assert.equal(fees,mode==='recovering'?0:1);
 assert.equal(f.state.privateReads.slice(readStart).filter(row=>row.name==='get_deposit_ids').length,mode==='recovering'?0:1);
 if(mode==='empty'){assert.equal(Object.hasOwn(result,'privateFeeCredit'),false);assert.deepEqual(result.depositIds,[]);assert.equal(f.state.readinessPreparations.at(-1).collateralOnly,undefined);assert.deepEqual([...f.values.entries()],before);}
 if(mode==='pending-exit'){assert(result.pendingWithdrawal);assert.equal(f.state.readinessPreparations.at(-1).collateralOnly,undefined);}
 if(mode==='funded'){assert.equal(result.privateFeeCredit,'77');assert.deepEqual(result.depositIds,[hex(9)]);}
});
for(const change of ['scope','wallet','pxe','owner'])test('opening collateral classification rejects held-read '+change,async()=>{
 const f=fixture(),gate=Promise.withResolvers(),entered=Promise.withResolvers(),feeEntered=Promise.withResolvers();let scope={synchronized:true},fees=0;
 f.options.accountSession.operationScope=()=>scope;f.state.responses={get_deposit_ids:Array(10).fill(0n)};
 f.state.beforeDepositIds=async()=>{entered.resolve();await gate.promise;};
 f.state.feeCredit=77n;f.state.beforeFeeBalance=()=>{fees++;feeEntered.resolve();};const app=f.restart();
 const work=app.readAccountStatus({opening:true}),rejected=assert.rejects(work,{code:'ROLLING_CONTEXT_CHANGED'});await Promise.all([entered.promise,feeEntered.promise]);
 await assert.rejects(app.readAccountStatus(),{code:'ROLLING_BUSY'});
 if(change==='scope')scope={synchronized:true};if(change==='wallet')f.options.accountSession.wallet={...f.options.accountSession.wallet};
 if(change==='pxe')f.options.accountSession.wallet.pxe={...f.options.accountSession.wallet.pxe};if(change==='owner')f.options.accountSession.owner=AztecAddress.fromBigIntUnsafe(99n);
 gate.resolve();await rejected;assert.equal(fees,1);assert.equal(f.values.size,0);assert.equal(f.state.sends,0);
});
test('opening collateral classification rejects failed native discovery before any utility',async()=>{
 const f=fixture();f.options.accountSession.operationScope=()=>scope;const scope={synchronized:true};let fees=0;
 f.options.accountSession.wallet.pxe.prepareBoardActionState=async()=>{throw Error('native discovery failed');};
 f.state.feeCredit=77n;f.state.beforeFeeBalance=()=>{fees++;};
 await assert.rejects(f.restart().readAccountStatus({opening:true}),/native discovery failed/);assert.equal(fees,0);assert.equal(f.state.privateReads.length,0);
});

for(const phase of ['included','confirmed'])test('native claim readiness omits only presentation receipt reread for '+phase,async()=>{
 const f=fundingFixture();
 if(phase==='included'){
  f.options.accountSession.proposedTransactions=true;f.options.accountSession.journal.included=async()=>{};
  const send=f.options.accountSession.wallet.sendTx;f.options.accountSession.wallet.sendTx=async(...args)=>{const result=await send(...args);f.state.outcome.receipt.status='proposed';return result;};
 }
 const app=f.restart(),intent=await app.prepare({type:'claim-deposit',receipt:f.receipt});assert.equal((await app.submitPrepared(intent.intentId)).status,phase);
 const scope={synchronized:true};f.options.accountSession.operationScope=()=>scope;
 let inspections=0,fees=0;f.options.accountSession.journal.inspectOutcome=async()=>{inspections++;return null;};
 f.state.feeCredit=77n;f.state.beforeFeeBalance=()=>{fees++;};
 const current=f.restart(),before=[...f.values],reads=f.state.privateReads.length,status=await current.readAccountStatus();
 assert.equal(status.status,'fee-ready');assert.equal(status.privateFeeCredit,'77');assert.equal(inspections,0);assert.equal(fees,1);
 assert(f.state.privateReads.slice(reads).some(row=>row.name==='get_deposit_ids'));assert.deepEqual([...f.values],before);
 assert.equal((await current.readFundingState()).status,'recovering');assert.equal(inspections,1);
 await assert.rejects(current.prepare({type:'like',post:'5'}),{code:'ROLLING_RECOVERY_REQUIRED'});assert.equal(inspections,2);
});
for(const mode of ['unsynchronized','missing-native-notes','fee-failure'])test('native claim readiness still requires '+mode,async()=>{
 const f=fundingFixture(),intent=await f.app.prepare({type:'claim-deposit',receipt:f.receipt});await f.app.submitPrepared(intent.intentId);
 f.options.accountSession.operationScope=()=>({synchronized:mode!=='unsynchronized'});
 // Keep one exact operation object across every asynchronous fence.
 const scope=f.options.accountSession.operationScope();f.options.accountSession.operationScope=()=>scope;
 let inspections=0;f.options.accountSession.journal.inspectOutcome=async()=>{inspections++;return null;};
 if(mode==='missing-native-notes')f.state.responses={get_deposit_ids:Array(10).fill(0n)};
 if(mode==='fee-failure')f.state.feeCredit=0n;
 const status=await f.restart().readAccountStatus();assert.equal(status.status,mode==='unsynchronized'?'recovering':mode==='missing-native-notes'?'collateral-pending':'fee-needed');
 assert.equal(inspections,mode==='unsynchronized'?1:0);
});

for(const failure of [false,true])test('ordinary arguments wait for owned discovery while predecessor proceeds: '+failure,async()=>{
 const f=fixture(),gate=Promise.withResolvers(),entered=Promise.withResolvers(),scope={synchronized:true,contractStateReady:gate.promise};
 f.options.accountSession.operationScope=()=>scope;f.options.accountSession.journal.assertCanStart=async()=>{entered.resolve();};f.app=f.restart();
 let settled=false;const work=f.app.prepare({type:'post',deposit:'9',content:'Wait safely for fresh notes'},{immediate:true});work.then(()=>settled=true,()=>settled=true);
 const result=failure?assert.rejects(work,/native discovery failed/):work;
 await entered.promise;await new Promise(r=>setImmediate(r));assert.equal(f.state.privateReads.length,0);assert.equal(f.values.size,0);assert.equal(settled,false);
 if(failure)gate.reject(Error('native discovery failed'));else gate.resolve();await result;
 assert.equal(f.state.sends,0);if(failure)assert.equal(f.values.size,0);else assert(f.state.privateReads.length>0);
});

for(const action of [{type:'like',post:'42'},{type:'name',first:'Fresh',last:'Willow'},{type:'bio',name:'5',expectedVersion:'0',content:'Exact bio'},{type:'avatar',name:'5',expectedVersion:'0',width:100,height:100,data:'AA=='},{type:'subboard',slug:'new-board',name:'New',description:'Description',rules:''}])test(action.type+' predecessor cannot enter arguments or write an intent before native discovery',async()=>{
 const f=fixture(),gate=Promise.withResolvers(),entered=Promise.withResolvers(),scope={synchronized:true,contractStateReady:gate.promise};
 f.options.accountSession.operationScope=()=>scope;f.options.accountSession.journal.assertCanStart=async()=>{entered.resolve();};f.app=f.restart();
 let settled=false;const work=f.app.prepare(action,{immediate:true});work.then(()=>settled=true,()=>settled=true);const result=assert.rejects(work,/native discovery failed/);
 await entered.promise;await new Promise(r=>setImmediate(r));assert.equal(f.state.privateReads.length,0);assert.equal(f.values.size,0);assert.equal(settled,false);
 gate.reject(Error('native discovery failed'));await result;assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
});

for(const action of [{type:'like',post:'42'},{type:'name',first:'Fresh',last:'Willow'},{type:'bio',name:'5',expectedVersion:'0',content:'Exact bio'},{type:'avatar',name:'5',expectedVersion:'0',width:100,height:100,data:'AA=='},{type:'subboard',slug:'new-board',name:'New',description:'Description',rules:''}])for(const change of ['scope','barrier'])test(action.type+' captures discovery owner before held predecessor: '+change,async()=>{
 const f=fixture(),predecessor=Promise.withResolvers(),entered=Promise.withResolvers(),discovery=Promise.withResolvers();
 let scope={synchronized:true,contractStateReady:discovery.promise};const owner=scope;
 f.options.accountSession.operationScope=()=>scope;f.options.accountSession.journal.assertCanStart=async()=>{entered.resolve();await predecessor.promise;};f.app=f.restart();
 let settled=false;const work=f.app.prepare(action,{immediate:true});work.then(()=>settled=true,()=>settled=true);const result=assert.rejects(work,{code:'ROLLING_CONTEXT_CHANGED'});
 await entered.promise;if(change==='scope')scope={synchronized:true};else owner.contractStateReady=Promise.resolve();
 predecessor.resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false,'the original discovery barrier still owns the wait');assert.equal(f.values.size,0);assert.equal(f.state.privateReads.length,0);
 discovery.resolve();await result;assert.equal(f.values.size,0);assert.equal(f.state.privateReads.length,0);assert.equal(f.state.sends,0);
});

for(const nativeState of ['missing-collateral','missing-credit'])test('included ordinary history never supplies rolled-back native state: '+nativeState,async()=>{
 const f=proposedFixture(),intent=await f.app.prepare({type:'like',post:'5'});assert.equal((await f.app.submitPrepared(intent.intentId)).status,'included');
 const scope={synchronized:true};f.options.accountSession.operationScope=()=>scope;
 let inspections=0;f.options.accountSession.journal.inspectOutcome=async()=>{inspections++;return null;};
 if(nativeState==='missing-collateral')f.state.responses={get_deposit_ids:Array(10).fill(0n)};
 else f.state.feeCredit=0n;
 const current=f.restart(),before=[...f.values],status=await current.readAccountStatus();
 assert.equal(status.status,nativeState==='missing-collateral'?'collateral-pending':'fee-needed');assert.equal(inspections,0);assert.deepEqual([...f.values],before);
 await assert.rejects(current.prepare({type:'like',post:'6'}),{code:'ROLLING_RECOVERY_REQUIRED'});assert.equal(inspections,1);assert.equal(f.state.sends,1);
});

for(const action of [
 {type:'bio',name:'5',expectedVersion:'0',content:'Exact bio é'},
 {type:'bio',name:'5',expectedVersion:'0',content:''},
 {type:'avatar',name:'5',expectedVersion:'0',width:100,height:100,data:'AA=='},
 {type:'avatar',name:'5',expectedVersion:'0',width:0,height:0,data:''},
 {type:'subboard',slug:'new-board',name:'New',description:'Description',rules:'Exact rules'},
])test(action.type+' actual immediate overlap retains exact ABI and generic fee checks '+JSON.stringify(action),async()=>{
 const baseline=fixture();await baseline.app.prepare(action);const expected=baseline.state.calls.at(-1);
 const f=fixture(),discovery=Promise.withResolvers(),predecessor=Promise.withResolvers(),scope={synchronized:false,preparationReads:[]};let fees=0;
 f.options.accountSession.operationScope=()=>scope;f.options.accountSession.journal.assertCanStart=async()=>{predecessor.resolve();};
 const payment=f.options.sdk.preparePrivateFeePayment;f.options.sdk.preparePrivateFeePayment=async input=>{fees++;assert.equal(input.creditCheck,undefined,'profile and board content retain generic fee qualification');return payment(input);};
 const raw=f.restart(),application=createSynchronizedRollingApplication({application:raw,operationScope:()=>scope,contextGuard:()=>{},synchronize:()=>{},prepareContractState:async({method})=>{assert.equal(method,{bio:'set_bio',avatar:'set_avatar',subboard:'create_subboard'}[action.type]);await discovery.promise;}});
 const pending=application.prepare(action,{immediate:true});await predecessor.promise;await new Promise(setImmediate);
 assert.equal(f.values.size,0);assert.equal(fees,0);assert.equal(f.state.estimates,0);assert.equal(f.state.sends,0);
 discovery.resolve();const prepared=await pending;assert.equal(fees,1);assert.equal(scope.contractStateReady,undefined);assert.equal(prepared.status,'prepared');
 assert.equal((await raw.submitPrepared(prepared.intentId)).status,'confirmed');
 const actual=f.state.calls.at(-1);assert.equal(actual.name,expected.name);assert.deepEqual(actual.args,expected.args);
 const abi=artifact.functions.find(fn=>fn.name===actual.name);assert.deepEqual(encodeArguments(abi,actual.args),encodeArguments(abi,expected.args));assert.equal(f.state.sends,1);
});

for(const failure of ['none','discovery','fee','both'])test('funded opening shares discovery and drains native balance ownership: '+failure,async()=>{
 const f=fixture(),scope={synchronized:true};f.options.accountSession.operationScope=()=>scope;
 const discovery=Promise.withResolvers(),exit=Promise.withResolvers(),discoveryEntered=Promise.withResolvers(),exitEntered=Promise.withResolvers();
 let discoveries=0,fees=0,settled=false,reads=0;
 const read=f.options.privateStore.read;f.options.privateStore.read=async key=>{if(++reads===2){exitEntered.resolve();await exit.promise;}return read(key);};
 f.options.accountSession.wallet.pxe.prepareBoardActionState=async input=>{
  discoveries++;assert.equal(input.collateralOnly,undefined);discoveryEntered.resolve();await discovery.promise;
  if(failure==='discovery'||failure==='both')throw Error('FPC discovery failed');
 };
 f.state.feeCredit=77n;f.state.beforeFeeBalance=()=>{fees++;if(failure==='fee'||failure==='both')throw Error('native balance failed');};
 f.options.sdk.preparePrivateFeePayment=()=>assert.fail('Status cannot prepare payment');
 const app=f.restart(),before=[...f.values],work=app.readAccountStatus({opening:true});work.then(()=>settled=true,()=>settled=true);
 const outcome=failure==='none'?work:assert.rejects(work,failure==='fee'?/native balance failed/:/FPC discovery failed/);
 await Promise.all([discoveryEntered.promise,exitEntered.promise]);assert.equal(f.state.privateReads.length,0);assert.equal(fees,0);
 await assert.rejects(app.readAccountStatus(),{code:'ROLLING_BUSY'});
 discovery.resolve();await new Promise(setImmediate);assert.equal(settled,false,'pending exit retains operation ownership while native reads settle');
 exit.resolve();const result=await outcome;
 if(failure==='none'){assert.equal(result.status,'fee-ready');assert.equal(result.privateFeeCredit,'77');assert.deepEqual(result.depositIds,[hex(9)]);}
 assert.equal(discoveries,1);assert.equal(fees,['discovery','both'].includes(failure)?0:1);assert.equal(f.state.privateReads.filter(x=>x.name==='get_deposit_ids').length,['discovery','both'].includes(failure)?0:1);
 assert.deepEqual([...f.values],before);assert.equal(f.state.sends,0);assert.equal(f.state.estimates,0);
});
for(const change of ['scope','wallet','pxe','owner','synchronized'])test('funded opening fee wave rejects held '+change,async()=>{
 const f=fixture(),gate=Promise.withResolvers(),entered=Promise.withResolvers();let scope={synchronized:true};f.options.accountSession.operationScope=()=>scope;
 f.options.accountSession.wallet.pxe.prepareBoardActionState=async input=>{if(!input.collateralOnly){entered.resolve();await gate.promise;}};
 f.state.feeCredit=77n;
 const app=f.restart(),work=app.readAccountStatus({opening:true}),rejected=assert.rejects(work,{code:'ROLLING_CONTEXT_CHANGED'});
 await entered.promise;
 if(change==='scope')scope={synchronized:true};if(change==='wallet')f.options.accountSession.wallet={...f.options.accountSession.wallet};
 if(change==='pxe')f.options.accountSession.wallet.pxe={...f.options.accountSession.wallet.pxe};if(change==='owner')f.options.accountSession.owner=AztecAddress.fromBigIntUnsafe(99n);
 if(change==='synchronized')scope.synchronized=false;
 gate.resolve();await rejected;assert.equal(f.values.size,0);assert.equal(f.state.sends,0);
});

for(const included of [false,true])test('canonical ordinary funding workflow avoids pre-bridge sync, included='+included,async()=>{
 const f=synchronizedFundingFixture({included});
 const prepared=await f.app.prepare({type:'like',post:'5'});await f.app.submitPrepared(prepared.intentId);
 if(included){f.state.outcome.receipt.status='proposed';await f.app.reconcile(prepared.intentId);}
 let inspections=0;const inspect=f.options.accountSession.journal.inspectOutcome;
 f.options.accountSession.journal.inspectOutcome=async(...args)=>{inspections++;return inspect(...args);};
 const beforeReads=f.state.privateReads.length;assert.deepEqual(await f.wrapped.readFundingState(),{status:'ready'});
 assert.equal(inspections,1);assert.deepEqual(f.counts(),{syncs:0,contexts:0});assert.equal(f.scope.synchronized,undefined);assert.equal(f.state.privateReads.length,beforeReads);
 await f.wrapped.prepare({type:'like',post:'5'});assert.deepEqual(f.counts(),{syncs:1,contexts:1});assert.equal(f.state.sends,1);
});
test('pre-sync funding workflow holds receipt authority and rejects changed owner',async()=>{
 const f=synchronizedFundingFixture(),prepared=await f.app.prepare({type:'like',post:'5'});await f.app.submitPrepared(prepared.intentId);
 const gate=Promise.withResolvers(),entered=Promise.withResolvers(),inspect=f.options.accountSession.journal.inspectOutcome;
 f.options.accountSession.journal.inspectOutcome=async(...args)=>{entered.resolve();await gate.promise;return inspect(...args);};
 const work=f.wrapped.readFundingState(),rejected=assert.rejects(work,{code:'ROLLING_CONTEXT_CHANGED'});await entered.promise;
 await assert.rejects(f.app.readFundingState(),{code:'ROLLING_BUSY'});f.options.accountSession.owner=AztecAddress.fromBigIntUnsafe(99n);gate.resolve();await rejected;
 assert.deepEqual(f.counts(),{syncs:0,contexts:0});assert.equal(f.state.sends,1);
});

for(const field of ['bok','fundingBok','fundingFee','bokReleaseSource','bokRequestScope','withdrawal','replacementReview'])test('pre-sync funding excludes completed ordinary record carrying '+field,async()=>{
 const f=synchronizedFundingFixture(),prepared=await f.app.prepare({type:'like',post:'5'});await f.app.submitPrepared(prepared.intentId);
 const slot=await createEncryptedJournalSlot({storage:f.options.privateStore,walletSecret:f.options.accountSession.walletSecret,walletSalt:f.options.accountSession.walletSalt,scopeText:JSON.stringify(['ROLLING_WORKFLOW_V1',l2JournalScopeText({account:f.options.accountSession.owner.toString(),chainId:'31337',version:'1',rollup:f.options.deployment.network.rollup,board:hex(1),portal:f.options.deployment.portal})]),keyDomain:'ROLLING_WORKFLOW_V1'});
 const prior=await slot.read();await slot.write(prior,{...prior.value,[field]:{held:true}});
 assert.equal(await f.app.readFundingState({beforeSync:true}),null);assert.deepEqual(f.counts(),{syncs:0,contexts:0});
});
test('pre-sync funding canonical failure does not mark scope synchronized or permit a new action',async()=>{
 const f=synchronizedFundingFixture(),prepared=await f.app.prepare({type:'like',post:'5'});await f.app.submitPrepared(prepared.intentId);
 const error=Error('canonical block changed');f.options.accountSession.journal.inspectOutcome=async()=>{throw error;};
 await assert.rejects(f.wrapped.readFundingState(),e=>e===error);assert.deepEqual(f.counts(),{syncs:0,contexts:0});assert.equal(f.scope.synchronized,undefined);
 assert.equal(f.state.sends,1);
});

for(const kind of ['collateral','private-fee','bok'])for(const included of [false,true])test('pre-sync completed '+kind+' claim keeps exact receipt authority before fresh next claim, included='+included,async()=>{
 const f=kind==='collateral'?fundingFixture():topUpFixture(kind),action=kind==='collateral'?{type:'claim-deposit',receipt:f.receipt}:f.action;
 f.options.accountSession.proposedTransactions=included;f.options.accountSession.journal.included=async receipt=>assert.equal(receipt.status,'proposed');
 const scope={};f.options.accountSession.operationScope=()=>scope;
 const raw=f.restart(),prepared=await raw.prepare(action);await raw.submitPrepared(prepared.intentId);
 if(included){f.state.outcome.receipt.status='proposed';await raw.reconcile(prepared.intentId);}
 let syncs=0,inspections=0;
 const inspect=f.options.accountSession.journal.inspectOutcome;f.options.accountSession.journal.inspectOutcome=async(...args)=>{inspections++;return inspect(...args);};
 const app=createSynchronizedRollingApplication({application:raw,operationScope:()=>scope,contextGuard:f.options.contextGuard,synchronize:async()=>{syncs++;}});
 const reads=f.state.claimReads.length,privateReads=f.state.privateReads.length;
 assert.deepEqual(await app.readFundingState(),{status:'ready'});assert.equal(inspections,1);assert.equal(syncs,0);assert.equal(scope.synchronized,undefined);
 assert.equal(f.state.claimReads.length,reads);assert.equal(f.state.privateReads.length,privateReads);
 f.state.claimError=true;await assert.rejects(app.prepare(action,{immediate:true}),{code:'ROLLING_FUNDING_REORG'});
 assert.equal(syncs,1);assert(f.state.claimReads.length>reads);assert.equal(f.state.sends,1);
});
for(const kind of ['private-fee','bok'])test('pre-sync completed '+kind+' claim rejects lost canonical predecessor authority',async()=>{
 const f=topUpFixture(kind),scope={};f.options.accountSession.operationScope=()=>scope;
 const raw=f.restart(),prepared=await raw.prepare(f.action);await raw.submitPrepared(prepared.intentId);f.state.outcome=null;let syncs=0;
 const app=createSynchronizedRollingApplication({application:raw,operationScope:()=>scope,contextGuard:f.options.contextGuard,synchronize:async()=>{syncs++;}});
 const result=await app.readFundingState();assert.equal(result.status,'recovering');assert.equal(result.intent.intentId,prepared.intentId);assert.equal(result.intent.status,'unknown');
 await assert.rejects(app.prepare(f.action,{immediate:true}),{code:'ROLLING_RECOVERY_REQUIRED'});assert.equal(f.state.sends,1);assert.equal(syncs,1);
});

for(const kind of ['private-fee','bok'])for(const included of [false,true])test('completed '+kind+' claim display uses fresh native balances without historical receipt, included='+included,async()=>{
 const f=topUpFixture(kind),scope={synchronized:true};f.options.accountSession.operationScope=()=>scope;
 f.options.accountSession.proposedTransactions=included;f.options.accountSession.journal.included=async()=>{};
 const raw=f.restart(),prepared=await raw.prepare(f.action);await raw.submitPrepared(prepared.intentId);
 if(included){f.state.outcome.receipt.status='proposed';await raw.reconcile(prepared.intentId);}
 let inspections=0;f.options.accountSession.journal.inspectOutcome=async()=>{inspections++;return null;};
 f.state.feeCredit=200n;const before=f.state.privateReads.length,status=await raw.readAccountStatus();assert.equal(status.status,'fee-ready');assert.equal(status.privateFeeCredit,'200');assert.equal(inspections,0);
 assert(f.state.privateReads.slice(before).some(x=>x.name==='get_deposit_ids'));
 assert.equal((await raw.readFundingState()).status,'recovering');assert.equal(inspections,1);
 await assert.rejects(raw.prepare(f.action),{code:'ROLLING_RECOVERY_REQUIRED'});assert.equal(f.state.sends,1);
});
for(const kind of ['private-fee','bok'])test('completed '+kind+' claim display still rejects missing native collateral',async()=>{
 const f=topUpFixture(kind),scope={synchronized:true};f.options.accountSession.operationScope=()=>scope;
 const raw=f.restart(),prepared=await raw.prepare(f.action);await raw.submitPrepared(prepared.intentId);
 let inspections=0;f.options.accountSession.journal.inspectOutcome=async()=>{inspections++;return null;};f.state.responses={get_deposit_ids:Array(10).fill(0n)};
 assert.equal((await raw.readAccountStatus()).status,'collateral-pending');assert.equal(inspections,0);
 await assert.rejects(raw.prepare(f.action),{code:'ROLLING_RECOVERY_REQUIRED'});assert.equal(f.state.sends,1);
});
for(const kind of ['private-fee','bok'])test('completed '+kind+' claim display still reports insufficient native fee credit',async()=>{
 const f=topUpFixture(kind),scope={synchronized:true};f.options.accountSession.operationScope=()=>scope;
 const raw=f.restart(),prepared=await raw.prepare(f.action);await raw.submitPrepared(prepared.intentId);
 f.options.accountSession.journal.inspectOutcome=async()=>assert.fail('display does not consume historical receipt');
 f.state.feeCredit=0n;
 assert.equal((await raw.readAccountStatus()).status,'fee-needed');assert.equal(f.state.sends,1);
});
test('private-fee predecessor to Bok claim synchronizes once after bridge and refreshes spendable balance afterward',async()=>{
 const {advanceAggregateClaim}=await import('./aggregate-wallet.mjs');
 const f=topUpFixture('bok'),header=f.options.accountSession.wallet.pxe.getSyncedBlockHeader;f.options.accountSession.wallet.pxe.getSyncedBlockHeader=async()=>{const value=await header();return {...value,globalVariables:{...value.globalVariables,timestamp:100n}};};let scope={},syncs=0;f.options.accountSession.operationScope=()=>scope;
 const raw=f.restart(),prior=await raw.prepare({type:'claim-private-fee',receipt:f.receipt});await raw.submitPrepared(prior.intentId);
 const app=createSynchronizedRollingApplication({application:raw,operationScope:()=>scope,contextGuard:f.options.contextGuard,synchronize:async()=>{syncs++;}});
 const funding={inspect:async()=>({paymentSaved:true,claimAction:'claim-bok',privateFeeCap:'100',claim:null}),recover:async()=>({receipt:f.receipt}),checkpointClaim:async()=>{}};
 const result=await advanceAggregateClaim({application:app,funding,contextGuard:f.options.contextGuard,waits:{bridge:async()=>{assert.equal(syncs,0);scope={};}}});
 assert.equal(result.state,'complete');assert.equal(syncs,1);assert.equal(f.state.sends,2);assert.equal(scope.synchronized,false);
 f.state.bokCredit=123n;const before=f.state.privateReads.length,balance=await app.readBokStatus();
 assert.equal(syncs,2,'spendable balance still synchronizes after actual inclusion');assert.equal(balance.availableCredit,'123');assert(f.state.privateReads.slice(before).some(x=>x.name==='balance_of'));
});

for(const failure of ['none','witness','receipt'])test('Bok claim immutable wave joins exact receipt preparation and drains '+failure,async()=>{
 const f=topUpFixture('bok'),scope={synchronized:true},gate=Promise.withResolvers(),entered=Promise.withResolvers();let count=0,settled=false;
 f.options.accountSession.operationScope=()=>scope;const verify=f.options.sdk.prepareFundingClaim;
 f.options.sdk.prepareFundingClaim=async input=>{if(++count===2)entered.resolve();if(failure==='receipt')throw Error('receipt failed');await gate.promise;return verify(input);};
 f.options.sdk.prefetchBokClaimWitnesses=async input=>{assert.equal(input.owner,f.options.accountSession.owner);assert.equal(input.artifact,f.options.deployment.bok.artifact);assert.equal(input.wallet,f.options.accountSession.wallet);assert.equal(input.node,f.options.accountSession.node);if(++count===2)entered.resolve();if(failure==='witness')throw Error('witness failed');await gate.promise;};
 const work=f.restart().prepare(f.action,{immediate:true});work.then(()=>settled=true,()=>settled=true);const result=failure==='none'?work:assert.rejects(work,new RegExp(failure+' failed'));
 await entered.promise;await new Promise(setImmediate);assert.equal(settled,false);assert.equal(f.values.size,0);assert.equal(f.state.sends,0);gate.resolve();await result;
 if(failure!=='none')assert.equal(f.values.size,0);
});
for(const change of ['scope','owner'])test('Bok claim immutable preparation rejects held '+change,async()=>{
 const f=topUpFixture('bok'),gate=Promise.withResolvers(),entered=Promise.withResolvers();let scope={synchronized:true};f.options.accountSession.operationScope=()=>scope;
 f.options.sdk.prefetchBokClaimWitnesses=async()=>{entered.resolve();await gate.promise;};
 const work=f.restart().prepare(f.action,{immediate:true}),rejected=assert.rejects(work,{code:'ROLLING_CONTEXT_CHANGED'});await entered.promise;
 if(change==='scope')scope={synchronized:true};else f.options.accountSession.owner=AztecAddress.fromBigIntUnsafe(99n);gate.resolve();await rejected;assert.equal(f.values.size,0);assert.equal(f.state.sends,0);
});
test('private-fee standalone claim never prefetches unrelated Bok immutables',async()=>{
 const f=topUpFixture('private-fee'),scope={synchronized:true};f.options.accountSession.operationScope=()=>scope;
 f.options.sdk.prefetchBokClaimWitnesses=()=>assert.fail('unrelated Bok');await f.restart().prepare(f.action,{immediate:true});
});

for(const usdc of [false,true])for(const withBok of [false,true])test(`combined immutable preparation matches actual batch: USDC=${usdc}, Bok=${withBok}`,async()=>{
 const f=aggregateClaimFixture(usdc),scope={synchronized:true};f.options.accountSession.operationScope=()=>scope;if(!withBok)delete f.action.bokReceipt;
 f.options.deployment.bok.instance={address:AztecAddress.fromBigIntUnsafe(5n)};
 const measured=[];f.options.measure=(name,run)=>{measured.push(name);return run();};
 const app=f.restart(),prepared=await app.prepare(f.action,{immediate:true});
 assert.equal(f.state.claimWitnessPrefetches.length,1);assert.equal(f.state.bokClaimWitnessPrefetches?.length??0,withBok?1:0);
 assert.deepEqual(measured.filter(name=>name.endsWith('claim-witnesses')).sort(),withBok?['action.bok-claim-witnesses','action.claim-witnesses']:['action.claim-witnesses']);
 if(withBok){const input=f.state.bokClaimWitnessPrefetches[0];assert.equal(input.bok,f.options.deployment.bok.instance);assert.equal(input.owner,f.options.accountSession.owner);assert.equal(input.artifact,f.options.deployment.bok.artifact);assert.equal(input.wallet,f.options.accountSession.wallet);assert.equal(input.node,f.options.accountSession.node);}
 await app.submitPrepared(prepared.intentId);assert.equal(f.state.sends,1);assert.equal(f.state.claimReads.length,withBok?6:4);
 assert.deepEqual(withBok?f.state.sent.payload.interactions.map(call=>call.name):[f.state.sent.payload.name],withBok?['claim_deposit','claim']:['claim_deposit']);
 assert.equal(f.state.claimWitnessPrefetches.length,1);assert.equal(f.state.bokClaimWitnessPrefetches?.length??0,withBok?1:0);
});
for(const failure of ['board','bok','bok-sync','receipt','both'])test('combined immutable branches drain before failure: '+failure,async()=>{
 const f=aggregateClaimFixture(),scope={synchronized:true},gates=[Promise.withResolvers(),Promise.withResolvers()],allStarted=Promise.withResolvers(),seen=new Set();let settled=false;
 f.options.accountSession.operationScope=()=>scope;const verify=f.options.sdk.prepareFundingClaim;
 const errors={board:Error('Board witness failed'),bok:Error('Bok witness failed'),receipt:Error('receipt failed')};
 function entered(name){seen.add(name);if(seen.size===5)allStarted.resolve();}
 f.options.sdk.prepareFundingClaim=async input=>{entered(input.kind);if(failure==='receipt'&&input.kind==='collateral')throw errors.receipt;return verify(input);};
 f.options.sdk.prefetchBoardClaimWitnesses=async()=>{entered('board');if(['board','both'].includes(failure))throw errors.board;await gates[0].promise;};
 f.options.sdk.prefetchBokClaimWitnesses=()=>{entered('bok-witness');if(failure==='bok-sync')throw errors.bok;return (async()=>{if(['bok','both'].includes(failure))throw errors.bok;await gates[1].promise;})();};
 // Keep a receipt sibling held even when both native witness branches fail.
 const wrapped=f.options.sdk.prepareFundingClaim;f.options.sdk.prepareFundingClaim=async input=>{const result=await wrapped(input);if(input.kind==='private-fee')await gates[0].promise;return result;};
 const work=f.restart().prepare(f.action,{immediate:true}).finally(()=>settled=true),expected=failure==='receipt'?errors.receipt:['board','both'].includes(failure)?errors.board:errors.bok,rejected=assert.rejects(work,error=>error===expected);
 await allStarted.promise;await new Promise(setImmediate);assert.equal(settled,false);assert.equal(f.values.size,0);assert.equal(f.state.sends,0);
 gates[0].resolve();if(['board','receipt'].includes(failure)){await new Promise(setImmediate);assert.equal(settled,false,'Bok sibling still holds operation');}gates[1].resolve();await rejected;
 assert.equal(f.values.size,0);assert.equal(f.state.sends,0);assert.equal(f.state.estimates,0);
});
for(const changed of ['scope','owner','wallet','pxe'])test('combined immutable preparation retains final '+changed+' fence',async()=>{
 const f=aggregateClaimFixture(),entered=Promise.withResolvers(),held=Promise.withResolvers();let scope={synchronized:true};f.options.accountSession.operationScope=()=>scope;
 f.options.sdk.prefetchBokClaimWitnesses=async()=>{entered.resolve();await held.promise;};
 const work=f.restart().prepare(f.action,{immediate:true}),rejected=assert.rejects(work,{code:'ROLLING_CONTEXT_CHANGED'});await entered.promise;
 if(changed==='scope')scope={synchronized:true};if(changed==='owner')f.options.accountSession.owner=AztecAddress.fromBigIntUnsafe(99n);if(changed==='wallet')f.options.accountSession.wallet={...f.options.accountSession.wallet};if(changed==='pxe')f.options.accountSession.wallet.pxe={...f.options.accountSession.wallet.pxe};
 held.resolve();await rejected;assert.equal(f.values.size,0);assert.equal(f.state.sends,0);
});

for(const failure of ['none','plugin','balance','both','disabled','owner','canonical'])test(`Bok status read wave drains public admission and native balance: ${failure}`,async()=>{
 const f=bokFixture(),hold=Promise.withResolvers(),entered=Promise.withResolvers(),started=new Set(),pluginError=Error('plugin read failed'),balanceError=Error('balance read failed');
 const mark=name=>{started.add(name);if(started.size===2)entered.resolve();};
 f.state.beforePluginRead=async()=>{mark('plugin');if(['plugin','both'].includes(failure))throw pluginError;await hold.promise;};
 const at=f.options.sdk.Contract.at;
 f.options.sdk.Contract.at=async(...args)=>{const current=await at(...args);return {methods:new Proxy(current.methods,{get(target,name){if(name!=='balance_of')return target[name];return(...args)=>({simulate:async()=>{mark('balance');if(['balance','both'].includes(failure))throw balanceError;await hold.promise;return target[name](...args).simulate();}});}})};};
 if(failure==='disabled')f.state.bokEnabled=false;
 let changed=false;const block=f.options.accountSession.node.getBlockData;
 f.options.accountSession.node.getBlockData=async tag=>{const result=await block(tag);return changed&&failure==='canonical'?{...result,blockHash:hex(99)}:result;};
 let done=false;const pending=f.restart().readBokStatus().then(value=>({value}),error=>({error})).finally(()=>done=true);
 await entered.promise;await new Promise(setImmediate);if(failure!=='both')assert.equal(done,false);assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
 changed=true;if(failure==='owner')f.state.guard=false;hold.resolve();const result=await pending;
 if(failure==='none')assert.deepEqual(result.value,{available:true,availableCredit:'1000',pluginId:hex(7)});
 else if(failure==='disabled')assert.deepEqual(result.value,{available:false});
 else if(['plugin','both'].includes(failure))assert.equal(result.error,pluginError);
 else if(failure==='balance')assert.equal(result.error,balanceError);else assert(result.error);
 assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
});

for(const failure of ['zero-credit','native','malformed'])test('empty joint opening preserves native fee failure classification '+failure,{timeout:3000},async()=>{
 const f=fixture(),scope={synchronized:true},ids=Promise.withResolvers(),entered=Promise.withResolvers();f.options.accountSession.operationScope=()=>scope;
 f.state.responses={get_deposit_ids:Array(10).fill(0n)};f.state.beforeDepositIds=()=>ids.promise;
 const error=Error('native balance failed');f.state.feeCredit=failure==='malformed'?(1n<<128n):0n;
 f.state.beforeFeeBalance=()=>{entered.resolve();if(failure==='native')throw error;};
 f.options.sdk.preparePrivateFeePayment=()=>assert.fail('Status cannot prepare payment');
 const app=f.restart();let done=false;const work=app.readAccountStatus({opening:true}).then(value=>({value}),error=>({error})).finally(()=>done=true);
 await entered.promise;await new Promise(setImmediate);assert.equal(done,false);await assert.rejects(app.readAccountStatus(),{code:'ROLLING_BUSY'});
 ids.resolve();const result=await work;
 if(failure==='zero-credit')assert.deepEqual(result.value,{status:'collateral-pending',depositIds:[],pendingWithdrawal:null,postEligibility:'requires-action-simulation'});
 else if(failure==='native')assert.equal(result.error,error);else assert.equal(result.error.code,'ROLLING_INVALID_RESPONSE');
 assert.equal(f.state.readinessPreparations.length,1);assert.equal(f.state.readinessPreparations[0].collateralOnly,undefined);
 assert.equal(f.state.estimates,0);assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
});
test('empty joint opening class failure drains pending exit without reading balances',{timeout:3000},async()=>{
 const f=fixture(),scope={synchronized:true},exit=Promise.withResolvers(),entered=Promise.withResolvers();f.options.accountSession.operationScope=()=>scope;
 const error=Object.assign(Error('current class mismatch'),{code:'PRIVATE_FEE_CLASS_MISMATCH'});let reads=0;
 const read=f.options.privateStore.read;f.options.privateStore.read=async key=>{if(++reads===2){entered.resolve();await exit.promise;}return read(key);};
 f.options.accountSession.wallet.pxe.prepareBoardActionState=async()=>{throw error;};
 const app=f.restart();let done=false;const work=app.readAccountStatus({opening:true}).finally(()=>done=true),rejected=assert.rejects(work,e=>e===error);
 await entered.promise;await new Promise(setImmediate);assert.equal(done,false);await assert.rejects(app.readAccountStatus(),{code:'ROLLING_BUSY'});
 exit.resolve();await rejected;assert.equal(f.state.privateReads.length,0);assert.equal(f.state.estimates,0);assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
});
test('empty joint opening network failure rejects before discovery or balance reads',async()=>{
 const f=fixture(),error=Object.assign(Error('wrong trusted network'),{code:'PRIVATE_FEE_CHAIN_MISMATCH'});
 f.options.sdk.inspectTrustedNode=async()=>{throw error;};
 await assert.rejects(f.restart().readAccountStatus({opening:true}),e=>e===error);
 assert.equal(f.state.readinessPreparations?.length??0,0);assert.equal(f.state.privateReads.length,0);assert.equal(f.state.estimates,0);assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
});

for(const change of ['none','expired','args','owner','receipt'])test('owned Bok application uses internal custody and retains submission binding: '+change,async()=>{
 const f=topUpFixture('bok'),original=f.options.sdk.prepareFundingClaim;let active=true,custodyReads=0,nativeReads=0;
 const checkCurrent=async()=>{if(!active)throw Object.assign(Error('owned custody ended'),{code:'ROLLING_FUNDING_MISMATCH'});};
 f.options.funding.readBokClaimCustody=async receipt=>{custodyReads++;assert.deepEqual(receipt,f.receipt);await checkCurrent();return {...f.retained,checkCurrent};};
 f.options.funding.loadAggregate=async()=>{throw Error('duplicate Ethereum custody verification');};
 f.options.sdk.prepareFundingClaim=async()=>{throw Error('duplicate Ethereum claim verification');};
 f.options.sdk.prepareBokMessageClaim=async input=>{nativeReads++;await input.contextGuard();return original(input);};
 const app=f.restart(),prepared=await app.prepare(f.action);assert.equal(nativeReads,1);assert.equal(f.state.sends,0);
 if(change==='expired')active=false;
 if(change==='args')f.state.changedClaim=true;
 if(change==='owner')f.options.accountSession.owner=AztecAddress.fromBigIntUnsafe(99n);
 if(change==='receipt')f.receipt.amount='99';
 if(change==='none')assert.equal((await app.submitPrepared(prepared.intentId)).status,'confirmed');
 else await assert.rejects(app.submitPrepared(prepared.intentId));
 assert.equal(f.state.sends,change==='none'?1:0);assert(custodyReads>=1);
});
test('Bok generic preparation cannot select the owned message path through action fields',async()=>{
 const f=topUpFixture('bok');let reads=0;
 f.options.funding.readBokClaimCustody=async()=>null;
 f.options.sdk.prepareBokMessageClaim=async()=>{reads++;throw Error('unowned path');};
 await assert.rejects(f.restart().prepare({...f.action,verified:true}));assert.equal(reads,0);assert.equal(f.values.size,0);
 const app=f.restart(),prepared=await app.prepare(f.action);assert.equal((await app.submitPrepared(prepared.intentId)).status,'confirmed');assert.equal(reads,0);
});


for(const action of moderatorActions)test('held moderation reuses its exact review before proof but refreshes before send: '+action.type,async()=>{
 const f=moderatorFixture(),scope={synchronized:true};f.options.accountSession.operationScope=()=>scope;f.app=f.restart();
 const estimate=f.options.sdk.estimatePrivateFeeTransaction;f.options.sdk.estimatePrivateFeeTransaction=async input=>{assert.equal(f.state.storageReads.length,1,'no repeated pre-proof authority roundtrip');return estimate(input);};
 const prepared=await f.app.prepare(action,{immediate:true});assert.equal(f.state.storageReads.length,1);await f.app.submitPrepared(prepared.intentId);
 assert.equal(f.state.storageReads.length,2,'fresh final authority is mandatory');assert.equal(f.state.sends,1);
 assert.equal(f.state.privateReads.filter(r=>r.name==='main_policy').length,2,'only immediate duplicate native review is omitted');
});
for(const changed of ['authority','policy','target','fork','owner'])test('held moderation still rejects final '+changed+' change without broadcast',async()=>{
 const f=moderatorFixture(),scope={synchronized:true};f.options.accountSession.operationScope=()=>scope;f.app=f.restart();
 const prepared=await f.app.prepare(moderatorActions[0],{immediate:true});
 f.state.beforeModeratorSubmit=async()=>{
  if(changed==='authority')f.state.moderator=99n;
  if(changed==='policy')f.state.policy=2;
  if(changed==='target')f.state.responses.get_post=[f.state.responses.get_post[0],f.state.responses.get_post[1],1n,...f.state.responses.get_post.slice(3)];
  if(changed==='fork')f.state.reorg=true;
  if(changed==='owner')f.state.guard=false;
 };
 await assert.rejects(f.app.submitPrepared(prepared.intentId));assert.equal(f.state.sends,0);assert.equal(f.state.estimates,1);
});
for(const changed of ['operation','anchor','cached-node','reopen','unsynchronized','encoded'])test('moderation review does not survive '+changed,async()=>{
 const f=moderatorFixture();let scope={synchronized:true};f.options.accountSession.operationScope=()=>scope;f.app=f.restart();
 const prepared=await f.app.prepare(moderatorActions[4],{immediate:true});
 if(changed==='operation')scope={synchronized:true};
 if(changed==='anchor')f.options.accountSession.wallet.pxe.getSyncedBlockHeader=async()=>({globalVariables:{blockNumber:2,timestamp:101n},hash:async()=>hex(43)});
 if(changed==='cached-node')f.options.accountSession.wallet.pxe.node={};
 if(changed==='reopen')f.app=f.restart();
 if(changed==='unsynchronized')scope.synchronized=false;
 if(changed==='encoded'){
  const journalScope={account:hex(3),chainId:'31337',version:'1',rollup:'0x'+'11'.repeat(20),board:hex(1),portal:'0x'+'22'.repeat(20)};
  const slot=await createEncryptedJournalSlot({storage:f.options.privateStore,walletSecret:hex(8),walletSalt:'0',scopeText:JSON.stringify(['ROLLING_WORKFLOW_V1',l2JournalScopeText(journalScope)]),keyDomain:'ROLLING_WORKFLOW_V1'});
  const before=await slot.read();await slot.write(before,before.value);
 }
 await f.app.submitPrepared(prepared.intentId);assert.equal(f.state.storageReads.length,3,'full pre-proof plus final authority remain');assert.equal(f.state.sends,1);
});

test('held moderation review rejects operation replacement during its local anchor comparison',async()=>{
 const f=moderatorFixture();let scope={synchronized:true};f.options.accountSession.operationScope=()=>scope;f.app=f.restart();
 const prepared=await f.app.prepare(moderatorActions[4],{immediate:true}),entered=Promise.withResolvers(),gate=Promise.withResolvers();
 const read=f.options.accountSession.wallet.pxe.getSyncedBlockHeader;f.options.accountSession.wallet.pxe.getSyncedBlockHeader=async()=>{entered.resolve();await gate.promise;return read();};
 const pending=f.app.submitPrepared(prepared.intentId),rejected=assert.rejects(pending,{code:'ROLLING_CONTEXT_CHANGED'});await entered.promise;scope={synchronized:true};gate.resolve();await rejected;
 assert.equal(f.state.sends,0);assert.equal(f.state.estimates,0);
});

const deferredMetadataActions=[
 {type:'bio',name:'5',expectedVersion:'0',content:'Fresh metadata'},
 {type:'avatar',name:'5',expectedVersion:'0',width:100,height:100,data:'AA=='},
 {type:'name',first:'River',last:'Lane'},
 {type:'subboard',slug:'metadata-board',name:'Metadata',description:'Fresh state',rules:''},
];
for(const action of deferredMetadataActions)test(`${action.type} public fee metadata precedes discovery; native credit waits and is reused only within its operation`,async()=>{
 const f=fixture(),scope={preparationReads:[]};f.options.accountSession.operationScope=()=>scope;
 const discovery=Promise.withResolvers();scope.contractStateReady=discovery.promise;
 let metadata=0,credit=0,ready=false;
 f.options.sdk.preparePrivateFeePayment=async input=>{assert.equal(input.creditCheck,'deferred-balance');metadata++;return {creditCheck:input.creditCheck,withAvailableCredit:async()=>{assert.equal(ready,true);credit++;return {creditCheck:'read-balance',availableCredit:100n};}};};
 f.app=f.restart();await f.app.prefetchContext({deferredPayment:true});assert.equal(metadata,1);assert.equal(credit,0);
 let done=false;const preparing=f.app.prepare(action,{immediate:true}).finally(()=>done=true);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(done,false);assert.equal(credit,0);
 ready=true;discovery.resolve();const prepared=await preparing;assert.equal(credit,1);
 await f.app.submitPrepared(prepared.intentId);assert.equal(metadata,1);assert.equal(credit,1);assert.equal(f.state.sends,1);
});
for(const failure of ['readiness','payment'])test(`deferred payment prefetch ${failure} failure drains independent preparation`,async()=>{
 const f=fixture(),scope={preparationReads:[]};f.options.accountSession.operationScope=()=>scope;
 const gate=Promise.withResolvers(),entered=Promise.withResolvers();let settled=false;
 f.options.sdk.inspectTrustedNode=async()=>{if(failure==='readiness')throw Error(failure);entered.resolve();await gate.promise;};
 f.options.sdk.preparePrivateFeePayment=async()=>{if(failure==='payment')throw Error(failure);entered.resolve();await gate.promise;return {};};f.app=f.restart();
 const work=f.app.prefetchContext({deferredPayment:true}).finally(()=>settled=true),observed=assert.rejects(work,new RegExp(failure));
 await entered.promise;await new Promise(r=>setImmediate(r));assert.equal(settled,false);gate.resolve();await observed;assert.equal(f.values.size,0);assert.equal(f.state.sends,0);
});
for(const replacement of ['scope','pxe','node'])test(`deferred payment rejects ${replacement} replacement during fresh credit read`,async()=>{
 const f=fixture();let scope={preparationReads:[]};f.options.accountSession.operationScope=()=>scope;
 const entered=Promise.withResolvers(),gate=Promise.withResolvers();
 f.options.sdk.preparePrivateFeePayment=async()=>({creditCheck:'deferred-balance',withAvailableCredit:async()=>{entered.resolve();await gate.promise;return {creditCheck:'read-balance',availableCredit:100n};}});f.app=f.restart();
 await f.app.prefetchContext({deferredPayment:true});
 const work=f.app.prepare(deferredMetadataActions[0],{immediate:true}),rejected=assert.rejects(work,{code:'ROLLING_CONTEXT_CHANGED'});await entered.promise;
 if(replacement==='scope')scope={};else if(replacement==='pxe')f.options.accountSession.wallet.pxe={...f.options.accountSession.wallet.pxe};else f.options.accountSession.node={...f.options.accountSession.node};gate.resolve();await rejected;assert.equal(f.values.size,0);assert.equal(f.state.sends,0);
});
test('deferred fee metadata cannot carry a balance or be consumed by a different operation',async()=>{
 const f=fixture();let scope={preparationReads:[]};f.options.accountSession.operationScope=()=>scope;const seen=[];
 f.options.sdk.preparePrivateFeePayment=async input=>{seen.push(input.creditCheck);return input.creditCheck==='deferred-balance'?{creditCheck:'deferred-balance',withAvailableCredit:()=>assert.fail('old operation credit')}:{creditCheck:'read-balance',availableCredit:100n};};f.app=f.restart();
 await f.app.prefetchContext({deferredPayment:true});scope={preparationReads:[]};
 const prepared=await f.app.prepare(deferredMetadataActions[0],{immediate:true});await f.app.submitPrepared(prepared.intentId);
 assert.deepEqual(seen,['deferred-balance',undefined]);assert.equal(f.state.sends,1);
});

test('deferred empty-credit rejection happens before writing an intent or attempting a proof',async()=>{
 const f=fixture(),scope={preparationReads:[]};f.options.accountSession.operationScope=()=>scope;
 let credits=0;f.options.sdk.preparePrivateFeePayment=async()=>({creditCheck:'deferred-balance',withAvailableCredit:async()=>{credits++;throw Object.assign(Error('empty'),{code:'PRIVATE_FEE_BALANCE_INSUFFICIENT'});}});f.app=f.restart();
 await f.app.prefetchContext({deferredPayment:true});assert.equal(credits,0);
 await assert.rejects(f.app.prepare(deferredMetadataActions[0],{immediate:true}),{code:'PRIVATE_FEE_BALANCE_INSUFFICIENT'});
 assert.equal(credits,1);assert.equal(f.values.size,0);assert.equal(f.state.sends,0);
});

for(const installFirst of [false,true])test(`Bok recovery wave historical claim never accesses new custody; installed first=${installFirst}`,async()=>{
 const f=topUpFixture('bok');let scope={};f.options.accountSession.operationScope=()=>scope;
 const previous=f.restart(),prepared=await previous.prepare({type:'claim-bok',receipt:f.receipt});await previous.submitPrepared(prepared.intentId);
 let custodyReads=0,installed=false;f.options.funding.readBokClaimCustody=async()=>{custodyReads++;throw Error('previous receipt must not read new custody');};
 const app=f.restart(),entered=Promise.withResolvers(),gate=Promise.withResolvers(),stop=Error('prepared boundary');
 const funding={inspect:async()=>({paymentSaved:true,privateFeeCap:'100',claim:null,claimAction:'claim-bok',phase:'deposit'}),recover:async()=>{if(installFirst){installed=true;entered.resolve();await gate.promise;}else{entered.resolve();await gate.promise;installed=true;}return {receipt:f.receipt};}};
 const application={readFundingState:async()=>{await entered.promise;if(!installFirst)gate.resolve();const result=await app.readFundingState();if(installFirst)gate.resolve();return result;},prepare:async()=>{assert.equal(installed,true);assert.equal(custodyReads,0);throw stop;}};
 await assert.rejects(advanceAggregateClaim({application,funding,contextGuard:f.options.contextGuard}),error=>error===stop);assert.equal(custodyReads,0);assert.equal(f.state.sends,1);
});


test('posting readiness uses selected native timestamp independently of exit screening',async()=>{
 for(const [time,ready]of [[99n,true],[100n,true],[101n,false]]){
  const f=collateralFixture();f.state.responses={get_deposit_info:[1n,9n,100n,BigInt('0x'+'33'.repeat(20)),0n,1n,0n,0n,1n,time,56n]};
  const result=await f.app.readPostingReadiness('9');assert.equal(result.ready,ready);assert.equal(result.nextAllowedTime,String(time));assert.equal(result.anchor.timestamp,'100');
  assert.deepEqual(f.state.privateReads.map(r=>r.name),['get_deposit_info']);assert.equal(f.values.size,0);assert.equal(f.state.sends,0);
 }
});
test('posting readiness rejects a noncanonical anchor without preparing an intent',async()=>{
 const f=collateralFixture();f.options.accountSession.node.getBlockData=async()=>({header:{globalVariables:{blockNumber:1}},blockHash:hex(99)});
 await assert.rejects(f.app.readPostingReadiness('9'),{code:'ROLLING_CONTEXT_CHANGED'});assert.equal(f.values.size,0);assert.equal(f.state.sends,0);
});


test('name avatar publishes both ordered calls in one SDK batch and retains exact bytes across restart',async()=>{
 const f=fixture();f.options.sdk.BatchCall=BatchCall;
 const image={width:100,height:100,data:btoa('avatar bytes')},action={type:'name',first:'River',last:'Lane',avatar:{...image}};
 const prepared=await f.app.prepare(action),batch=f.state.calls[0];
 assert(batch instanceof BatchCall);assert.deepEqual(batch.interactions.map(call=>call.name),['register_name','set_avatar']);
 assert.equal(batch.interactions[1].args[0],prepared.nameAvailability.id);
 assert.deepEqual(batch.interactions[1].args.slice(1,5),[0,100,100,12]);
 const savedArgs=structuredClone(batch.interactions[1].args);action.avatar.data=btoa('changed');
 assert.equal(f.state.estimates,1);assert.equal(f.state.sends,0);
 const result=await f.restart().submitPrepared(prepared.intentId);
 assert.equal(result.status,'confirmed');assert.equal(f.state.sends,1);
 assert(f.state.sent.payload instanceof BatchCall);
 assert.deepEqual(f.state.sent.payload.interactions.map(call=>call.name),['register_name','set_avatar']);
 assert.deepEqual(f.state.sent.payload.interactions[1].args,savedArgs);
 assert.deepEqual(result.action.avatar,image);
});
test('name avatar validates the optional image before fee estimation or journal writes',async()=>{
 for(const image of [null,{},[],{width:100,height:100,data:''},{width:99,height:100,data:'YQ=='},{width:100,height:100,data:'@@@'},
  {width:100,height:100,data:btoa('a'.repeat(8193))},{width:100,height:100,data:'YQ==',expectedVersion:'1'},{width:100,height:100,data:'YQ==',name:'7'}]){
  const f=fixture();f.options.sdk.BatchCall=BatchCall;
  await assert.rejects(f.app.prepare({type:'name',first:'River',last:'Lane',avatar:image}),{code:'ROLLING_INVALID_ACTION'});
  assert.equal(f.state.estimates,0);assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
 }
});
test('name avatar collision rejects the complete operation before estimation or sending',async()=>{
 const f=fixture();f.options.sdk.BatchCall=BatchCall;f.state.nameRegistered=1n;
 await assert.rejects(f.app.prepare({type:'name',first:'River',last:'Lane',avatar:{width:100,height:100,data:'YQ=='}}),{code:'ROLLING_NAME_TAKEN'});
 assert.equal(f.state.estimates,0);assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
});

// Requires the normally built post_thread artifact; never patch an ABI fixture.
function threadFixture({bok=false}={}){
 const f=bok?bokFixture():fixture();
 f.state.responses={get_thread_screen_hints:Array(8).fill(undefined),get_thread_ready_time:120n};
 f.options.sdk.ordinaryPostFeeBudget=()=>assert.fail('Thread is not the single-post gas profile');
 f.options.sdk.BatchCall=class {constructor(wallet,interactions){assert.equal(wallet,f.options.accountSession.wallet);this.name='batch';this.interactions=interactions;}};
 f.app=f.restart();return f;
}
const threadAction=()=>({type:'thread',deposit:'9',contents:['Private Sentinel first','Second','Third'],name:'0',subboard:'0'});
for(const reply of [false,true])test(`atomic thread real ABI and one generic send, reply=${reply}`,async()=>{
 const f=threadFixture(),action={...threadAction(),...(reply?{parent:'88',root:'77'}:{})};
 const estimate=f.options.sdk.estimatePrivateFeeTransaction;f.options.sdk.estimatePrivateFeeTransaction=async input=>{assert.equal(input.ordinaryPost,undefined);return estimate(input);};f.app=f.restart();
 const prepared=await f.app.prepare(action,{immediate:true,postingRules:displayedRules()});assert.equal(f.state.estimates,0);
 const result=await f.app.submitPrepared(prepared.intentId);assert.equal(result.status,'confirmed');assert.equal(f.state.estimates,1);assert.equal(f.state.sends,1);
 const call=f.state.sent.payload;assert.equal(call.name,'post_thread');const [deposit,nonces,drafts,count,hints,plugins,requests]=call.args;
 assert.equal(deposit,hex(9));assert.equal(count,3);assert.equal(hints.length,8);assert(hints.every(hint=>hint===null));assert(plugins.every(value=>value===hex(0)));assert(requests.every(value=>value===hex(0)));
 const ids=await Promise.all(nonces.slice(0,count).map(nonce=>poseidon2HashWithSeparator([new Fr(1),new Fr(1),new Fr(BigInt(nonce))],0x42420102)));
 assert.equal(drafts[0].parent,hex(reply?88:0));assert.equal(drafts[0].root_reference,hex(reply?77:0));
 for(let i=1;i<count;i++){assert.equal(drafts[i].parent,ids[i-1].toString());assert.equal(drafts[i].root_reference,reply?hex(77):ids[0].toString());}
 assert.equal(nonces[3],hex(0));assert.equal(drafts[3].length,0);assert.equal((await f.app.reconcile(prepared.intentId)).status,'confirmed');assert.equal(f.state.sends,1);
 assert([...f.values.values()].every(value=>!value.includes('Private Sentinel')));
});
test('atomic thread Bok authorization binds the linked draft and shares one send',async()=>{
 const f=threadFixture({bok:true}),action={...threadAction(),budgets:['0','400','0']};
 const prepared=await f.app.prepare(action,{immediate:true});await f.app.submitPrepared(prepared.intentId);
 assert.equal(f.state.sends,1);assert.equal(f.state.estimates,1);const [authorization,thread]=f.state.sent.payload.interactions;
 assert.equal(authorization.name,'authorize_request');assert.equal(thread.name,'post_thread');assert.equal(authorization.args[0],thread.args[6][1]);assert.equal(authorization.args[2],'400');assert.equal(thread.args[5][1],hex(7));
 const draft=thread.args[2][1],nonce=thread.args[1][1],preimage=[1n,31337n,1n,1n,5n,BigInt(draft.subboard),BigInt(draft.parent),BigInt(draft.root_reference),1n,0n,0n,BigInt(nonce),BigInt(draft.length),...draft.message.map(BigInt)];
 assert.equal(authorization.args[1],String(await poseidon2HashWithSeparator(preimage.map(n=>new Fr(n)),0x52434931)));
});
test('atomic thread readiness passes the authenticated chain timestamp and required count',async()=>{
 const f=threadFixture(),result=await f.app.readPostingReadiness('9',{count:3});
 assert.equal(result.ready,false);assert.equal(result.nextAllowedTime,'120');
 const call=f.state.privateReads.find(value=>value.name==='get_thread_ready_time');assert.deepEqual(call.args.slice(1),[hex(9),3,'100']);assert.equal(f.state.sends,0);
});
test('atomic thread displayed rules and malformed actions fail without saving or sending',async()=>{
 const f=threadFixture();await assert.rejects(f.app.prepare(threadAction(),{immediate:true,postingRules:displayedRules('0',{parentVersion:'99'})}),{code:'ROLLING_POSTING_RULES_CHANGED'});assert.equal(f.values.size,0);
 for(const input of [{...threadAction(),parent:'3'},{...threadAction(),contents:['only']},{...threadAction(),budgets:['1','1','0']}])await assert.rejects(f.app.prepare(input,{immediate:true}));
 assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
});
test('atomic thread simulation failure leaves the unsent action without a partial publication',async()=>{
 const f=threadFixture({bok:true}),prepared=await f.app.prepare({...threadAction(),budgets:['400','0','0']},{immediate:true});
 f.options.sdk.estimatePrivateFeeTransaction=async()=>{throw Error('thread rejected by contract');};const app=f.restart();
 await assert.rejects(app.submitPrepared(prepared.intentId),/thread rejected by contract/);assert.equal(f.state.sends,0);
 const saved=await app.readAccountStatus();assert.deepEqual(saved.intent.action.contents,threadAction().contents);
});

test('public Like guard rejects duplicate before estimation or saved intent without private storage reads',async()=>{
 const f=fixture(),nhk=await computeAppNullifierHidingKey(deriveMasterNullifierHidingSecretKey(new Fr(8)),AztecAddress.fromBigIntUnsafe(1n));
 const tag=String(await poseidon2HashWithSeparator([1n,31337n,1n,1n,9n,nhk.toBigInt()].map(v=>new Fr(v)),0x52434c31));
 const read=f.options.readPublicLikePage;f.options.readPublicLikePage=async input=>({...await read(input),items:[{post:'9',tag:BigInt(tag).toString()}]});f.options.accountSession.node.getPublicStorageAt=()=>assert.fail('No personalized storage RPC');
 await assert.rejects(f.restart().prepare({type:'like',post:'9'},{immediate:true}),{code:'ROLLING_ALREADY_LIKED'});assert.equal(f.state.estimates,0);assert.equal(f.state.sends,0);assert.equal(f.values.size,0);
});
test('public Like read runs independently of a held private action and does no sync',async()=>{
 const f=fixture(),gate=Promise.withResolvers(),entered=Promise.withResolvers();f.state.beforeDepositIds=()=>{entered.resolve();return gate.promise;};
 const held=f.app.readAccountStatus();await entered.promise;f.options.sdk.inspectTrustedNode=()=>assert.fail('No background native readiness');
 const value=await f.app.readLikes(['9']);assert.deepEqual(value.posts,[{post:'9',liked:false}]);gate.resolve();await held;
});
test('public Like guard requires canonical publication and rejects Unlike',async()=>{
 const f=fixture(),read=f.options.readPublicLikePage;f.options.readPublicLikePage=async input=>({...await read(input),checkpoint:{number:1,hash:hex(43)}});const app=f.restart();
 await assert.rejects(app.prepare({type:'like',post:'9'},{immediate:true}),{code:'ROLLING_LIKES_UNAVAILABLE'});await assert.rejects(app.prepare({type:'unlike',post:'9'},{immediate:true}),{code:'ROLLING_ACTION_UNAVAILABLE'});assert.equal(f.state.sends,0);
});

test('public Like guard shares one operation result and accepts a canonical index block behind the tip',async()=>{
 const f=fixture(),read=f.options.readPublicLikePage,scope={};let pages=0;
 f.options.readPublicLikePage=async input=>{pages++;return read(input);};f.options.accountSession.operationScope=()=>scope;
 const old=f.options.accountSession.node.getBlockData;f.options.accountSession.node.getBlockData=async height=>height==='proposed'?{header:{globalVariables:{blockNumber:2}},blockHash:hex(43)}:old(height);
 const app=f.restart(),prepared=await app.prepare({type:'like',post:'9'},{immediate:true});await app.submitPrepared(prepared.intentId);
 assert.equal(pages,1);assert.equal(f.state.sends,1);
});
