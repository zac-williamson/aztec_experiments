import assert from 'node:assert/strict';
import {test} from 'node:test';
import {TestDateProvider} from '@aztec-labs/foundation/timer';
import {synchronizeC01MinedClock} from './c01-client-mining.mjs';

test('restored devnet clock satisfies the actual SDK startup drift guard without disabling it',async t=>{
  t.mock.timers.enable({apis:['Date'],now:1791933971000});
  // Import the installed implementation, since the package's public index does
  // not expose this class. Only its block read is a labelled local fixture.
  const {ArchiverL1Synchronizer}=await import(new URL('./modules/l1_synchronizer.js',import.meta.resolve('@aztec-labs/archiver')));
  const dateProvider=new TestDateProvider({warn(){}}),timestamp=1791932911;
  const context={config:{maxAllowedEthClientDriftSeconds:60},dateProvider,
    publicClient:{getBlock:async()=>({number:46n,timestamp:BigInt(timestamp)})}};
  const check=()=>ArchiverL1Synchronizer.prototype.testEthereumNodeSynced.call(context);
  await assert.rejects(check(),/Ethereum node is out of sync/);
  synchronizeC01MinedClock(dateProvider,timestamp);
  await check();
  t.mock.timers.tick(61000);
  await assert.rejects(check(),/Ethereum node is out of sync/);
});

test('mined-clock synchronization prevents accumulated drift across a long proof batch',t=>{
  t.mock.timers.enable({apis:['Date'],now:100000});
  const old=new TestDateProvider({warn(){}}),fixed=new TestDateProvider({warn(){}});
  old.setTime(100000);fixed.setTime(100000);
  let maxFixedLead=0;
  for(let tick=1;tick<=300;tick++){
    t.mock.timers.tick(1025); // one-second block plus RPC/mining overhead
    const mined=100+tick;
    if(mined>old.nowInSeconds())old.setTime(mined*1000);
    maxFixedLead=Math.max(maxFixedLead,synchronizeC01MinedClock(fixed,mined));
    assert.equal(fixed.nowInSeconds(),mined);
  }
  assert.equal(old.nowInSeconds()-400,7,'Old forward-only clock misses a six-second build-start cutoff');
  assert(maxFixedLead<=1);
  // A controlled epoch warp forward is still adopted on the next mined block.
  synchronizeC01MinedClock(fixed,1000);assert.equal(fixed.nowInSeconds(),1000);
});
