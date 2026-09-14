// Bounded local server-proof setup, never an unverified global-cache import.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ROOT, assertNodeVersion, assertAztecPackages } from './toolchain.mjs';
assertNodeVersion(); assertAztecPackages();
const bbSha256 = '208cc0d9046603f31a8dc6c5ed0de529ccc63155a22078d409262ec6e4122031';
const headerSha256 = 'fed28be863d5941f0f3325628c87ab11e61887cff306b0fae4b872f88f9b8f40';
const headerPath = '/Users/zac/nargo/github.com/AztecProtocol/aztec-packages/v5.2.0/barretenberg/cpp/src/barretenberg/srs/factories/bn254_g1_chunk_hashes.hpp';
const sourceUrl = 'https://crs.aztec-cdn.foundation/g1_compressed.dat';
const chunkBytes = 4194304, count = 129, bytes = chunkBytes * count;
const sha = data => createHash('sha256').update(data).digest('hex');
const directory = path.join(ROOT,'.build/C01-epoch-crs');
const evidence = path.join(ROOT,'execution/evidence/C01',`epoch-crs-${randomUUID()}.json`);
const report = { schemaVersion:1, startedAt:new Date().toISOString(), sourceUrl, bytes, passed:false };
let handle, created=false;
try {
  const binary = await fs.readFile(path.join(ROOT,'node_modules/@aztec/bb.js/build/arm64-macos/bb'));
  assert.equal(sha(binary),bbSha256);
  const header = await fs.readFile(headerPath); assert.equal(sha(header),headerSha256);
  const rows = [...header.toString().matchAll(/\{([^{}]+)\}/g)]
    .map(match=>Buffer.from([...match[1].matchAll(/0x([0-9a-f]{2})/g)].map(m=>parseInt(m[1],16))))
    .filter(row=>row.length===32);
  assert.equal(rows.length,763);
  const pins = rows.slice(0,count), table=Buffer.concat(pins);
  const tableOffset=binary.indexOf(table); assert(tableOffset>=0,'CRS chunk pins absent from pinned native executable');
  const chunkSha256=pins.map(pin=>pin.toString('hex'));
  // No overwriting or trusting an earlier cache: this run owns only a fresh directory.
  await fs.mkdir(directory,{mode:0o700}); created=true;
  handle=await fs.open(path.join(directory,'bn254_g1_compressed.dat'),'wx',0o600);
  const response=await fetch(sourceUrl,{headers:{Range:`bytes=0-${bytes-1}`,'Accept-Encoding':'identity'},
    redirect:'error',signal:AbortSignal.timeout(120000)});
  assert.equal(response.status,206,'Expected exact ranged response');
  assert.equal(response.headers.get('content-length'),String(bytes));
  assert.match(response.headers.get('content-range') ?? '',new RegExp(`^bytes 0-${bytes-1}/[0-9]+$`));
  assert([null,'identity'].includes(response.headers.get('content-encoding')));
  const whole=createHash('sha256'); let buffer=Buffer.alloc(chunkBytes), filled=0, total=0, chunk=0;
  for await(const raw of response.body) {
    const data=Buffer.from(raw);total+=data.length;assert(total<=bytes,'Range exceeds bound');whole.update(data);
    let cursor=0;
    while(cursor<data.length){const size=Math.min(chunkBytes-filled,data.length-cursor);data.copy(buffer,filled,cursor,cursor+size);filled+=size;cursor+=size;
      if(filled===chunkBytes){assert.equal(sha(buffer),chunkSha256[chunk],`CRS chunk ${chunk} integrity mismatch`);
        let written=0;while(written<buffer.length){const result=await handle.write(buffer,written,buffer.length-written,null);assert(result.bytesWritten>0);written+=result.bytesWritten;}
        chunk++;filled=0;
      }
    }
  }
  assert.equal(total,bytes);assert.equal(chunk,count);assert.equal(filled,0);await handle.sync();await handle.close();handle=null;
  const digest=whole.digest('hex');
  assert.equal(sha(await fs.readFile(path.join(directory,'bn254_g1_compressed.dat'))),digest);
  await fs.chmod(path.join(directory,'bn254_g1_compressed.dat'),0o400);
  const manifest={schemaVersion:1,bbSha256,headerSha256,sourceUrl,compressed:{name:'bn254_g1_compressed.dat',bytes,numPoints:bytes/32,sha256:digest,chunkBytes,chunkSha256}};
  await fs.writeFile(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o400});
  Object.assign(report,{passed:true,manifest,binaryHashTableOffset:tableOffset,hashTableSha256:sha(table),sourceSha256:sha(await fs.readFile(new URL(import.meta.url))),retainedBytes:bytes});
} catch(error){report.failure={name:error.name,code:error.code??null,message:error.message};if(handle)await handle.close();if(created)await fs.rm(directory,{recursive:true,force:true});process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();await fs.writeFile(evidence,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({evidence,passed:report.passed,bytes}));}
