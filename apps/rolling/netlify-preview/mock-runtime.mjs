// Mock wallet runtime for local visual review only. Mirrors the shape used by
// apps/rolling/wallet-panel.browser.test.mjs. No real custody, chain or proofs.
// Actions report the same progress stages as the real session (estimating,
// preparing, proving, submitting, included) so the transaction status can be
// reviewed end to end; posts land in the mock API as pending and then confirm.
const params=new URLSearchParams(location.search);
const state={unlocked:params.get('unlocked')==='1',fee:params.get('fee')||(params.get('unlocked')==='1'?'fee-ready':'fee-needed'),bokCredit:'4250000',feeCredit:'1200000000000000000',deposits:['9'],
 identities:[{id:'7',first:'River',last:'Lane'},{id:'8',first:'Ellis',last:'Moss'}],nextName:12,
 saved:{bookmarks:['105'],followedBoards:['0','20'],followedNames:['7'],labels:{boards:{'20':'Building things'},names:{'7':'River Lane'}}}};
const wait=ms=>new Promise(r=>setTimeout(r,ms));const rawAccount={};
let intents=0,report=null,block=10400;const hash=n=>'0x'+n.toString(16).padStart(4,'0').repeat(16);
const emit=(stage,extra={})=>{try{report?.({stage,...extra});}catch{}};
const diagnostic=(stage,step,state)=>emit(stage,{step,deploymentStep:null,state,code:null});
// Published posts are handed to the harness so they appear (pending, then confirmed) in the public feeds.
const publishing=new Set(['post','reply','quote','repost','bok']);
const prepared=new Map();const publish=async(action,txHash)=>{if(publishing.has(action?.type))await fetch('/__mock/post',{method:'POST',body:JSON.stringify({action,txHash})}).catch(()=>{});};
// Posts and gifts return as included; observeIncluded delivers the final confirmation
// once the reader refreshes. Names confirm directly and join the owned list.
const settles=new Set([...publishing,'like']);
async function transact(action,intentId,{estimated=false}={}){
 if(!estimated){emit('estimating');await wait(350);}
 emit('preparing');await wait(350);emit('proving');await wait(1400);
 const txHash=hash(++intents);emit('submitting',{intentId,txHash});await wait(900);
 await publish(action,txHash);
 if(action.type==='name'){const record={id:String(state.nextName++),first:action.first??'New',last:action.last??'Name'};state.identities.push(record);return {intentId,action,status:'confirmed',txHash,nameAvailability:{id:record.id}};}
 if(settles.has(action.type)){const inclusion={blockNumber:++block,blockHash:hash(block)};emit('included',{intentId,txHash,...inclusion});await wait(200);return {intentId,action,status:'included',txHash,inclusion};}
 return {intentId,action,status:'confirmed',txHash};
}
const savedClient={snapshot:()=>state.saved,subscribe(){return ()=>{};},status:()=>'ready',ready:Promise.resolve(),async refresh(){},async set({kind,target,enabled}){const key={1:'bookmarks',2:'followedBoards',3:'followedNames'}[kind];const list=state.saved[key];if(enabled&&!list.includes(target))list.push(target);if(!enabled)state.saved[key]=list.filter(v=>v!==target);},close(){}};
const application={
 async readAccountStatus(){await wait(300);return {status:state.fee,privateFeeCredit:state.feeCredit,depositIds:state.fee==='fee-ready'?state.deposits:[]};},
 async readBokStatus(){await wait(400);return {available:true,availableCredit:state.bokCredit};},
 async ownedIdentities(){await wait(300);return {identities:state.identities.map(r=>r.id),records:state.identities.map(r=>({...r})),nextCursor:null};},
 async readProfile({name}){await wait(200);return {name,bioVersion:'1',avatarVersion:'0'};},
 async readBalances({includeBok}){await wait(500);return {fee:{available:state.feeCredit,pendingReservation:null},...(includeBok?{bok:{available:state.bokCredit}}:{}),collateral:{deposits:[{id:'9',amount:'10000000000000000',reason:'time-locked',nextAllowedTime:String(Math.floor(Date.now()/1000)+86400*3)}],nextCursor:null}};},
 async readModeratorStatus(){return {authorized:false};},
 async readPrivateFeeCredit(){return {availableCredit:state.feeCredit};},
 async estimateDraftFee(action,{signal}={}){await wait(350);signal?.throwIfAborted?.();return {estimatedFee:action?.type==='like'?'20000000000000000000':'12000000000000000'};},
 async executeAction(action,{onPrepared}={}){const intentId=String(++intents);emit('estimating');await wait(400);onPrepared?.({intentId,action,maximumFee:'1000000000000000',status:'prepared'});return transact(action,intentId,{estimated:true});},
 async prepare(action){const intentId=String(++intents);prepared.set(intentId,action);emit('estimating');await wait(500);return {intentId,action,status:'prepared',maximumFee:'1000000000000000',...(action.type==='name'?{nameAvailability:{id:String(state.nextName)}}:{}),...(action.type==='bok'?{bok:{budget:action.budget,availableCredit:state.bokCredit,phase:'authorize'}}:{})};},
 async submitPrepared(id){const action=prepared.get(id)??{type:'post'};return transact(action,id,{estimated:true});},
 async cancelPrepared(){return {status:'cancelled'};},
 async reconcile(id){return {intentId:id,status:'confirmed'};},
 async inspectRecovery(id){return {intent:{intentId:id},attempts:[],status:'unknown',inclusionHistory:[]};}
};
const quote=asset=>asset==='USDC'
 ?{kind:'rolling-aggregate-usdc-v1',breakdown:{collateral:{maxUsdc:'11250000',amount:'5000000000000000'},fee:{maxUsdc:'2100000',amount:'2000000000000000'},bokAmount:'5000000',relayFeeUsdc:'650000',maximumUsdc:'19000000'},privateFeeCap:'1000000000000000',slippageBps:100}
 :{kind:'rolling-aggregate-eth-v1',breakdown:{collateralWei:'5000000000000000',fee:{maxEth:'950000000000000',amount:'2000000000000000'},bok:{maxEth:'2200000000000000',amount:'5000000'},gasBudgetWei:'600000000000000',maximumTotalWei:'8750000000000000'},usdEstimate:'21.40',privateFeeCap:'1000000000000000',slippageBps:100};
