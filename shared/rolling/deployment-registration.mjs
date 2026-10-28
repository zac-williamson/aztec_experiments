// Public release metadata, not an account balance or current chain admission.
// Its bytes are authenticated by the same wallet asset manifest as the artifacts.
const invalid=()=>Object.assign(Error('Rolling registration metadata is invalid.'),{code:'ROLLING_DEPLOYMENT_INVALID'});
const check=value=>{if(!value)throw invalid();};
const keys=(value,names)=>check(value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).sort().join()===names.sort().join());
const hex=(value,bytes,zero=false)=>check(typeof value==='string'&&new RegExp('^0x[0-9a-f]{'+bytes*2+'}$').test(value)&&(zero||BigInt(value)>0n));
const digest=value=>check(typeof value==='string'&&/^[0-9a-f]{64}$/.test(value));
export function validateRollingRegistration(value,{config,artifactHashes,proofsEnabled}={}){
 keys(value,['schemaVersion','purpose','config','proofsEnabled','artifactHashes','instances','economics','configHash','publication']);
 check(value.schemaVersion===1&&value.purpose==='testnet-registration');
 check(['11155111','31337'].includes(value.config?.network?.chainId));
 check(typeof value.proofsEnabled==='boolean'&&(value.proofsEnabled||value.config.network.chainId==='31337'));
 if(config!==undefined){
  const registered=structuredClone(value.config),runtime=structuredClone(config);
  // The relay signs Ethereum transactions for this serving environment; it is
  // not a deployed contract or a member of the aggregate contract scope. Its
  // terms remain bound to the runtime address by aggregate-wallet. A different
  // stage signer must not relax any other registration identity check.
  if(registered.aggregateFunding?.usdcRelayAddress!==undefined||runtime.aggregateFunding?.usdcRelayAddress!==undefined){
   hex(registered.aggregateFunding?.usdcRelayAddress,20);hex(runtime.aggregateFunding?.usdcRelayAddress,20);
   registered.aggregateFunding.usdcRelayAddress=runtime.aggregateFunding.usdcRelayAddress;
  }
  check(JSON.stringify(registered)===JSON.stringify(runtime));
 }
 if(proofsEnabled!==undefined)check(value.proofsEnabled===proofsEnabled);
 keys(value.artifactHashes,['board','privateFee']);for(const name of ['board','privateFee']){digest(value.artifactHashes[name]);if(artifactHashes)check(value.artifactHashes[name]===artifactHashes[name]);}
 keys(value.instances,['board','privateFee']);
 for(const name of ['board','privateFee']){
  const record=value.instances[name];keys(record,['address','classId','bytes']);hex(record.address,32);hex(record.classId,32);
  check(record.address===value.config[name]?.contractAddress);
  check(typeof record.bytes==='string'&&/^(?:[0-9a-f]{2}){1,1024}$/.test(record.bytes));
 }
 keys(value.economics,['minDeposit','maxDeposit','baseCooldown','kMultiplier','censorWindow','maxSaveUp']);
 for(const number of Object.values(value.economics))check(typeof number==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(number));
 check(BigInt(value.economics.minDeposit)>0n&&BigInt(value.economics.maxDeposit)>=BigInt(value.economics.minDeposit));hex(value.configHash,32,true);
 keys(value.publication,['ethereum','aztec']);
 for(const anchor of Object.values(value.publication)){keys(anchor,['number','hash']);check(Number.isSafeInteger(anchor.number)&&anchor.number>=0);hex(anchor.hash,32);}
 return value;
}
export function encodeRollingRegistration({sdk,config,artifactHashes,proofsEnabled,deployment}){
 const instances=Object.fromEntries(['board','privateFee'].map(name=>{
  const {address,instance}=deployment[name];
  return [name,{address:address.toString(),classId:instance.originalContractClassId.toString(),bytes:new sdk.SerializableContractInstance(instance).toBuffer().toString('hex')}];
 }));
 return validateRollingRegistration({schemaVersion:1,purpose:'testnet-registration',config:structuredClone(config),proofsEnabled,artifactHashes:{...artifactHashes},instances,
  economics:{...deployment.economics},configHash:deployment.configHash,publication:{ethereum:{...deployment.ethereumCheckpoint},aztec:{...deployment.checkpoint}}},{config,artifactHashes,proofsEnabled});
}
export async function decodeRollingRegistration(sdk,value,{config,artifactHashes,proofsEnabled,boardArtifact,privateFeeArtifact}){
 validateRollingRegistration(value,{config,artifactHashes,proofsEnabled});
 const settled=await Promise.allSettled(['board','privateFee'].map(async name=>{
  const record=value.instances[name],instance=sdk.SerializableContractInstance.fromBuffer(globalThis.Buffer.from(record.bytes,'hex'));
  check(instance.toBuffer().toString('hex')===record.bytes);
  check(instance.originalContractClassId.toString()===record.classId&&instance.currentContractClassId.toString()===record.classId);
  const address=await sdk.computeContractAddressFromInstance(instance);check(address.toString()===record.address);
  if(name==='privateFee')check(instance.salt.isZero()&&instance.deployer.isZero());
  return {address,instance:instance.withAddress(address),artifact:name==='board'?boardArtifact:privateFeeArtifact};
 }));
 const failure=settled.find(value=>value.status==='rejected');if(failure)throw failure.reason;
 const instances=settled.map(value=>value.value);
 return {board:instances[0],privateFee:{...instances[1],gasSettings:config.privateFee.gasSettings},
  network:{chainId:config.network.chainId,version:config.network.rollupVersion,rollup:config.network.rollupAddress},portal:config.board.portalAddress,
  proofsEnabled,economics:{...value.economics},configHash:value.configHash,checkpoint:{...value.publication.aztec},ethereumCheckpoint:{...value.publication.ethereum}};
}
