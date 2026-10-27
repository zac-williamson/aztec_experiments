// Actual local EVM transactions through the production journal and router.
// Test DEX reserves/rollup are explicit fixtures; no public network or user wallet.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {JsonRpcProvider,ContractFactory,Interface,keccak256} from 'ethers';
import {createEthereumJournal} from '../shared/ethereum-journal.mjs';
import {bokCreditPurchaseAbi} from '../shared/rolling/bok-credit-purchase.mjs';
const h=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const artifact=(file,name)=>JSON.parse(fs.readFileSync(new URL('../.build/portal-tests/out/'+file+'/'+name+'.json',import.meta.url)));
test('actual EVM: one Ethereum wallet transaction purchases and bridges Bok credit atomically',async t=>{
 const child=spawn(process.env.ANVIL??'anvil',['--port','0','--host','127.0.0.1'],{stdio:['ignore','pipe','pipe']});
 t.after(()=>{child.kill('SIGTERM');});
 const url=await new Promise((resolve,reject)=>{let output='';child.stdout.on('data',data=>{output+=data;const found=/Listening on (127\.0\.0\.1:\d+)/.exec(output);if(found)resolve('http://'+found[1]);});child.on('error',reject);child.on('exit',code=>reject(Error('Anvil exited: '+code)));});
 const provider=new JsonRpcProvider(url,undefined,{cacheTimeout:-1});t.after(()=>provider.destroy());const signer=await provider.getSigner(0),payer=(await signer.getAddress()).toLowerCase();
 const deploy=async(file,name,args=[])=>{const a=artifact(file,name),contract=await new ContractFactory(a.abi,a.bytecode.object,signer).deploy(...args);await contract.waitForDeployment();return contract;};
 const token=await deploy('RollingFundingRouter.t.sol','FundingToken'),weth=await deploy('RollingFundingRouter.t.sol','FundingWrapped'),dex=await deploy('RollingFundingRouter.t.sol','FundingDex');
 const rollup=await deploy('RollingFundingRouterCredit.t.sol','BokIntegrationRollup',[await token.getAddress()]);
 const portal=await deploy('PluginPortal.sol','PluginPortal',[await rollup.getAddress(),h(4),1,await token.getAddress()]);
 await (await portal.activate(0,0,0,[])).wait();await (await token.seed(await dex.getAddress(),10000)).wait();
 const collateral=await deploy('BillboardPortal.sol','BillboardPortal',[await rollup.getAddress(),h(4),1,'1000000000000000000','2000000000000000000',h(2)]);
 const fee=await deploy('RollingFundingRouter.t.sol','FundingToken');
 const feePortal=await deploy('RollingFundingRouter.t.sol','FundingFeeBridge',[await fee.getAddress(),await rollup.getAddress()]);
 const router=await deploy('RollingFundingRouter.sol','RollingFundingRouter',[await collateral.getAddress(),await feePortal.getAddress(),await portal.getAddress(),await weth.getAddress(),await dex.getAddress(),h(3)]);
 const routerAddress=(await router.getAddress()).toLowerCase(),tokenAddress=(await token.getAddress()).toLowerCase(),portalAddress=(await portal.getAddress()).toLowerCase();
 const records=new Map(),storage={read:async key=>records.get(key)??null,compareAndSwap:async(key,before,after)=>{assert.equal(records.get(key)??null,before);records.set(key,after);}};
 let sends=0;const journal=await createEthereumJournal({storage,walletSecret:h(11),walletSalt:h(12),scope:{account:h(13),board:h(4),chainId:'31337',version:'1',rollup:(await rollup.getAddress()).toLowerCase(),portal:routerAddress,token:tokenAddress,depositor:payer},provider,signer:{getAddress:()=>signer.getAddress(),sendTransaction:async request=>{sends++;return signer.sendTransaction(request);}}});
 const head=await provider.getBlock('latest'),deadline=String(head.timestamp+900),data=new Interface(bokCreditPurchaseAbi).encodeFunctionData('buyCredit',[[h(14),200,h(15),3000,deadline]]);
 const result=await journal.send({data,value:'3000',expected:{kind:'bok-purchase',amount:'200',recipient:h(14),secretHash:h(15),portal:portalAddress,token:tokenAddress,weth:(await weth.getAddress()).toLowerCase(),swapRouter:(await dex.getAddress()).toLowerCase(),routerCodeHash:keccak256(await provider.getCode(routerAddress)),poolFee:3000,maximumWei:'3000',deadline}});
 assert.equal(sends,1);assert.equal(result.outcome,'success');assert.equal(result.event.amount,'200');assert.equal(result.event.account,h(14));
 assert.equal(await token.balanceOf(portalAddress),200n);assert.equal(await token.balanceOf(payer),0n);assert.equal(await provider.getBalance(routerAddress),0n);
 assert.equal(await weth.balanceOf(routerAddress),0n);assert.equal(await token.balanceOf(routerAddress),0n);
 assert.equal(await token.allowance(routerAddress,portalAddress),0n);assert.equal(await weth.allowance(routerAddress,await dex.getAddress()),0n);
 assert.equal((await journal.recover()).txHash,result.txHash);assert.equal(sends,1);
});
