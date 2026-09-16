import {createHash} from 'node:crypto';
const word=value=>{if(typeof value!=='string'||!/^0x[0-9a-f]{64}$/.test(value))throw Error('Model identity requires full SHA-256 words.');return Buffer.from(value.slice(2),'hex');};
export const sha256Bytes=bytes=>'0x'+createHash('sha256').update(bytes).digest('hex');
// Exactly six32-byte words. Configuration/template bytes are never normalized.
export function modelVersionTranscript({imageDigest,weightsDigest,configurationDigest,promptDigest}){
 const domain=Buffer.alloc(32);domain.write('AZTEC_BB_MODEL_V1','ascii');
 const schema=Buffer.alloc(32);schema[31]=1;
 return Buffer.concat([domain,schema,...[imageDigest,weightsDigest,configurationDigest,promptDigest].map(word)]);
}
export function modelVersion(identity){return sha256Bytes(modelVersionTranscript(identity));}
export function identifyModel({imageDigest,weightsDigest,configurationBytes,promptBytes}){
 const identity={imageDigest,weightsDigest,configurationDigest:sha256Bytes(configurationBytes),promptDigest:sha256Bytes(promptBytes)};
 return Object.freeze({...identity,modelVersion:modelVersion(identity)});
}
