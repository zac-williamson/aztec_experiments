// Controlled canonical RPC/event fixtures; real ABI encoding and encrypted IndexedDB journal.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Interface,AbiCoder,keccak256} from 'ethers';
import {IDBFactory} from 'fake-indexeddb';
import {aggregateFundingAbi} from './aggregate-funding.mjs';
import {validateAggregateFundingIntent,verifyAggregateFundingEffects} from './aggregate-recovery.mjs';
import {createEthereumJournal,verifyEthereumIntentReceipt} from '../ethereum-journal.mjs';
import {createBrowserJournalStorage} from '../journal-indexeddb.mjs';
const h=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),a=n=>'0x'+BigInt(n).toString(16).padStart(40,'0');
const abi=new Interface(aggregateFundingAbi),board=new Interface(['event Deposited(address indexed depositor,uint128 amount,bytes32 secretHash,bytes32 key,uint256 index)']),fee=new Interface(['event DepositToAztecPublic(bytes32 indexed to,uint256 amount,bytes32 secretHash,bytes32 key,uint256 index)']),bok=new Interface(['event Deposited(bytes32 indexed account,uint128 amount,bytes32 key,uint256 index)']);
function fixture(){
 const p={beneficiary:a(1),collateral:'100',collateralSecretHash:h(8),fee:{amount:'200',maxEth:'20',poolFee:3000},feeSecretHash:h(9),bok:{amount:'300',maxEth:'30',poolFee:3000},bokCommitment:h(10),bokSecretHash:h(11),nonce:'0',deadline:'2000000000'};
 const expected={kind:'aggregate-funding',routerCodeHash:keccak256('0x6001'),collateralPortal:a(3),feePortal:a(4),bokPortal:a(5),privateFpc:h(6),planHash:keccak256(AbiCoder.defaultAbiCoder().encode([abi.getFunction('fund').inputs[0]],[p]))};
 const record={from:a(1),to:a(2),chainId:'31337',nonce:0,data:abi.encodeFunctionData('fund',[p,'0x'+'ab'.repeat(65)]),value:'150',expected};
 const event=(address,iface,name,args)=>({address,...iface.encodeEventLog(iface.getEvent(name),args)});
 const logs=[event(a(2),abi,'Funded',[a(1),expected.planHash,100,200,300,15,25,10]),event(a(3),board,'Deposited',[a(1),100,h(8),h(12),1]),event(a(4),fee,'DepositToAztecPublic',[h(6),200,h(9),h(13),2]),event(a(5),bok,'Deposited',[h(10),300,h(14),3])];
 const receipt={hash:h(20),from:a(1),to:a(2),blockNumber:12,blockHash:h(21),status:1,logs},tx={...record,hash:h(20)};
 const provider={getCode:async()=> '0x6001',getTransactionReceipt:async()=>receipt,getTransaction:async()=>tx,getBlock:async()=>({number:12,hash:h(21)})};
 return {p,record,receipt,tx,provider,event};
}
function usdcFixture(){
 const f=fixture(),p={beneficiary:a(1),relayer:a(7),collateral:{amount:'100',maxUsdc:'20',poolFee:3000},collateralSecretHash:h(8),fee:{amount:'200',maxUsdc:'30',poolFee:3000},feeSecretHash:h(9),bokAmount:'300',bokCommitment:h(10),bokSecretHash:h(11),nonce:'0',validAfter:'1',deadline:'2000000000',relayFeeUsdc:'5',authorizationSalt:h(15)};
 const expected={...f.record.expected,kind:'aggregate-usdc-funding',planHash:keccak256(AbiCoder.defaultAbiCoder().encode([abi.getFunction('fundUsdc').inputs[0]],[p]))};
 const record={...f.record,from:a(7),data:abi.encodeFunctionData('fundUsdc',[p,'0x'+'ab'.repeat(65),'0x'+'cd'.repeat(65)]),value:'0',expected};
 Object.assign(f.tx,record);f.receipt.from=a(7);f.receipt.logs[0]=f.event(a(2),abi,'UsdcFunded',[a(1),expected.planHash,a(7),100,200,300,15,25,5,10]);
 return {...f,p,record};
}
test('USDC recovery keeps actual relayer transaction identity distinct from collateral beneficiary',async()=>{
 const f=usdcFixture(),result=await verifyEthereumIntentReceipt(f.provider,f.record,h(20));
 assert.equal(result.outcome,'success');assert.equal(result.event.beneficiary,a(1));assert.equal(f.tx.from,a(7));
 assert.equal(result.event.relayFeeUsdc,'5');assert.equal(result.event.refund,'10');
 assert.deepEqual([result.event.collateral.amount,result.event.privateFee.amount,result.event.bok.amount],['100','200','300']);
});
for(const defect of ['beneficiary','relayer','fee','refund','scope','missing','duplicate','calldata','kind','value','signature','amount'])test('USDC recovery rejects '+defect,async()=>{
 const f=usdcFixture();
 if(defect==='beneficiary')f.receipt.logs[1]=f.event(a(3),board,'Deposited',[a(7),100,h(8),h(12),1]);
 if(['relayer','fee','refund'].includes(defect))f.receipt.logs[0]=f.event(a(2),abi,'UsdcFunded',[a(1),f.record.expected.planHash,defect==='relayer'?a(1):a(7),100,200,300,15,25,defect==='fee'?6:5,defect==='refund'?11:10]);
 if(defect==='scope')f.record.expected.privateFpc=h(100);
 if(defect==='missing')f.receipt.logs.pop();if(defect==='duplicate')f.receipt.logs.push(f.receipt.logs[3]);
 if(defect==='calldata'){f.tx.data='0x12345678';assert.equal((await verifyEthereumIntentReceipt(f.provider,f.record,h(20))).outcome,'replaced');return;}
 if(defect==='kind')f.record.expected.kind='aggregate-funding';
 if(defect==='value')f.record.value='1';
 if(defect==='signature')f.record.data=abi.encodeFunctionData('fundUsdc',[f.p,'0x','0x01']);
 if(defect==='amount')f.record.data=abi.encodeFunctionData('fundUsdc',[{...f.p,bokAmount:0},'0x01','0x01']);
 if(['kind','value','signature','amount'].includes(defect)){assert.throws(()=>validateAggregateFundingIntent(f.record));return;}
 await assert.rejects(verifyEthereumIntentReceipt(f.provider,f.record,h(20)));
});
test('exact aggregate transaction recovers all three effects and conserved refund',async()=>{
 const f=fixture();assert.equal(validateAggregateFundingIntent(f.record).collateral,100n);
 const result=await verifyEthereumIntentReceipt(f.provider,f.record,h(20));assert.equal(result.outcome,'success');assert.equal(result.event.refund,'10');
 assert.deepEqual([result.event.collateral.amount,result.event.privateFee.amount,result.event.bok.amount],['100','200','300']);assert.equal(result.event.bok.secretHash,h(11));
});
for(const kind of ['runtime','missing','duplicate','beneficiary','refund','fee-recipient','bok-commitment','secret','plan','reorg'])test('aggregate recovery rejects '+kind,async()=>{
 const f=fixture();
 if(kind==='runtime')f.provider.getCode=async()=> '0x6002';
 if(kind==='missing')f.receipt.logs.pop();
 if(kind==='duplicate')f.receipt.logs.push(f.receipt.logs[1]);
 if(kind==='beneficiary')f.receipt.logs[1]=f.event(a(3),board,'Deposited',[a(7),100,h(8),h(12),1]);
 if(kind==='refund')f.receipt.logs[0]=f.event(a(2),abi,'Funded',[a(1),f.record.expected.planHash,100,200,300,15,25,11]);
 if(kind==='fee-recipient')f.receipt.logs[2]=f.event(a(4),fee,'DepositToAztecPublic',[h(7),200,h(9),h(13),2]);
 if(kind==='bok-commitment')f.receipt.logs[3]=f.event(a(5),bok,'Deposited',[h(15),300,h(14),3]);
 if(kind==='secret')f.record.data=abi.encodeFunctionData('fund',[{...f.p,bokSecretHash:h(18)},'0x'+'ab'.repeat(65)]);
 if(kind==='plan')f.record.expected.planHash=h(30);
 if(kind==='reorg')f.provider.getBlock=async()=>({number:12,hash:h(22)});
 if(kind==='secret')assert.equal((await verifyEthereumIntentReceipt(f.provider,f.record,h(20))).outcome,'replaced');
 else await assert.rejects(verifyEthereumIntentReceipt(f.provider,f.record,h(20)));
});
test('receipt events cannot authorize an unrelated wallet envelope',async()=>{
 const f=fixture();f.tx.data='0x12345678';assert.equal((await verifyEthereumIntentReceipt(f.provider,f.record,h(20))).outcome,'replaced');
});
for(const defect of ['amount','value','owner','scope','unknown'])test('aggregate intent rejects '+defect+' before signing',()=>{
 const f=fixture();if(defect==='amount')f.record.data=abi.encodeFunctionData('fund',[{...f.p,fee:{...f.p.fee,amount:0}},'0x01']);
 if(defect==='value')f.record.value='151';if(defect==='owner')f.record.from=a(8);if(defect==='scope')f.record.expected.feePortal=a(3);if(defect==='unknown')f.record.expected.extra=true;
 assert.throws(()=>validateAggregateFundingIntent(f.record));
});
for(const [kind,make] of [['ETH',fixture],['USDC',usdcFixture]])test(kind+' unknown aggregate send survives encrypted reopen and ignores explicit retry',async()=>{
 const f=make(),storage=createBrowserJournalStorage(new IDBFactory());let sends=0,landed=false;
 Object.assign(f.provider,{getNetwork:async()=>({chainId:31337n}),getBlockNumber:async()=>12,getTransactionCount:async()=>0,estimateGas:async()=>100000n,getTransactionReceipt:async()=>landed?f.receipt:null});
 const opts={storage,walletSecret:h(40),walletSalt:h(41),scope:{account:h(42),chainId:'31337',rollup:a(6),version:'1',board:h(43),portal:a(2),depositor:f.record.from},provider:f.provider,
 signer:{getAddress:async()=>f.record.from,sendTransaction:async request=>{assert.equal(request.gasLimit,200000n);sends++;throw Error('lost acknowledgment');}}};
 const intent={data:f.record.data,value:f.record.value,expected:f.record.expected};
 await assert.rejects((await createEthereumJournal(opts)).send(intent),{code:'BB_ETH_SUBMISSION_UNKNOWN'});
 const recovered=await createEthereumJournal(opts);await assert.rejects(recovered.recover({retry:true}),{code:'BB_ETH_RECOVERY_REQUIRED'});assert.equal(sends,1);
 // A later mined transaction is found by its retained sender/nonce, not resent.
 landed=true;f.provider.getTransactionCount=async()=>1;
 f.provider.getBlockNumber=async()=>13;
 f.provider.getBlock=async n=>({number:n==='latest'?13:n,hash:n===13?h(23):h(21),parentHash:h(21),prefetchedTransactions:n===13?[{...f.tx}]:[]});
 f.receipt.blockNumber=13;f.receipt.blockHash=h(23);
 const result=await recovered.recover({retry:true});assert.equal(result.outcome,'success');assert.equal(sends,1);
});

