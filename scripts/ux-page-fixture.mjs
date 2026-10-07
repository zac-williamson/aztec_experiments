// Real presentation/controller modules with explicit application ports; no custody or chain qualification.
import fs from 'node:fs/promises';import {chromium} from 'playwright';
const root=new URL('../',import.meta.url);
export async function fixture(kind='billboard/user',{context}={}){
 const browser=context?null:await chromium.launch({headless:true});const page=context?await context.newPage():await browser.newPage({viewport:{width:390,height:844}});
 const close=()=>browser?browser.close():page.close();
 const errors=[];page.on('pageerror',error=>errors.push(error));try{
 const template=await fs.readFile(new URL('apps/src/'+kind+'/template.html',root),'utf8');
 await page.route('https://ui.test/**',route=>route.fulfill({contentType:'text/html',body:template.replace(/<script[\s\S]*?<\/script>/g,'')}));await page.goto('https://ui.test/');
 await page.addStyleTag({path:new URL('../shared/styles.css',import.meta.url).pathname});
 await page.addScriptTag({path:new URL('../shared/board-view.js',import.meta.url).pathname});
 await page.evaluate(()=>{
  window.calls=[];window.account={address:null,invalidated:false};window.config={board:{contractAddress:'0x'+'1'.repeat(64)},network:{chainId:'11155111'},privateFee:{}};
  window.billboardConfigStore={snapshot:()=>({config:null}),subscribe:listener=>{window.configChanged=listener;return()=>{};}};
  window._getPublicConfig=()=>config;window.publicOperationFailure=e=>({code:e.code,field:e.field,message:e.message||e.code});window.initialState='zero_balance_need_deposit';
  window.BillboardAccount={snapshot:()=>account,configure:options=>{window.walletOptions=options;}};window.BillboardWalletProviders={list:()=>[],subscribe:()=>()=>{},refresh(){}};window.__aztec={createPXE(){}};
  window.initializeHostedBoard=callback=>callback();
  window.ethers={formatEther:value=>String(Number(value)/1e18)};
  const listeners=new Set();window.operationState={status:'idle'};window.emit=state=>{operationState=state;for(const listener of listeners)listener(state);};
  window.applicationPort={connected:false,subscribe:listener=>{listeners.add(listener);listener(operationState);return()=>listeners.delete(listener);},operation:()=>operationState,diagnosticReport:()=> '{}',readFundingRecovery:()=>null,
   run:async action=>{calls.push(action);if(!account.address)throw {code:'BB_WALLET_NOT_READY'};applicationPort.connected=true;return {state:initialState};},
   completeDeposit:async()=>{calls.push('completeDeposit');return {state:'postable'};},completeFeeFunding:async()=>calls.push('completeFeeFunding'),
   readActivity:async()=>[],readDepositTerms:async()=>({minWei:1000000000000n,maxWei:10000000000000n,baseCooldown:60n}),fundingQuote:()=>({maximumFee:10n**18n,fundingAmount:2n*10n**18n}),
   readDeposit:async()=>({amount:1n,nextAllowedTime:0n,chainTime:1}),readFeed:async()=>({posts:[],policies:[],progress:{complete:true}})};
  window.createBillboardApplication=()=>applicationPort;
 });
 await page.addScriptTag({path:new URL('../shared/wallet-buttons.js',import.meta.url).pathname});
 await page.addScriptTag({path:new URL('apps/src/'+kind+'/app.js',root).pathname});
 return {page,errors,async close(){await close();if(errors.length)throw errors[0];}};
 }catch(error){await close();throw error;}
}
