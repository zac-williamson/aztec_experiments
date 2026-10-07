const view=BillboardView,element=id=>document.getElementById(id);
view.header({title:'Create a board',section:''});
const application=createBillboardApplication({kind:'deploy',deploymentConfig:()=>window.__aztec.deploymentManifestConfig(JSON.parse(element('deploymentManifest').value))});
view.bindOperation(application,element('operationStatus'));
const saveKey='board-deployment-resume-v1';
let selected=null,publicConfig=null,attemptBusy=false,revision=0;
function controls(){const busy=attemptBusy||['working','waiting'].includes(application.operation().status);for(const id of ['deployButton','manifestFile','publicFeeGas','readyTxHash','retryEthereum','prepareBoard','newMinimum','newMaximum','newInterval','newWindow','newMultiplier','newAllowance','newModerator','newRules'])element(id).disabled=busy;}
application.subscribe(controls);
function clearCompletion(){publicConfig=null;for(const id of ['readBoard','postBoard','downloadConfig'])element(id).hidden=true;element('capabilities').replaceChildren();}
function describe(m){element('manifestSummary').replaceChildren();const pairs=[['Network','Ethereum '+m.network.chainId+' / Aztec '+m.network.rollupVersion],['Refundable deposit',ethers.formatEther(m.board.minDeposit)+'–'+ethers.formatEther(m.board.maxDeposit)+' ETH'],['Posting interval at minimum deposit',m.board.baseCooldown+' seconds'],['Moderation period',m.board.censorWindow+' seconds'],['Saved posting allowance',m.board.maxSaveUp+' intervals'],['Penalty for an eligible removal',(Number(m.board.kMultiplier)-1)+' additional posting intervals'],['Moderator',m.board.censor],['Board rules',m.board.policy]];for(const [label,value]of pairs)element('manifestSummary').append(view.element('dt',label),view.element('dd',String(value)));}
async function importDeploymentManifest(input){
 if(attemptBusy)return;
 const file=input.files?.[0];if(!file)return;
 const version=++revision;clearCompletion();selected=null;
 try{if(file.size>65536)throw Error();const manifest=window.__aztec.validateDeploymentManifest(JSON.parse(await file.text()));if(version!==revision)return;selected=manifest;element('deploymentManifest').value=JSON.stringify(selected);element('readyTxHash').value='';describe(selected);element('status').textContent='Review these settings, then connect the deployment accounts.';}
 catch{if(version!==revision)return;element('deploymentManifest').value='';element('status').textContent='Choose a valid deployment configuration file.';}
}
function saveResume(attempt,hash){localStorage.setItem(saveKey,JSON.stringify({schema:1,manifest:attempt.manifest,gas:attempt.gas,readyTxHash:hash||attempt.readyTxHash}));}
async function startDeploy(){
 if(attemptBusy)return;
 if(!selected){element('status').textContent='Choose and review a deployment configuration first.';return;}
 const attempt={revision:++revision,manifest:structuredClone(selected),gas:element('publicFeeGas').value.trim(),readyTxHash:element('readyTxHash').value,retry:element('retryEthereum').checked};
 attemptBusy=true;controls();clearCompletion();
 try{
  const gas=attempt.gas?JSON.parse(attempt.gas):null;if(gas)window.__aztec.normalizePrivateFeeGasSettings(gas);
  const input={...window.__aztec.deploymentManifestConfig(attempt.manifest),readyTxHash:attempt.readyTxHash||undefined,retryEthereum:attempt.retry,dataDirPrefix:'pxe_bb_'};
  saveResume(attempt);
  const result=await application.run('deploy',input);if(attempt.revision!==revision)return;
  if(result.readyTxHash)element('readyTxHash').value=result.readyTxHash;saveResume(attempt,result.readyTxHash);
  publicConfig=await application.publicConfiguration(result,gas,attempt.manifest);
  element('downloadConfig').hidden=false;element('deployButton').textContent='Continue deployment';
  element('status').textContent=result.status==='active'?'Contracts deployed. Checking board configuration…':'Activation is waiting for network settlement. Your deployment is saved; continue here later.';
  const checks=await application.deploymentCapabilities(result,attempt.manifest);if(attempt.revision!==revision)return;
  for(const [key,label]of [['reading','Read messages'],['deposits','Accept deposits'],['posting','Posting configuration'],['remoteProver','Remote prover'],['moderator','Moderator address']])element('capabilities').append(view.element('dt',label),view.element('dd',checks[key].replaceAll('-',' ')));
  const fragment='network='+[publicConfig.network.chainId,publicConfig.network.rollupAddress,publicConfig.network.rollupVersion].join(':')+'&board='+publicConfig.board.contractAddress;
  element('readBoard').href=view.url('feed.html',fragment);element('readBoard').hidden=!checks.hostedReading;
  element('postBoard').href=view.url('user.html',fragment);element('postBoard').hidden=checks.posting!=='configuration-verified';
  if(result.status==='active')element('status').textContent=checks.posting==='configuration-verified'?'Contracts deployed and posting configuration checked. Account funding and prover readiness are checked when connecting.':'Contracts deployed. Configure hosted posting and check the services below before inviting users.';
 }catch(error){element('status').textContent=publicOperationFailure(error).message;}
 finally{attemptBusy=false;controls();}
}
for(const id of ['newMinimum','newMaximum','newInterval','newWindow','newMultiplier','newAllowance','newModerator','newRules'])element(id).oninput=()=>{revision++;selected=null;clearCompletion();element('manifestSummary').replaceChildren();element('status').textContent='Settings changed. Review them again before creating the board.';};
element('prepareBoard').onclick=async()=>{if(attemptBusy)return;const version=++revision;selected=null;clearCompletion();try{const {manifest,gas}=await application.prepareDeployment({minDeposit:element('newMinimum').value,maxDeposit:element('newMaximum').value,baseCooldown:element('newInterval').value,censorWindow:element('newWindow').value,kMultiplier:element('newMultiplier').value,maxSaveUp:element('newAllowance').value,censor:element('newModerator').value.trim().toLowerCase(),policy:element('newRules').value.trim()});if(version!==revision)return;selected=manifest;element('deploymentManifest').value=JSON.stringify(manifest);element('publicFeeGas').value=gas?JSON.stringify(gas):'';element('readyTxHash').value='';describe(manifest);element('status').textContent='Review the settings above. Create board will ask for wallet approvals.';}catch(error){element('status').textContent=error.code==='BB_WALLET_NOT_READY'?'Connect both deployment accounts first.':'Check the board settings: positive amounts and intervals, minimum no greater than maximum, valid moderator address, and rules within 1,488 UTF-8 bytes.';}};
element('downloadConfig').onclick=()=>{if(publicConfig)_downloadJson('board-public-config.json',publicConfig);};
function initialize(){
 if(!window.__aztec?.createPXE){element('status').textContent='Loading wallet software…';waitForBundle(initialize);return;}
 try{const text=localStorage.getItem(saveKey);if(text){const saved=JSON.parse(text);if(saved.schema!==1)throw Error();selected=window.__aztec.validateDeploymentManifest(saved.manifest);element('deploymentManifest').value=JSON.stringify(selected);element('publicFeeGas').value=saved.gas;element('readyTxHash').value=saved.readyTxHash||'';describe(selected);element('deployButton').textContent='Continue deployment';}}
 catch{element('status').textContent='Saved deployment settings could not be opened. Import the reviewed configuration.';}
 initWalletButtons('walletButtonsContainer',{statusId:'status',canEndSession:()=>!attemptBusy&&!['working','waiting'].includes(application.operation().status),onReady:()=>{if(!element('newModerator').value)element('newModerator').value=window.BillboardAccount.snapshot().address;element('status').textContent='Accounts connected. Review your settings before creating the board.';}});
}
initialize();
