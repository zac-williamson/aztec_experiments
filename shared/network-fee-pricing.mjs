// Gas/work limits describe the application. Prices come from the network.
// Returned values are fresh plain data; deployment configuration is never mutated.
const fail=code=>Object.assign(Error(code),{code});
function uint(value,bits=128){
 if(value?.toBigInt)value=value.toBigInt();
 if(typeof value==='number'){if(!Number.isSafeInteger(value))throw fail('PRIVATE_FEE_INVALID_GAS');value=String(value);}
 if(typeof value==='string'){if(!/^(0|[1-9][0-9]*)$/.test(value)||value.length>39)throw fail('PRIVATE_FEE_INVALID_GAS');value=BigInt(value);}
 if(typeof value!=='bigint'||value<0n||value>=1n<<BigInt(bits))throw fail('PRIVATE_FEE_INVALID_GAS');
 return value;
}
export function serializePrivateFeeGasSettings(settings){
 const result={};
 for(const [group,keys,bits]of [['gasLimits',['daGas','l2Gas'],32],['teardownGasLimits',['daGas','l2Gas'],32],['maxFeesPerGas',['feePerDaGas','feePerL2Gas'],128],['maxPriorityFeesPerGas',['feePerDaGas','feePerL2Gas'],128]])
  result[group]=Object.fromEntries(keys.map(key=>[key,uint(settings?.[group]?.[key],bits).toString()]));
 return result;
}
export function pricePrivateFeeGasSettings(settings,minimum,{maximumFee,buffer=true}={}){
 const limits={daGas:uint(settings?.gasLimits?.daGas,32),l2Gas:uint(settings?.gasLimits?.l2Gas,32)};
 const teardown={daGas:uint(settings?.teardownGasLimits?.daGas,32),l2Gas:uint(settings?.teardownGasLimits?.l2Gas,32)};
 if(limits.daGas===0n||limits.l2Gas===0n||teardown.l2Gas===0n||teardown.daGas>limits.daGas||teardown.l2Gas>limits.l2Gas)throw fail('PRIVATE_FEE_INVALID_GAS');
 const priority={},floor={},prices={};
 for(const key of ['feePerDaGas','feePerL2Gas']){
  const base=uint(minimum?.[key]);priority[key]=uint(settings?.maxPriorityFeesPerGas?.[key]);
  floor[key]=uint(base+priority[key]);prices[key]=uint(base*(buffer?2n:1n)+priority[key]);
 }
 const total=p=>limits.daGas*p.feePerDaGas+limits.l2Gas*p.feePerL2Gas;
 const cap=maximumFee===undefined?undefined:uint(maximumFee);
 // An existing approval is an upper bound, not permission to increase spending.
 // If its remaining headroom cannot fit a fresh buffer, use today's fee floor.
 if(cap!==undefined&&total(prices)>cap){
  if(total(floor)>cap)throw fail('ROLLING_FEE_CHANGED');
  Object.assign(prices,floor);
 }
 const amount=uint(total(prices));if(amount===0n)throw fail('PRIVATE_FEE_INVALID_GAS');
 const strings=value=>Object.fromEntries(Object.entries(value).map(([k,v])=>[k,v.toString()]));
 return {gasSettings:{gasLimits:strings(limits),teardownGasLimits:strings(teardown),maxFeesPerGas:strings(prices),maxPriorityFeesPerGas:strings(priority)},maximumFee:amount};
}