// Claims walk the funding steps the panel projects into its status bar.
async function claim(apply){for(const step of ['inspect','prepare','checkpoint','submit','reconcile']){diagnostic('funding-claim',step,'started');await wait(step==='prepare'?900:450);diagnostic('funding-claim',step,'complete');}apply();return {state:'complete'};}
const funding={usdcAvailable:true,async prepareStarter({asset}){await wait(700);return quote(asset);},async confirm({onSubmitted}){await wait(800);onSubmitted?.();await wait(1200);return {pending:false};},async inspect(){return {paymentSaved:false};},advanceClaim(){return claim(()=>{state.fee='fee-ready';});},pauseClaim(){},async reviewRevertedClaim(){}};
const cap=kind=>({defaultPrivateFeeCap:'1000000000000000',ethAvailable:true,async prepare(input){await wait(600);return {phase:'deposit',asset:input.asset,amount:input.amount,maximumSwapWei:'3100000000000000',exchanged:false};},async confirm({onSubmitted}={}){await wait(700);onSubmitted?.();await wait(900);return {};},async inspect(){return {paymentSaved:false,completed:true};},advanceClaim(){return claim(()=>{if(kind==='bok')state.bokCredit=String(BigInt(state.bokCredit)+5000000n);else state.feeCredit=String(BigInt(state.feeCredit)+500000000000000000n);});},pauseClaim(){},async recover(){}});
const session={application,bokConfigured:true,busy:false,funding,topup:{'private-fee':cap('private-fee'),bok:cap('bok')},postingFeeLimit:'2000000000000000',ordinaryPostingFeeLimit:'450000000000000',
 async prepareOpening({asset}){await wait(600);return {status:{status:state.fee,privateFeeCredit:state.fee==='fee-ready'?state.feeCredit:'0',depositIds:state.fee==='fee-ready'?state.deposits:[]},quote:state.fee==='fee-ready'?null:quote(asset)};},
 async preparePostingState(){await wait(300);return {availableCredit:state.feeCredit};},
 async observeIncluded({txHash}){await wait(3500);return {txHash,status:'confirmed'};},
 async close(){}};
const runtime={
 account:{configure(){},async endSession(){state.unlocked=false;return {reload:true};}},
 getAccount:()=>state.unlocked?rawAccount:null,
 async restoreAccount(){await wait(200);return state.unlocked;},
 async signInWallet(){await wait(900);state.unlocked=true;return rawAccount;},
 fundingWallets:()=>[{id:'metamask',name:'MetaMask'},{id:'phantom',name:'Phantom'},{id:'coinbase',name:'Coinbase Wallet'}],
 fundingWalletStatus:()=>({connected:true,name:'MetaMask',address:'0x1a2B3c4D5e6F7a8B9c0D1e2F3a4B5c6D7e8F9a0B'}),
 async connectFundingWallet(){await wait(400);},
 canStartTestAccount:true,startingTestAccount:()=>false,startedFreshAccount:()=>false,
 async savedItems(){return savedClient;},
 async createSession({onProgress}){
  report=onProgress;
  for(const step of ['account-lock','trusted-node','deployment','account-derive','store-open','pxe-create','initial-sync','application-bind']){diagnostic('session-initialization',step,'started');await wait(380);diagnostic('session-initialization',step,'complete');}
  return session;
 }
};
export async function loadRollingWalletRuntime(){await wait(150);return runtime;}
