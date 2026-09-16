import {Interface} from 'ethers';
import {createEncryptedJournalSlot} from './journal-record.mjs';
import {transactionError} from './transaction-outcomes.mjs';
const iface=new Interface([
  'function approve(address spender,uint256 amount) returns (bool)',
  'function depositToAztecPublic(bytes32 to,uint256 amount,bytes32 secretHash) returns(bytes32 key,uint256 index)',
  'event Approval(address indexed owner,address indexed spender,uint256 value)',
  'event DepositToAztecPublic(bytes32 indexed to,uint256 amount,bytes32 secretHash,bytes32 key,uint256 index)',
  'function deposit(bytes32 secretHash) payable',
  'function withdraw(uint256 epoch,uint256 numCheckpointsInEpoch,uint256 leafIndex,bytes32[] path)',
  'event Deposited(address indexed depositor,uint64 nonce,uint128 amount,bytes32 secretHash,bytes32 key,uint256 index)',
  'event Withdrawn(address indexed depositor,uint64 nonce,uint128 amount)',
]);
const unknown=()=>transactionError('BB_ETH_RECOVERY_REQUIRED','Recover the saved Ethereum request before starting another payment.');
const invalid=()=>transactionError('BB_JOURNAL_INVALID','Ethereum recovery storage is invalid. Preserve it before continuing.');
const address=v=>typeof v==='string'&&/^0x[0-9a-f]{40}$/.test(v);
const hash=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v);
const lower=v=>typeof v==='string'?v.toLowerCase():'';
const positive=v=>typeof v==='string'&&/^[1-9][0-9]{0,77}$/.test(v);
const integer=v=>Number.isSafeInteger(v)&&v>=0;
function validatedScope(scope) {
  const names=['account','chainId','rollup','version','board','portal','depositor',...(scope?.token!==undefined?['token']:[])];
  if(!scope||Object.keys(scope).sort().join()!==[...names].sort().join())throw invalid();
  if((scope.token!==undefined&&!address(scope.token))||!hash(scope.account)||!hash(scope.board)||!address(scope.rollup)||!address(scope.portal)||!address(scope.depositor)||!positive(scope.chainId)||!positive(scope.version))throw invalid();
  return JSON.stringify(['AZTEC_BB_ETH_JOURNAL_V1',...names.map(n=>scope[n])]);
}
function validateIntent(record,scope) {
  if(!record||record.version!==1||record.from!==scope.depositor||record.to!==(record.expected?.kind==='approve'?scope.token:scope.portal)||record.chainId!==scope.chainId||!integer(record.nonce)||
    !integer(record.startBlock)||!hash(record.startHash)||!integer(record.nextBlock)||record.nextBlock<1||
    (record.cursorHash!==null&&!hash(record.cursorHash))||(record.txHash!==null&&!hash(record.txHash))||
    typeof record.data!=='string'||record.data.length>131072||!/^0x(?:[0-9a-f]{2})+$/.test(record.data)||
    typeof record.value!=='string'||!/^(0|[1-9][0-9]{0,77})$/.test(record.value))throw invalid();
  const expected=record.expected;
  const fee=scope.token!==undefined;
  if(!expected||!(fee?['approve','fee-deposit']:['deposit','withdraw']).includes(expected.kind)||!positive(expected.amount)||BigInt(expected.amount)>=(1n<<(fee?128n:96n)))throw invalid();
  if(!fee&&(!positive(expected.nonce)||BigInt(expected.nonce)>=1n<<64n))throw invalid();
  let parsed;try{parsed=iface.parseTransaction({data:record.data,value:record.value});}catch{throw invalid();}
  const method=expected.kind==='fee-deposit'?'depositToAztecPublic':expected.kind;
  if(!parsed||parsed.name!==method||iface.encodeFunctionData(parsed.fragment,parsed.args).toLowerCase()!==record.data)throw invalid();
  if(expected.kind==='deposit') {
    if(!hash(expected.secretHash)||lower(parsed.args[0])!==expected.secretHash||record.value!==expected.amount)throw invalid();
  }else {
    if(record.value!=='0')throw invalid();
    if(expected.kind==='approve'&&(expected.spender!==scope.portal||lower(parsed.args[0])!==scope.portal||String(parsed.args[1])!==expected.amount))throw invalid();
    if(expected.kind==='fee-deposit'&&(expected.recipient!==scope.board||!hash(expected.secretHash)||lower(parsed.args[0])!==scope.board||String(parsed.args[1])!==expected.amount||lower(parsed.args[2])!==expected.secretHash))throw invalid();
  }
  return record;
}
function matchesRequest(tx,record) {
  try{return lower(tx.from)===record.from&&lower(tx.to)===record.to&&Number(tx.nonce)===record.nonce&&String(tx.chainId)===record.chainId&&lower(tx.data)===record.data&&BigInt(tx.value)===BigInt(record.value);}catch{return false;}
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
  if(!matchesRequest(tx,record))return {outcome:'replaced',txHash,receipt,event:null};
  if(receipt.status===0)return {outcome:'reverted',txHash,receipt,event:null};
  if(!Array.isArray(receipt.logs))throw unknown();
  const expected=record.expected,eventName=({deposit:'Deposited',withdraw:'Withdrawn',approve:'Approval','fee-deposit':'DepositToAztecPublic'})[expected.kind];
  const topic=iface.getEvent(eventName).topicHash.toLowerCase(),events=[];
  for(const log of receipt.logs) {
    if(lower(log.address)!==record.to||lower(log.topics?.[0])!==topic)continue;
    let parsed;try{parsed=iface.parseLog(log);}catch{throw unknown();}
    if(!parsed)throw unknown();
    if(expected.kind==='approve') {
      if(lower(parsed.args.owner)!==record.from||lower(parsed.args.spender)!==expected.spender||String(parsed.args.value)!==expected.amount)throw unknown();
    }else if(expected.kind==='fee-deposit') {
      if(lower(parsed.args.to)!==expected.recipient||String(parsed.args.amount)!==expected.amount||lower(parsed.args.secretHash)!==expected.secretHash)throw unknown();
    }else if(lower(parsed.args.depositor)!==record.from||String(parsed.args.nonce)!==expected.nonce||String(parsed.args.amount)!==expected.amount||
      (expected.kind==='deposit'&&lower(parsed.args.secretHash)!==expected.secretHash))throw unknown();
    events.push(parsed.args);
  }
  if(events.length!==1)throw unknown();
  return {outcome:'success',txHash,receipt,event:events[0]};
}
export async function createEthereumJournal({storage,walletSecret,walletSalt,scope,provider,signer,acknowledgeTx,contextGuard,timeoutMs=20000}) {
  const slot=await createEncryptedJournalSlot({storage,walletSecret,walletSalt,scopeText:validatedScope(scope),keyDomain:'AZTEC_BB_ETH_JOURNAL_KEY_V1'});
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>20000)throw invalid();
  let acknowledged=acknowledgeTx,lastHash=null;
  function reader() {
    const deadline=Date.now()+timeoutMs;
    return async fn=>{if(Date.now()>=deadline)throw unknown();let timer;try{return await Promise.race([Promise.resolve().then(fn),new Promise((_,reject)=>{timer=setTimeout(()=>reject(unknown()),Math.max(0,deadline-Date.now()));})]);}catch(error){if(error?.code==='BB_JOURNAL_INVALID')throw error;throw unknown();}finally{clearTimeout(timer);}};
  }
  async function load() {const saved=await slot.read();if(saved.value!==null)validateIntent(saved.value,scope);return saved;}
  async function network(read) {
    if(String((await read(()=>provider.getNetwork())).chainId)!==scope.chainId)throw unknown();
    if(contextGuard)await contextGuard();
  }
  function confirmed(result,request){acknowledged=result.txHash;lastHash=result.txHash;return {...result,request};}
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
  async function broadcast(saved) {
    const record=saved.value;if(!signer)throw unknown();
    await network(reader());
    if(lower(await signer.getAddress())!==record.from)throw unknown();
    if(contextGuard)await contextGuard();
    let response;
    try{response=await signer.sendTransaction({from:record.from,to:record.to,data:record.data,value:BigInt(record.value),nonce:record.nonce,chainId:BigInt(record.chainId)});}catch{throw transactionError('BB_ETH_SUBMISSION_UNKNOWN','Ethereum submission is uncertain. Keep its saved request and use recovery.');}
    if(!hash(lower(response?.hash))||!matchesRequest(response,record))throw unknown();
    return slot.write(saved,{...record,txHash:lower(response.hash)});
  }
  async function finish(saved) {
    const read=reader();await network(read);
    const result=await verifyEthereumIntentReceipt(provider,saved.value,saved.value.txHash,read);
    if(result)return confirmed(result,saved.value);
    // Bounded confirmation wait; a timeout keeps the durable request intact.
    await read(()=>provider.waitForTransaction(saved.value.txHash,1,timeoutMs));
    const after=await verifyEthereumIntentReceipt(provider,saved.value,saved.value.txHash,reader());
    if(!after)throw unknown();return confirmed(after,saved.value);
  }
  return {
    assertCanStart,get lastTxHash(){return lastHash;},
    async send(intent) {
      const previous=await assertCanStart(),read=reader();await network(read);
      if(!signer||lower(await signer.getAddress())!==scope.depositor)throw unknown();
      const start=await read(()=>provider.getBlock('latest'));
      const pendingNonce=await read(()=>provider.getTransactionCount(scope.depositor,'pending'));
      if(!integer(pendingNonce))throw unknown();
      const nonce=Math.max(pendingNonce,previous.value?previous.value.nonce+1:0);
      const {data,value,expected}=typeof intent==='function'?await intent(nonce):intent;
      if(!start||!integer(start.number)||!hash(lower(start.hash))||!integer(nonce))throw unknown();
      const record=validateIntent({version:1,from:scope.depositor,to:expected?.kind==='approve'?scope.token:scope.portal,chainId:scope.chainId,nonce,data:lower(data),value:String(value),expected,
        startBlock:start.number,startHash:lower(start.hash),nextBlock:start.number+1,cursorHash:null,txHash:null},scope);
      const saved=await slot.write(previous,record);
      const result=await finish(await broadcast(saved));
      if(result.outcome!=='success')throw transactionError('BB_ETH_TRANSACTION_FAILED','The Ethereum request reverted or was replaced. Reconcile it before another action.');
      return result;
    },
    async recover({retry=false}={}) {
      let saved=await load();if(!saved.value)throw transactionError('BB_NO_SAVED_ETHEREUM_TRANSACTION','No saved Ethereum request exists for this wallet and portal.');
      const read=reader();await network(read);
      const found=await locate(saved,read);saved=found.saved;
      if(found.result)return confirmed(found.result,saved.value);
      if(!retry)throw unknown();
      // Explicit retry retains the same sender nonce, destination, calldata and
      // value. Even if an earlier broadcast is hidden by RPC, at most one request
      // with this nonce can execute on the canonical Ethereum chain.
      return finish(await broadcast(saved));
    },
  };
}