function zeroBokFixture(usdc=false){
 const f=usdc?usdcFixture():fixture();Object.assign(f.p,{bokCommitment:h(0),bokSecretHash:h(0),...(usdc?{bokAmount:'0'}:{bok:{amount:'0',maxEth:'0',poolFee:0}})});
 const method=usdc?'fundUsdc':'fund';f.record.expected.planHash=keccak256(AbiCoder.defaultAbiCoder().encode([abi.getFunction(method).inputs[0]],[f.p]));
 f.record.data=abi.encodeFunctionData(method,[f.p,...(usdc?['0x12','0x34']:['0x12'])]);f.record.value=usdc?'0':'120';Object.assign(f.tx,f.record);
 f.receipt.logs.pop();f.receipt.logs[0]=usdc?f.event(a(2),abi,'UsdcFunded',[a(1),f.record.expected.planHash,a(7),100,200,0,15,25,5,10]):f.event(a(2),abi,'Funded',[a(1),f.record.expected.planHash,100,200,0,15,0,5]);return f;
}
for(const usdc of [false,true]){
 test(`${usdc?'USDC':'ETH'} zero Bok receipt recovers exactly collateral and private fee`,async()=>{
  const f=zeroBokFixture(usdc),result=await verifyEthereumIntentReceipt(f.provider,f.record,h(20));assert.equal(result.outcome,'success');
  assert.equal(result.event.collateral.amount,'100');assert.equal(result.event.privateFee.amount,'200');assert.equal(Object.hasOwn(result.event,'bok'),false);
 });
 test(`${usdc?'USDC':'ETH'} zero Bok rejects unexpected plugin deposit`,async()=>{
  const f=zeroBokFixture(usdc);f.receipt.logs.push(f.event(a(5),bok,'Deposited',[h(10),1,h(14),3]));await assert.rejects(verifyEthereumIntentReceipt(f.provider,f.record,h(20)));
 });
 for(const index of [1,2])test(`${usdc?'USDC':'ETH'} zero Bok still requires unique core receipt ${index}`,async()=>{
  const missing=zeroBokFixture(usdc);missing.receipt.logs.splice(index,1);await assert.rejects(verifyEthereumIntentReceipt(missing.provider,missing.record,h(20)));
  const duplicate=zeroBokFixture(usdc);duplicate.receipt.logs.push(duplicate.receipt.logs[index]);await assert.rejects(verifyEthereumIntentReceipt(duplicate.provider,duplicate.record,h(20)));
 });
}
test('zero Bok ETH rejects charged plugin cost despite correct core deposits',async()=>{
 const f=zeroBokFixture();f.receipt.logs[0]=f.event(a(2),abi,'Funded',[a(1),f.record.expected.planHash,100,200,0,15,1,4]);await assert.rejects(verifyEthereumIntentReceipt(f.provider,f.record,h(20)));
});

