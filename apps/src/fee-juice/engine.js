// User-funded private fee balance. No issuer, swap service, or public author balance.
;(function () {
  const g = globalThis;
  g.runFeeJuiceFlow = async function (env, config) {
    const {aztec:a,log} = env;
    if (!config.aztecWallet?.secretKey || !config.privateFee?.contractAddress || !env.privateFeeArtifact) {
      throw new Error('Load your wallet and the private fee deployment configuration.');
    }
    const secretKey = a.Fr.fromHexString(config.aztecWallet.secretKey);
    const accountContract = new a.SchnorrInitializerlessAccountContract(a.deriveSigningKey(secretKey));
    const keys = await a.deriveKeys(secretKey);
    const salt = typeof config.aztecWallet.salt === 'string' ? a.Fr.fromHexString(config.aztecWallet.salt) : new a.Fr(config.aztecWallet.salt || 0);
    const accountArtifact = await accountContract.getContractArtifact();
    const instance = await a.getContractInstanceFromInstantiationParams(accountArtifact, {
      constructorArtifact:undefined,constructorArgs:undefined,salt,publicKeys:keys.publicKeys,
      immutablesHash:await accountContract.getImmutablesHash(),
    });
    const owner=instance.address,node=a.createAztecNodeClient(config.aztecNodeUrl),info=await node.getNodeInfo();
    const privateFeeAddress=await a.derivePrivateFeeAddress(env.privateFeeArtifact);
    if(privateFeeAddress.toString()!==config.privateFee.contractAddress)throw new Error('Private fee deployment configuration does not match the bundled contract.');
    if(config.action==='status')return {ok:true,address:owner.toString(),feePayer:privateFeeAddress.toString()};
    if(config.action==='deposit'){
      if(typeof env.fundPrivateFees!=='function')throw new Error('Private fee funding support is unavailable.');
      const amount=env.ethers.parseUnits(config.depositAmount,18);
      const feeLimit=a.GasSettings.from(config.privateFee.gasSettings).getFeeLimit().toBigInt();
      if(feeLimit<=0n || amount<=feeLimit){const error=new Error('Deposit must exceed the configured maximum claim fee.');error.code='BB_PRIVATE_FEE_AMOUNT';throw error;}
      const record=await env.fundPrivateFees({node,owner,privateFeeAddress,privateFeeArtifact:env.privateFeeArtifact,
        walletSecret:config.aztecWallet.secretKey,expectedChainId:String(info.l1ChainId),expectedVersion:String(info.rollupVersion),
        ethSigner:await env.getBrowserSigner(),amount,saveRecovery:config.saveRecovery});
      return {ok:true,record};
    }
    if(config.action!=='claim'||!config.fundingRecord)throw new Error('Import the recovery file for your private fee deposit.');
    const ethSigner=await env.getBrowserSigner();
    const claim=await a.recoverPrivateFeeClaim({node,ethProvider:ethSigner.provider,owner,walletSecret:config.aztecWallet.secretKey,
      privateFeeArtifact:env.privateFeeArtifact,record:config.fundingRecord,expectedChainId:String(info.l1ChainId),expectedVersion:String(info.rollupVersion)});
    let pxe;
    try{
      await env.initCRS();
      const contracts=await node.getL1ContractAddresses();
      const dataDirectory='pxe_private_fee_'+owner.toString()+'_'+contracts.rollupAddress;
      const store=await env.createStore({...contracts,l1ChainId:info.l1ChainId,accountAddress:owner.toString(),dataDirectory});
      pxe=await a.createPXE(node,{proverEnabled:true,autoSync:true,dataDirectory},{store});
      await pxe.registerAccount(keys,await a.computePartialAddress(instance));
      await pxe.registerContractClass(a.SchnorrInitializerlessAccountContractArtifact);
      await pxe.registerContract(instance);
      await pxe.sync();
      const wallet=g.BillboardPrivateFeeRouting.createAztecWallet(a,pxe,node,node,log,secretKey,{preProveHook:config.preProveHook,contextGuard:config.contextGuard});
      wallet._accountManager=await a.AccountManager.create(wallet,secretKey,accountContract,{salt});
      const constructorArtifact=accountArtifact.functions.find(f=>f.name==='constructor');
      if(constructorArtifact){const signingPublicKey=await accountContract.getSigningPublicKey();await new a.ContractFunctionInteraction(wallet,owner,constructorArtifact,[signingPublicKey.x,signingPublicKey.y]).simulate({from:owner});}
      const prepared=await a.preparePrivateFeePayment({wallet,node,owner,privateFeeAddress,privateFeeArtifact:env.privateFeeArtifact,
        expectedChainId:String(info.l1ChainId),expectedVersion:String(info.rollupVersion),gasSettings:config.privateFee.gasSettings,claim});
      const result=await new a.BatchCall(wallet,[]).send({from:owner,fee:{paymentMethod:prepared.paymentMethod,gasSettings:prepared.gasSettings}});
      log('Your private fee balance is ready for board transactions.','success');
      return {ok:true,receipt:result.receipt};
    }catch(error){
      const code=['BB_SUBMISSION_UNKNOWN','BB_TRANSACTION_FAILED','BB_STATE_CONFLICT'].includes(error?.code)?error.code:'BB_PRIVATE_FEE_CLAIM_FAILED';
      const safe=new Error(code==='BB_SUBMISSION_UNKNOWN'?'Submission outcome is unknown. Check the transaction before retrying.':'Private fee claim did not complete. Keep the recovery file and check the deposit before retrying.');safe.code=code;throw safe;
    }finally{if(pxe)await pxe.stop().catch(()=>{});}
  };
})();
