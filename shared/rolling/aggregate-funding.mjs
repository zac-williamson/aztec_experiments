import {Interface, AbiCoder, keccak256, TypedDataEncoder, encodeBytes32String} from 'ethers';

const usdcTuple='(address beneficiary,address relayer,(uint256 amount,uint256 maxUsdc,uint24 poolFee) collateral,bytes32 collateralSecretHash,(uint256 amount,uint256 maxUsdc,uint24 poolFee) fee,bytes32 feeSecretHash,uint256 bokAmount,bytes32 bokCommitment,bytes32 bokSecretHash,uint256 nonce,uint256 validAfter,uint256 deadline,uint256 relayFeeUsdc,bytes32 authorizationSalt)';
export const aggregateUsdcFundingAbi=Object.freeze([
  `function fundUsdc(${usdcTuple} p,bytes collateralConsent,bytes authorization)`,
  `function usdcAuthorizationNonce(${usdcTuple} p) view returns(bytes32)`,
  'event UsdcFunded(address indexed beneficiary,bytes32 indexed planHash,address indexed relayer,uint256 collateral,uint256 feeAmount,uint256 bokAmount,uint256 collateralUsdc,uint256 feeUsdc,uint256 relayFeeUsdc,uint256 refund)',
]);
export const aggregateFundingAbi = Object.freeze([
  ...aggregateUsdcFundingAbi,
  'function fund((address beneficiary,uint256 collateral,bytes32 collateralSecretHash,(uint256 amount,uint256 maxEth,uint24 poolFee) fee,bytes32 feeSecretHash,(uint256 amount,uint256 maxEth,uint24 poolFee) bok,bytes32 bokCommitment,bytes32 bokSecretHash,uint256 nonce,uint256 deadline) p,bytes consent) payable',
  'event Funded(address indexed beneficiary,bytes32 indexed planHash,uint256 collateral,uint256 feeAmount,uint256 bokAmount,uint256 feeEth,uint256 bokEth,uint256 refund)',
  ...['collateralPortal','feePortal','bokPortal','weth','swapRouter','feeToken','bokToken'].map(n=>`function ${n}() view returns(address)`),
  'function privateFpc() view returns(bytes32)', 'function chainId() view returns(uint256)',
]);
const router = new Interface(aggregateFundingAbi);
const portal = new Interface(['function depositNonces(address) view returns(uint256)','function depositsEnabled() view returns(bool)',
  'function getDeposit(address) view returns(uint128)','function MIN_DEPOSIT() view returns(uint256)','function MAX_DEPOSIT() view returns(uint256)']);
