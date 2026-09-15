// Standard CLI assembly. Configuration contains only public service/policy values, never secrets.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Fr } from '@aztec/foundation/curves/bn254';
import { createSponsorTransport } from '../shared/sponsor-transport.mjs';
import { createLocalSponsorCouponProvider } from '../shared/local-sponsor-provider.mjs';
import { createSqliteSponsorCouponStore } from './coupon-store.mjs';
export class CliSponsorConfigurationError extends Error {constructor(){super('CLI_SPONSOR_CONFIGURATION_UNAVAILABLE');this.code='CLI_SPONSOR_CONFIGURATION_UNAVAILABLE';}}
const need=ok=>{if(!ok)throw new CliSponsorConfigurationError();};
function exact(x,keys){need(x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k)));}
function scalar(x){need(typeof x==='string'&&/^0x[0-9a-f]{64}$/.test(x));const f=Fr.fromString(x);need(!f.isZero()&&f.toString()===x);return x;}
function uint(x,bits){if(typeof x==='number'){need(Number.isSafeInteger(x));x=String(x);}need(typeof x==='string'&&/^(0|[1-9][0-9]*)$/.test(x)&&x.length<=39&&BigInt(x)<(1n<<BigInt(bits)));return BigInt(x);}
export function validateCliSponsorFlags(args){
  try{need(args&&typeof args==='object');const configured=Object.hasOwn(args,'sponsor-config'),custom=Object.hasOwn(args,'sponsor-provider');need(!(configured&&custom));for(const key of ['sponsor-config','sponsor-provider'])if(Object.hasOwn(args,key))need(typeof args[key]==='string'&&args[key].length>0&&args[key].length<=4096&&!args[key].includes('\0'));}
  catch{throw new CliSponsorConfigurationError();}
}
export function readCliSponsorConfig(configPath){
  let fd;
  try {
    need(typeof configPath==='string'&&configPath.length>0&&configPath.length<=4096&&!configPath.includes('\0'));
    fd=fs.openSync(path.resolve(configPath),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    const stat=fs.fstatSync(fd);need(stat.isFile()&&stat.nlink===1&&stat.size>0&&stat.size<=16384);
    const bytes=Buffer.alloc(16385);let total=0;while(total<bytes.length){const n=fs.readSync(fd,bytes,total,bytes.length-total,null);if(!n)break;total+=n;}need(total<=16384);
    const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,total)));
    exact(raw,['issuerUrl','sponsorAddress','windowDuration','gasSettings']);
    const sponsorAddress=scalar(raw.sponsorAddress),duration=uint(raw.windowDuration,64);need(duration>0n&&duration<=86400n);
    createSponsorTransport({url:raw.issuerUrl}); // URL validation only; standard CLI configuration requires HTTPS.
    const groups={gasLimits:['daGas','l2Gas'],teardownGasLimits:['daGas','l2Gas'],maxFeesPerGas:['feePerDaGas','feePerL2Gas'],maxPriorityFeesPerGas:['feePerDaGas','feePerL2Gas']};
    exact(raw.gasSettings,Object.keys(groups));const gasSettings={};
    for(const [group,fields] of Object.entries(groups)){exact(raw.gasSettings[group],fields);const isGas=group.endsWith('GasLimits')||group==='gasLimits';gasSettings[group]=Object.freeze(Object.fromEntries(fields.map(name=>{const value=uint(raw.gasSettings[group][name],isGas?32:128);return [name,isGas?Number(value):String(value)];})));}
    need(gasSettings.gasLimits.daGas>0&&gasSettings.gasLimits.l2Gas>0&&gasSettings.teardownGasLimits.daGas<=gasSettings.gasLimits.daGas&&gasSettings.teardownGasLimits.l2Gas<=gasSettings.gasLimits.l2Gas);
    for(const name of groups.maxFeesPerGas)need(BigInt(gasSettings.maxFeesPerGas[name])>0n&&BigInt(gasSettings.maxPriorityFeesPerGas[name])<=BigInt(gasSettings.maxFeesPerGas[name]));
    return Object.freeze({issuerUrl:raw.issuerUrl,sponsorAddress,windowDuration:String(duration),gasSettings:Object.freeze(gasSettings)});
  }catch{throw new CliSponsorConfigurationError();}finally{if(fd!==undefined)fs.closeSync(fd);}
}
export async function createCliSponsorship({configPath,walletPath,walletSecret}={}){
  let provider;
  try {
    const config=readCliSponsorConfig(configPath),secret=scalar(walletSecret);
    need(typeof walletPath==='string'&&walletPath.length>0&&walletPath.length<=4096);
    const resolved=path.resolve(walletPath),walletStat=fs.lstatSync(resolved);need(walletStat.isFile()&&!walletStat.isSymbolicLink());
    const directory=path.join(fs.realpathSync(path.dirname(resolved)),'sponsor-coupons-v1');
    const name=createHash('sha256').update(JSON.stringify(['AZTEC_BB_CLI_COUPON_NAMESPACE_V1',config.sponsorAddress,secret])).digest('hex')+'.sqlite';
    provider=await createLocalSponsorCouponProvider({walletSecret:secret,sponsorAddress:config.sponsorAddress,windowDuration:config.windowDuration,issuerUrl:config.issuerUrl,
      createStore:({encryptionKey})=>createSqliteSponsorCouponStore({dbPath:path.join(directory,name),encryptionKey})});
    return Object.freeze({sponsorship:Object.freeze({sponsorAddress:config.sponsorAddress,gasSettings:config.gasSettings,couponProvider:provider}),close:()=>provider.close()});
  }catch{try{await provider?.close();}catch{}throw new CliSponsorConfigurationError();}
}
