(function(root){
  'use strict';
  const ABI=['function MIN_DEPOSIT() view returns (uint256)','function MAX_DEPOSIT() view returns (uint256)','function L2_CONTRACT() view returns (bytes32)','function ROLLUP() view returns (address)','function INBOX() view returns (address)','function OUTBOX() view returns (address)','function VERSION() view returns (uint256)','function L1_CHAIN_ID() view returns (uint256)','function CONFIG_HASH() view returns (bytes32)'];
  const names=['MIN_DEPOSIT','MAX_DEPOSIT','L2_CONTRACT','ROLLUP','INBOX','OUTBOX','VERSION','L1_CHAIN_ID','CONFIG_HASH'];
  function failure(){return Object.assign(new Error('The configured portal, network or private fee contract could not be verified. Check the public board configuration before making a payment.'),{code:'BB_CONNECTION_VERIFICATION_FAILED'});}
  async function verify({sdk,ethers,config,privateFeeArtifact,verifyFee=true}={}){
    let provider;const deadline=Date.now()+20000;
    try{
      const selected=root.BillboardConfig.validate(config);
      if(typeof verifyFee!=='boolean')throw Error();
      const read=fn=>sdk.boundedTransactionRead(fn,deadline-Date.now());
      if(verifyFee){
        if(!selected.privateFee||!privateFeeArtifact)throw Error();
        const address=await read(()=>sdk.derivePrivateFeeAddress(privateFeeArtifact));
        if(address.toString()!==selected.privateFee.contractAddress)throw Error();
      }
      provider=new ethers.JsonRpcProvider(selected.network.ethRpcUrl);
      const node=sdk.createAztecNodeClient(selected.network.nodeUrl);
      const portal=new ethers.Contract(selected.board.portalAddress,ABI,provider);
      const [network,info,contracts,code,values]=await read(()=>Promise.all([
        provider.getNetwork(),node.getNodeInfo(),node.getL1ContractAddresses(),provider.getCode(selected.board.portalAddress),
        Promise.all(names.map(name=>portal[name]()))
      ]));
      const immutable=Object.fromEntries(names.map((name,index)=>[name,values[index]]));
      const same=(a,b)=>BigInt(a.toString())===BigInt(b);
      if(!same(network.chainId,selected.network.chainId)||!same(info.l1ChainId,selected.network.chainId)||!same(info.rollupVersion,selected.network.rollupVersion)||
         !same(contracts.rollupAddress,selected.network.rollupAddress)||!same(immutable.L2_CONTRACT,selected.board.contractAddress)||
         !same(immutable.ROLLUP,selected.network.rollupAddress)||!same(immutable.VERSION,selected.network.rollupVersion)||!same(immutable.L1_CHAIN_ID,selected.network.chainId)||
         !same(immutable.INBOX,contracts.inboxAddress.toString())||!same(immutable.OUTBOX,contracts.outboxAddress.toString()))throw Error();
      if(sdk.verifyPortalRuntime(code,sdk.portalRuntimeMetadata,immutable)!==true)throw Error();
      return Object.freeze({verified:true,privateFeeVerified:verifyFee,portalRuntimeVerified:true,scope:'Bundled portal runtime and configured public identities matched RPC responses; this is not independent cryptographic network verification.'});
    }catch{throw failure();}
    finally{try{provider?.destroy();}catch{}}
  }
  root.BillboardConnectionCheck=Object.freeze({verify});
})(globalThis);