const bok = new Interface(['function active() view returns(bool)']);
const quoter = new Interface(['function quoteExactOutputSingle((address tokenIn,address tokenOut,uint256 amount,uint24 fee,uint160 sqrtPriceLimitX96)) returns(uint256 amountIn,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)']);
const P=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const prepared=new WeakSet();
function fail(code){throw Object.assign(new Error('Aggregate funding is unavailable.'),{code:`AGGREGATE_${code}`});}
function check(x,code='INVALID'){if(!x)fail(code);}
function record(x,keys){check(x && [Object.prototype,null].includes(Object.getPrototypeOf(x)) && Reflect.ownKeys(x).length===keys.length);const r={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(x,k);check(d && 'value' in d);r[k]=d.value;}return r;}
function hex(x,n=32){check(typeof x==='string' && new RegExp(`^0x[0-9a-f]{${n*2}}$`).test(x) && BigInt(x)>0n);return x;}
function uint(x,bits=256){check(typeof x==='string' && /^(0|[1-9][0-9]{0,77})$/.test(x) && BigInt(x)<2n**BigInt(bits));return BigInt(x);}
function field(x){hex(x);check(BigInt(x)<P);return x;}
function quantity(x){check(typeof x==='string' && /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/.test(x),'PUBLIC_READ_FAILED');return BigInt(x);}
function blockSnapshot(x){check(x && Object.getPrototypeOf(x)===Object.prototype,'PUBLIC_READ_FAILED');const out={};for(const k of ['number','hash','timestamp']){const d=Object.getOwnPropertyDescriptor(x,k);check(d && 'value' in d,'PUBLIC_READ_FAILED');out[k]=d.value;}quantity(out.number);quantity(out.timestamp);hex(out.hash);return out;}
function freeze(x){if(x && typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;}
export const collateralConsentTypes=freeze({DepositFor:[{name:'beneficiary',type:'address'},{name:'executor',type:'address'},{name:'amount',type:'uint256'},{name:'secretHash',type:'bytes32'},{name:'nonce',type:'uint256'},{name:'deadline',type:'uint256'}]});
/** Trusted session supplies authenticated deployment scope and its public RPC adapter (EIP1193).
 * Quotes are obtained here through fixed QuoterV2 eth_call at one fresh canonical block.
 * No quote amount supplied by the UI is treated as evidence of liquidity. This is preparation,
 * not a send/claim/Ready verdict; the caller journals the exact tx BEFORE its single send.
 */
export async function prepareAggregateFunding(input,{provider,nowSeconds=()=>Math.floor(Date.now()/1000)}={}) {
  const x=record(input,['scope','allocation','wallet']);
  const s=record(x.scope,['chainId','router','routerCodeHash','collateralPortal','feePortal','bokPortal','weth','swapRouter','feeToken','bokToken','privateFpc','quoter','quoterCodeHash']);
  uint(s.chainId,64);check(BigInt(s.chainId)>0n);for(const k of ['router','collateralPortal','feePortal','bokPortal','weth','swapRouter','feeToken','bokToken','quoter'])hex(s[k],20);
  for(const k of ['routerCodeHash','quoterCodeHash'])hex(s[k]);field(s.privateFpc);
  const a=record(x.allocation,['asset','collateralWei','feeAmount','bokAmount','feePoolFee','bokPoolFee','slippageBps','collateralSecretHash','feeSecretHash','bokCommitment','bokSecretHash']);
  check(a.asset==='ETH','USDC_GAS_ROUTE_UNQUALIFIED');
  for(const k of ['collateralWei','feeAmount','bokAmount'])check(uint(a[k],k==='collateralWei'?96:128)>0n);
  for(const k of ['feePoolFee','bokPoolFee'])check([100,500,3000,10000].includes(a[k]));
  check(Number.isSafeInteger(a.slippageBps) && a.slippageBps>=0 && a.slippageBps<=500);
  for(const k of ['collateralSecretHash','feeSecretHash','bokCommitment','bokSecretHash'])field(a[k]);
  const w=record(x.wallet,['address','chainId','canSendTransaction','canSignTypedData','gasBudgetWei']);hex(w.address,20);uint(w.chainId,64);
  check(w.chainId===s.chainId && w.canSendTransaction===true && w.canSignTypedData===true,'WALLET_CAPABILITY');check(uint(w.gasBudgetWei)>0n,'USER_GAS_REQUIRED');
  check(provider && typeof provider.request==='function');
  const request=async(method,params)=>{try{return await provider.request({method,params});}catch{fail('PUBLIC_READ_FAILED');}};
  check(quantity(await request('eth_chainId',[]))===BigInt(s.chainId),'CHAIN');
  const block=blockSnapshot(await request('eth_getBlockByNumber',['latest',false]));
  const now=nowSeconds();check(Number.isSafeInteger(now) && now>=0 && BigInt(block.timestamp)<=BigInt(now) && BigInt(now)-BigInt(block.timestamp)<=60n,'STALE_QUOTE');
  const tag=block.number;
  for(const [address,expected] of [[s.router,s.routerCodeHash],[s.quoter,s.quoterCodeHash]]){
    const code=await request('eth_getCode',[address,tag]);check(typeof code==='string' && /^0x(?:[0-9a-f]{2})+$/.test(code) && keccak256(code)===expected,'RUNTIME');
  }
  const call=async(address,abi,name,args=[])=>{const data=await request('eth_call',[{to:address,data:abi.encodeFunctionData(name,args)},tag]);try{return abi.decodeFunctionResult(name,data);}catch{fail('PUBLIC_READ_FAILED');}};
  for(const key of ['collateralPortal','feePortal','bokPortal','weth','swapRouter','feeToken','bokToken','privateFpc','chainId'])check(String((await call(s.router,router,key))[0]).toLowerCase()===s[key],'SCOPE');
  check((await call(s.collateralPortal,portal,'depositsEnabled'))[0]===true && (await call(s.bokPortal,bok,'active'))[0]===true,'PORTAL_NOT_READY');
  check((await call(s.collateralPortal,portal,'getDeposit',[w.address]))[0]===0n,'EXISTING_DEPOSIT');
  const minimum=(await call(s.collateralPortal,portal,'MIN_DEPOSIT'))[0], maximum=(await call(s.collateralPortal,portal,'MAX_DEPOSIT'))[0];
  check(BigInt(a.collateralWei)>=minimum && BigInt(a.collateralWei)<=maximum,'COLLATERAL_BOUNDS');
  const nonce=(await call(s.collateralPortal,portal,'depositNonces',[w.address]))[0].toString();
  const quote=async(token,amount,poolFee)=>{
    const q=(await call(s.quoter,quoter,'quoteExactOutputSingle',[[s.weth,token,amount,poolFee,0]]))[0];
    check(q>0n,'LIQUIDITY_UNQUALIFIED');return {amount,maxEth:((q*BigInt(10000+a.slippageBps)+9999n)/10000n).toString(),poolFee,quotedEth:q.toString()};
  };
  const fee=await quote(s.feeToken,a.feeAmount,a.feePoolFee), credit=await quote(s.bokToken,a.bokAmount,a.bokPoolFee);
  const current=blockSnapshot(await request('eth_getBlockByNumber',[tag,false]));check(current.hash===block.hash && current.timestamp===block.timestamp,'QUOTE_REORG');
  const deadline=(BigInt(block.timestamp)+120n).toString();
  const plan={beneficiary:w.address,collateral:a.collateralWei,collateralSecretHash:a.collateralSecretHash,
    fee:{amount:fee.amount,maxEth:fee.maxEth,poolFee:fee.poolFee},feeSecretHash:a.feeSecretHash,
    bok:{amount:credit.amount,maxEth:credit.maxEth,poolFee:credit.poolFee},bokCommitment:a.bokCommitment,bokSecretHash:a.bokSecretHash,nonce,deadline};
  const value=(BigInt(plan.collateral)+BigInt(fee.maxEth)+BigInt(credit.maxEth)).toString();
  const balance=await request('eth_getBalance',[w.address,'latest']);check(quantity(balance)>=BigInt(value)+BigInt(w.gasBudgetWei),'INSUFFICIENT_USER_FUNDS');
  const finished=nowSeconds();check(Number.isSafeInteger(finished) && finished>=now && finished-now<=30 && BigInt(finished)<=BigInt(deadline),'STALE_QUOTE');
  const consent={domain:{name:'RollingCollateral',version:'1',chainId:s.chainId,verifyingContract:s.collateralPortal},types:collateralConsentTypes,
    value:{beneficiary:w.address,executor:s.router,amount:plan.collateral,secretHash:plan.collateralSecretHash,nonce,deadline}};
  const result=freeze({kind:'rolling-aggregate-eth-v1',scope:s,plan,value,quoteAnchor:{number:tag,hash:block.hash,timestamp:block.timestamp},
    breakdown:{collateralWei:plan.collateral,fee:fee,bok:credit,gasBudgetWei:w.gasBudgetWei,maximumTotalWei:(BigInt(value)+BigInt(w.gasBudgetWei)).toString()},consent,
    consentDigest:TypedDataEncoder.hash(consent.domain,consent.types,consent.value),planHash:keccak256(AbiCoder.defaultAbiCoder().encode([router.getFunction('fund').inputs[0]],[plan])),
    ready:false,requiredClaims:['collateral','private-fee','bok']});prepared.add(result);return result;
}
/** Encode only a locally prepared immutable plan. Revalidate deadline/account/scope before
 * wallet invocation. Ambiguous, dropped or reorged sends are read-only reconciliation, never replay.
 */
export function aggregateFundingTransaction(preparation,consent,{nowSeconds=Math.floor(Date.now()/1000)}={}) {
  check(prepared.has(preparation),'UNVERIFIED_QUOTE');check(Number.isSafeInteger(nowSeconds) && BigInt(nowSeconds)<=BigInt(preparation.plan.deadline),'STALE_QUOTE');
  check(typeof consent==='string' && /^0x(?:[0-9a-fA-F]{2}){1,4096}$/.test(consent),'CONSENT');
  return freeze({from:preparation.plan.beneficiary,to:preparation.scope.router,chainId:preparation.scope.chainId,
    value:preparation.value,data:router.encodeFunctionData('fund',[preparation.plan,consent]),planHash:preparation.planHash,recovery:'reconcile-only'});
}

const usdcAbi=new Interface(['function implementation() view returns(address)','function DOMAIN_SEPARATOR() view returns(bytes32)','function balanceOf(address) view returns(uint256)','function authorizationState(address,bytes32) view returns(bool)']);
const preparedUsdc=new WeakSet();
export const usdcAuthorizationTypes=freeze({ReceiveWithAuthorization:[{name:'from',type:'address'},{name:'to',type:'address'},{name:'value',type:'uint256'},{name:'validAfter',type:'uint256'},{name:'validBefore',type:'uint256'},{name:'nonce',type:'bytes32'}]});
/** USDC-only preparation. Two user signatures, one relayer transaction; prompt counts
 * remain wallet-specific. Relayer ETH is at risk on a revert and cannot be reimbursed by
 * an atomic reverted transaction. There is no app-funded gas subsidy or external send.
 * Fresh fixed scope must authenticate Circle proxy AND implementation runtime/domain.
 */
export async function prepareAggregateUsdcFunding(input,{provider,nowSeconds=()=>Math.floor(Date.now()/1000)}={}) {
  const x=record(input,['scope','allocation','wallet','relay']);
  const s=record(x.scope,['chainId','router','routerCodeHash','collateralPortal','feePortal','bokPortal','weth','swapRouter','feeToken','bokToken','privateFpc','quoter','quoterCodeHash','usdcCodeHash','usdcImplementation','usdcImplementationCodeHash','usdcDomain']);
  check(uint(s.chainId,64)>0n);for(const key of ['router','collateralPortal','feePortal','bokPortal','weth','swapRouter','feeToken','bokToken','quoter','usdcImplementation'])hex(s[key],20);
  for(const key of ['routerCodeHash','quoterCodeHash','usdcCodeHash','usdcImplementationCodeHash'])hex(s[key]);field(s.privateFpc);
  s.usdcDomain=record(s.usdcDomain,['name','version']);for(const key of ['name','version'])check(typeof s.usdcDomain[key]==='string' && /^[A-Za-z0-9 .-]{1,64}$/.test(s.usdcDomain[key]));
  const a=record(x.allocation,['asset','collateralWei','feeAmount','bokAmount','collateralPoolFee','feePoolFee','slippageBps','collateralSecretHash','feeSecretHash','bokCommitment','bokSecretHash','authorizationSalt']);check(a.asset==='USDC');
  for(const key of ['collateralWei','feeAmount','bokAmount'])check(uint(a[key],key==='collateralWei'?96:128)>0n);
  for(const key of ['collateralPoolFee','feePoolFee'])check([100,500,3000,10000].includes(a[key]));check(Number.isSafeInteger(a.slippageBps)&&a.slippageBps>=0&&a.slippageBps<=500);
  for(const key of ['collateralSecretHash','feeSecretHash','bokCommitment','bokSecretHash'])field(a[key]);hex(a.authorizationSalt);
  const w=record(x.wallet,['address','chainId','canSignTypedData']);hex(w.address,20);check(w.chainId===s.chainId&&w.canSignTypedData===true,'WALLET_CAPABILITY');
  const relay=record(x.relay,['address','feeUsdc','gasBudgetWei']);hex(relay.address,20);check(relay.address!==w.address&&relay.address!==s.router,'RELAY_SCOPE');check(uint(relay.feeUsdc,128)>0n&&uint(relay.gasBudgetWei)>0n,'RELAY_BUDGET');
  check(provider&&typeof provider.request==='function');
  const request=async(method,params)=>{try{return await provider.request({method,params});}catch{fail('PUBLIC_READ_FAILED');}};
  check(quantity(await request('eth_chainId',[]))===BigInt(s.chainId),'CHAIN');
  const block=blockSnapshot(await request('eth_getBlockByNumber',['latest',false])),tag=block.number,now=nowSeconds();
  check(Number.isSafeInteger(now)&&now>=0&&BigInt(block.timestamp)<=BigInt(now)&&BigInt(now)-BigInt(block.timestamp)<=60n,'STALE_QUOTE');
  for(const [address,expected] of [[s.router,s.routerCodeHash],[s.quoter,s.quoterCodeHash],[s.bokToken,s.usdcCodeHash],[s.usdcImplementation,s.usdcImplementationCodeHash]]){
    const code=await request('eth_getCode',[address,tag]);check(typeof code==='string'&&/^0x(?:[0-9a-f]{2})+$/.test(code)&&keccak256(code)===expected,'RUNTIME');
  }
  const call=async(address,abi,name,args=[])=>{const value=await request('eth_call',[{to:address,data:abi.encodeFunctionData(name,args)},tag]);try{return abi.decodeFunctionResult(name,value);}catch{fail('PUBLIC_READ_FAILED');}};
  for(const key of ['collateralPortal','feePortal','bokPortal','weth','swapRouter','feeToken','bokToken','privateFpc','chainId'])check(String((await call(s.router,router,key))[0]).toLowerCase()===s[key],'SCOPE');
  check(String((await call(s.bokToken,usdcAbi,'implementation'))[0]).toLowerCase()===s.usdcImplementation,'USDC_IMPLEMENTATION');
  const domain={...s.usdcDomain,chainId:s.chainId,verifyingContract:s.bokToken};check((await call(s.bokToken,usdcAbi,'DOMAIN_SEPARATOR'))[0]===TypedDataEncoder.hashDomain(domain),'USDC_DOMAIN');
  check((await call(s.collateralPortal,portal,'depositsEnabled'))[0]===true&&(await call(s.bokPortal,bok,'active'))[0]===true,'PORTAL_NOT_READY');
  check((await call(s.collateralPortal,portal,'getDeposit',[w.address]))[0]===0n,'EXISTING_DEPOSIT');
  check(BigInt(a.collateralWei)>=(await call(s.collateralPortal,portal,'MIN_DEPOSIT'))[0]&&BigInt(a.collateralWei)<=(await call(s.collateralPortal,portal,'MAX_DEPOSIT'))[0],'COLLATERAL_BOUNDS');
  const nonce=String((await call(s.collateralPortal,portal,'depositNonces',[w.address]))[0]);
  const quote=async(token,amount,poolFee)=>{const quoted=(await call(s.quoter,quoter,'quoteExactOutputSingle',[[s.bokToken,token,amount,poolFee,0]]))[0];check(quoted>0n,'LIQUIDITY_UNQUALIFIED');return {amount,maxUsdc:((quoted*BigInt(10000+a.slippageBps)+9999n)/10000n).toString(),poolFee,quotedUsdc:quoted.toString()};};
  const collateral=await quote(s.weth,a.collateralWei,a.collateralPoolFee),fee=await quote(s.feeToken,a.feeAmount,a.feePoolFee);
  const deadline=(BigInt(block.timestamp)+120n).toString(),validAfter='0';
  const plan={beneficiary:w.address,relayer:relay.address,collateral:{amount:a.collateralWei,maxUsdc:collateral.maxUsdc,poolFee:collateral.poolFee},collateralSecretHash:a.collateralSecretHash,
    fee:{amount:a.feeAmount,maxUsdc:fee.maxUsdc,poolFee:fee.poolFee},feeSecretHash:a.feeSecretHash,bokAmount:a.bokAmount,bokCommitment:a.bokCommitment,bokSecretHash:a.bokSecretHash,
    nonce,validAfter,deadline,relayFeeUsdc:relay.feeUsdc,authorizationSalt:a.authorizationSalt};
  const planHash=keccak256(AbiCoder.defaultAbiCoder().encode([usdcTuple],[plan]));
  const authorizationNonce=keccak256(AbiCoder.defaultAbiCoder().encode(['bytes32','uint256','address','bytes32'],[encodeBytes32String('ROLLING_USDC_FUNDING_V1'),s.chainId,s.router,planHash]));
  check((await call(s.router,router,'usdcAuthorizationNonce',[plan]))[0]===authorizationNonce,'SCOPE');
  check((await call(s.bokToken,usdcAbi,'authorizationState',[w.address,authorizationNonce]))[0]===false,'AUTHORIZATION_SPENT');
  const maximumUsdc=(BigInt(collateral.maxUsdc)+BigInt(fee.maxUsdc)+BigInt(a.bokAmount)+BigInt(relay.feeUsdc)).toString();
  check((await call(s.bokToken,usdcAbi,'balanceOf',[w.address]))[0]>=BigInt(maximumUsdc),'INSUFFICIENT_USER_FUNDS');
  check(quantity(await request('eth_getBalance',[relay.address,'latest']))>=BigInt(relay.gasBudgetWei),'RELAY_GAS_REQUIRED');
  const current=blockSnapshot(await request('eth_getBlockByNumber',[tag,false]));check(current.hash===block.hash&&current.timestamp===block.timestamp,'QUOTE_REORG');
  const finished=nowSeconds();check(Number.isSafeInteger(finished)&&finished>=now&&finished-now<=30&&BigInt(finished)<BigInt(deadline),'STALE_QUOTE');
  const consent={domain:{name:'RollingCollateral',version:'1',chainId:s.chainId,verifyingContract:s.collateralPortal},types:collateralConsentTypes,value:{beneficiary:w.address,executor:s.router,amount:a.collateralWei,secretHash:a.collateralSecretHash,nonce,deadline}};
  const authorization={domain,types:usdcAuthorizationTypes,value:{from:w.address,to:s.router,value:maximumUsdc,validAfter,validBefore:deadline,nonce:authorizationNonce}};
  const result=freeze({kind:'rolling-aggregate-usdc-v1',scope:s,plan,planHash,value:'0',maximumUsdc,authorizationNonce,quoteAnchor:{number:tag,hash:block.hash,timestamp:block.timestamp},consent,authorization,
    consentDigest:TypedDataEncoder.hash(consent.domain,consent.types,consent.value),authorizationDigest:TypedDataEncoder.hash(domain,authorization.types,authorization.value),
    breakdown:{collateral,fee,bokAmount:a.bokAmount,relayFeeUsdc:relay.feeUsdc,maximumUsdc},relayGasBudgetWei:relay.gasBudgetWei,
    ready:false,requiredClaims:['collateral','private-fee','bok'],relayPreflightRequired:true,failureGasRisk:'relayer-unreimbursed-on-revert'});preparedUsdc.add(result);return result;
}
export function aggregateUsdcFundingTransaction(preparation,collateralConsent,authorization,{nowSeconds=Math.floor(Date.now()/1000)}={}){
  check(preparedUsdc.has(preparation),'UNVERIFIED_QUOTE');check(Number.isSafeInteger(nowSeconds)&&BigInt(nowSeconds)>BigInt(preparation.plan.validAfter)&&BigInt(nowSeconds)<BigInt(preparation.plan.deadline),'STALE_QUOTE');
  for(const signature of [collateralConsent,authorization])check(typeof signature==='string'&&/^0x(?:[0-9a-fA-F]{2}){1,4096}$/.test(signature),'CONSENT');
  return freeze({from:preparation.plan.relayer,to:preparation.scope.router,chainId:preparation.scope.chainId,value:'0',data:router.encodeFunctionData('fundUsdc',[preparation.plan,collateralConsent,authorization]),
    beneficiary:preparation.plan.beneficiary,planHash:preparation.planHash,authorizationNonce:preparation.authorizationNonce,recovery:'reconcile-only'});
}
