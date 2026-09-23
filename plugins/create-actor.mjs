import fs from 'node:fs/promises';
import {Fr} from '@aztec/foundation/curves/bn254';
import {GrumpkinScalar} from '@aztec/foundation/curves/grumpkin';
import {getSchnorrInitializerlessAccountContractAddress} from '@aztec/accounts/schnorr';
import {Barretenberg,BarretenbergSync} from '@aztec/bb.js';
const [file]=process.argv.slice(2);
if(!file)throw Error('Provide a new private actor JSON path');
try{
 const secret=Fr.random(),salt=Fr.random(),signingKey=GrumpkinScalar.random();
 const address=await getSchnorrInitializerlessAccountContractAddress(signingKey,salt,secret);
 await fs.writeFile(file,JSON.stringify({address:String(address),secret:String(secret),salt:String(salt),signingKey:String(signingKey)},null,2)+'\n',{flag:'wx',mode:0o600});
 console.log('Created actor '+address+'; fund its public Fee Juice balance before use.');
}finally{await Barretenberg.destroySingleton();BarretenbergSync.destroySingleton();}
