import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import {startBoardWeb} from '../devnet/web.mjs';
test('browser CRS requests return exact bounded ranges, with invalid ranges rejected',async()=>{
 const web=await startBoardWeb({fixture:{descriptor:{scope:{}}},port:8797,publicConfig:{}});
 const file=await fs.open('apps/dist/crs/g1_uncompressed.dat');
 try{
  const {size}=await file.stat(),expected=Buffer.alloc(32);await file.read(expected,0,32,16);
  const response=await fetch('http://localhost:8797/crs/g1_uncompressed.dat',{headers:{Range:'bytes=16-47'}});
  assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),`bytes 16-47/${size}`);assert.equal(response.headers.get('content-length'),'32');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),expected);
  const invalid=await fetch('http://localhost:8797/crs/g1_uncompressed.dat',{headers:{Range:`bytes=${size}-`}});assert.equal(invalid.status,416);assert.equal(invalid.headers.get('content-range'),`bytes */${size}`);await invalid.text();
 }finally{await file.close();await web.close();}
});
