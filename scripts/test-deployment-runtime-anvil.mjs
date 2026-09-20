// Real local Ethereum deployment/runtime check; no Aztec network proving.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes,createHash} from 'node:crypto';
import {Wallet,ContractFactory,JsonRpcProvider} from 'ethers';
import {verifyPortalRuntime} from '../shared/portal-runtime.mjs';
import {ROOT,assertNodeVersion,anvilBinary} from './toolchain.mjs';
assertNodeVersion();
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bb-runtime-live-'));
let anvil,provider,watchdog,passed=false,stage='startup';
const field=()=> '0x'+randomBytes(31).toString('hex').padStart(64,'0');
try {
 const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
 anvil=spawn(anvilBinary(),['--host','127.0.0.1','--port',String(port),'--chain-id','31337','--accounts','0','--silent'],{cwd:temporary,stdio:'ignore'});
 watchdog=setTimeout(()=>anvil.kill('SIGKILL'),60000);
 const url='http://127.0.0.1:'+port;
 let ready=false;for(let i=0;i<50;i++){try{const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]}),signal:AbortSignal.timeout(200)});ready=(await r.json()).result==='0x7a69';}catch{}if(ready)break;await new Promise(resolve=>setTimeout(resolve,50));}assert(ready);
 provider=new JsonRpcProvider(url,31337,{staticNetwork:true,cacheTimeout:-1,pollingInterval:50});
 const operator=Wallet.createRandom().connect(provider);await provider.send('anvil_setBalance',[operator.address,'0x3635c9adc5dea00000']);
 const read=relative=>JSON.parse(fs.readFileSync(path.join(ROOT,relative)));
 const publisherArtifact=read('.build/portal-tests/out/PortalV1.t.sol/RootPublisher.json'),artifact=read('billboard/portal/out/BillboardPortal.sol/BillboardPortal.json'),metadata=read('shared/portal-runtime.json');
 assert.equal(metadata.creationBytecodeSha256,createHash('sha256').update(Buffer.from(artifact.bytecode.object.slice(2),'hex')).digest('hex'));
 stage='deploy-disposable-bridge-and-real-portal';
 const publisher=await new ContractFactory(publisherArtifact.abi,publisherArtifact.bytecode.object,operator).deploy(5);await publisher.waitForDeployment();
 const board=field(),configHash=field(),rollup=await publisher.getAddress();
 const expected={MIN_DEPOSIT:1n,MAX_DEPOSIT:1000000n,L2_CONTRACT:board,ROLLUP:rollup,INBOX:await publisher.getInbox(),OUTBOX:await publisher.getOutbox(),VERSION:5n,L1_CHAIN_ID:31337n,CONFIG_HASH:configHash};
 const portal=await new ContractFactory(artifact.abi,artifact.bytecode.object,operator).deploy(rollup,board,5,1,1000000,configHash);await portal.waitForDeployment();
 const address=await portal.getAddress(),receipt=await portal.deploymentTransaction().wait();assert.equal(receipt.status,1);assert.equal(await portal.depositsEnabled(),false);
 stage='verify-real-runtime';
 const actual=await provider.getCode(address);assert.equal(verifyPortalRuntime(actual,metadata,expected),true);
 for(const name of Object.keys(expected))assert.throws(()=>verifyPortalRuntime(actual,metadata,{...expected,[name]:BigInt(expected[name])+1n}),/does not match/);
 stage='reject-live-code-mutation';
 const occupied=new Set(Object.values(metadata.immutables).flatMap(refs=>refs.flatMap(ref=>Array.from({length:ref.length},(_,i)=>ref.start+i))));
 const offset=Array.from({length:(actual.length-2)/2},(_,i)=>i).find(i=>!occupied.has(i)),index=2+offset*2;
 const mutated=actual.slice(0,index)+(actual.slice(index,index+2)==='00'?'01':'00')+actual.slice(index+2);
 await provider.send('anvil_setCode',[address,mutated]);
 const changed=await provider.getCode(address);assert.equal(changed.toLowerCase(),mutated.toLowerCase());assert.throws(()=>verifyPortalRuntime(changed,metadata,expected),/does not match/);
 passed=true;
}catch(error){console.log(JSON.stringify({passed:false,stage,errorClass:error.name,message:error.message}));process.exitCode=1;}
finally {
 clearTimeout(watchdog);if(provider)provider.destroy();
 if(anvil&&anvil.exitCode===null&&anvil.signalCode===null){const closed=once(anvil,'close');anvil.kill('SIGTERM');const kill=setTimeout(()=>anvil.kill('SIGKILL'),2000);await closed;clearTimeout(kill);}
 fs.rmSync(temporary,{recursive:true,force:true});
 if(passed)console.log(JSON.stringify({passed:true,realEthereumDeployment:true,allNineImmutableMismatchesRejected:true,liveCodeMutationRejected:true,disposableMockBridge:true,networkProofs:false,ownedProcessExited:true,temporaryDirectoryRemoved:!fs.existsSync(temporary)}));
}
