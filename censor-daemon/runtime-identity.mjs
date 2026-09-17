import {createHash} from 'node:crypto';
const digest=value=>typeof value==='string'&&/^sha256:[a-f0-9]{64}$/.test(value);
// Manifest bytes are supplied offline. Docker verifies pulled content; bind the
// selected platform manifest's config digest to the local and running image IDs.
export function verifyRuntimeImage({imageReference,manifestBytes,image,container}){
 if(!Buffer.isBuffer(manifestBytes)||manifestBytes.length>1024*1024)throw Error('Bounded platform manifest required');
 const manifestDigest='sha256:'+createHash('sha256').update(manifestBytes).digest('hex');
 if(typeof imageReference!=='string'||!imageReference.endsWith('@'+manifestDigest))throw Error('Platform manifest does not match pinned image');
 const manifest=JSON.parse(manifestBytes);
 if(manifest.schemaVersion!==2||!['application/vnd.oci.image.manifest.v1+json','application/vnd.docker.distribution.manifest.v2+json'].includes(manifest.mediaType)||!digest(manifest.config?.digest)||!Array.isArray(manifest.layers)||!manifest.layers.length||!manifest.layers.every(l=>digest(l.digest)))throw Error('A resolved platform image manifest is required');
 const localBound=image?.Id===manifest.config.digest||(image?.Id===manifestDigest&&image?.Descriptor?.digest===manifestDigest&&image?.Descriptor?.mediaType===manifest.mediaType);
 if(!localBound||container?.Image!==image.Id||container?.Config?.Image!==imageReference||image.Os!=='linux'||!['arm64','amd64','s390x'].includes(image.Architecture))throw Error('Running image differs from pinned platform configuration');
 return Object.freeze({manifestDigest,configDigest:manifest.config.digest,localImageId:image.Id,os:image.Os,architecture:image.Architecture,variant:image.Variant??null});
}
