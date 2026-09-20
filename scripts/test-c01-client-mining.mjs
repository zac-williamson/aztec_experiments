import {anvilBinary} from './toolchain.mjs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {Wallet,JsonRpcProvider} from 'ethers';
import {createPublicClient,http} from 'viem';
import {foundry} from 'viem/chains';
import {withC01ClientMining} from './c01-client-mining.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('local Ethereum receipt accounting and controlled mining',{timeout:30000},async t=>{
  const reservation=net.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(anvilBinary(),['--host','127.0.0.1','--port',String(port),'--chain-id','31337','--accounts','0','--silent'],{stdio:'ignore'});
  let closed=false;const exit=new Promise(resolve=>{child.once('close',()=>{closed=true;resolve();});child.once('error',()=>{closed=true;resolve();});});
  const rpcUrl=`http://127.0.0.1:${port}`,client=createPublicClient({chain:foundry,transport:http(rpcUrl,{retryCount:0,timeout:1000})});
  const dateProvider={nowInSeconds:()=>Math.floor(Date.now()/1000),setTime(){}};
  try{
    let ready=false;for(let i=0;i<40;i++){try{ready=await client.getChainId()===31337;}catch{}if(ready)break;await pause(100);}
    assert(ready,'Disposable zero-account Anvil failed to start');
    await t.test('capped EIP-1559 receipt fee equals actual balance debit',async()=>{
      const provider=new JsonRpcProvider(rpcUrl,31337,{staticNetwork:true,cacheTimeout:-1,pollingInterval:50});
      try{
        const user=Wallet.createRandom().connect(provider);await provider.send('anvil_setBalance',[user.address,'0x3635c9adc5dea00000']);
        const before=await provider.getBalance(user.address),cap=1000000000n;
        const tx=await user.sendTransaction({to:Wallet.createRandom().address,value:1n,type:2,gasLimit:21000n,maxFeePerGas:cap,maxPriorityFeePerGas:cap});
        const receipt=await tx.wait(),block=await provider.getBlock(receipt.blockNumber);
        assert(block.baseFeePerGas>0n);assert.equal(receipt.gasPrice,cap);
        assert.equal(before-await provider.getBalance(user.address)-1n,receipt.fee);
      }finally{provider.destroy();}
    });
    const observed={};
    const result=await withC01ClientMining({rpcUrl,dateProvider,observation:observed},async tick=>{
      const first=await client.getBlock({blockTag:'latest'});
      await pause(2200); // Represents proof work that never calls a mining tick.
      assert((await client.getBlock({blockTag:'latest'})).number>=first.number+2n);
      await tick();return 'complete';
    });
    assert.equal(result,'complete');assert(observed.clientMining.passed&&observed.clientMining.stopped);
    const stoppedAt=(await client.getBlock({blockTag:'latest'})).number;await pause(1200);
    assert.equal((await client.getBlock({blockTag:'latest'})).number,stoppedAt);
    const failed={};const sentinel=new Error('work failed');
    await assert.rejects(withC01ClientMining({rpcUrl,dateProvider,observation:failed},async()=>{throw sentinel;}),error=>error===sentinel);
    assert.equal(failed.clientMining.passed,false);assert.equal(failed.clientMining.stopped,true);
    const failedAt=(await client.getBlock({blockTag:'latest'})).number;await pause(1200);
    assert.equal((await client.getBlock({blockTag:'latest'})).number,failedAt);
    const unavailable={};
    await assert.rejects(withC01ClientMining({rpcUrl,dateProvider,observation:unavailable},async tick=>{
      child.kill('SIGTERM');await exit;await tick();
    }),/C01_CLIENT_MINING_FAILED/);
    assert.equal(unavailable.clientMining.passed,false);assert.equal(unavailable.clientMining.stopped,true);
  }finally{
    if(!closed){child.kill('SIGTERM');await Promise.race([exit,pause(2000)]);}
    if(!closed){child.kill('SIGKILL');await Promise.race([exit,pause(2000)]);}
    assert(closed,'Disposable Anvil did not exit');
  }
});
