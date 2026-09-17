import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyRuntimeImage} from './runtime-identity.mjs';
import {hashModel,startModelRuntime} from './model-runtime.mjs';
const config='sha256:'+'11'.repeat(32),layer='sha256:'+'22'.repeat(32);
function fixture(){const manifestBytes=Buffer.from(JSON.stringify({schemaVersion:2,mediaType:'application/vnd.oci.image.manifest.v1+json',config:{digest:config},layers:[{digest:layer}]}));const imageReference='registry.test/model@sha256:'+createHash('sha256').update(manifestBytes).digest('hex');return {manifestBytes,imageReference,image:{Id:config,Os:'linux',Architecture:'arm64'},container:{Image:config,Config:{Image:imageReference}}};}
test('resolved platform manifest binds configured and running image config',()=>{const x=fixture(),r=verifyRuntimeImage(x);assert.equal(r.configDigest,config);assert.equal(r.architecture,'arm64');assert.equal(r.manifestDigest,x.imageReference.split('@')[1]);});
test('different manifest bytes, local config, running config or requested image rejected',()=>{for(const edit of [x=>x.manifestBytes=Buffer.concat([x.manifestBytes,Buffer.from(' ')]),x=>x.image.Id=layer,x=>x.container.Image=layer,x=>x.container.Config.Image='other',x=>x.image.Os='windows']){const x=fixture();edit(x);assert.throws(()=>verifyRuntimeImage(x));}});
test('multi-platform index cannot impersonate platform manifest',()=>{const x=fixture();x.manifestBytes=Buffer.from(JSON.stringify({schemaVersion:2,mediaType:'application/vnd.oci.image.index.v1+json',manifests:[]}));x.imageReference='registry.test/model@sha256:'+createHash('sha256').update(x.manifestBytes).digest('hex');assert.throws(()=>verifyRuntimeImage(x),/resolved platform/);});
test('startup requires explicit offline platform manifest',async()=>{await assert.rejects(startModelRuntime({}),/platform model image manifest/);});
test('model hashing respects an already aborted budget',async()=>{await assert.rejects(hashModel(new URL('./prompt-template.json',import.meta.url),AbortSignal.abort()),{name:'AbortError'});});

test('containerd manifest-addressed image requires the matching platform descriptor',()=>{const x=fixture(),id=x.imageReference.split('@')[1];x.image.Id=id;x.image.Descriptor={digest:id,mediaType:'application/vnd.oci.image.manifest.v1+json'};x.container.Image=id;assert.equal(verifyRuntimeImage(x).configDigest,config);x.image.Descriptor.digest=layer;assert.throws(()=>verifyRuntimeImage(x));});
