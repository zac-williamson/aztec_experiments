import {validateBokCreditPurchaseIntent,verifyBokCreditPurchaseEffects} from './rolling/bok-credit-purchase.mjs';
import {validateAggregateFundingIntent,verifyAggregateFundingEffects} from './rolling/aggregate-recovery.mjs';
import {validateTopupSwapIntent,verifyTopupSwapEffects} from './rolling/topup-swap.mjs';
import {Interface,getCreateAddress,getCreate2Address,keccak256} from 'ethers';
const CREATE2_PROXY='0x4e59b44847b379578588920ca78fbf26c0b4956c';
import {createEncryptedJournalSlot} from './journal-record.mjs';
import {transactionError} from './transaction-outcomes.mjs';
const iface=new Interface([
  'function activate()',
  'event Activated(bytes32 indexed configHash)',
  'function approve(address spender,uint256 amount) returns (bool)',
  'function depositToAztecPublic(bytes32 to,uint256 amount,bytes32 secretHash) returns(bytes32 key,uint256 index)',
  'event Approval(address indexed owner,address indexed spender,uint256 value)',
  'event DepositToAztecPublic(bytes32 indexed to,uint256 amount,bytes32 secretHash,bytes32 key,uint256 index)',
  'function deposit(bytes32 secretHash) payable',
  'function withdraw(bytes32 depositId,uint256 epoch,uint256 numCheckpointsInEpoch,uint256 leafIndex,bytes32[] path)',
  'event Deposited(address indexed depositor,uint128 amount,bytes32 secretHash,bytes32 key,uint256 index)',
  'event Withdrawn(address indexed depositor,uint128 amount,bytes32 indexed depositId)',
  'function requestRefund(bytes32 depositId)',
  'function refund(address depositor,bytes32 depositId,uint256 epoch,uint256 checkpointCount,uint256 leafIndex,bytes32[] path)',
  'event RefundRequested(address indexed depositor,bytes32 indexed depositId,uint128 amount,bytes32 key,uint256 index)',
  'event Refunded(address indexed depositor,bytes32 indexed depositId,uint128 amount)',
]);
const bokInterface=new Interface([
  'function withdraw(address recipient,uint128 amount,bytes32 nonce,uint256 epoch,uint256 checkpoints,uint256 index,bytes32[] path)',
  'event Withdrawn(address indexed recipient,uint128 amount,bytes32 nonce)',
  'function deposit(bytes32 account,uint128 amount,bytes32 secretHash)',
  'event Deposited(bytes32 indexed account,uint128 amount,bytes32 key,uint256 index)',
]);
const field=value=>hash(value)&&BigInt(value)>0n&&BigInt(value)<21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const unknown=()=>transactionError('BB_ETH_RECOVERY_REQUIRED','Recover the saved Ethereum request before starting another payment.');
const providerCodes=new Set(['ACTION_REJECTED','INSUFFICIENT_FUNDS','CALL_EXCEPTION','NETWORK_ERROR','SERVER_ERROR','TIMEOUT','UNKNOWN_ERROR','NONCE_EXPIRED','REPLACEMENT_UNDERPRICED','UNSUPPORTED_OPERATION','BAD_DATA',4001,4100,4900,4901,-32002]);
function ethereumFailure(code,message,cause,stage){const raw=Object.getOwnPropertyDescriptor(cause??{},'providerCode')?.value??Object.getOwnPropertyDescriptor(cause??{},'code')?.value;return Object.assign(transactionError(code,message),{ethereumStage:stage,...(providerCodes.has(raw)?{providerCode:String(raw)}:{})});}
const invalid=()=>transactionError('BB_JOURNAL_INVALID','Ethereum recovery storage is invalid. Preserve it before continuing.');
const address=v=>typeof v==='string'&&/^0x[0-9a-f]{40}$/.test(v);
const hash=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v);
const lower=v=>typeof v==='string'?v.toLowerCase():'';
const positive=v=>typeof v==='string'&&/^[1-9][0-9]{0,77}$/.test(v);
const integer=v=>Number.isSafeInteger(v)&&v>=0;
function validatedScope(scope) {
  const names=['account','chainId','rollup','version','board','portal','depositor',...(scope?.token!==undefined?['token']:[]),...(scope?.deployment!==undefined?['deployment']:[])];
  if(!scope||Object.keys(scope).sort().join()!==[...names].sort().join())throw invalid();
  if(scope.deployment!==undefined&&(!hash(scope.deployment)||scope.token!==undefined))throw invalid();
  if((scope.token!==undefined&&!address(scope.token))||!hash(scope.account)||!hash(scope.board)||!address(scope.rollup)||!address(scope.portal)||!address(scope.depositor)||!positive(scope.chainId)||!positive(scope.version))throw invalid();
  return JSON.stringify(['AZTEC_BB_ETH_JOURNAL_V1',...names.map(n=>scope[n])]);
}
function intentDestination(expected,scope) {
  if(scope.deployment!==undefined) {
    if(expected?.kind==='create-portal')return null;
    if(expected?.kind==='create2-portal')return CREATE2_PROXY;
    if(expected?.kind==='activate-portal')return scope.portal;
  }
  return expected?.kind==='approve'?scope.token:scope.portal;
}
function validateIntent(record,scope) {
  if(!record||record.version!==1||record.from!==scope.depositor||record.to!==intentDestination(record.expected,scope)||record.chainId!==scope.chainId||!integer(record.nonce)||
    !integer(record.startBlock)||!hash(record.startHash)||!integer(record.nextBlock)||record.nextBlock<1||
    (record.cursorHash!==null&&!hash(record.cursorHash))||(record.txHash!==null&&!hash(record.txHash))||
    typeof record.data!=='string'||record.data.length>131072||!/^0x(?:[0-9a-f]{2})+$/.test(record.data)||
    typeof record.value!=='string'||!/^(0|[1-9][0-9]{0,77})$/.test(record.value))throw invalid();
  const expected=record.expected;
  if(scope.deployment!==undefined) {
    if(!expected||!['create-portal','create2-portal','activate-portal'].includes(expected.kind)||!address(expected.portal)||record.value!=='0')throw invalid();
    if(expected.kind==='create-portal') {
      if(keccak256(record.data)!==scope.deployment||lower(getCreateAddress({from:record.from,nonce:record.nonce}))!==expected.portal)throw invalid();
    }else if(expected.kind==='create2-portal') {
      if(record.data.slice(0,66)!==scope.board||keccak256('0x'+record.data.slice(66))!==scope.deployment||lower(getCreate2Address(CREATE2_PROXY,scope.board,scope.deployment))!==expected.portal)throw invalid();
    }else {
      if(expected.portal!==scope.portal||!hash(expected.configHash))throw invalid();
      let parsed;try{parsed=iface.parseTransaction({data:record.data});}catch{throw invalid();}
      if(parsed?.name!=='activate'||iface.encodeFunctionData(parsed.fragment,parsed.args).toLowerCase()!==record.data)throw invalid();
    }
    return record;
  }
  if(['aggregate-funding','aggregate-usdc-funding'].includes(expected?.kind)){if(scope.token!==undefined)throw invalid();try{validateAggregateFundingIntent(record);}catch{throw invalid();}return record;}
  if(expected?.kind==='bok-purchase'){try{validateBokCreditPurchaseIntent(record,scope);}catch{throw invalid();}return record;}
  if(expected?.kind==='topup-swap'){try{validateTopupSwapIntent(record,scope,{Interface});}catch{throw invalid();}return record;}
  const fee=scope.token!==undefined;
  if(!expected||!(fee?['approve','fee-deposit','bok-deposit','bok-withdraw']:['deposit','withdraw','request-refund','deposit-refund']).includes(expected.kind)||!positive(expected.amount)||BigInt(expected.amount)>=(1n<<(fee?128n:96n)))throw invalid();
  const abi=['bok-deposit','bok-withdraw'].includes(expected.kind)?bokInterface:iface;
  let parsed;try{parsed=abi.parseTransaction({data:record.data,value:record.value});}catch{throw invalid();}
  const method=expected.kind==='request-refund'?'requestRefund':expected.kind==='deposit-refund'?'refund':expected.kind==='fee-deposit'?'depositToAztecPublic':expected.kind==='bok-deposit'?'deposit':expected.kind==='bok-withdraw'?'withdraw':expected.kind;
  if(!parsed||parsed.name!==method||abi.encodeFunctionData(parsed.fragment,parsed.args).toLowerCase()!==record.data)throw invalid();
  if(expected.kind==='deposit') {
    if(!hash(expected.secretHash)||lower(parsed.args[0])!==expected.secretHash||record.value!==expected.amount)throw invalid();
  }else {
    if(record.value!=='0')throw invalid();
    if(expected.kind==='request-refund'&&(!field(expected.depositId)||lower(parsed.args[0])!==expected.depositId))throw invalid();
    if(expected.kind==='deposit-refund'&&(!field(expected.depositId)||lower(parsed.args[0])!==record.from||lower(parsed.args[1])!==expected.depositId))throw invalid();
    if(expected.kind==='withdraw'&&(!field(expected.depositId)||lower(parsed.args[0])!==expected.depositId))throw invalid();
    if(expected.kind==='approve'&&(expected.spender!==scope.portal||lower(parsed.args[0])!==scope.portal||String(parsed.args[1])!==expected.amount))throw invalid();
    if(expected.kind==='fee-deposit'&&(expected.recipient!==scope.board||!hash(expected.secretHash)||lower(parsed.args[0])!==scope.board||String(parsed.args[1])!==expected.amount||lower(parsed.args[2])!==expected.secretHash))throw invalid();
    if(expected.kind==='bok-deposit'&&(!field(expected.recipient)||!field(expected.secretHash)||lower(parsed.args[0])!==expected.recipient||String(parsed.args[1])!==expected.amount||lower(parsed.args[2])!==expected.secretHash))throw invalid();
    if(expected.kind==='bok-withdraw'&&(!address(expected.recipient)||BigInt(expected.recipient)===0n||!field(expected.exitNonce)||lower(parsed.args[0])!==expected.recipient||String(parsed.args[1])!==expected.amount||lower(parsed.args[2])!==expected.exitNonce))throw invalid();
  }
  return record;
}
function matchesRequest(tx,record) {
  try{return lower(tx.from)===record.from&&(tx.to==null?null:lower(tx.to))===record.to&&Number(tx.nonce)===record.nonce&&String(tx.chainId)===record.chainId&&lower(tx.data)===record.data&&BigInt(tx.value)===BigInt(record.value);}catch{return false;}
}
// This validator requires the actual transaction, canonical receipt and exact
// portal event. An empty active balance or consumed Outbox bit is insufficient.
export async function verifyEthereumIntentReceipt(provider,record,txHash,read=fn=>fn()) {
  const receipt=await read(()=>provider.getTransactionReceipt(txHash));
  if(!receipt)return null;
  if(lower(receipt.hash)!==txHash||!integer(receipt.blockNumber)||!hash(lower(receipt.blockHash))||![0,1].includes(receipt.status))throw unknown();
  const [tx,block]=await Promise.all([read(()=>provider.getTransaction(txHash)),read(()=>provider.getBlock(receipt.blockNumber))]);
  if(!tx||lower(tx.hash)!==txHash||lower(tx.from)!==record.from||Number(tx.nonce)!==record.nonce||String(tx.chainId)!==record.chainId||
    lower(block?.hash)!==lower(receipt.blockHash)||lower(receipt.from)!==record.from||lower(receipt.to)!==lower(tx.to))throw unknown();
  const direct=matchesRequest(tx,record);
  // Wallet execution envelopes may differ from the requested call. For user
  // payments, verify the exact effect emitted by the configured contract below.
  const effectKinds=['deposit','withdraw','approve','fee-deposit','request-refund','deposit-refund'];
  if(!direct && !effectKinds.includes(record.expected.kind))return {outcome:'replaced',txHash,receipt,event:null};
  if(receipt.status===0)return {outcome:'reverted',txHash,receipt,event:null};
  if(!Array.isArray(receipt.logs))throw unknown();
  const expected=record.expected;
  if(expected.kind==='bok-purchase'){
    let event;try{event=await verifyBokCreditPurchaseEffects(provider,record,receipt,read);}catch{throw unknown();}
    const current=await read(()=>provider.getBlock(receipt.blockNumber));if(lower(current?.hash)!==lower(receipt.blockHash))throw unknown();
    return {outcome:'success',txHash,receipt,event};
  }
  if(expected.kind==='topup-swap'){
    let event;try{event=verifyTopupSwapEffects(record,receipt,{Interface});}catch{throw unknown();}
    const current=await read(()=>provider.getBlock(receipt.blockNumber));if(lower(current?.hash)!==lower(receipt.blockHash))throw unknown();
    return {outcome:'success',txHash,receipt,event};
  }
  if(['aggregate-funding','aggregate-usdc-funding'].includes(expected.kind)) {
    const event=await verifyAggregateFundingEffects(provider,record,receipt,read);
    const current=await read(()=>provider.getBlock(receipt.blockNumber));if(lower(current?.hash)!==lower(receipt.blockHash))throw unknown();
    return {outcome:'success',txHash,receipt,event};
  }
  if(expected.kind==='bok-withdraw') {
    // Exact calldata authenticates nonce/recipient; a portal event is not a
    // substitute for the saved original request or a wallet envelope.
    const topic=bokInterface.getEvent('Withdrawn').topicHash.toLowerCase(),events=[];
    for(const log of receipt.logs){if(lower(log.address)!==record.to||lower(log.topics?.[0])!==topic)continue;
      let parsed;try{parsed=bokInterface.parseLog(log);}catch{throw unknown();}
      if(!parsed||lower(parsed.args.recipient)!==expected.recipient||String(parsed.args.amount)!==expected.amount||lower(parsed.args.nonce)!==expected.exitNonce)throw unknown();events.push(parsed.args);
    }
    if(events.length!==1)throw unknown();return {outcome:'success',txHash,receipt,event:events[0]};
  }
  if(expected.kind==='bok-deposit') {
    // This portal's event omits secretHash. Only the exact saved calldata can
    // authenticate it; event-only wallet envelopes need a separate binding.
    const topic=bokInterface.getEvent('Deposited').topicHash.toLowerCase(),events=[];
    for(const log of receipt.logs) {
      if(lower(log.address)!==record.to||lower(log.topics?.[0])!==topic)continue;
      let parsed;try{parsed=bokInterface.parseLog(log);}catch{throw unknown();}
      if(!parsed||lower(parsed.args.account)!==expected.recipient||String(parsed.args.amount)!==expected.amount||!field(lower(parsed.args.key)))throw unknown();
      events.push(parsed.args);
    }
    if(events.length!==1)throw unknown();
    return {outcome:'success',txHash,receipt,event:events[0]};
  }
  if(['create-portal','create2-portal'].includes(expected.kind)) {
    if(expected.kind==='create-portal'&&lower(receipt.contractAddress)!==expected.portal)throw unknown();
    const code=await read(()=>provider.getCode(expected.portal,receipt.blockNumber));
    if(typeof code!=='string'||code==='0x'||!/^0x(?:[0-9a-fA-F]{2})+$/.test(code))throw unknown();
    return {outcome:'success',txHash,receipt,event:null};
  }
  const eventName=({deposit:'Deposited',withdraw:'Withdrawn','request-refund':'RefundRequested','deposit-refund':'Refunded',approve:'Approval','fee-deposit':'DepositToAztecPublic','activate-portal':'Activated'})[expected.kind];
  const topic=iface.getEvent(eventName).topicHash.toLowerCase(),events=[];
  for(const log of receipt.logs) {
    if(lower(log.address)!==record.to||lower(log.topics?.[0])!==topic)continue;
    let parsed;try{parsed=iface.parseLog(log);}catch{throw unknown();}
    if(!parsed)throw unknown();
    if(expected.kind==='activate-portal') {
      if(lower(parsed.args.configHash)!==expected.configHash)throw unknown();
    }else if(expected.kind==='approve') {
      if(lower(parsed.args.owner)!==record.from||lower(parsed.args.spender)!==expected.spender||String(parsed.args.value)!==expected.amount)throw unknown();
    }else if(expected.kind==='fee-deposit') {
      if(lower(parsed.args.to)!==expected.recipient||String(parsed.args.amount)!==expected.amount||lower(parsed.args.secretHash)!==expected.secretHash)throw unknown();
    }else if(lower(parsed.args.depositor)!==record.from||String(parsed.args.amount)!==expected.amount||
      (expected.kind==='deposit'&&lower(parsed.args.secretHash)!==expected.secretHash)||
      (['withdraw','request-refund','deposit-refund'].includes(expected.kind)&&(!field(expected.depositId)||lower(parsed.args.depositId)!==expected.depositId)))throw unknown();
    events.push(parsed.args);
  }
  if(!direct && events.length===0)return {outcome:'replaced',txHash,receipt,event:null};
  if(events.length!==1)throw unknown();
  return {outcome:'success',txHash,receipt,event:events[0]};
}
export async function createEthereumJournal({storage,walletSecret,walletSalt,scope,provider,signer,acknowledgeTx,contextGuard,prepareRequest,minimumNonce=0,onSubmitted}) {
  const slot=await createEncryptedJournalSlot({storage,walletSecret,walletSalt,scopeText:validatedScope(scope),keyDomain:'AZTEC_BB_ETH_JOURNAL_KEY_V1'});
  if(!integer(minimumNonce))throw invalid();
  if(prepareRequest!==undefined&&typeof prepareRequest!=='function')throw invalid();
  let acknowledged=acknowledgeTx,lastHash=null,submittedResponse=null;
  function reader({preserveInsufficientFunds=false}={}) {
    return async fn=>{try{return await fn();}catch(error){if(error?.code==='BB_JOURNAL_INVALID'||(preserveInsufficientFunds&&error?.code==='INSUFFICIENT_FUNDS'))throw error;throw ethereumFailure('BB_ETH_READ_FAILED','Ethereum could not be reached. Your payment has not been marked as failed.',error,'read');}};
  }
  async function load() {const saved=await slot.read();if(saved.value!==null)validateIntent(saved.value,scope);return saved;}
  async function network(read) {
    if(String((await read(()=>provider.getNetwork())).chainId)!==scope.chainId)throw unknown();
    if(contextGuard)await contextGuard();
  }
  function confirmed(result,request){submittedResponse=null;acknowledged=result.txHash;lastHash=result.txHash;return {...result,request};}
  async function locate(saved,read) {
    let record=saved.value;
    if(record.txHash) {const result=await verifyEthereumIntentReceipt(provider,record,record.txHash,read);if(result)return {saved,result};}
    const head=await read(()=>provider.getBlockNumber());if(!integer(head))throw unknown();
    // A reorg at the previous cursor invalidates skipped history. Search from
    // genesis on that rare path; never silently skip an uncertain interval.
    if(record.nextBlock>1) {
      const anchor=await read(()=>provider.getBlock(record.nextBlock-1));
      const expected=record.cursorHash ?? record.startHash;
      if(lower(anchor?.hash)!==expected||head<record.nextBlock-1) {
        saved=await slot.write(saved,{...record,nextBlock:1,cursorHash:null});record=saved.value;
      }
    }
    // A nonce not consumed at this canonical block cannot have a mined transaction
    // in its history. Avoid downloading every block while an unsent request waits.
    const tip=await read(()=>provider.getBlock(head));
    if(tip?.number!==head||!hash(lower(tip.hash)))throw unknown();
    const minedNonce=await read(()=>provider.getTransactionCount(record.from,head));
    if(!integer(minedNonce))throw unknown();
    if(minedNonce<=record.nonce) {
      const current=await read(()=>provider.getBlock(head));
      if(lower(current?.hash)!==lower(tip.hash))throw unknown();
      saved=await slot.write(saved,{...record,nextBlock:head+1,cursorHash:lower(tip.hash)});
      return {saved,result:null};
    }
    let cursorHash=record.cursorHash,nextBlock=record.nextBlock,previousHash=record.nextBlock===1?null:(record.cursorHash??record.startHash);
    for(let number=nextBlock;number<=head;number++) {
      const block=await read(()=>provider.getBlock(number,true));
      if(!block||block.number!==number||!hash(lower(block.hash))||(previousHash&&lower(block.parentHash)!==previousHash))throw unknown();
      previousHash=lower(block.hash);
      let transactions;try{transactions=block.prefetchedTransactions;}catch{throw unknown();}
      if(!Array.isArray(transactions))throw unknown();
      for(const tx of transactions) {
        if(lower(tx.from)!==record.from||Number(tx.nonce)!==record.nonce)continue;
        if(!hash(lower(tx.hash)))throw unknown();
        const result=await verifyEthereumIntentReceipt(provider,record,lower(tx.hash),read);
        if(!result||result.receipt.blockNumber!==number||lower(result.receipt.blockHash)!==lower(block.hash))throw unknown();
        saved=await slot.write(saved,{...saved.value,txHash:result.txHash});
        return {saved,result};
      }
      cursorHash=lower(block.hash);nextBlock=number+1;
      if((number-record.nextBlock+1)%10===0||number===head) {
        const current=await read(()=>provider.getBlock(number));if(lower(current?.hash)!==cursorHash)throw unknown();
        saved=await slot.write(saved,{...record,nextBlock,cursorHash});
      }
    }
    return {saved,result:null};
  }
  async function assertCanStart() {
    const saved=await load();if(!saved.value)return saved;
    if(!hash(acknowledged))throw unknown();
    const read=reader();await network(read);
    const result=await verifyEthereumIntentReceipt(provider,saved.value,acknowledged,read);if(!result)throw unknown();
    return saved;
  }
  async function broadcast(saved,previous) {
    const record=saved.value;if(!signer)throw unknown();
    let response,walletCalled=false;
    const request={from:record.from,to:record.to,data:record.data,value:BigInt(record.value),nonce:record.nonce,chainId:BigInt(record.chainId)};
    try{
      await network(reader());
      if(lower(await signer.getAddress())!==record.from)throw unknown();
      if(contextGuard)await contextGuard();
      if(['deposit','request-refund','fee-deposit','bok-deposit','bok-purchase','aggregate-funding','aggregate-usdc-funding'].includes(record.expected.kind)) {
        // Match the V6 SDK deposit allowance for changing shared Inbox state.
        const estimate=await reader({preserveInsufficientFunds:true})(()=>provider.estimateGas(request));
        if(typeof estimate!=='bigint'||estimate<=0n)throw unknown();
        request.gasLimit=estimate*2n;
        if(contextGuard)await contextGuard();
      }
      if(prepareRequest){
        const fees=await prepareRequest(Object.freeze({...request}));
        if(!fees||Object.keys(fees).some(key=>!['gasLimit','gasPrice','maxFeePerGas','maxPriorityFeePerGas'].includes(key))||Object.values(fees).some(value=>typeof value!=='bigint'||value<0n)||fees.gasLimit===0n)throw invalid();
        Object.assign(request,fees);
      }
      if(contextGuard)await contextGuard();
      walletCalled=true;response=await signer.sendTransaction(request);
    }catch(error){
      // Only the first attempt can establish that this new intent was never sent.
      // A rejected retry says nothing about an earlier attempt: keep its record.
      const rejected=error?.code===4001||error?.code==='ACTION_REJECTED';
      const unfunded=error?.code==='INSUFFICIENT_FUNDS';
      if(previous && (rejected||unfunded||!walletCalled)) {
        await slot.write(saved,previous.value);
        throw ethereumFailure(rejected?'BB_ETH_REQUEST_CANCELLED':unfunded?'BB_ETH_INSUFFICIENT_FUNDS':'BB_ETH_PREFLIGHT_FAILED',
          rejected?'Payment cancelled. No transaction was sent. You can try again.':unfunded?'Not enough ETH for this payment and gas. Add funds, then try again.':'The wallet payment could not be prepared. No transaction was sent.',error,walletCalled?'wallet':'preflight');
      }
      throw ethereumFailure('BB_ETH_SUBMISSION_UNKNOWN','Your wallet has not confirmed whether the payment was sent. Check its activity before trying again.',error,'wallet');
    }
    // Wallet responses acknowledge submission; only canonical RPC data confirms intent.
    if(!hash(lower(response?.hash)))throw unknown();
    submittedResponse=response;
    const submitted=await slot.write(saved,{...record,txHash:lower(response.hash)});
    // Display only: durable submission is not Ethereum confirmation. Never
    // await or propagate observer code across transaction authority.
    try{void Promise.resolve(onSubmitted?.()).catch(()=>{});}catch{}
    return submitted;
  }
  async function finish(saved) {
    const read=reader();await network(read);
    let found=await locate(saved,read);saved=found.saved;
    if(found.result)return confirmed(found.result,saved.value);
    const record=saved.value;
    // Keep the genuine wallet response for the fresh handoff. Restored sessions
    // require the original transaction from RPC; a hash alone cannot watch nonce replacement.
    const observed=await read(()=>provider.getTransaction(record.txHash));
    const tx=observed??(typeof submittedResponse?.replaceableTransaction==='function'&&lower(submittedResponse.hash)===record.txHash?submittedResponse:null);
    if(!tx||typeof tx.replaceableTransaction!=='function'||lower(tx.hash)!==record.txHash||lower(tx.from)!==record.from||tx.nonce!==record.nonce||lower(tx.to)!==lower(record.to)||lower(tx.data)!==record.data||String(tx.value)!==record.value||String(tx.chainId)!==record.chainId)throw unknown();
    try{await tx.replaceableTransaction(record.startBlock).wait(1);}
    catch(error){if(!['TRANSACTION_REPLACED','CALL_EXCEPTION'].includes(error?.code))throw ethereumFailure('BB_ETH_CONFIRMATION_UNKNOWN','Your payment was sent. Ethereum confirmation is unavailable; the payment has not been marked as failed.',error,'confirmation');}
    // Native completion and replacement errors are wake-up hints. Canonical
    // receipt, nonce and exact intent reconciliation remain the authority.
    await network(reader());found=await locate(saved,reader());
    if(!found.result)throw unknown();return confirmed(found.result,found.saved.value);
  }
  return {
    // Authenticated detached request for an explicit recovery review. It confers
    // no send authority; callers must reconcile and bind their later confirmation.
    async inspectRequest(){return structuredClone((await load()).value);},
    async inspectSummary(){
      const saved=await load();if(!saved.value)return null;
      const record=saved.value;
      const result=record.txHash?await verifyEthereumIntentReceipt(provider,record,record.txHash,reader()):null;
      return {kind:record.expected.kind,txHash:record.txHash,outcome:result?.outcome??'unknown'};
    },
    assertCanStart,get lastTxHash(){return lastHash;},
    async send(intent,{waitForReceipt=true}={}) {
      if(typeof waitForReceipt!=='boolean')throw invalid();
      const previous=await assertCanStart(),read=reader();await network(read);
      if(!signer||lower(await signer.getAddress())!==scope.depositor)throw unknown();
      const start=await read(()=>provider.getBlock('latest'));
      const pendingNonce=await read(()=>provider.getTransactionCount(scope.depositor,'pending'));
      if(!integer(pendingNonce))throw unknown();
      const nonce=Math.max(pendingNonce,previous.value?previous.value.nonce+1:0,minimumNonce);
      const {data,value,expected}=typeof intent==='function'?await intent(nonce):intent;
      if(!start||!integer(start.number)||!hash(lower(start.hash))||!integer(nonce))throw unknown();
      const record=validateIntent({version:1,from:scope.depositor,to:intentDestination(expected,scope),chainId:scope.chainId,nonce,data:lower(data),value:String(value),expected,
        startBlock:start.number,startHash:lower(start.hash),nextBlock:start.number+1,cursorHash:null,txHash:null},scope);
      const saved=await slot.write(previous,record);
      const submitted=await broadcast(saved,previous);
      // A wallet acknowledgement is pending, not a receipt. Funding's existing
      // continuation owns mining and bridge observation after this handoff.
      const immediate=!waitForReceipt?await verifyEthereumIntentReceipt(provider,submitted.value,submitted.value.txHash,reader()):null;
      if(!waitForReceipt&&!immediate)return {outcome:'submitted',txHash:submitted.value.txHash,request:structuredClone(submitted.value)};
      const result=immediate?confirmed(immediate,submitted.value):await finish(submitted);
      if(result.outcome!=='success')throw transactionError('BB_ETH_TRANSACTION_FAILED','The Ethereum request reverted or was replaced. Reconcile it before another action.');
      return result;
    },
    async reconcilePrevious(options={}){if(!(await load()).value)return null;return this.recover(options);},
    async recover({retry=false,wait=false}={}) {
      if(typeof retry!=='boolean'||typeof wait!=='boolean')throw invalid();
      let saved=await load();if(!saved.value)throw transactionError('BB_NO_SAVED_ETHEREUM_TRANSACTION','No saved Ethereum request exists for this wallet and portal.');
      const read=reader();await network(read);
      const found=await locate(saved,read);saved=found.saved;
      if(found.result)return confirmed(found.result,saved.value);
      if(wait&&saved.value.txHash)return finish(saved);
      if(!retry||['aggregate-funding','aggregate-usdc-funding'].includes(saved.value.expected.kind))throw unknown();
      // Explicit retry retains the same sender nonce, destination, calldata and
      // value. Even if an earlier broadcast is hidden by RPC, at most one request
      // with this nonce can execute on the canonical Ethereum chain.
      return finish(await broadcast(saved));
    },
  };
}
