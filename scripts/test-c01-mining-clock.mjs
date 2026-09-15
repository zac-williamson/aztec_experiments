import assert from 'node:assert/strict';
import {test} from 'node:test';
import {TestDateProvider} from '@aztec/foundation/timer';
import {synchronizeC01MinedClock} from './c01-client-mining.mjs';

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
