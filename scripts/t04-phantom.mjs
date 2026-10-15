// Test-only actions for the pinned official extension. Caller owns every resource.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {TypedDataEncoder,verifyTypedData,getAddress} from 'ethers';
import {collateralConsentTypes,usdcAuthorizationTypes} from '../shared/rolling/aggregate-funding.mjs';
export const phantomPackage=Object.freeze({archive:'.build/phantom-20261014-acquisition/package.crx',sha256:'28b3bce96b53ca6824cafdfe4a0893a08c6bda6891fa55c37cfc88cef6d86639',id:'bfnaelmomeimhlpmgjnjophhpkkoljpa',version:'26.33.0'});
export function walletExtensionMode(args){
 if(args.length===0)return 'metamask';
 if(args.length===2&&args[0]==='--wallet=metamask'&&['--aggregate-devnet=ETH','--aggregate-devnet=USDC'].includes(args[1]))return 'metamask-aggregate-'+args[1].split('=')[1];
 if(args.length===2&&args[0]==='--wallet=phantom'&&args[1]==='--onboarding-only')return 'phantom-onboarding';
 assert.deepEqual(args,['--wallet=phantom','--signatures-only']);return 'phantom';
}
export function phantomZip(bytes){
 assert.equal(createHash('sha256').update(bytes).digest('hex'),phantomPackage.sha256);
 assert.equal(bytes.subarray(0,4).toString(),'Cr24');assert.equal(bytes.readUInt32LE(4),3);
 const offset=12+bytes.readUInt32LE(8);assert(offset<bytes.length);return bytes.subarray(offset);
}
export function unpackPhantom(root,directory){
 const zip=path.join(directory,'phantom.zip');fs.writeFileSync(zip,phantomZip(fs.readFileSync(path.join(root,phantomPackage.archive))),{flag:'wx',mode:0o600});
 const extension=path.join(directory,'extension');execFileSync('/usr/bin/unzip',['-q',zip,'-d',extension]);
 const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json')));
 assert.equal(manifest.version,phantomPackage.version);assert.equal(manifest.manifest_version,3);
 const id=[...createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest().subarray(0,16)].map(x=>String.fromCharCode(97+(x>>4),97+(x&15))).join('');
 assert.equal(id,phantomPackage.id);return extension;
}
// Unbroadcast signature-only examples use random disposable contract addresses.
// These are the actual G04 field layouts, not claims of deployed testnet liquidity.
export function phantomTypedData({account,portal,router,token,nonce,now}){
 for(const address of [account,portal,router,token])getAddress(address);
 assert.match(nonce,/^0x[0-9a-f]{64}$/);assert(Number.isSafeInteger(now)&&now>0);
 return [
  {domain:{name:'RollingCollateral',version:'1',chainId:11155111,verifyingContract:portal},types:collateralConsentTypes,value:{beneficiary:account,executor:router,amount:'1',secretHash:nonce,nonce:'0',deadline:String(now+600)}},
  {domain:{name:'USDC',version:'2',chainId:11155111,verifyingContract:token},types:usdcAuthorizationTypes,value:{from:account,to:router,value:'1',validAfter:String(now-1),validBefore:String(now+600),nonce}},
 ];
}
export function assertPhantomSignature(data,signature,account){assert.equal(verifyTypedData(data.domain,data.types,data.value,signature).toLowerCase(),account.toLowerCase());return TypedDataEncoder.hash(data.domain,data.types,data.value);}
export const phantomMethods=Object.freeze(['eth_chainId','eth_accounts','eth_requestAccounts','wallet_switchEthereumChain','eth_signTypedData_v4']);
export function assertPhantomMethod(method){assert(phantomMethods.includes(method),'Unexpected request in signature-only wallet check');}
export async function onboardPhantom(context,mnemonic,password,mark,{passwordOnly=false,onProfile=()=>{}}={}){
 for(const page of context.pages())if(page.url().startsWith('chrome-extension://'+phantomPackage.id+'/'))await page.close();
 const page=await context.newPage();page.setDefaultTimeout(8000);
 await page.goto('chrome-extension://'+phantomPackage.id+'/onboarding.html');
 mark('phantom-import-choice');await page.getByRole('button',{name:'I Already Have a Wallet',exact:true}).click();
 await page.getByText('Import Recovery Phrase',{exact:true}).click();
 mark('phantom-import-phrase');
 const words=mnemonic.split(' ');assert.equal(words.length,12);
 for(let i=0;i<words.length;i++)await page.getByTestId('secret-recovery-phrase-word-input-'+i).fill(words[i]);
 await page.getByTestId('onboarding-form-submit-button').click();
 mark('phantom-import-accounts');await page.getByText('Import Accounts',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 mark('phantom-password');await page.getByTestId('onboarding-form-password-input').fill(password);
 await page.getByTestId('onboarding-form-confirm-password-input').fill(password);
 mark('phantom-terms');
 const terms=page.getByTestId('onboarding-form-terms-of-service-checkbox');
 assert.equal(await terms.isChecked(),false);
 // The pinned extension renders a Reach custom-checkbox container around the
 // input. Use its visible control, then verify the underlying checked state.
 await terms.locator('..').click();
 await page.waitForFunction(()=>document.querySelector('[data-testid="onboarding-form-terms-of-service-checkbox"]')?.checked===true);
 assert.equal(await terms.isChecked(),true);
 mark('phantom-password-submit');await page.getByTestId('onboarding-form-submit-button').click();
 await page.getByTestId('onboarding-form-password-input').waitFor({state:'hidden'});
 if(passwordOnly)return page;
 return completePhantomOnboarding(context,page,mark,onProfile);
}

export async function completePhantomOnboarding(context,page,mark,onProfile){
 mark('phantom-completion');const deadline=Date.now()+15000;
 let usernameFilled=false,usernameAttempted=false,finished=false,deferred=false;
 while(Date.now()<deadline){
  const later=page.getByTestId('onboarding-create-username-complete-later');
  const claimed=page.getByTestId('onboarding-claiming-username-get-started');
  const done=page.getByRole('button',{name:'Get Started',exact:true});
  if(await later.isVisible()&&!deferred){deferred=true;mark('phantom-username-defer');await later.click();continue;}
  if(await claimed.isVisible()){
   assert(usernameAttempted);onProfile({attempted:true,created:true,externalDeletionVerified:false});
   await claimed.click();finished=true;break;
  }
  if(await done.isVisible()){await done.click();finished=true;break;}
  const username=page.getByPlaceholder('username',{exact:true});
  if(!usernameFilled&&await username.isVisible()){
   // Only a fresh disposable profile is in scope. No personal/existing identity.
   usernameFilled=true;mark('phantom-username-fill');await username.fill('test'+randomBytes(6).toString('hex'));
   // The pinned input validates on blur as well as its debounced change path.
   // Use an ordinary keyboard transition, never force its disabled Continue.
   await username.press('Tab');continue;
  }
  const claim=page.getByTestId('onboarding-create-username-continue');
  if(usernameFilled&&!usernameAttempted&&await claim.isVisible()&&await claim.isEnabled()){
   usernameAttempted=true;onProfile({attempted:true,created:false,externalDeletionVerified:false});
   mark('phantom-username-create');await claim.click();continue;
  }
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 assert(finished,'Phantom completion unavailable');
 // The real completion button can close onboarding itself. Open/reuse its
 // ordinary wallet surface, rather than navigating a destroyed page.
 const wallet=context.pages().find(candidate=>candidate.url()==='chrome-extension://'+phantomPackage.id+'/popup.html')??await context.newPage();
 wallet.setDefaultTimeout(8000);await wallet.goto('chrome-extension://'+phantomPackage.id+'/popup.html');
 await wallet.getByTestId('settings-menu-open-button').waitFor();
 if(page!==wallet&&!page.isClosed())await page.close();return wallet;
}

export async function enablePhantomTestnet(page,mark){
 mark('phantom-testnet');await page.getByTestId('settings-menu-open-button').click();
 await page.getByTestId('settings-item-developer-settings').click();
 await page.getByTestId('toggleTestNetwork').click();
 await page.goto('chrome-extension://'+phantomPackage.id+'/popup.html');
}
export async function phantomPrompt(context,button){
 const end=Date.now()+8000;
 while(Date.now()<end){
  for(const page of context.pages())if(page.url().startsWith('chrome-extension://'+phantomPackage.id+'/notification.html')){
   const control=page.getByRole('button',{name:button,exact:true});
   if(await control.isVisible()){await control.click();return;}
  }
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 throw Error('Phantom confirmation control unavailable');
}
