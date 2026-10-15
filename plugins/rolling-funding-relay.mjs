import fs from 'node:fs/promises';
import path from 'node:path';
import {Interface,AbiCoder,keccak256,Transaction,Wallet,JsonRpcProvider,FetchRequest} from 'ethers';
import {fileState,onceAztecOperation,reconcileRollingEthereum,matchRollingEthereumSigned,operatorEthereumRequest} from './operations.mjs';
import {aggregateUsdcFundingAbi} from '../shared/rolling/aggregate-funding.mjs';
import {validateAggregateFundingIntent,verifyAggregateFundingEffects} from '../shared/rolling/aggregate-recovery.mjs';
const abi=new Interface(aggregateUsdcFundingAbi);
const quoteAbi=new Interface(['function quoteExactOutputSingle((address tokenIn,address tokenOut,uint256 amount,uint24 fee,uint160 sqrtPriceLimitX96)) returns(uint256,uint160,uint32,uint256)']);
const tokenAbi=new Interface(['function implementation() view returns(address)']);
const rejected=()=>Error('Funding relay unavailable; retain the original payment for recovery.');
const check=v=>{if(!v)throw rejected();};
const hex=(v,n=32)=>typeof v==='string'&&new RegExp('^0x[0-9a-f]{'+n*2+'}$').test(v)&&BigInt(v)>0n;
const uint=v=>typeof v==='string'&&/^[1-9][0-9]{0,76}$/.test(v)&&BigInt(v)<2n**256n;
function capture(value,keys){check(value&&Object.getPrototypeOf(value)===Object.prototype&&Reflect.ownKeys(value).length===keys.length);const out={};for(const key of keys){const d=Object.getOwnPropertyDescriptor(value,key);check(d&&'value'in d);out[key]=d.value;}return out;}
function configOf(input){
 const c=capture(input,['chainId','development','router','routerCodeHash','collateralPortal','feePortal','bokPortal','privateFpc','usdc','usdcCodeHash','usdcImplementation','usdcImplementationCodeHash','weth','quoter','quoterCodeHash','gasPoolFee','relayer','feeUsdc','maxGasWei','totalGasBudgetWei']);
 for(const key of ['router','collateralPortal','feePortal','bokPortal','usdc','usdcImplementation','weth','quoter','relayer'])check(hex(c[key],20));
 for(const key of ['routerCodeHash','usdcCodeHash','usdcImplementationCodeHash','quoterCodeHash','privateFpc'])check(hex(c[key]));
 for(const key of ['chainId','feeUsdc','maxGasWei','totalGasBudgetWei'])check(uint(c[key]));
 check(typeof c.development==='boolean'&&c.chainId===(c.development?'31337':'11155111')&&[100,500,3000,10000].includes(c.gasPoolFee)&&BigInt(c.maxGasWei)<=BigInt(c.totalGasBudgetWei));
 return Object.freeze(c);
}
/** Trusted process only. A private signer-wide lease and total conservative gas
 * reservation survive restart. Unknown broadcasts are never replayed. The same
 * funded signer must not be shared with another service or manual sender. */
