import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {identifyModel,modelVersionTranscript,modelVersion} from './model-version.mjs';
const identity={imageDigest:'0x'+'11'.repeat(32),weightsDigest:'0x'+'22'.repeat(32),configurationDigest:'0x'+'33'.repeat(32),promptDigest:'0x'+'44'.repeat(32)};
test('model identity is the exact six-word transcript, without Field truncation',()=>{const transcript=modelVersionTranscript(identity);assert.equal(transcript.length,192);assert.equal(transcript.toString('hex'),'415a5445435f42425f4d4f44454c5f5631'+'00'.repeat(15)+'00'.repeat(31)+'01'+'11'.repeat(32)+'22'.repeat(32)+'33'.repeat(32)+'44'.repeat(32));assert.equal(modelVersion(identity),'0x572b141822ea558b6ed141b9a8654d834569a151bf877bbdd8e64d7f61321fb2');});
test('configuration whitespace and exact prompt bytes change model version',()=>{const base={imageDigest:identity.imageDigest,weightsDigest:identity.weightsDigest,configurationBytes:Buffer.from('{"seed":1}'),promptBytes:Buffer.from('Prompt\n')},a=identifyModel(base);assert.notEqual(a.modelVersion,identifyModel({...base,configurationBytes:Buffer.from('{ "seed":1}')}).modelVersion);assert.notEqual(a.modelVersion,identifyModel({...base,promptBytes:Buffer.from('Prompt')}).modelVersion);});
test('labels, shortened hashes, mutable tags and oversized digests are rejected',()=>{for(const value of ['latest','image:v1','sha256:'+'11'.repeat(32),'0x1','0x'+'11'.repeat(33)])assert.throws(()=>modelVersion({...identity,imageDigest:value}));});
