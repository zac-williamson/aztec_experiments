// Local Ethereum application test. Controlled bridge roots; no Aztec network prover.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {Wallet,ContractFactory,JsonRpcProvider,solidityPacked,getBytes} from 'ethers';
import {createEthereumJournal} from '../shared/ethereum-journal.mjs';
import {createFileJournalStorage} from '../apps/src/billboard/user/transaction-journal-store.mjs';
import {encodeReadyCommitment,encodeEscrowCommitment,sha256Field} from '../shared/protocol-commitments.mjs';
import {ROOT,pins,assertNodeVersion} from './toolchain.mjs';
assertNodeVersion();
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bb-eth-live-'));
let anvil,provider,stage='startup',passed=false,watchdog;
const field=()=> '0x'+randomBytes(31).toString('hex').padStart(64,'0');
try {
  assert(execFileSync('anvil',['--version'],{encoding:'utf8'}).includes(pins.foundry));
  const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
  anvil=spawn('anvil',['--host','127.0.0.1','--port',String(port),'--chain-id','31337','--accounts','0','--silent'],{cwd:temporary,stdio:'ignore'});
  watchdog=setTimeout(()=>anvil.kill('SIGKILL'),90000);
  const url='http://127.0.0.1:'+port;
  let ready=false;for(let i=0;i<50;i++){try{const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]}),signal:AbortSignal.timeout(200)});ready=(await r.json()).result==='0x7a69';}catch{}if(ready)break;await new Promise(resolve=>setTimeout(resolve,50));}assert(ready);
  provider=new JsonRpcProvider(url,31337,{staticNetwork:true,cacheTimeout:-1,pollingInterval:50});
  const user=Wallet.createRandom().connect(provider),operator=Wallet.createRandom().connect(provider);
  for(const account of [user,operator])await provider.send('anvil_setBalance',[account.address,'0x3635c9adc5dea00000']);
  const publisherArtifact=JSON.parse(fs.readFileSync(path.join(ROOT,'.build/portal-tests/out/PortalV1.t.sol/RootPublisher.json')));
  const portalArtifact=JSON.parse(fs.readFileSync(path.join(ROOT,'billboard/portal/out/BillboardPortal.sol/BillboardPortal.json')));
  stage='deploy-local-portal';
  const publisher=await new ContractFactory(publisherArtifact.abi,publisherArtifact.bytecode.object,operator).deploy(5);await publisher.waitForDeployment();
  const board=field(),configHash=field();
  const portal=await new ContractFactory(portalArtifact.abi,portalArtifact.bytecode.object,operator).deploy(await publisher.getAddress(),board,5,1,1000000,configHash);await portal.waitForDeployment();
  const scope={l1ChainId:'31337',rollupAddress:(await publisher.getAddress()).toLowerCase(),rollupVersion:'5',boardAddress:board,portalAddress:(await portal.getAddress()).toLowerCase()};
  const leaf=async content=>sha256Field(getBytes(solidityPacked(['bytes32','uint256','address','uint256','bytes32'],[board,5,scope.portalAddress,31337,content])));
  const readyRoot=await leaf(await sha256Field(encodeReadyCommitment(scope,configHash)));
  await (await publisher.publish(1,1,readyRoot)).wait();await (await portal.activate(1,1,0,[])).wait();
  const walletSecret=field(),walletSalt=field(),storage=createFileJournalStorage(temporary);
  const journalScope={account:field(),chainId:'31337',rollup:scope.rollupAddress,version:'5',board,portal:scope.portalAddress,depositor:user.address.toLowerCase()};
  let sends=0;const lostResponseSigner={getAddress:()=>user.getAddress(),sendTransaction:async request=>{sends++;const tx=await user.sendTransaction(request);await tx.wait();throw new Error('synthetic response loss after mining');}};
  const options={storage,walletSecret,walletSalt,scope:journalScope,provider,signer:lostResponseSigner};
  stage='deposit-with-lost-hash';
  const secretHash=field(),amount='1000';
  await assert.rejects((await createEthereumJournal(options)).send({data:portal.interface.encodeFunctionData('deposit',[secretHash]),value:amount,expected:{kind:'deposit',nonce:'1',amount,secretHash}}),{code:'BB_ETH_SUBMISSION_UNKNOWN'});
  const deposit=await (await createEthereumJournal({...options,signer:null})).recover();assert.equal(deposit.outcome,'success');assert.equal(sends,1);assert.equal((await portal.getDeposit(user.address)).amount,1000n);
  stage='refund-with-lost-hash';
  const exitRoot=await leaf(await sha256Field(encodeEscrowCommitment('exit',scope,{depositor:user.address.toLowerCase(),depositNonce:'1',amount})));
  await (await publisher.publish(2,1,exitRoot)).wait();
  const refundJournal=await createEthereumJournal({...options,acknowledgeTx:deposit.txHash});
  await assert.rejects(refundJournal.send({data:portal.interface.encodeFunctionData('withdraw',[2,1,0,[]]),value:'0',expected:{kind:'withdraw',nonce:'1',amount}}),{code:'BB_ETH_SUBMISSION_UNKNOWN'});
  assert.equal((await portal.getDeposit(user.address)).amount,0n);
  const refund=await (await createEthereumJournal({...options,signer:null})).recover();assert.equal(refund.outcome,'success');assert.equal(refund.event.amount,1000n);assert.equal(sends,2);
  const again=await (await createEthereumJournal({...options,signer:lostResponseSigner})).recover({retry:true});assert.equal(again.txHash,refund.txHash);assert.equal(sends,2);
  passed=true;
}catch(error){console.log(JSON.stringify({passed:false,stage,errorClass:error.name,code:error.code||null}));process.exitCode=1;}
finally {
  clearTimeout(watchdog);if(provider)provider.destroy();
  if(anvil&&anvil.exitCode===null&&anvil.signalCode===null){const closed=once(anvil,'close');anvil.kill('SIGTERM');const kill=setTimeout(()=>anvil.kill('SIGKILL'),2000);await closed;clearTimeout(kill);}
  fs.rmSync(temporary,{recursive:true,force:true});
  if(passed)console.log(JSON.stringify({passed:true,realEthereumReceipts:true,portalDepositAndRefund:true,lostHashRecovered:true,repeatedRecoveryDidNotResend:true,controlledBridgeRoots:true,networkProofs:false,ownedProcessExited:true,temporaryDirectoryRemoved:!fs.existsSync(temporary),secretsLogged:false}));
}