function feeOnlyFixture(usdc){
 const f=zeroBokFixture(usdc);Object.assign(f.p,{collateral:usdc?{amount:'0',maxUsdc:'0',poolFee:0}:'0',collateralSecretHash:h(0)});
 const method=usdc?'fundUsdc':'fund';f.record.expected.planHash=keccak256(AbiCoder.defaultAbiCoder().encode([abi.getFunction(method).inputs[0]],[f.p]));
 f.record.data=abi.encodeFunctionData(method,[f.p,...(usdc?['0x','0x34']:['0x'])]);f.record.value=usdc?'0':'20';Object.assign(f.tx,f.record);
 f.receipt.logs.splice(1,1);f.receipt.logs[0]=usdc?f.event(a(2),abi,'UsdcFunded',[a(1),f.record.expected.planHash,a(7),0,200,0,0,25,5,5]):f.event(a(2),abi,'Funded',[a(1),f.record.expected.planHash,0,200,0,15,0,5]);return f;
}
for(const usdc of [false,true]){
 test(`${usdc?'USDC':'ETH'} posting credit authenticates exactly the fee receipt and conserved refund`,async()=>{
  const f=feeOnlyFixture(usdc),result=await verifyEthereumIntentReceipt(f.provider,f.record,h(20));assert.equal(result.outcome,'success');assert.equal(result.event.privateFee.amount,'200');assert.equal(result.event.refund,'5');assert.equal(result.event.collateral,undefined);assert.equal(result.event.bok,undefined);
 });
 for(const bad of ['collateral-event','missing-fee','duplicate-fee','hidden-collateral'])test(`${usdc?'USDC':'ETH'} posting credit rejects ${bad}`,async()=>{
  const f=feeOnlyFixture(usdc);
  if(bad==='collateral-event')f.receipt.logs.push(f.event(a(3),board,'Deposited',[a(1),100,h(8),h(12),1]));
  if(bad==='missing-fee')f.receipt.logs.pop();if(bad==='duplicate-fee')f.receipt.logs.push(f.receipt.logs[1]);
  if(bad==='hidden-collateral'){f.p.collateralSecretHash=h(1);const method=usdc?'fundUsdc':'fund';f.record.data=abi.encodeFunctionData(method,[f.p,...(usdc?['0x','0x34']:['0x'])]);assert.throws(()=>validateAggregateFundingIntent(f.record));return;}
  await assert.rejects(verifyEthereumIntentReceipt(f.provider,f.record,h(20)));
 });
}
