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
    let transactionJournal;
    if(['claim','recover-l2'].includes(config.action)) {
      if(typeof env.createTransactionJournal!=='function')throw Object.assign(new Error('Durable private fee recovery storage is required.'),{code:'BB_JOURNAL_INVALID'});
      const contracts=await node.getL1ContractAddresses();
      transactionJournal=await env.createTransactionJournal({walletSecret:config.aztecWallet.secretKey,walletSalt:salt.toString(),
        scope:{account:owner.toString().toLowerCase(),chainId:String(info.l1ChainId),version:String(info.rollupVersion),rollup:contracts.rollupAddress.toString().toLowerCase(),board:privateFeeAddress.toString().toLowerCase(),portal:contracts.feeJuicePortalAddress.toString().toLowerCase()},
        Tx:a.Tx,node,acknowledgeTx:config.acknowledgeTx,contextGuard:config.contextGuard});
      if(config.action==='recover-l2') {
        const receipt=await transactionJournal.recover(),ok=receipt.executionResult==='success';
        log(ok?'The saved private fee transaction succeeded.':'The saved private fee transaction reverted; the claim failed.',ok?'success':'warn');
        return {ok,receipt,lastL2TxHash:receipt.txHash.toString(),state:ok?'transaction_recovered':'transaction_reverted'};
      }
      await transactionJournal.assertCanStart();
    }
    if(config.action==='recover-eth') {
      const result=await a.recoverPrivateFeeFunding({node,owner,privateFeeAddress,privateFeeArtifact:env.privateFeeArtifact,
        walletSecret:config.aztecWallet.secretKey,walletSalt:salt.toString(),expectedChainId:String(info.l1ChainId),expectedVersion:String(info.rollupVersion),
        ethSigner:await env.getBrowserSigner(),journalStorage:env.createJournalStorage(),sender:config.fundingRecord?.sender,retry:config.retryEthereum===true,saveRecovery:config.saveRecovery,contextGuard:config.contextGuard});
      log(result.outcome==='funded'?'Private fee deposit recovered. Claim after the bridge message is available.':result.outcome==='approved'?'Token approval recovered. Continue with the deposit.':'The previous Ethereum request failed or was replaced.', ['funded','approved'].includes(result.outcome)?'success':'warn');
      return result;
    }
    if(config.action==='deposit'){
      if(typeof env.fundPrivateFees!=='function')throw new Error('Private fee funding support is unavailable.');
      const amount=env.ethers.parseUnits(config.depositAmount,18);
      const feeLimit=a.GasSettings.from(config.privateFee.gasSettings).getFeeLimit().toBigInt();
      if(feeLimit<=0n || amount<=feeLimit){const error=new Error('Deposit must exceed the configured maximum claim fee.');error.code='BB_PRIVATE_FEE_AMOUNT';throw error;}
      const record=await env.fundPrivateFees({node,owner,privateFeeAddress,privateFeeArtifact:env.privateFeeArtifact,
        walletSecret:config.aztecWallet.secretKey,walletSalt:salt.toString(),journalStorage:env.createJournalStorage(),acknowledgeEthereumTx:config.acknowledgeEthereumTx,contextGuard:config.contextGuard,expectedChainId:String(info.l1ChainId),expectedVersion:String(info.rollupVersion),
        ethSigner:await env.getBrowserSigner(),amount,saveRecovery:config.saveRecovery});
      return {ok:true,record,lastEthereumTxHash:record.txHash};
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
      const wallet=g.BillboardPrivateFeeRouting.createAztecWallet(a,pxe,node,node,log,secretKey,{preProveHook:config.preProveHook,contextGuard:config.contextGuard,transactionJournal});
      wallet._accountManager=await a.AccountManager.create(wallet,secretKey,accountContract,{salt});
      const constructorArtifact=accountArtifact.functions.find(f=>f.name==='constructor');
      if(constructorArtifact){const signingPublicKey=await accountContract.getSigningPublicKey();await new a.ContractFunctionInteraction(wallet,owner,constructorArtifact,[signingPublicKey.x,signingPublicKey.y]).simulate({from:owner});}
      const prepared=await a.preparePrivateFeePayment({wallet,node,owner,privateFeeAddress,privateFeeArtifact:env.privateFeeArtifact,
        expectedChainId:String(info.l1ChainId),expectedVersion:String(info.rollupVersion),gasSettings:config.privateFee.gasSettings,claim});
      const result=await new a.BatchCall(wallet,[]).send({from:owner,fee:{paymentMethod:prepared.paymentMethod,gasSettings:prepared.gasSettings}});
      log('Your private fee balance is ready for board transactions.','success');
      return {ok:true,receipt:result.receipt,lastL2TxHash:transactionJournal.lastTxHash};
    }catch(error){
      const code=['BB_SUBMISSION_UNKNOWN','BB_TRANSACTION_FAILED','BB_STATE_CONFLICT','BB_RECOVERY_REQUIRED','BB_JOURNAL_INVALID'].includes(error?.code)?error.code:'BB_PRIVATE_FEE_CLAIM_FAILED';
      const safe=new Error(code==='BB_SUBMISSION_UNKNOWN'?'Submission outcome is unknown. Check the transaction before retrying.':'Private fee claim did not complete. Keep the recovery file and check the deposit before retrying.');safe.code=code;throw safe;
    }finally{if(pxe)await pxe.stop().catch(()=>{});}
  };
})();