export async function createRollingFundingRelay({config,directory,provider,signer,lease}){
 const c=configOf(config);check(typeof directory==='string'&&path.isAbsolute(directory)&&provider&&signer&&typeof lease?.assertHeld==='function');
 await lease.assertHeld();check((await signer.getAddress()).toLowerCase()===c.relayer);
 const ledger=await fileState(path.join(directory,'funding-budget.json'));
 const identity=keccak256(new TextEncoder().encode(JSON.stringify(c)));
 if(!ledger.read().identity)await ledger.write({identity,reservedGasWei:'0',activePlan:null});
 check(ledger.read().identity===identity&&typeof ledger.read().reservedGasWei==='string'&&/^(0|[1-9][0-9]*)$/.test(ledger.read().reservedGasWei));
 let busy=false,closed=false,active;
 const planFile=hash=>path.join(directory,hash.slice(2)+'.json');
 async function readStore(hash){try{await fs.access(planFile(hash));return await fileState(planFile(hash));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
 function intentFromData(data){
  check(typeof data==='string'&&/^0x[0-9a-f]+$/.test(data)&&data.length<=32768);
  const parsed=abi.parseTransaction({data,value:0});check(parsed?.name==='fundUsdc');
  const planHash=keccak256(AbiCoder.defaultAbiCoder().encode([abi.getFunction('fundUsdc').inputs[0]],[parsed.args[0]]));
  const intent={chainId:c.chainId,from:c.relayer,to:c.router,value:'0',data,expected:{kind:'aggregate-usdc-funding',routerCodeHash:c.routerCodeHash,collateralPortal:c.collateralPortal,feePortal:c.feePortal,bokPortal:c.bokPortal,privateFpc:c.privateFpc,planHash}};
  const plan=validateAggregateFundingIntent(intent);check(plan.relayFeeUsdc===BigInt(c.feeUsdc));return {intent,plan,planHash};
 }
 async function reconcile(record){
  const intent=record?.deployment?.intent,nonce=record?.deployment?.nonce;
  const result=await reconcileRollingEthereum({record,development:c.development,scope:'aggregate-funding',reads:{
   signed:async r=>{check(intent&&intentFromData(intent.data).planHash===r.identity);check(JSON.stringify(intentFromData(intent.data).intent)===JSON.stringify(intent));return matchRollingEthereumSigned({parse:Transaction.from,record:r,chainId:c.chainId,to:c.router,data:intent.data,from:c.relayer,nonce});},
   receipt:hash=>provider.getTransactionReceipt(hash),block:number=>provider.getBlock(number),head:tag=>provider.getBlock(tag),
   effect:async(r,anchor,receipt)=>{await verifyAggregateFundingEffects(provider,intent,receipt);return true;},
  }});
  if(result.canonical&&ledger.read().activePlan===record.identity)await ledger.write({...ledger.read(),activePlan:null});
  return {...result,planHash:record.identity};
 }
 async function preflight(intent,plan){
  check((await provider.getNetwork()).chainId===BigInt(c.chainId));
  const block=await provider.getBlock('latest');check(block&&Number.isSafeInteger(block.number)&&Number.isSafeInteger(block.timestamp)&&BigInt(block.timestamp)>plan.validAfter&&BigInt(block.timestamp)+30n<plan.deadline);
  for(const [address,hash] of [[c.router,c.routerCodeHash],[c.usdc,c.usdcCodeHash],[c.usdcImplementation,c.usdcImplementationCodeHash],[c.quoter,c.quoterCodeHash]])check(keccak256(await provider.getCode(address,block.number))===hash);
  const impl=tokenAbi.decodeFunctionResult('implementation',await provider.call({to:c.usdc,data:tokenAbi.encodeFunctionData('implementation'),blockTag:block.number}))[0];check(impl.toLowerCase()===c.usdcImplementation);
  const request={to:c.router,from:c.relayer,data:intent.data,value:0n};
  // Executes both signatures, exact conversion and all bridges without spending.
  await provider.call({...request,blockTag:block.number});
  const gasLimit=(await provider.estimateGas(request))*120n/100n,fees=await provider.getFeeData();
  check(gasLimit>0n&&typeof fees.maxFeePerGas==='bigint'&&fees.maxFeePerGas>0n&&typeof fees.maxPriorityFeePerGas==='bigint'&&fees.maxPriorityFeePerGas>=0n&&fees.maxPriorityFeePerGas<=fees.maxFeePerGas);
  const gasCost=gasLimit*fees.maxFeePerGas;check(gasCost<=BigInt(c.maxGasWei)&&await provider.getBalance(c.relayer)>=gasCost);
  // User reimbursement must cover the full ETH gas ceiling using the same fixed
  // USDC→WETH public pool, with a 5% conversion buffer. No app subsidy fallback.
  const quote=quoteAbi.decodeFunctionResult('quoteExactOutputSingle',await provider.call({to:c.quoter,data:quoteAbi.encodeFunctionData('quoteExactOutputSingle',[[c.usdc,c.weth,gasCost,c.gasPoolFee,0]]),blockTag:block.number}))[0];
  check(quote>0n&&(quote*105n+99n)/100n<=plan.relayFeeUsdc);
  const nonce=await provider.getTransactionCount(c.relayer,'pending');check(Number.isSafeInteger(nonce)&&nonce>=0&&nonce===await provider.getTransactionCount(c.relayer,'latest'));
  check((await provider.getBlock(block.number))?.hash===block.hash);
  return {to:c.router,data:intent.data,value:0n,chainId:BigInt(c.chainId),type:2,nonce,gasLimit,maxFeePerGas:fees.maxFeePerGas,maxPriorityFeePerGas:fees.maxPriorityFeePerGas};
 }
 async function owned(fn){check(!closed&&!busy);busy=true;active=(async()=>{await lease.assertHeld();return fn();})();try{return await active;}catch{throw rejected();}finally{busy=false;}}
 return Object.freeze({
  terms:()=>{check(!closed&&ledger.read().activePlan===null&&BigInt(ledger.read().reservedGasWei)+BigInt(c.maxGasWei)<=BigInt(c.totalGasBudgetWei));return {relayer:c.relayer,feeUsdc:c.feeUsdc,gasBudgetWei:c.maxGasWei};},
  submit:input=>owned(async()=>{
   const {data}=capture(input,['data']),{intent,plan,planHash}=intentFromData(data);
   const old=await readStore(planHash);if(old){const record=old.read().operations?.['relay-funding'];check(record?.identity===planHash);return reconcile(record);}
   // An unresolved predecessor blocks every new plan, including after restart.
   check(ledger.read().activePlan===null&&BigInt(ledger.read().reservedGasWei)+BigInt(c.maxGasWei)<=BigInt(c.totalGasBudgetWei));
   const transaction=await preflight(intent,plan);await lease.assertHeld();
   await ledger.write({...ledger.read(),activePlan:planHash,reservedGasWei:String(BigInt(ledger.read().reservedGasWei)+BigInt(c.maxGasWei))});
   const store=await fileState(planFile(planHash));
   const result=await onceAztecOperation({store,name:'relay-funding',identity:planHash,scope:'aggregate-funding',reconcile,execute:async({bindDeployment,submit})=>{
    await bindDeployment({intent,nonce:transaction.nonce});
    const raw=await signer.signTransaction(transaction),tx=Transaction.from(raw);
    const record={raw:raw.slice(2),hash:tx.hash};
    check(matchRollingEthereumSigned({parse:Transaction.from,record,chainId:c.chainId,to:c.router,data:intent.data,from:c.relayer,nonce:transaction.nonce}));
    check(tx.type===2&&tx.gasLimit===transaction.gasLimit&&tx.maxFeePerGas===transaction.maxFeePerGas&&tx.maxPriorityFeePerGas===transaction.maxPriorityFeePerGas);
    await lease.assertHeld();await submit(record,()=>provider.broadcastTransaction(raw));
   }});return {...result,planHash};
  }),
  status:hash=>owned(async()=>{check(hex(hash));const store=await readStore(hash);if(!store)return {status:ledger.read().activePlan===hash?'unresolved':'absent',scope:'aggregate-funding',canonical:false,planHash:hash};const record=store.read().operations?.['relay-funding'];check(record?.identity===hash);return reconcile(record);}),
  async close(){closed=true;try{await active;}catch{/* retained state owns recovery */}finally{await lease.close();}},
 });
}

// The marker lives outside the mutable operation directory. Once initialization
// begins, missing state is a recovery condition, never a fresh spending budget.
export async function prepareFundingRelayState({stateDirectory,policy}) {
 const identity=keccak256(new TextEncoder().encode(JSON.stringify(configOf(policy))));
 const marker=stateDirectory+'.initialized.json';let saved;
 async function privateFile(filename){const st=await fs.lstat(filename);check(st.isFile()&&!st.isSymbolicLink()&&(st.mode&0o077)===0&&st.uid===process.getuid()&&st.size<=16384);return JSON.parse(await fs.readFile(filename,'utf8'));}
 try{saved=await privateFile(marker);}catch(error){if(error.code!=='ENOENT')throw error;}
 if(saved){
  check(saved.schemaVersion===1&&saved.identity===identity);
  const directory=await fs.lstat(stateDirectory);check(directory.isDirectory()&&!directory.isSymbolicLink()&&(directory.mode&0o777)===0o700&&directory.uid===process.getuid()&&await fs.realpath(stateDirectory)===stateDirectory);
  const budget=await privateFile(path.join(stateDirectory,'funding-budget.json'));check(budget.identity===identity);return;
 }
 await fs.mkdir(stateDirectory,{recursive:true,mode:0o700});const directory=await fs.lstat(stateDirectory);
 check(directory.isDirectory()&&!directory.isSymbolicLink()&&(directory.mode&0o777)===0o700&&directory.uid===process.getuid()&&await fs.realpath(stateDirectory)===stateDirectory);
 check((await fs.readdir(stateDirectory)).length===0);
 const handle=await fs.open(marker,'wx',0o600);try{await handle.writeFile(JSON.stringify({schemaVersion:1,identity})+'\n');await handle.sync();}finally{await handle.close();}
 const parent=await fs.open(path.dirname(marker),'r');try{await parent.sync();}finally{await parent.close();}
}

/** Private operator composition. This file is never served as a browser asset;
 * neither signer files nor provider credentials enter generated-code workers. */
export async function openRollingFundingRelay(input){
 const {ethereumUrl,signerFile,stateDirectory,policy}=capture(input,['ethereumUrl','signerFile','stateDirectory','policy']);
 const config=configOf(policy),url=new URL(ethereumUrl);
 check(url.href===ethereumUrl&&!url.username&&!url.password&&!url.search&&!url.hash&&(url.protocol==='https:'||config.development&&url.protocol==='http:'&&['127.0.0.1','[::1]'].includes(url.hostname)));
 check(typeof signerFile==='string'&&path.isAbsolute(signerFile)&&typeof stateDirectory==='string'&&path.isAbsolute(stateDirectory));
 await prepareFundingRelayState({stateDirectory,policy:config});
 const {acquireHostedLease}=await import('./main.mjs');
 const lease=await acquireHostedLease(stateDirectory);
 let provider;
 try{
  const stat=await fs.stat(signerFile);check(stat.isFile()&&stat.size<=4096&&(stat.mode&0o077)===0);
  const actor=capture(JSON.parse(await fs.readFile(signerFile,'utf8')),['ethereumKey']);check(hex(actor.ethereumKey));
  provider=new JsonRpcProvider(operatorEthereumRequest(FetchRequest,ethereumUrl),undefined,{batchMaxCount:1,cacheTimeout:-1});
  const signer=new Wallet(actor.ethereumKey,provider),relay=await createRollingFundingRelay({config,directory:stateDirectory,provider,signer,lease});
  return {...relay,async close(){try{await relay.close();}finally{provider.destroy();}}};
 }catch{try{await lease.close();}finally{provider?.destroy();}throw rejected();}
}
