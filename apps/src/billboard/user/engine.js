// ============================================================
// engine.js -- Billboard User Engine (Deposit -> Post -> Withdraw)
// ============================================================
// Fully abstracted from the interface. Takes an `env` object
// (providing aztec SDK, ethers, logging, CRS init, store
// creation, ETH signer) and a `config` object. Runs any single
// action or the full autonomous flow:
//
//   deposit   -> make a new ETH deposit into the L1 portal
//   claim     -> claim the deposit on L2 (consume L1->L2 msg)
//   post      -> post an anonymous message to the billboard
//   list      -> list all posts on the billboard
//   withdraw  -> withdraw on L2 (send L2->L1 message)
//   claim-l1  -> claim ETH on L1 (consume Outbox message)
//   status    -> auto-resolve current state and print it
//   auto      -> deposit -> claim -> post (if msg) -> withdraw -> claim-l1
//
// Works in: browser (bundle), CLI (bundle + fake-indexeddb)
//
// Defines: globalThis.runBillboardUser(env, config) -> Promise<result>
// ============================================================

;(function() {
  const g = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this);

  // ============================================================
  // Constants
  // ============================================================
  const TRANSIENT_RE = /temporary internal error|please retry|timeout|fetch|network|connection|ECONNRESET|socket/i;

  const MSG_FIELDS = 32;
  const MSG_BYTES = MSG_FIELDS * 31; // 31 bytes per field

  const PORTAL_ABI = [
    "constructor(address rollup, bytes32 l2Contract, uint256 version, uint256 minDeposit, uint256 maxDeposit, bytes32 configHash)",
    "function deposit(bytes32 secretHash) payable returns (bytes32, uint256)",
    "function withdraw(uint256 epoch, uint256 numCheckpointsInEpoch, uint256 leafIndex, bytes32[] path)",
    "function activeDeposit(address) view returns (uint64 nonce, uint128 amount)",
    "function lastDepositNonce(address) view returns (uint64)",
    "function depositsEnabled() view returns (bool)",
    "function getDeposit(address) view returns (uint64 nonce, uint128 amount)",
    "function MAX_DEPOSIT() view returns (uint256)",
    "function CONFIG_HASH() view returns (bytes32)",
    "function L1_CHAIN_ID() view returns (uint256)",
    "function MIN_DEPOSIT() view returns (uint256)",
    "function L2_CONTRACT() view returns (bytes32)",
    "function ROLLUP() view returns (address)",
    "function VERSION() view returns (uint256)",
    "function totalDeposited() view returns (uint256)",
    "event Deposited(address indexed depositor, uint64 nonce, uint128 amount, bytes32 secretHash, bytes32 key, uint256 index)",
    "event Withdrawn(address indexed depositor, uint64 nonce, uint128 amount)",
  ];

  const OUTBOX_ABI = [
    "function hasMessageBeenConsumedAtEpoch(uint256 epoch, uint256 leafId) view returns (bool)",
  ];

  const DEPOSIT_SIGNATURE = 'Deposited(address,uint64,uint128,bytes32,bytes32,uint256)';

  // ============================================================
  // Helpers
  // ============================================================
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function extractErrorMessage(err) {
    if (!err) return 'Unknown error';
    let msg = err.message || String(err);
    const patterns = [
      /Assertion failed: '([^']+)'/,
      /"message"\s*:\s*"([^"]+)"/,
      /revert: (.+)/,
      /Failed to solve.*?"([^"]{5,200})"/,
      /Error: (.+)/,
    ];
    for (const p of patterns) {
      const m = msg.match(p);
      if (m && m[1]) return m[1];
    }
    if (msg.length > 300) msg = msg.substring(0, 300) + '...';
    return msg;
  }

  function toAztec(bi, decimals = 4) {
    const factor = 10n ** BigInt(decimals);
    return (Number(bi * factor / 10n ** 18n) / Number(factor)).toFixed(decimals);
  }

  function toEther(wei) {
    return toEtherStr(wei);
  }
  function toEtherStr(wei) {
    // 18 decimals
    const factor = 10n ** 18n;
    const whole = wei / factor;
    const frac = wei % factor;
    return whole.toString() + '.' + frac.toString().padStart(18, '0').replace(/0+$/, '');
  }

  // Retry wrapper for transient errors
  async function retry(fn, label, log, maxRetries = 8) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try { return await fn(); }
      catch (err) {
        const isTransient = TRANSIENT_RE.test(err.message || '');
        if (!isTransient || attempt === maxRetries) throw err;
        const delay = 2000 * attempt;
        if (label) log('  [' + label + '] transient error (attempt ' + attempt + '/' + maxRetries + '), retrying in ' + delay/1000 + 's...', 'warn');
        await sleep(delay);
      }
    }
  }

  // Wrap a node client with retry proxy
  function wrapWithRetry(obj, label, log) {
    return new Proxy(obj, {
      get(target, prop) {
        const val = target[prop];
        if (typeof val !== 'function') return val;
        return async (...args) => {
          for (let attempt = 1; attempt <= 8; attempt++) {
            try { return await val.apply(target, args); }
            catch (err) {
              const isTransient = TRANSIENT_RE.test(err.message || '');
              if (!isTransient || attempt === 8) throw err;
              const delay = 2000 * attempt;
              if (label) log('  [' + label + '.' + String(prop) + '] transient error (attempt ' + attempt + '/8), retrying in ' + delay/1000 + 's...', 'warn');
              await sleep(delay);
            }
          }
        };
      }
    });
  }

  // A cancellation ends the operation. Never open another signing request
  // automatically or rebuild a transaction after an ambiguous submission.
  async function withUserRetry(fn, _label) { return fn(); }

  function generateSecret(a) {
    let secret;
    do { secret = a.Fr.random(); } while (secret.toBigInt() === 0n);
    return secret;
  }

  function escrowContent(a, ethers, isExit, l2Addr, portalAddr, depositor, amount, depositNonce, version, chainId) {
    if (BigInt(depositNonce) <= 0n || BigInt(depositNonce) >= (1n << 64n)) throw new Error('Invalid deposit receipt nonce');
    if (BigInt(amount) <= 0n || BigInt(amount) >= (1n << 96n)) throw new Error('Invalid deposit receipt amount');
    const domain = ethers.encodeBytes32String(isExit ? 'AZTEC_BB_EXIT_V1' : 'AZTEC_BB_CLAIM_V1');
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes32','uint256','uint256','address','bytes32','uint256','address','uint64','uint128'],
      [domain,1,BigInt(chainId),portalAddr,l2Addr.toString(),BigInt(version),depositor,BigInt(depositNonce),BigInt(amount)]);
    return a.sha256ToField([g.Buffer.from(ethers.getBytes(encoded))]);
  }

  // Find all deposit events for an address on the portal by scanning L1 logs.
  // Returns array of { amount, secretHash, key, index, txHash, depositNonce } sorted by index ascending.
  // Scans newest-to-oldest. Once deposits are found, continues scanning a few more chunks
  // for any other recent deposits, then stops (avoiding a 2+ minute scan of empty history).
  async function findAllDeposits(ethers, provider, portalAddr, l1Account, log) {
    const paddedAddr = '0x000000000000000000000000' + l1Account.toLowerCase().replace(/^0x/, '');
    log('  Searching for Deposited events from ' + l1Account + '...', 'info');
    log('  Portal: ' + portalAddr, 'info');

    const currentBlock = await provider.getBlockNumber();
    const CHUNK = 10000;
    const MAX_LOOKBACK = 200000;
    const EXTRA_AFTER_FIND = 3; // extra chunks to scan after first find
    let logs = [];
    let chunksSinceFind = 0;
    let foundAny = false;
    let scanned = 0;
    for (let end = currentBlock; end >= Math.max(0, currentBlock - MAX_LOOKBACK); end -= CHUNK) {
      const from = Math.max(0, end - CHUNK + 1);
      scanned++;
      try {
        const chunk = await provider.getLogs({
          address: portalAddr,
          topics: [ethers.id(DEPOSIT_SIGNATURE), paddedAddr],
          fromBlock: from,
          toBlock: end,
        });
        if (chunk.length > 0) {
          logs = logs.concat(chunk);
          log('  Found ' + chunk.length + ' event(s) in blocks ' + from + '-' + end, 'info');
          foundAny = true;
          chunksSinceFind = 0;
        } else if (foundAny) {
          chunksSinceFind++;
          if (chunksSinceFind >= EXTRA_AFTER_FIND) {
            log('  No more deposits in recent history. Stopping scan.', 'info');
            break;
          }
        }
      } catch (e) {
        log('  Range ' + from + '-' + end + ' could not be read', 'warn');
      }
    }
    log('  Scanned ' + scanned + ' chunk(s), total ' + logs.length + ' deposit event(s).', 'info');
    if (logs.length === 0) return [];

    const deposits = [];
    for (const logEntry of logs) {
      const parsed = new ethers.Interface(PORTAL_ABI).parseLog(logEntry);
      if (!parsed || parsed.name !== 'Deposited' || parsed.args.depositor.toLowerCase() !== l1Account.toLowerCase()) throw new Error('Invalid deposit event');
      const { amount, secretHash, key, index, nonce: depositNonce } = parsed.args;
      deposits.push({ amount, secretHash, key, index, txHash: logEntry.transactionHash, depositNonce });
    }
    deposits.sort((a, b) => Number(a.index - b.index));
    return deposits;
  }

  // Scoped V1 exit content inside the canonical L2-to-L1 envelope.
  function computeWithdrawMessageLeaf(a, ethers, l2Addr, portalAddr, l1Account, amount, depositNonce, version, chainId) {
    const sender = l2Addr;
    const recipient = a.EthAddress.fromString(portalAddr);
    const content = escrowContent(a, ethers, true, l2Addr, portalAddr, l1Account, amount, depositNonce, version, chainId);
    const versionFr = new a.Fr(BigInt(version));
    const chainIdFr = new a.Fr(BigInt(chainId));
    return a.sha256ToField([
      sender.toBuffer(),     // 32 bytes
      versionFr.toBuffer(),  // 32 bytes
      recipient.toBuffer(),  // 20 bytes
      chainIdFr.toBuffer(),  // 32 bytes
      content.toBuffer(),    // 32 bytes
    ]);
  }

  // Shared pure codec seam for cross-consumer known-answer qualification.
  g.BillboardUserCodec = Object.freeze({ escrowContent, computeWithdrawMessageLeaf });

  // A negative result is valid only after complete, canonical history coverage.
  // Cursor persistence is supplied by the transaction journal; never skip RPC gaps.
  async function findWithdrawTxHash(aztecNode, messageLeaf, fromBlock, toBlock, log, options={}) {
    const first=Math.max(1,Number(toBlock)),last=Number(fromBlock);
    if(!Number.isSafeInteger(first)||!Number.isSafeInteger(last)||first<1||last<0)throw new Error('Invalid withdrawal history range');
    if(last<first)return null;
    const fail=()=>Object.assign(new Error('Withdrawal history is incomplete. Preserve the receipt and retry recovery.'),{code:'BB_RECOVERY_UNKNOWN'});
    const timeout=options.timeoutMs??20000;
    if(!Number.isFinite(timeout)||timeout<=0||timeout>20000)throw fail();
    const deadline=Date.now()+timeout,target=messageLeaf.toBigInt();
    async function read(fn) {let timer;try {return await Promise.race([Promise.resolve().then(fn),new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail()),Math.max(0,deadline-Date.now()));})]);}catch {throw fail();}finally {clearTimeout(timer);}}
    const anchor=await read(()=>aztecNode.getBlock(last));
    if(!anchor?.hash)throw fail();
    let ranges=[[first,last]];
    const saved=options.cursorStore?await options.cursorStore.read():null;
    if(saved) {
      if(!Number.isSafeInteger(saved.anchorBlock)||saved.anchorBlock<first||typeof saved.anchorHash!=='string'||!Array.isArray(saved.ranges))throw fail();
      let prior=first-1;
      for(const range of saved.ranges) {
        if(!Array.isArray(range)||range.length!==2||!range.every(Number.isSafeInteger)||range[0]<=prior||range[1]<range[0]||range[1]>saved.anchorBlock)throw fail();
        prior=range[1];
      }
      const previousAnchor=saved.anchorBlock<=last?await read(()=>aztecNode.getBlock(saved.anchorBlock)):null;
      if(previousAnchor?.hash?.toString()===saved.anchorHash) {
        ranges=saved.ranges.map(range=>[...range]);
        if(last>saved.anchorBlock)ranges.push([saved.anchorBlock+1,last]);
      }
    }
    while(ranges.length) {
      const range=ranges[ranges.length-1],end=range[1];
      if(Date.now()>=deadline)throw fail();
      const from=Math.max(range[0],end-49),count=end-from+1;
      const blocks=await read(()=>aztecNode.getBlocks(from,count,{includeTransactions:true}));
      if(!Array.isArray(blocks)||blocks.length!==count)throw fail();
      const numbered=new Map(blocks.map(block=>[Number(block?.number),block]));
      if(numbered.size!==count)throw fail();
      for(let number=from;number<=end;number++) {
        const block=numbered.get(number);
        if(!block?.hash||!Array.isArray(block.body?.txEffects))throw fail();
        for(const effect of block.body.txEffects) {
          if(!Array.isArray(effect.l2ToL1Msgs))throw fail();
          for(let index=0;index<effect.l2ToL1Msgs.length;index++) {
            const value=effect.l2ToL1Msgs[index];
            if(!value||typeof value.toBigInt!=='function')throw fail();
            if(value.toBigInt()!==target)continue;
            if(!effect.txHash)throw fail();
            const canonical=await read(()=>aztecNode.getBlock(number));
            const receipt=await read(()=>aztecNode.getTxReceipt(effect.txHash));
            if(canonical?.hash?.toString()!==block.hash.toString() || receipt?.blockHash?.toString()!==block.hash.toString() ||
              receipt?.txHash?.toString()!==effect.txHash.toString() || Number(receipt.blockNumber)!==number || receipt.executionResult!=='success' ||
              !['checkpointed','proven','finalized'].includes(receipt.status))throw fail();
            return {txHash:effect.txHash.toString(),messageIndexInTx:index,blockNumber:number,blockHash:block.hash.toString()};
          }
        }
      }
      // Never persist skipped pages under an anchor that changed during the read.
      const checkedAnchor=await read(()=>aztecNode.getBlock(last));
      if(checkedAnchor?.hash?.toString()!==anchor.hash.toString())throw fail();
      if(from===range[0])ranges.pop();else range[1]=from-1;
      const progress={nextBlock:ranges.at(-1)?.[1]??0,anchorBlock:last,anchorHash:anchor.hash.toString(),ranges:ranges.map(range=>[...range])};
      if(options.cursorStore)await options.cursorStore.write(progress);
      if(options.onProgress)await options.onProgress(progress);
      log('  Checked withdrawal history through block '+from,'info');
    }
    const current=await read(()=>aztecNode.getBlock(last));
    if(current?.hash?.toString()!==anchor.hash.toString())throw fail();
    return null;
  }
  g.BillboardWithdrawalHistory=Object.freeze({findWithdrawTxHash});

  // ============================================================
  // Aztec Wallet (gas estimation + prove/submit split, with retry)
  // ============================================================
  function createAztecWallet(a, pxe, aztecNode, rawNode, log, secretKey, opts = {}) {
    class AztecWallet extends a.BaseWallet {
      constructor(pxe, aztecNode) {
        super(pxe, aztecNode);
        this._accountManager = null;
        this._account = null;
        this._estimatedGasPadding = 0.1;
        this._secretKey = null;
      }
      async getAccountFromAddress() {
        if (!this._account) this._account = await this._accountManager.getAccount();
        return this._account;
      }
      getAccounts() {
        return this._accountManager ? Promise.resolve([this._accountManager.address]) : Promise.resolve([]);
      }

      async sendTx(executionPayload, opts) {
        const previousJournal = this._transactionJournal ? await this._transactionJournal.assertCanStart() : null;
        const fixedGas = !!opts.fee?.gasSettings;
        const checkedGas = fixedGas ? a.GasSettings.from(opts.fee.gasSettings) : null;
        log(fixedGas ? '  Simulating with configured gas limits...' : '  Estimating gas (simulating tx)...', 'info');
        const feeOptions = await this.completeFeeOptions({
          from: opts.from,
          feePayer: executionPayload.feePayer,
          gasSettings: opts.fee?.gasSettings,
          forEstimation: !fixedGas,
        });

        const simResult = await retry(
          () => this.simulateViaEntrypoint(executionPayload, {
            from: opts.from, feeOptions, skipTxValidation: true, skipFeeEnforcement: true,
            additionalScopes: opts.additionalScopes, sendMessagesAs: opts.sendMessagesAs,
          }),
          'simulation', log, 5
        );

        const gu = simResult.gasUsed;
        const pad = 1 + this._estimatedGasPadding;
        const gasLimits = fixedGas ? opts.fee.gasSettings.gasLimits : gu.totalGas.mul(pad);
        const teardownGasLimits = fixedGas ? opts.fee.gasSettings.teardownGasLimits : gu.teardownGas.mul(pad);
        const maxFee = gasLimits.computeFee(feeOptions.gasSettings.maxFeesPerGas).toBigInt();

        log('  Estimated gas: L2=' + gasLimits.l2Gas.toLocaleString() + ' DA=' + gasLimits.daGas.toLocaleString(), 'info');
        log('  Max fee: ' + maxFee.toLocaleString() + ' Fee Juice (' + toAztec(maxFee, 4) + ' AZTEC)', 'info');

        if (this._preProveHook) {
          await this._preProveHook({ gasLimits, maxFee, feeOptions, teardownGasLimits });
        }

        const finalGasSettings = checkedGas ?? a.GasSettings.from({
          gasLimits: opts.fee?.gasSettings?.gasLimits ?? gasLimits,
          teardownGasLimits: opts.fee?.gasSettings?.teardownGasLimits ?? teardownGasLimits,
          maxFeesPerGas: feeOptions.gasSettings.maxFeesPerGas,
          maxPriorityFeesPerGas: feeOptions.gasSettings.maxPriorityFeesPerGas,
        });

        log('  Proving tx (can take minutes)...', 'info');

        const feeOpts2 = await this.completeFeeOptions({
          from: opts.from, feePayer: executionPayload.feePayer, gasSettings: finalGasSettings,
        });
        const txRequest = await this.createTxExecutionRequestFromPayloadAndFee(executionPayload, opts.from, feeOpts2);
        const provenTx = await this.pxe.proveTx(txRequest, {
          scopes: this.scopesFrom(opts.from, opts.additionalScopes),
          senderForTags: this.senderForTagsFrom(opts.from, opts.sendMessagesAs),
        });
        const tx = await provenTx.toTx();
        const txHash = tx.getTxHash();
        log('  Proving complete. Submitting to node...', 'success');

        log('  Transaction hash: ' + txHash.toString(), 'info');
        if (this._contextGuard) await this._contextGuard();
        const applicationNullifier = this._applicationNullifierBoard
          ? (await a.extractApplicationNullifier(provenTx, tx, this._applicationNullifierBoard, this._applicationNoteNullifier)).toString() : undefined;
        if (this._transactionJournal) await this._transactionJournal.prepare(tx, previousJournal, {applicationNullifier});
        if (this._contextGuard) await this._contextGuard();
        await a.submitOnceWithReconciliation(rawNode,tx);
        const waitOpts=typeof opts.wait==='object'?opts.wait:{};
        const receipt=await a.waitForSuccessfulReceipt(rawNode,tx,{
          timeoutMs:(waitOpts.timeout ?? 540)*1000,intervalMs:(waitOpts.interval ?? 5)*1000,
          now:()=>Date.now(),sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms)),
        });
        if (this._transactionJournal) this._transactionJournal.confirmed(receipt);
        log('  Tx confirmed! Block: ' + receipt.blockNumber + ', Status: ' + receipt.status, 'success');
        return { receipt };
      }
    }

    const wallet = new AztecWallet(pxe, aztecNode);
    wallet._preProveHook = opts.preProveHook || null;
    wallet._contextGuard = opts.contextGuard || null;
    wallet._transactionJournal = opts.transactionJournal || null;
    wallet._secretKey = secretKey;
    return wallet;
  }

  // ============================================================
  // CREATE2 portal address computation
  // ============================================================
  // ============================================================
  // Value extraction from simulation results
  // ============================================================
  function extractInt(simResult) {
    let val = simResult;
    if (simResult && simResult.result !== undefined) val = simResult.result;
    else if (simResult && simResult.value !== undefined) val = simResult.value;
    if (val && val.toString) val = val.toString();
    return Number(BigInt(val));
  }

  function unwrapPostValue(value) {
    if (value && value.result !== undefined) value = value.result;
    if (value && value.value !== undefined) value = value.value;
    return value;
  }

  // The current UI/list loop uses Numbers. Reject unsafe orders before conversion;
  // stable identities always remain canonical Fields, never numeric display indexes.
  function safePostOrder(value) {
    value = unwrapPostValue(value);
    if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('Unsafe post order');
    if (!['number', 'bigint', 'string'].includes(typeof value)) throw new Error('Invalid post order');
    const text = String(value);
    if (!/^(0|[1-9][0-9]*)$/.test(text)) throw new Error('Invalid post order');
    const order = BigInt(text);
    if (order > BigInt(Number.MAX_SAFE_INTEGER) || order >= (1n << 64n)) throw new Error('Unsafe post order');
    return Number(order);
  }

  function canonicalPostId(a, value, fromConfig = false) {
    value = unwrapPostValue(value);
    if (fromConfig && (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/.test(value))) {
      throw new Error('Post ID must be a canonical lowercase Field');
    }
    if (typeof value === 'number' || value === null || value === undefined || typeof value === 'boolean') {
      throw new Error('Invalid post ID');
    }
    const number = BigInt(value.toString());
    const id = new a.Fr(number);
    if (number <= 0n || id.toBigInt() !== number) throw new Error('Invalid post ID');
    const text = id.toString();
    if (!/^0x[0-9a-f]{64}$/.test(text)) throw new Error('Invalid post ID encoding');
    return text;
  }

  async function resolvePostId(a, contract, address, target) {
    let id;
    if (target.postId !== undefined && target.postId !== null) {
      id = canonicalPostId(a, target.postId, true);
    } else {
      if (target.postIndex === undefined || target.postIndex === null) throw new Error('Post ID or order required');
      const order = safePostOrder(target.postIndex);
      id = canonicalPostId(a, await contract.methods.get_post_id(BigInt(order)).simulate({ from: address }));
    }
    const exists = unwrapPostValue(await contract.methods.get_post_exists(new a.Fr(BigInt(id))).simulate({ from: address }));
    if (exists !== true) throw new Error('Unknown post ID');
    return id;
  }

  function packPostMessage(text) {
    if (typeof text !== 'string' || !text || text.includes('\0')) throw new Error('Invalid message text');
    const bytes = new TextEncoder().encode(text);
    if (new TextDecoder('utf-8', { fatal: true }).decode(bytes) !== text) throw new Error('Invalid message UTF-8');
    if (bytes.length > MSG_BYTES) throw new Error('Message too long (max ' + MSG_BYTES + ' bytes).');
    const padded = new Uint8Array(MSG_BYTES); padded.set(bytes);
    const fields = [];
    for (let i = 0; i < MSG_FIELDS; i++) {
      let value = 0n;
      for (let j = 0; j < 31; j++) value = (value << 8n) | BigInt(padded[i * 31 + j]);
      fields.push(value);
    }
    return { fields, byteLength: bytes.length };
  }

  function decodePostMessage(fields, length) {
    length = safePostOrder(length);
    if (length < 1 || length > MSG_BYTES || fields.length !== MSG_FIELDS) throw new Error('Invalid message length');
    const bytes = new Uint8Array(MSG_BYTES);
    fields.forEach((field, i) => {
      let value = BigInt(field.toString());
      if (value < 0n || value >= (1n << 248n)) throw new Error('Invalid message Field');
      for (let j = 30; j >= 0; j--) { bytes[i * 31 + j] = Number(value & 255n); value >>= 8n; }
    });
    if (bytes.slice(0, length).includes(0) || bytes.slice(length).some(byte => byte !== 0)) throw new Error('Invalid message padding');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(0, length));
  }

  function packModerationReason(text) {
    if (typeof text !== 'string' || text.includes('\0')) throw new Error('Invalid moderation reason');
    const bytes = new TextEncoder().encode(text);
    if (bytes.length > 200 || new TextDecoder('utf-8', { fatal: true }).decode(bytes) !== text) throw new Error('Moderation reason must be valid UTF-8 and at most 200 bytes');
    const padded = new Uint8Array(217); padded.set(bytes);
    const fields = Array.from({ length: 7 }, (_, i) => {
      let value = 0n;
      for (let j = 0; j < 31; j++) value = (value << 8n) | BigInt(padded[i * 31 + j]);
      return value;
    });
    return { fields, byteLength: bytes.length };
  }

  function decodeModerationReason(fields, length) {
    length = safePostOrder(length);
    if (fields.length !== 7 || length > 200) throw new Error('Invalid moderation reason length');
    const padded = [...fields, ...Array(25).fill(0n)];
    if (length === 0) {
      if (padded.some(value => BigInt(value.toString()) !== 0n)) throw new Error('Invalid moderation reason padding');
      return '';
    }
    return decodePostMessage(padded, length);
  }

  async function readPolicySnapshot(a, contract, address) {
    const snapshot = unwrapPostValue(await contract.methods.get_moderation_policy_snapshot().simulate({ from: address }));
    if (!Array.isArray(snapshot) || snapshot.length !== 3 || !Array.isArray(snapshot[0]) || snapshot[0].length !== 48) throw new Error('Invalid policy snapshot');
    const byteLength = safePostOrder(unwrapPostValue(snapshot[1]).toString());
    if (byteLength < 1 || byteLength > 1488) throw new Error('Invalid policy snapshot length');
    return { fields: snapshot[0], byteLength, version: canonicalPostId(a, snapshot[2]) };
  }

  async function moderationArguments(a, contract, address, postIdField, text, expectedPolicyVersion) {
    const packed = packModerationReason(text);
    const version = canonicalPostId(a, await contract.methods.get_post_policy_version(postIdField).simulate({ from: address }));
    if (expectedPolicyVersion !== undefined && canonicalPostId(a, expectedPolicyVersion, true) !== version) throw new Error('Post policy changed or does not match the reviewed policy');
    return [postIdField, new a.Fr(BigInt(version)), packed.fields.map(value => new a.Fr(value)), packed.byteLength];
  }
  g.BillboardModerationCodec = Object.freeze({ packModerationReason, decodeModerationReason, moderationArguments, readPolicySnapshot });

  function restoreModeratorOperation(a, encoded) {
    try {
      const value=JSON.parse(encoded);
      if(!Array.isArray(value)||value.length!==2||!Array.isArray(value[1]))throw new Error();
      const [kind,args]=value;
      const field=value=>{if(typeof value!=='string'||!/^0x[0-9a-f]{64}$/.test(value))throw new Error();const parsed=new a.Fr(BigInt(value));if(parsed.toString()!==value)throw new Error();return parsed;};
      if(kind==='transfer_censor'&&args.length===1) return {action:'transfer-censor',newCensor:field(args[0]).toString()};
      if(kind==='set_moderation_policy'&&args.length===2&&Array.isArray(args[0])&&args[0].length===48) {
        const fields=args[0].map(field),length=Number(field(args[1]).toBigInt());
        if(!Number.isSafeInteger(length)||length<1||length>1488||typeof g.unpackFieldsToString!=='function')throw new Error();
        return {action:'set-moderation-policy',moderationPolicy:g.unpackFieldsToString(fields.map(v=>v.toBigInt()),length)};
      }
      if(kind==='declare_immoral'&&args.length===4&&Array.isArray(args[2])&&args[2].length===7&&typeof args[3]==='string'&&/^(0|[1-9][0-9]*)$/.test(args[3])) {
        const postId=field(args[0]).toString(),expectedPolicyVersion=field(args[1]).toString();
        return {action:'declare-immoral',postId,expectedPolicyVersion,censorResponse:decodeModerationReason(args[2].map(field),Number(args[3]))};
      }
      throw new Error();
    } catch {throw Object.assign(new Error('Saved moderator operation is invalid. Preserve the recovery record.'),{code:'BB_JOURNAL_INVALID'});}
  }

  function parsePostOperation(a, encoded) {
    try {
      const value = JSON.parse(encoded);
      if (!value || Object.keys(value).sort().join() !== 'depositChain,kind,message,nonce,schemaVersion' ||
        value.schemaVersion !== 1 || value.kind !== 'post' || typeof value.message !== 'string') throw new Error();
      canonicalPostId(a, value.nonce, true); canonicalPostId(a, value.depositChain, true); packPostMessage(value.message);
      return value;
    } catch { throw Object.assign(new Error('Saved post intent is invalid. Preserve its recovery record.'), {code:'BB_JOURNAL_INVALID'}); }
  }

  async function withFreshPostState(attempt, refresh, maximum = 2, retryAllowed = () => true) {
    for (let i = 0; ; i++) {
      try { return await attempt(); }
      catch (error) {
        if (error?.code !== 'BB_STATE_CONFLICT' || i >= maximum || !retryAllowed(error)) throw error;
        await refresh();
      }
    }
  }

  // Dummy attempts own their bounded retry controller; the outer dispatcher never retries them.
  function postStateCanRetry(isDummy, _error) { return !isDummy; }

  function screeningFailureCanWait(error) {
    // Tagged transaction/custody outcomes must reach the caller, never an outer wait/retry loop.
    return !(typeof error?.code === 'string' && error.code.startsWith('BB_'));
  }

  function dummyStateCanRetry(error) {
    return Array.isArray(error?.stateReasons) && error.stateReasons.length > 0 && error.stateReasons.every(reason => reason === 'Block header not found');
  }

  g.BillboardPostCodec = Object.freeze({ parsePostOperation, safePostOrder, canonicalPostId, resolvePostId, packPostMessage, decodePostMessage, withFreshPostState, dummyStateCanRetry, postStateCanRetry, screeningFailureCanWait });

  function privateFeeFailure(code = 'BB_PRIVATE_FEE_UNAVAILABLE') {
    const error = new Error(code === 'BB_PRIVATE_FEE_UNAVAILABLE'
      ? 'Configure the private fee contract and fund your private fee balance before continuing.'
      : 'Private fee payment stopped. Check any submitted transaction before trying again.');
    error.code = code;
    return error;
  }

  function requirePrivateFeeConfiguration(a, config, privateFeeArtifact) {
    const route = config?.privateFee;
    if (!a?.preparePrivateFeePayment || !privateFeeArtifact || !route?.contractAddress || !route.gasSettings) {
      throw privateFeeFailure();
    }
    try { return { ...route, gasSettings: a.GasSettings.from(route.gasSettings) }; }
    catch (_) { throw privateFeeFailure(); }
  }

  function createPrivateFeeSender({ a, config, privateFeeArtifact, contract, wallet, node, owner, scope }) {
    const route = requirePrivateFeeConfiguration(a, config, privateFeeArtifact);
    // A bridge claim may bootstrap the first payment. Subsequent actions spend the private note.
    let claim = config.privateFeeClaim;
    return async function sendPrivateFeeAction(kind, args) {
      const methods = {claim: 'claim_deposit', post: 'post', withdraw: 'withdraw', set_moderation_policy:'set_moderation_policy', declare_immoral:'declare_immoral', transfer_censor:'transfer_censor'};
      const method = Object.hasOwn(methods,kind) ? methods[kind] : undefined;
      if (!method) throw privateFeeFailure('BB_PRIVATE_FEE_UNSUPPORTED_ACTION');
      let prepared;
      try {
        prepared = await a.preparePrivateFeePayment({ wallet, node, owner,
          privateFeeAddress: route.contractAddress, privateFeeArtifact,
          expectedChainId: scope.l1ChainId, expectedVersion: scope.rollupVersion,
          gasSettings: route.gasSettings, claim,
        });
        if (!prepared?.paymentMethod || !prepared.gasSettings) throw privateFeeFailure();
      } catch (_) { throw privateFeeFailure('BB_PRIVATE_FEE_PREPARATION_FAILED'); }
      try {
        const result = await contract.methods[method](...args).send({
          from: owner, fee: {paymentMethod: prepared.paymentMethod, gasSettings: prepared.gasSettings},
        });
        claim = undefined;
        return result;
      } catch (error) {
        if (['BB_SUBMISSION_UNKNOWN', 'BB_TRANSACTION_FAILED', 'BB_RECOVERY_REQUIRED', 'BB_JOURNAL_INVALID'].includes(error?.code)) throw privateFeeFailure(error.code);
        if (error?.code === 'BB_STATE_CONFLICT') {
          const allowed = ['Existing nullifier', 'Block header not found'];
          if (Array.isArray(error.stateReasons) && error.stateReasons.length > 0 && error.stateReasons.every(reason => allowed.includes(reason))) {
            const safe = privateFeeFailure('BB_STATE_CONFLICT');
            safe.stateReasons = Array.from(error.stateReasons);
            throw safe;
          }
          throw privateFeeFailure('BB_SUBMISSION_UNKNOWN');
        }
        throw privateFeeFailure('BB_PRIVATE_FEE_ACTION_FAILED');
      }
    };
  }
  g.BillboardPrivateFeeRouting = Object.freeze({ requirePrivateFeeConfiguration, createPrivateFeeSender, createAztecWallet });

  async function readScreeningHints(contract, owner, depositChainId) {
    try {
      let result = await contract.methods.get_screen_hints(owner, depositChainId).simulate({from: owner});
      if (result && result.result !== undefined) result = result.result;
      if (result && result.value !== undefined) result = result.value;
      if (!Array.isArray(result) || result.length !== 2 || result.some(hint => hint != null && (typeof hint !== 'object' || Array.isArray(hint))) || (!result[0] && result[1])) {
        throw new Error('BB_HISTORY_INVALID_RESPONSE');
      }
      return result;
    } catch (error) {
      let detail = '';
      try { detail = extractErrorMessage(error); } catch (_) {}
      const reason = /BB_HISTORY_[A-Z_]+/.exec(detail)?.[0];
      let message = 'Could not read screening history. Sync your wallet and retry.';
      if (reason?.endsWith('_AMBIGUOUS')) message = 'Conflicting screening history was found. Sync or restore your wallet history before retrying.';
      else if (reason === 'BB_HISTORY_DEPOSIT_MISSING') message = 'The selected deposit is unavailable. Sync your wallet and select an active deposit.';
      else if (reason?.endsWith('_MISSING')) message = 'Screening history is incomplete. Sync or restore your wallet history before retrying.';
      else if (reason?.includes('STALE')) message = 'Screening history is stale. Sync your wallet and retry.';
      const safe = new Error(message);
      safe.code = 'BB_SCREENING_HISTORY_UNAVAILABLE';
      throw safe;
    }
  }
  g.BillboardScreeningHistory = Object.freeze({readScreeningHints});

  function extractFieldArray(simResult) {
    let val = simResult;
    if (simResult && simResult.result !== undefined) val = simResult.result;
    else if (simResult && simResult.value !== undefined) val = simResult.value;
    if (!Array.isArray(val)) return [];
    return val.map(v => {
      if (v && v.toString) return BigInt(v.toString());
      return BigInt(v);
    });
  }

  // ============================================================
  // Setup cache — avoids re-doing expensive CRS/PXE/sync on
  // repeated calls with the same config (used by web app pages)
  // ============================================================
  const _setupCache = new Map();
  function _setupKey(config, address, nodeInfo, rollup, board) {
    return JSON.stringify([config.aztecNodeUrl, config.ethRpcUrl, address.toString(),
      String(nodeInfo.l1ChainId), String(nodeInfo.rollupVersion), rollup.toLowerCase(),
      board.toLowerCase(), config.portalAddress.toLowerCase(), config.dataDirPrefix || 'pxe_bb_']);
  }
  function walletSalt(value) {
    if (value === undefined) return 0n;
    if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) throw new Error('Invalid wallet salt');
    if (!['string','number','bigint'].includes(typeof value) ||
        (typeof value === 'string' && !/^(?:0x[0-9a-fA-F]{1,64}|[0-9]{1,78})$/.test(value))) throw new Error('Invalid wallet salt');
    const salt=BigInt(value);
    if(salt<0n || salt>=21888242871839275222246405745257275088548364400416034343698204186575808495617n) throw new Error('Invalid wallet salt');
    return salt;
  }

  // ============================================================
  // Main entry point
  // ============================================================
  g.runBillboardUser = async function(env, config) {
    const { aztec: a, ethers, log, initCRS, createStore, artifact } = env;

    let aztecWallet = config.aztecWallet;
    if (!aztecWallet || !aztecWallet.secretKey) {
      throw new Error('Aztec wallet with secretKey is required.');
    }

    const saltVal = walletSalt(aztecWallet.salt);
    const contractSalt = config.contractSalt || 1;
    const secretKeyHex = aztecWallet.secretKey;
    let action = config.action || 'status';
    if (['claim', 'post', 'withdraw', 'auto', 'declare-immoral', 'transfer-censor', 'set-moderation-policy'].includes(action)) requirePrivateFeeConfiguration(a, config, env.privateFeeArtifact);

    // ============================================================
    // Step 1: Derive account keys
    // ============================================================
    log('Step 1: Deriving account keys...', 'info');
    const secretKey = a.Fr.fromHexString(secretKeyHex);
    const signingKey = a.deriveSigningKey(secretKey);
    const accountContract = new a.SchnorrInitializerlessAccountContract(signingKey);
    const { publicKeys } = await a.deriveKeys(secretKey);
    const accountArtifact = await accountContract.getContractArtifact();
    const immutablesHash = await accountContract.getImmutablesHash();
    const instance = await a.getContractInstanceFromInstantiationParams(accountArtifact, {
      constructorArtifact: undefined, constructorArgs: undefined,
      salt: new a.Fr(saltVal), publicKeys, immutablesHash,
    });
    const partialAddress = await a.computePartialAddress(instance);
    const address = instance.address;
    log('  Address: ' + address.toString(), 'success');

    // ============================================================
    // Step 2: Connect to Aztec node
    // ============================================================
    log('Step 2: Connecting to Aztec node...', 'info');
    const nodeUrl = config.aztecNodeUrl;
    const rawNode = a.createAztecNodeClient(nodeUrl);
    const aztecNode = wrapWithRetry(rawNode, 'node', log);
    const nodeInfo = await aztecNode.getNodeInfo();
    log('  Chain ID: ' + nodeInfo.l1ChainId, 'info');
    log('  Rollup version: ' + nodeInfo.rollupVersion, 'info');

    const l1Contracts = await aztecNode.getL1ContractAddresses();
    const rollupAddr = l1Contracts.rollupAddress.toString();
    const version = nodeInfo.rollupVersion;
    if(config.expectedNetworkScope && (String(nodeInfo.l1ChainId)!==String(config.expectedNetworkScope.chainId) || String(version)!==String(config.expectedNetworkScope.version) || rollupAddr.toLowerCase()!==String(config.expectedNetworkScope.rollup).toLowerCase())) throw new Error('Network changed since CLI preflight.');
    log('  L1 Rollup: ' + rollupAddr, 'info');

    try {
      const blockNum = await aztecNode.getBlockNumber();
      log('  Current L2 block: ' + blockNum, 'info');
    } catch (e) { /* non-critical */ }

    // ============================================================
    // Step 3: Compute L2 + portal addresses
    // ============================================================
    log('Step 3: Computing contract addresses...', 'info');
    const contractArtifact = a.loadContractArtifact(artifact);
    if (!config.portalAddress) throw new Error('An explicit V1 portal address is required.');
    const portalAddr = ethers.getAddress(config.portalAddress);
    const scopeProvider = new ethers.JsonRpcProvider(config.ethRpcUrl);
    let l2Addr, l2AddrHex;
    try {
      if (await scopeProvider.getCode(portalAddr) === '0x') throw new Error('Portal contract is not deployed.');
      const boundPortal = new ethers.Contract(portalAddr, PORTAL_ABI, scopeProvider);
      const [board, chain, rollup, boundVersion, network] = await Promise.all([
        boundPortal.L2_CONTRACT(), boundPortal.L1_CHAIN_ID(), boundPortal.ROLLUP(), boundPortal.VERSION(), scopeProvider.getNetwork()]);
      if (BigInt(chain) !== BigInt(nodeInfo.l1ChainId) || BigInt(network.chainId) !== BigInt(chain) ||
          rollup.toLowerCase() !== rollupAddr.toLowerCase() || BigInt(boundVersion) !== BigInt(version)) throw new Error('Portal and node network scope disagree.');
      l2AddrHex = board.toLowerCase();
      l2Addr = a.AztecAddress.fromFieldUnsafe(a.Fr.fromHexString(l2AddrHex));
    } finally { scopeProvider.destroy(); }
    log('  L2 billboard: ' + l2AddrHex, 'success');
    log('  L1 portal: ' + portalAddr, 'info');

    async function searchWithdrawal(messageLeaf,latestBlock) {
      if(typeof env.createHistoryCursor!=='function')throw Object.assign(new Error('Durable withdrawal recovery storage is required.'),{code:'BB_JOURNAL_INVALID'});
      const cursorStore=await env.createHistoryCursor({walletSecret:secretKeyHex,walletSalt:saltVal,
        scope:{account:address.toString().toLowerCase(),chainId:String(nodeInfo.l1ChainId),rollup:rollupAddr.toLowerCase(),version:String(version),board:l2AddrHex.toLowerCase(),portal:portalAddr.toLowerCase()},
        messageLeaf:'0x'+messageLeaf.toBigInt().toString(16).padStart(64,'0')});
      return findWithdrawTxHash(aztecNode,messageLeaf,latestBlock,1,log,{cursorStore});
    }

    const journalActions = ['claim','post','withdraw','auto','recover','declare-immoral','set-moderation-policy','transfer-censor'];
    if(journalActions.includes(action) && typeof env.createTransactionJournal!=='function')throw Object.assign(new Error('Durable transaction journal is required.'),{code:'BB_JOURNAL_INVALID'});
    const transactionJournal = journalActions.includes(action)
      ? await env.createTransactionJournal({walletSecret:secretKeyHex,walletSalt:saltVal,
          scope:{account:address.toString().toLowerCase(),chainId:String(nodeInfo.l1ChainId),rollup:rollupAddr.toLowerCase(),version:String(version),board:l2AddrHex.toLowerCase(),portal:portalAddr.toLowerCase()},
          Tx:a.Tx,node:rawNode,acknowledgeTx:config.acknowledgeTx,contextGuard:config.contextGuard}) : null;
    if(journalActions.includes(action) && (!transactionJournal || typeof transactionJournal.assertCanStart!=='function' || typeof transactionJournal.prepare!=='function' || typeof transactionJournal.confirmed!=='function'))throw Object.assign(new Error('Invalid transaction journal.'),{code:'BB_JOURNAL_INVALID'});
    let resumedPost = null, resumedSpend = null, resumedClaim = null, claimOperation = null, resumedModeratorOperation = null;
    if(action==='recover') {
      if(!transactionJournal)throw new Error('Transaction journal is required for recovery.');
      if(config.contextGuard)await config.contextGuard();
      let receipt;
      try { receipt = await transactionJournal.recover(); }
      catch(error) {
        if(error?.code!=='BB_RECOVERY_REQUIRED'||typeof transactionJournal.inspect!=='function'||typeof transactionJournal.allowReplacement!=='function')throw error;
        const saved = await transactionJournal.inspect();
        if (!saved?.operation) throw error;
        // Posts retain their public identity; note-spending actions must retain
        // their attributed application nullifier in every replacement proof.
        let kind,metadata;try{metadata=JSON.parse(saved.operation);kind=metadata?.kind;}catch{throw error;}
        if(Array.isArray(metadata)) {
          const restored=restoreModeratorOperation(a,saved.operation);
          resumedModeratorOperation=saved.operation;action=restored.action;
          config={...config,...restored,reconcilePrevious:false,censorWalletJson:config.censorWalletJson||config.aztecWallet};
        } else if(kind==='post') {
          resumedPost = parsePostOperation(a, saved.operation);
          action='post';
          config={...config,action,isDummy:false,message:resumedPost.message,depositChainId:resumedPost.depositChain};
        } else if(kind==='claim') {
          const intent=JSON.parse(saved.operation);
          if(Object.keys(intent).sort().join()!=='amount,depositChain,depositNonce,depositor,kind,leafIndex,schemaVersion,secretHash,transactionHash'||intent.schemaVersion!==1||
            !/^0x[0-9a-f]{40}$/.test(intent.depositor)||!/^0x[0-9a-f]{64}$/.test(intent.transactionHash)||
            !/^[1-9][0-9]*$/.test(intent.amount)||!/^[1-9][0-9]*$/.test(intent.depositNonce)||!/^(0|[1-9][0-9]*)$/.test(intent.leafIndex))throw error;
          canonicalPostId(a,intent.depositChain,true);canonicalPostId(a,intent.secretHash,true);
          if(BigInt(intent.amount)>=1n<<128n||BigInt(intent.depositNonce)>=1n<<64n)throw error;
          new a.Fr(BigInt(intent.leafIndex));
          resumedClaim={intent,operation:saved.operation};action='claim';
          config={...config,action,reuseTxHash:intent.transactionHash,depositChainId:intent.depositChain};
        } else if(kind==='dummy'||kind==='withdraw') {
          const intent=JSON.parse(saved.operation);
          if(Object.keys(intent).sort().join()!=='depositChain,headSequence,kind,schemaVersion'||intent.schemaVersion!==1||
            typeof intent.headSequence!=='string'||!/^(0|[1-9][0-9]*)$/.test(intent.headSequence)||BigInt(intent.headSequence)>=1n<<64n||
            !saved.applicationNullifier)throw error;
          canonicalPostId(a,intent.depositChain,true);
          resumedSpend={intent,operation:saved.operation,applicationNullifier:saved.applicationNullifier};
          action=kind==='dummy'?'post':'withdraw';
          config={...config,action,isDummy:kind==='dummy',message:'',depositChainId:intent.depositChain};
        } else throw error;
        requirePrivateFeeConfiguration(a, config, env.privateFeeArtifact);
        await transactionJournal.allowReplacement(saved.operation);
        log('Saved proof is stale. Restoring the same action for a fresh proof.', 'info');
      }
      if(receipt) {
        const succeeded=receipt.executionResult==='success';
        log((succeeded?'Saved transaction succeeded. Hash: ':'Saved transaction reverted; the action failed. Hash: ')+receipt.txHash.toString(),succeeded?'success':'warn');
        return {recovered:true,lastL2TxHash:receipt.txHash.toString(),state:succeeded?'transaction_recovered':'transaction_reverted'};
      }
    }
    // Check before any action-specific state changes, including auto-mode L1 sends.
    let reconciledModerator=null;
    if(transactionJournal) {
      if(config.reconcilePrevious===true&&['declare-immoral','set-moderation-policy','transfer-censor'].includes(action)) {
        if(typeof transactionJournal.reconcilePrevious!=='function')throw Object.assign(new Error('Moderator recovery is unavailable.'),{code:'BB_JOURNAL_INVALID'});
        try { reconciledModerator=await transactionJournal.reconcilePrevious(); }
        catch(error) {
          if(error?.code!=='BB_RECOVERY_REQUIRED'||typeof transactionJournal.inspect!=='function'||typeof transactionJournal.allowReplacement!=='function')throw error;
          const saved=await transactionJournal.inspect();restoreModeratorOperation(a,saved?.operation);
          await transactionJournal.allowReplacement(saved.operation);resumedModeratorOperation=saved.operation;
        }
      }
      await transactionJournal.assertCanStart();
    }


    // Check if L2 contract is deployed
    let l2Deployed = false;
    let existingInstance = null;
    try { existingInstance = await aztecNode.getContract(l2Addr); } catch (e) { /* not deployed */ }
    if (existingInstance) {
      l2Deployed = true;
      log('  Billboard contract IS deployed on L2.', 'success');
    } else {
      log('  WARNING: Billboard contract NOT deployed on L2 at this address.', 'warn');
      log('  The contract must be deployed first (use the deploy CLI or aztec-wallet).', 'warn');
    }

    // Check portal on L1
    let ethSigner = null, l1Account = null, provider = null;
    let portalL1Balance = 0n, portalDepositNonce = 0n;
    let portalDeployed = false;
    try {
      if (config.ethWallet && config.ethWallet.privateKey) {
        provider = new ethers.JsonRpcProvider(config.ethRpcUrl);
        ethSigner = new ethers.Wallet(config.ethWallet.privateKey, provider);
        l1Account = await ethSigner.getAddress();
      } else if (env.getBrowserSigner && config.hasEthSigner !== false) {
        ethSigner = await env.getBrowserSigner();
        l1Account = await ethSigner.getAddress();
        provider = ethSigner.provider;
      } else {
        if(['deposit','claim','auto','claim-l1','recover-eth'].includes(action)) throw new Error('This operation requires an Ethereum wallet.');
        provider = new ethers.JsonRpcProvider(config.ethRpcUrl);
      }
      if (BigInt((await provider.getNetwork()).chainId) !== BigInt(nodeInfo.l1ChainId)) throw new Error('Ethereum signer chain disagrees with the board.');
      if (config.contextGuard) await config.contextGuard();
      log('  L1 account:  ' + l1Account, 'info');
      const code = await provider.getCode(portalAddr);
      portalDeployed = code !== '0x';
      if (portalDeployed) {
        const portal = new ethers.Contract(portalAddr, PORTAL_ABI, provider);
        try {
          const l2Contract = await portal.L2_CONTRACT();
          const onchainHex = '0x' + l2Contract.slice(2).toLowerCase().padStart(64, '0');
          const expectedHex = l2AddrHex.toLowerCase().replace(/^0x/, '').padStart(64, '0');
          if (onchainHex !== '0x' + expectedHex) {
            log('  WARNING: Portal L2_CONTRACT mismatch!', 'warn');
            log('  Portal says: ' + onchainHex, 'warn');
            log('  Expected:    ' + ('0x' + expectedHex), 'warn');
            portalDeployed = false;
          } else {
            log('  Portal verified on L1.', 'success');
          }
        } catch (e) {
          log('  Warning: could not read L2_CONTRACT from portal: ' + 'request did not complete', 'warn');
        }
        if(l1Account) {const active = await portal.getDeposit(l1Account);
        portalL1Balance = BigInt(active.amount); portalDepositNonce = BigInt(active.nonce);}
      } else {
        log('  WARNING: Portal not deployed at ' + portalAddr, 'warn');
      }
    } catch (e) {
      throw new Error('Could not verify the L1 wallet and receipt.');
    }

    const ethereumActions=['deposit','claim-l1','auto','recover-eth'];
    let ethereumJournal=null;
    if(ethereumActions.includes(action)) {
      if(typeof env.createEthereumJournal!=='function'||!l1Account)throw Object.assign(new Error('Ethereum transaction journal is required.'),{code:'BB_JOURNAL_INVALID'});
      ethereumJournal=await env.createEthereumJournal({walletSecret:secretKeyHex,walletSalt:saltVal,
        scope:{account:address.toString().toLowerCase(),chainId:String(nodeInfo.l1ChainId),rollup:rollupAddr.toLowerCase(),version:String(version),board:l2AddrHex.toLowerCase(),portal:portalAddr.toLowerCase(),depositor:l1Account.toLowerCase()},
        provider,signer:ethSigner,acknowledgeTx:config.acknowledgeEthereumTx,contextGuard:config.contextGuard});
      if(!ethereumJournal||typeof ethereumJournal.send!=='function'||typeof ethereumJournal.assertCanStart!=='function')throw Object.assign(new Error('Invalid Ethereum journal.'),{code:'BB_JOURNAL_INVALID'});
      if(action==='recover-eth') {
        const recovered=await ethereumJournal.recover({retry:config.retryEthereum===true});
        const success=recovered.outcome==='success';
        log(success?'Saved Ethereum request and portal event verified.':'Saved Ethereum request '+recovered.outcome+'; the original action did not succeed.',success?'success':'warn');
        log('Ethereum transaction: '+recovered.txHash,'info');
        return {recovered:true,lastEthereumTxHash:recovered.txHash,state:success?'ethereum_recovered':'ethereum_'+recovered.outcome};
      }
      await ethereumJournal.assertCanStart();
    }

    // ============================================================
    // Determine current state (auto-resolve)
    // ============================================================
    // Three possible states:
    //   "postable"                         -- have a deposit note on L2, can post/withdraw
    //   "withdrawn_l2_claimable_l1"        -- no note on L2, but portal has balance + withdrawal msg exists
    //   "zero_balance_need_deposit"        -- no note, no portal balance (or portal balance but not claimed yet)
    //
    // For "zero_balance_need_deposit" with portalL1Balance > 0, the deposit was made on L1
    // but not yet claimed on L2 -- the user should run 'claim'.

    let stateStatus = 'unknown';
    let l2NoteInfo = null;
    let selectedChain = config.depositChainId == null ? null : BigInt(config.depositChainId);
    async function readDepositInfo() {
      try {
        if (typeof g.readBillboardDepositInfo !== 'function') throw new Error('Missing V1 deposit decoder');
        const info = await g.readBillboardDepositInfo(contract, address, selectedChain);
        if (info.amount > 0n) selectedChain = info.depositChainId;
        return info;
      } catch (error) { if (error?.code === 'BB_DEPOSIT_READ') throw error; error.code = 'BB_DEPOSIT_READ'; throw error; }
    }
    function requireDepositChain() {
      if (selectedChain == null || selectedChain === 0n) throw new Error('No selected live deposit identity');
      return new a.Fr(selectedChain);
    }


    // We can check the L2 note only if the contract is deployed AND we set up PXE.
    // For 'status' we do a lightweight check (no PXE) if possible, but get_deposit_info
    // requires the PXE. So we'll set up PXE for all actions that need it.
    // For 'status' we'll do a best-effort without PXE first.

    // Determine state from L1 info alone (no PXE needed):
    //   portalL1Balance > 0  -> deposit exists on L1 (either not claimed, or withdrawn but not yet claimed on L1)
    //   portalL1Balance == 0 -> no active L1 deposit (either never deposited, or already claimed on L1)

    if (portalL1Balance > 0n) {
      log('  L1 portal deposit balance: ' + toEtherStr(portalL1Balance) + ' ETH', 'info');
    } else {
      log('  L1 portal deposit balance: 0 ETH', 'info');
    }

    // ============================================================
    // Decide if we need full PXE setup
    // ============================================================
    const needsPXE = ['status', 'claim', 'post', 'list', 'withdraw', 'declare-immoral', 'transfer-censor', 'set-moderation-policy', 'auto'].includes(action);
    const needsCRS = needsPXE;

    let pxe = null, wallet = null, contract = null;

    if (needsPXE) {
      if (!l2Deployed) {
        throw new Error('Billboard contract not deployed on L2 at ' + l2AddrHex + '. Deploy it first (use the deploy CLI or aztec-wallet).');
      }


      // Check setup cache
      const sKey = _setupKey(config, address, nodeInfo, rollupAddr, l2AddrHex);
      const cached = _setupCache.get(sKey);
      if (cached) {
        log('  Reusing cached PXE/wallet setup.', 'success');
        pxe = cached.pxe;
        wallet = cached.wallet;
        wallet._preProveHook = config.preProveHook || null;
        wallet._contextGuard = config.contextGuard || null;
        wallet._transactionJournal = transactionJournal;
        contract = cached.contract;
        // Re-sync to pick up latest state
        try { await pxe.sync(); } catch (e) {}
      } else {
        // ============================================================
        // Step 4: Initialize CRS
        // ============================================================
        log('Step 4: Initializing CRS...', 'info');
        await initCRS();
        log('  CRS ready.', 'success');

        // ============================================================
        // Step 5: Create PXE
        // ============================================================
        log('Step 5: Creating PXE...', 'info');
        const dataDirPrefix = (config.dataDirPrefix || 'pxe_bb_') + address.toString().slice(0, 16) + '_';
        const storeConfig = { ...l1Contracts, l1ChainId: nodeInfo.l1ChainId, accountAddress: address.toString(), dataDirectory: dataDirPrefix + l1Contracts.rollupAddress };
        const store = await createStore(storeConfig);
        pxe = await a.createPXE(aztecNode, {
          proverEnabled: true, autoSync: true,
          dataDirectory: dataDirPrefix + l1Contracts.rollupAddress,
        }, { store });
        log('  PXE created.', 'success');

        // ============================================================
        // Step 6: Register account + sync
        // ============================================================
        log('Step 6: Registering account with PXE...', 'info');
        const derivedKeys = await a.deriveKeys(secretKey);
        await pxe.registerAccount(derivedKeys, partialAddress);
        log('  Account registered.', 'success');

        log('  Registering Schnorr initializerless account contract...', 'info');
        await retry(() => pxe.registerContractClass(a.SchnorrInitializerlessAccountContractArtifact), 'register', log, 5);
        await retry(() => pxe.registerContract(instance), 'register', log, 5);
        log('  Contract registered.', 'success');

        log('  Registering billboard contract with PXE...', 'info');
        await retry(() => pxe.registerContractClass(contractArtifact), 'register-bb', log, 5);
        await retry(() => pxe.registerContract(existingInstance), 'register-bb', log, 5);
        log('  Billboard contract registered.', 'success');

        log('  Syncing PXE with node...', 'info');
        await pxe.sync();
        log('  PXE synced.', 'success');

        // ============================================================
        // Step 7: Create wallet
        // ============================================================
        log('Step 7: Creating wallet...', 'info');
        wallet = createAztecWallet(a, pxe, aztecNode, rawNode, log, secretKey, { preProveHook: config.preProveHook, contextGuard: config.contextGuard, transactionJournal });
        const accountManager = await a.AccountManager.create(wallet, secretKey, accountContract, { salt: new a.Fr(saltVal) });
        wallet._accountManager = accountManager;
        log('  Wallet ready.', 'success');

        // Re-create the deploy method with the real wallet (for getInstance if needed)
        // and create the contract handle.
        contract = await a.Contract.at(l2Addr, contractArtifact, wallet);

        // Store signing key capsule
        log('  Storing signing key capsule...', 'info');
        const signingPublicKey = await accountContract.getSigningPublicKey();
        const constructorArtifact = accountArtifact.functions.find(f => f.name === 'constructor');
        if (constructorArtifact) {
          const storeCall = new a.ContractFunctionInteraction(
            wallet, instance.address, constructorArtifact,
            [signingPublicKey.x, signingPublicKey.y]
          );
          await storeCall.simulate({ from: instance.address });
          log('  Capsule stored.', 'success');
        }

        // Cache the setup for reuse by subsequent engine calls
        _setupCache.set(sKey, { pxe, wallet, contract, aztecNode, rawNode });
      }

      // Now check the L2 deposit note (always re-check, state may have changed)
      log('  Checking L2 deposit note...', 'info');
      try {
        const r = await readDepositInfo();
        l2NoteInfo = r;
        if (l2NoteInfo.amount > 0n) {
          log('  L2 deposit note found: amount=' + l2NoteInfo.amount.toString() + ' wei, nextAllowedTime=' + l2NoteInfo.nextAllowedTime.toString(), 'success');
        } else {
          log('  No L2 deposit note found.', 'info');
        }
      } catch (e) { if (e?.code === 'BB_DEPOSIT_READ') throw e;
        log('  Could not check L2 note: ' + 'request did not complete', 'warn');
      }
    }

    // ============================================================
    // Resolve state
    // ============================================================
    if (l2NoteInfo && l2NoteInfo.amount > 0n) {
      stateStatus = 'postable';
    } else if (portalL1Balance > 0n) {
      // Could be: deposit made but not claimed, OR withdrawn on L2 but not claimed on L1.
      // Check for a withdrawal L2->L1 message to distinguish.
      if (needsPXE && l2Deployed) {
        try {
          const messageLeaf = computeWithdrawMessageLeaf(a, ethers, l2Addr, portalAddr, l1Account, portalL1Balance, portalDepositNonce, version, nodeInfo.l1ChainId);
          const latestBlock = await aztecNode.getBlockNumber();
          const found = await searchWithdrawal(messageLeaf,latestBlock);
          if (found) {
            stateStatus = 'withdrawn_l2_claimable_l1';
            log('  Withdrawal tx found: ' + found.txHash, 'success');
          } else {
            stateStatus = 'deposited_l1_not_claimed_l2';
          }
        } catch {
          throw Object.assign(new Error('Cannot distinguish an unclaimed deposit from an unresolved withdrawal. Retry recovery; do not create another deposit.'),{code:'BB_RECOVERY_UNKNOWN'});
        }
      } else {
        stateStatus = 'deposited_l1_not_claimed_l2';
      }
    } else {
      stateStatus = 'zero_balance_need_deposit';
    }

    log('', 'info');
    log('========================================', 'info');
    log('  STATE: ' + stateStatus, 'success');
    log('========================================', 'info');
    log('  L2 address:  ' + l2AddrHex, 'info');
    log('  L1 portal:   ' + portalAddr, 'info');
    if (config.contextGuard) await config.contextGuard();
    if (l1Account) log('  L1 account:  ' + l1Account, 'info');
    if (l2NoteInfo && l2NoteInfo.amount > 0n) {
      log('  L2 note:     ' + l2NoteInfo.amount.toString() + ' wei (' + toEtherStr(l2NoteInfo.amount) + ' ETH)', 'info');

      // Show posts-available info (point 3: CLI shows how many posts you can make and when)
      try {
        let baseCooldown = 3600n;
        let minDepositL2 = ethers.parseEther('0.001');
        let maxSaveUp = 16;
        if (contract) {
          const cdR = await contract.methods.get_base_cooldown().simulate({ from: address });
          baseCooldown = BigInt(extractInt(cdR));
          const mdR = await contract.methods.get_min_deposit().simulate({ from: address });
          minDepositL2 = BigInt(unwrapPostValue(mdR).toString());
          const msuR = await contract.methods.get_max_save_up().simulate({ from: address });
          maxSaveUp = Number(extractInt(msuR));
        }
        const userCd = Number((baseCooldown * minDepositL2 + l2NoteInfo.amount - 1n) / l2NoteInfo.amount);
        const l2Now = await getL2Timestamp(a, aztecNode);
        const nextAllowed = Number(l2NoteInfo.nextAllowedTime);
        const remaining = nextAllowed - l2Now;
        if (remaining <= 0) {
          const postsAvail = Math.min(Math.floor(-remaining / userCd) + 1, maxSaveUp);
          log('  Posts available: ' + postsAvail + ' (capped at max_save_up=' + maxSaveUp + ')', 'success');
          log('  Cooldown: ' + userCd + 's per post', 'info');
        } else {
          const mm = Math.floor(remaining / 60);
          const ss = remaining % 60;
          log('  Posts available: 0 — next post in ' + mm + ':' + String(ss).padStart(2, '0'), 'info');
          log('  Cooldown: ' + userCd + 's per post (max_save_up=' + maxSaveUp + ')', 'info');
        }
        // Show screening status
        const lastScreened = Number(l2NoteInfo.lastScreenedIndex);
        const lastReal = Number(l2NoteInfo.lastRealPostIndex);
        const NO_IDX = 0;
        if (lastReal !== NO_IDX) {
          if (lastScreened >= lastReal) {
            log('  Screening: all posts screened (eligible to withdraw)', 'success');
          } else {
            const unscreened = lastReal - lastScreened;
            log('  Screening: ' + unscreened + ' real post' + (unscreened > 1 ? 's' : '') + ' unscreened — make dummy posts before withdrawal', 'warn');
          }
        }
      } catch (e) {
        log('  (Could not fetch posts-available info: ' + 'request did not complete' + ')', 'warn');
      }
    }
    log('  L1 deposit:  ' + toEtherStr(portalL1Balance) + ' ETH', 'info');
    log('', 'info');

    // ============================================================
    // Handle 'status' action (just print and return)
    // ============================================================
    if (action === 'status') {
      return { ok: true, state: stateStatus, l2Addr: l2AddrHex, portalAddr, l1Account, portalL1Balance: portalL1Balance.toString(), l2Note: l2NoteInfo, handles: { pxe, wallet, contract, aztecNode, rawNode, address, l2Addr, contractSalt, version, nodeInfo, depositChainId: selectedChain } };
    }

    // ============================================================
    // DEPOSIT action
    // ============================================================
    // Private in-memory record; public action results omit the secret.
    let depositInfo = null;
    function secretScope() {
      if (!l1Account) throw new Error('An L1 depositor is required for secret custody.');
      return { l1ChainId: String(BigInt(nodeInfo.l1ChainId)), rollupAddress: rollupAddr.toLowerCase(),
        rollupVersion: String(BigInt(version)), boardAddress: l2AddrHex.toLowerCase(),
        portalAddress: portalAddr.toLowerCase(), depositor: l1Account.toLowerCase() };
    }
    function secretStore() {
      const store = config.claimSecretStore;
      if (!store || typeof store.save !== 'function' || typeof store.load !== 'function') {
        throw new Error('Durable claim-secret storage is required before depositing or recovering.');
      }
      return store;
    }
    async function restoreSecret(secretHash) {
      const hash = secretHash.toLowerCase();
      const record = await secretStore().load(secretScope(), hash);
      if (!record || record.schemaVersion !== 1 || record.secretHash !== hash ||
          typeof record.secret !== 'string' || !/^0x[0-9a-f]{64}$/.test(record.secret) ||
          BigInt(record.secret) <= 0n || BigInt(record.secret) >= a.Fr.MODULUS) {
        throw new Error('The matching saved claim secret is missing or invalid. Restore its backup before claiming.');
      }
      const computed = await a.computeSecretHash(new a.Fr(BigInt(record.secret)));
      if (computed.toString().toLowerCase() !== hash) throw new Error('Saved claim secret does not match the deposit.');
      return record.secret;
    }
    function parsedDeposit(receipt) {
      const iface = new ethers.Interface(PORTAL_ABI);
      const events = receipt.logs.filter(ev => ev.address.toLowerCase() === portalAddr.toLowerCase() &&
        ev.topics[0]?.toLowerCase() === ethers.id(DEPOSIT_SIGNATURE).toLowerCase()).map(ev => iface.parseLog(ev));
      const matching = events.filter(ev => ev && ev.name === 'Deposited' && ev.args.depositor.toLowerCase() === l1Account.toLowerCase());
      if (matching.length !== 1) throw new Error('Expected exactly one V1 receipt event for this depositor.');
      const event = matching[0].args;
      if (event.nonce <= 0n || event.nonce >= (1n << 64n) || event.amount <= 0n || event.amount >= (1n << 96n)) throw new Error('Invalid V1 receipt event.');
      return event;
    }
    async function doDeposit() {
      if (!ethSigner || !portalDeployed) throw new Error('A verified portal and L1 signer are required.');
      const store = secretStore();
      const portal = new ethers.Contract(portalAddr, PORTAL_ABI, ethSigner);
      if (!await portal.depositsEnabled()) throw new Error('Portal deposits are disabled until authenticated Ready activation.');
      const active = await portal.getDeposit(l1Account);
      if (BigInt(active.nonce) !== 0n) throw new Error('An active L1 receipt already exists.');
      if (l2NoteInfo && l2NoteInfo.amount > 0n) throw new Error('Select and withdraw the existing posting right before making a new deposit.');
      if (!config.depositAmount) throw new Error('Deposit amount is required.');
      const amount = ethers.parseEther(config.depositAmount);
      const [minimum, maximum] = await Promise.all([portal.MIN_DEPOSIT(),portal.MAX_DEPOSIT()]);
      if (amount < minimum || amount > maximum) throw new Error('Deposit amount is outside the configured portal bounds.');
      const secret = generateSecret(a);
      const secretHash = (await a.computeSecretHash(secret)).toString().toLowerCase();
      const record = { schemaVersion: 1, secretHash, secret: secret.toString().toLowerCase() };
      // A successful durable commit and verified read-back must precede ANY L1 submission.
      await store.save(secretScope(), record);
      if (await restoreSecret(secretHash) !== record.secret) throw new Error('Claim-secret storage read-back failed.');
      log('Claim secret saved locally. Sending deposit...', 'info');
      if (config.contextGuard) await config.contextGuard();
      const expectedNonce=BigInt(await portal.lastDepositNonce(l1Account))+1n;
      const paid=await ethereumJournal.send({data:new ethers.Interface(PORTAL_ABI).encodeFunctionData('deposit',[secretHash]),value:amount.toString(),
        expected:{kind:'deposit',nonce:expectedNonce.toString(),amount:amount.toString(),secretHash}});
      const event=paid.event;
      depositInfo = { amount, leafIndex: event.index, depositNonce: event.nonce, secret: record.secret, secretHash, txHash: paid.txHash };
      portalL1Balance = amount; portalDepositNonce = event.nonce;
      log('Deposit confirmed. Receipt nonce: ' + event.nonce.toString(), 'success');
    }

    async function doReuseDeposit() {
      if (!provider || !l1Account || !portalDeployed) throw new Error('A verified portal and depositor are required.');
      secretStore();
      const active = await new ethers.Contract(portalAddr,PORTAL_ABI,provider).getDeposit(l1Account);
      if (BigInt(active.nonce) === 0n || BigInt(active.amount) === 0n) throw new Error('No active L1 receipt to recover.');
      let event, txHash;
      if (config.reuseTxHash) {
        const receipt = await provider.getTransactionReceipt(config.reuseTxHash);
        if (!receipt || receipt.status !== 1) throw new Error('No successful deposit receipt found.');
        const receiptHash=receipt.hash??receipt.transactionHash;
        if(typeof receiptHash!=='string'||receiptHash.toLowerCase()!==config.reuseTxHash.toLowerCase()||
          !receipt.blockHash||!Number.isSafeInteger(receipt.blockNumber)||receipt.blockNumber<1)throw Object.assign(new Error('Saved deposit receipt identity is unavailable.'),{code:'BB_RECOVERY_UNKNOWN'});
        const block=await provider.getBlock(receipt.blockNumber);
        if(block?.hash!==receipt.blockHash)throw Object.assign(new Error('Saved deposit receipt is not canonical.'),{code:'BB_RECOVERY_UNKNOWN'});
        event = parsedDeposit(receipt); txHash = config.reuseTxHash;
      } else {
        const events = await findAllDeposits(ethers,provider,portalAddr,l1Account,log);
        const matches = events.filter(item => item.depositNonce === BigInt(active.nonce) && item.amount === BigInt(active.amount));
        if (matches.length !== 1) throw new Error('Could not uniquely locate the active receipt; provide its transaction hash.');
        const found = matches[0];
        event = { amount: found.amount, nonce: found.depositNonce, index: found.index, secretHash: found.secretHash };
        txHash = found.txHash;
      }
      if (event.nonce !== BigInt(active.nonce) || event.amount !== BigInt(active.amount)) throw new Error('Deposit event does not match the active receipt.');
      const secret = await restoreSecret(event.secretHash);
      depositInfo = { amount:event.amount, leafIndex:event.index, depositNonce:event.nonce, secret,
        secretHash:event.secretHash.toLowerCase(), txHash };
      portalL1Balance=event.amount; portalDepositNonce=event.nonce;
      log('Recovered the active receipt using its saved claim secret.', 'success');
    }

    let privateFeeSender;
    async function sendPrivate(kind, args) {
      if(kind!=='post'||args[4]===true) {
        if(typeof transactionJournal?.setOperation!=='function')throw Object.assign(new Error('Transaction operation journal is required.'),{code:'BB_JOURNAL_INVALID'});
        const operationKind=kind==='post'?'dummy':kind;
        if(operationKind==='dummy'||operationKind==='withdraw') {
          const note=await readDepositInfo();
          if(note.amount<=0n)throw Object.assign(new Error('The original deposit spend must be reconciled.'),{code:'BB_RECOVERY_REQUIRED'});
          const operation=JSON.stringify({schemaVersion:1,kind:operationKind,depositChain:requireDepositChain().toString(),headSequence:note.headSequence.toString()});
          if(resumedSpend&&operation!==resumedSpend.operation)throw Object.assign(new Error('The saved deposit state changed. Recover its original transaction.'),{code:'BB_RECOVERY_REQUIRED'});
          const notes=await a.boundedTransactionRead(()=>wallet.pxe.debug.getNotes({contractAddress:l2Addr,owner:address,
            storageSlot:contractArtifact.storageLayout.deposits.slot,status:a.NoteStatus.ACTIVE,scopes:[address]}),20000);
          if(!Array.isArray(notes))throw Object.assign(new Error('Private deposit note attribution is unavailable.'),{code:'BB_RECOVERY_REQUIRED'});
          const matching=notes.filter(item=>item.note?.items?.length===8 && item.note.items[1].equals(requireDepositChain()));
          if(matching.length!==1||!matching[0].owner.equals(address)||!matching[0].contractAddress.equals(l2Addr)||
            !matching[0].storageSlot.equals(contractArtifact.storageLayout.deposits.slot)||matching[0].siloedNullifier.isZero())throw Object.assign(new Error('Private deposit note attribution is ambiguous.'),{code:'BB_RECOVERY_REQUIRED'});
          const packed=matching[0].note.items.map(value=>value.toBigInt());
          if(packed[0]!==1n+(note.depositNonce<<32n)||packed[2]!==note.amount||
            packed[6]!==note.headSequence+(note.lastScreenedIndex<<64n)+(note.lastRealPostIndex<<128n)||packed[7]!==note.nextAllowedTime||
            (resumedSpend&&matching[0].siloedNullifier.toString()!==resumedSpend.applicationNullifier))throw Object.assign(new Error('The selected private deposit changed before proving.'),{code:'BB_RECOVERY_REQUIRED'});
          transactionJournal.setOperation(operation);
          wallet._applicationNullifierBoard=l2Addr;
          wallet._applicationNoteNullifier=matching[0].siloedNullifier;
        } else {
          if(operationKind==='claim'&&!claimOperation)throw Object.assign(new Error('Exact claim identity is unavailable.'),{code:'BB_JOURNAL_INVALID'});
          transactionJournal.setOperation(operationKind==='claim'?claimOperation:JSON.stringify({kind:operationKind}));
          wallet._applicationNullifierBoard=null;
        }
      } else wallet._applicationNullifierBoard=null;
      privateFeeSender ??= createPrivateFeeSender({ a, config, privateFeeArtifact: env.privateFeeArtifact,
        contract, wallet, node: aztecNode, owner: address,
        scope: { l1ChainId: String(nodeInfo.l1ChainId), rollupVersion: String(version) } });
      const result = await privateFeeSender(kind, args);
      // A confirmed saved step no longer constrains the next intentional action.
      resumedSpend = null;
      return result;
    }

    async function sendCensorPrivate(censorWallet, censorAddress, censorContract, kind, args) {
      const encode=value=>Array.isArray(value)?value.map(encode):String(value);
      const operation=JSON.stringify([kind,args.map(encode)]);
      if(typeof transactionJournal?.setOperation!=='function')throw Object.assign(new Error('Moderator operation journal is unavailable.'),{code:'BB_JOURNAL_INVALID'});
      if(reconciledModerator?.operation===operation&&reconciledModerator.receipt.executionResult==='success') {
        const fresh=await transactionJournal.reconcilePrevious();
        if(fresh?.operation!==operation)throw Object.assign(new Error('Moderator recovery record changed.'),{code:'BB_RECOVERY_REQUIRED'});
        if(fresh.receipt.executionResult==='success')return {receipt:fresh.receipt};
      }
      if(resumedModeratorOperation) {
        if(operation!==resumedModeratorOperation)throw Object.assign(new Error('The saved moderator request differs from the current action.'),{code:'BB_RECOVERY_REQUIRED'});
        const current=unwrapPostValue(await a.boundedTransactionRead(()=>censorContract.methods.get_censor().simulate({from:censorAddress}),20000));
        if(new a.Fr(BigInt(current.toString())).toString()!==censorAddress.toString())throw Object.assign(new Error('This wallet no longer has moderator authority.'),{code:'BB_RECOVERY_REQUIRED'});
      }
      transactionJournal.setOperation(operation);
      const sender=createPrivateFeeSender({a,config,privateFeeArtifact:env.privateFeeArtifact,
        contract:censorContract,wallet:censorWallet,node:aztecNode,owner:censorAddress,
        scope:{l1ChainId:String(nodeInfo.l1ChainId),rollupVersion:String(version)}});
      return sender(kind,args);
    }

    // ============================================================
    // CLAIM action (claim deposit on L2)
    // ============================================================
    async function doClaim() {
      if (!contract) throw new Error('PXE setup required for claim.');
      if (!ethSigner) throw new Error('L1 signer required for claim.');

      // If we don't have depositInfo yet, try to reuse an existing deposit
      if (!depositInfo) {
        log('No deposit info from this session. Searching L1 for existing deposits...', 'info');
        await a.boundedTransactionRead(()=>doReuseDeposit(),20000);
      }

      const depositorField = a.Fr.fromHexString(l1Account);
      const amount = depositInfo.amount;
      const secret = new a.Fr(BigInt(depositInfo.secret));
      const leafIndex = depositInfo.leafIndex;
      const claimContent = escrowContent(a,ethers,false,l2Addr,portalAddr,l1Account,amount,depositInfo.depositNonce,version,nodeInfo.l1ChainId);
      selectedChain = (await a.poseidon2HashWithSeparator([new a.Fr(1),l2Addr.toField(),address.toField(),claimContent,secret],0x42420101)).toBigInt();
      if (selectedChain === 0n) throw new Error('Invalid derived deposit identity');
      claimOperation=JSON.stringify({schemaVersion:1,kind:'claim',depositor:l1Account.toLowerCase(),amount:String(amount),depositNonce:String(depositInfo.depositNonce),leafIndex:String(leafIndex),secretHash:depositInfo.secretHash.toLowerCase(),transactionHash:depositInfo.txHash.toLowerCase(),depositChain:new a.Fr(selectedChain).toString()});
      if(resumedClaim&&claimOperation!==resumedClaim.operation)throw Object.assign(new Error('The original claim receipt or beneficiary does not match the saved request.'),{code:'BB_RECOVERY_REQUIRED'});

      log('Claiming deposit on L2...', 'info');
      log('  Depositor:    ' + l1Account, 'info');
      log('  Amount:       ' + amount.toString() + ' wei', 'info');
      log('  Leaf index:   ' + leafIndex.toString(), 'info');
      log('  Portal:       ' + portalAddr, 'info');

      // Check if note already exists (fast utility call — no PXE sync needed)
      log('  Checking deposit note status...', 'info');
      await new Promise(r => setTimeout(r, 0)); // yield to UI thread

      let noteInfo = { amount: 0n, nextAllowedTime: 0n, l1Depositor: '0x0' };
      try {
        const r = await readDepositInfo();
        noteInfo = r;
      } catch (e) { if (e?.code === 'BB_DEPOSIT_READ') throw e;}

      if (noteInfo.amount > 0n) {
        if(resumedClaim)throw Object.assign(new Error('A deposit note exists, but the saved claim transaction still needs reconciliation.'),{code:'BB_RECOVERY_REQUIRED'});
        log('  Deposit note already exists on L2!', 'success');
        log('  Amount: ' + noteInfo.amount.toString() + ' wei', 'info');
        log('  Next allowed time: ' + noteInfo.nextAllowedTime.toString(), 'info');
        log('  No claim needed. You can post or withdraw.', 'success');
        return;
      }

      // One attempt per action. Message availability and uncertain submission
      // remain retryable outcomes; never run a ten-minute blind retry loop.
      const result = await sendPrivate('claim', [depositorField, amount, depositInfo.depositNonce, secret, leafIndex]);
      const receipt = result.receipt;
      log('  Claim confirmed. Tx hash: ' + receipt.txHash + ', block: ' + receipt.blockNumber, 'success');
      try { await a.boundedTransactionRead(()=>wallet.pxe.sync(),20000); }
      catch { log('  Claim confirmed; wallet synchronization is pending. Refresh before the next action.', 'warn'); }

    }

    // ============================================================
    // POST action
    // ============================================================
    async function doPost() {
      const logicalNonce = resumedPost ? new a.Fr(BigInt(resumedPost.nonce)) : generateSecret(a);
      return withFreshPostState(()=>doPostAttempt(logicalNonce), async()=>{
        const saved=await transactionJournal.inspect();
        if(!saved?.operation||typeof transactionJournal.allowReplacement!=='function')throw Object.assign(new Error('Saved post recovery is required.'),{code:'BB_RECOVERY_REQUIRED'});
        const intended=parsePostOperation(a,saved.operation);
        if(intended.nonce!==logicalNonce.toString())throw Object.assign(new Error('Post identity changed.'),{code:'BB_RECOVERY_REQUIRED'});
        await transactionJournal.allowReplacement(saved.operation);
        log('  State changed; refreshing rights for the same saved post.', 'warn');
        await wallet.pxe.sync();
      }, 2, error => postStateCanRetry(!!config.isDummy, error));
    }
    async function doPostAttempt(postNonce) {
      if (!contract) throw new Error('PXE setup required for post.');

      const isDummy = !!config.isDummy;
      const msgText = isDummy ? '' : (config.message || '');
      if (!isDummy && !msgText) throw new Error('Message required (use --msg <text>).');

      if (isDummy) {
        log('Making dummy post (advances screening, stores no content)...', 'info');
        // Pre-flight: check note exists + time lock expired
        let infoResult = null;
        for (let i = 0; i < 3; i++) {
          try {
            infoResult = await readDepositInfo();
            const { amount } = infoResult;
            if (amount > 0n) break;
          } catch (e) { if (e?.code === 'BB_DEPOSIT_READ') throw e;}
          if (i < 2) await sleep(5000);
        }
        if (!infoResult) throw new Error('Could not read deposit info.');
        const { amount, nextAllowedTime } = infoResult;
        if (amount === 0n) throw new Error('No deposit note found. Claim a deposit first.');
        let now = BigInt(await getL2Timestamp(a, aztecNode));
        if (nextAllowedTime > now) {
          const waitSec = Number(nextAllowedTime - now);
          throw new Error('Too early for dummy post. Wait ' + waitSec + ' more seconds.');
        }
        log('  Time lock check passed.', 'success');
        await doDummyPost();
        log('  Dummy post complete — screening advanced.', 'success');
        return;
      }

      const { fields, byteLength } = packPostMessage(msgText);
      // One nonce per logical attempt; wallet approval/transport retries retain it.
      // The logical nonce is retained across state refreshes; publication rejects duplicate IDs.
      log('Posting message (' + byteLength + ' bytes)...', 'info');

      // Pre-flight: check note exists + time lock expired
      let infoResult = null;
      for (let i = 0; i < 3; i++) {
        try {
          infoResult = await readDepositInfo();
          const { amount } = infoResult;
          if (amount > 0n) break;
        } catch (e) { if (e?.code === 'BB_DEPOSIT_READ') throw e;}
        if (i < 2) await sleep(5000);
      }
      if (!infoResult) throw new Error('Could not read deposit info.');
      const { amount, nextAllowedTime } = infoResult;
      if (amount === 0n) throw new Error('No deposit note found. Claim a deposit first.');
      let now = BigInt(await getL2Timestamp(a, aztecNode));
      if (nextAllowedTime > now) {
        const waitSec = Number(nextAllowedTime - now);
        // In auto mode, wait for the cooldown. Otherwise, throw with a helpful message.
        if (config.action === 'auto') {
          log('  Cooldown: ' + waitSec + 's remaining (~' + Math.ceil(waitSec / 60) + ' min). Waiting...', 'info');
          while (true) {
            const n = BigInt(await getL2Timestamp(a, aztecNode));
            if (nextAllowedTime <= n) break;
            const rem = Number(nextAllowedTime - n);
            log('  [' + rem + 's remaining] Waiting for cooldown...', 'info');
            await sleep(Math.min(rem * 1000, 30000));
          }
          log('  Cooldown expired!', 'success');
        } else {
          throw new Error('Too early to post. Wait ' + waitSec + ' more seconds (~' + Math.ceil(waitSec / 60) + ' min).');
        }
      }
      log('  Time lock check passed.', 'success');

      // Fetch screening hints (child + grandchild PostNotes for the screening proof)
      log('  Fetching screening hints...', 'info');
      const [childHint, grandchildHint] = await readScreeningHints(contract, address, requireDepositChain());
      log('  Screening hints fetched: child=' + (childHint ? 'yes' : 'no') + ', grandchild=' + (grandchildHint ? 'yes' : 'no'), 'info');
      log('  Pre-flight passed.', 'success');

      const operation=JSON.stringify({schemaVersion:1,kind:'post',nonce:postNonce.toString(),message:msgText,depositChain:requireDepositChain().toString()});
      if(resumedPost&&operation!==JSON.stringify(resumedPost))throw Object.assign(new Error('Saved post intent changed.'),{code:'BB_RECOVERY_REQUIRED'});
      if(typeof transactionJournal?.setOperation!=='function')throw Object.assign(new Error('Post recovery storage is required.'),{code:'BB_JOURNAL_INVALID'});
      const postId=await a.poseidon2HashWithSeparator([new a.Fr(1),l2Addr.toField(),postNonce],0x42420102);
      const exists=unwrapPostValue(await contract.methods.get_post_exists(postId).simulate({from:address}));
      if(exists!==false)throw Object.assign(new Error('Post publication must be reconciled before another proof.'),{code:'BB_RECOVERY_REQUIRED'});
      transactionJournal.setOperation(operation);
      const result = await sendPrivate('post', [
        requireDepositChain(),
        postNonce,
        fields.map(f => new a.Fr(f)),
        byteLength,
        false, // is_dummy
        childHint,
        grandchildHint
      ]);
      const receipt = result.receipt;
      log('  TX confirmed! Block: ' + receipt.blockNumber + ', Status: ' + receipt.status, 'success');
      if (receipt.transactionFee !== undefined) {
        log('  Fee paid: ' + toAztec(BigInt(receipt.transactionFee), 6) + ' AZTEC', 'info');
      }
      log('  Message posted.', 'success');
    }

    // ============================================================
    // DUMMY POST (internal helper — advances screening without storing content)
    // ============================================================
    async function doDummyPost() { return withFreshPostState(doDummyPostAttempt, async()=>{
      const saved=await transactionJournal.inspect();
      if(!saved?.applicationNullifier||!saved.operation)throw Object.assign(new Error('Saved screening spend is unavailable.'),{code:'BB_RECOVERY_REQUIRED'});
      const intent=JSON.parse(saved.operation);
      if(intent.kind!=='dummy'||intent.depositChain!==requireDepositChain().toString())throw Object.assign(new Error('Saved screening identity changed.'),{code:'BB_RECOVERY_REQUIRED'});
      await transactionJournal.allowReplacement(saved.operation);
      resumedSpend={intent,operation:saved.operation,applicationNullifier:saved.applicationNullifier};
      log('  State changed; refreshing hints for the same saved screening step.', 'warn');
      await wallet.pxe.sync();
    }, 2, dummyStateCanRetry); }
    async function doDummyPostAttempt() {
      if (!contract) throw new Error('PXE setup required for dummy post.');
      if ((await readDepositInfo()).amount === 0n) throw new Error('No live deposit for dummy post.');

      // Fetch screening hints
      const [childHint, grandchildHint] = await readScreeningHints(contract, address, requireDepositChain());

      const dummyFields = new Array(32).fill(0).map(() => new a.Fr(0));
      const result = await sendPrivate('post', [
        requireDepositChain(),
        new a.Fr(0),
        dummyFields,
        0,
        true, // is_dummy = true
        childHint,
        grandchildHint
      ]);
      const receipt = result.receipt;
      log('  Dummy post TX confirmed! Block: ' + receipt.blockNumber + ', Status: ' + receipt.status, 'info');
      if (receipt.transactionFee !== undefined) {
        log('  Fee paid: ' + toAztec(BigInt(receipt.transactionFee), 6) + ' AZTEC', 'info');
      }
    }

    // ============================================================
    // LIST action
    // ============================================================
    async function doList() {
      if (!contract) throw new Error('PXE setup required for list.');

      const jsonOutput = !!config.jsonOutput;

      if (!jsonOutput) log('Loading posts...', 'info');
      const countResult = await contract.methods.get_post_count().simulate({ from: address });
      const count = safePostOrder(countResult);
      if (!jsonOutput) log('  Post count: ' + count, 'info');

      // Check censor config
      let censorAddr = null, kMult = 64;
      try {
        const censorResult = await contract.methods.get_censor().simulate({ from: address });
        let cv = censorResult;
        if (cv && cv.result !== undefined) cv = cv.result;
        if (cv && cv.value !== undefined) cv = cv.value;
        censorAddr = cv && cv.toString ? cv.toString() : (cv ? '0x' + BigInt(cv).toString(16).padStart(64, '0') : null);
      } catch (e) {}
      try {
        const kResult = await contract.methods.get_k_multiplier().simulate({ from: address });
        kMult = extractInt(kResult);
      } catch (e) {}
      const censorActive = censorAddr && !censorAddr.endsWith('0000000000000000000000000000000000000000');
      if (censorActive && !jsonOutput) log('  Censor: ACTIVE (K=' + kMult + ')', 'warn');

      // Read censor_window and max_save_up
      let censorWindow = 0, maxSaveUp = 0;
      try {
        const cwResult = await contract.methods.get_censor_window().simulate({ from: address });
        censorWindow = Number(extractInt(cwResult));
      } catch (e) {}
      try {
        const msuResult = await contract.methods.get_max_save_up().simulate({ from: address });
        maxSaveUp = Number(extractInt(msuResult));
      } catch (e) {}
      if (censorWindow > 0 && !jsonOutput) log('  Censor window: ' + censorWindow + 's', 'info');
      if (maxSaveUp > 0 && !jsonOutput) log('  Max save-up: ' + maxSaveUp, 'info');

      // Read moderation policy from contract
      let policyText = null, policyVersion = null;
      try {
        const snapshot = await readPolicySnapshot(a, contract, address);
        const policyFields = snapshot.fields;
        const policyLen = snapshot.byteLength;
        policyVersion = snapshot.version;
        if (policyLen > 0 && g.unpackFieldsToString) {
          policyText = g.unpackFieldsToString(policyFields, policyLen);
          if (policyText && !jsonOutput) {
            log('  --- Moderation Policy ---', 'info');
            for (const line of policyText.split('\n')) log('  | ' + line, 'info');
            log('  -------------------------', 'info');
          }
        }
      } catch (e) {}

      if (count === 0) {
        if (jsonOutput) { console.log(JSON.stringify({ count: 0, posts: [], censor: censorAddr, kMultiplier: kMult, policy: policyText || '', policyVersion, censorWindow, maxSaveUp })); }
        else { log('  No posts yet.', 'info'); }
        return;
      }

      const _jsonPosts = [];

      for (let i = 0; i < count; i++) {
        let postId = null;
        try {
          postId = await resolvePostId(a, contract, address, { postIndex: i });
          const idField = new a.Fr(BigInt(postId));
          const postResult = await contract.methods.get_post(idField).simulate({ from: address });
          const vals = extractFieldArray(postResult);
          const length = await contract.methods.get_post_length(idField).simulate({ from: address });
          const msg = decodePostMessage(vals, length);

          // Check if flagged
          let flagged = false;
          try {
            const flagResult = await contract.methods.is_post_flagged(idField).simulate({ from: address });
            let fv = flagResult;
            if (fv && fv.result !== undefined) fv = fv.result;
            if (fv && fv.value !== undefined) fv = fv.value;
            flagged = fv && (fv === true || BigInt(fv.toString ? fv.toString() : fv) > 0n);
          } catch (e) {}

          // Collect censor response and flagged_by for flagged posts
          let censorResponse = null, flaggedBy = null;
          if (flagged) {
            try {
              const respResult = await contract.methods.get_censor_response(idField).simulate({ from: address });
              const respVals = extractFieldArray(respResult);
              const reasonLength = await contract.methods.get_censor_response_length(idField).simulate({ from: address });
              censorResponse = decodeModerationReason(respVals, unwrapPostValue(reasonLength));
            } catch (e) {}
            try {
              const fbResult = await contract.methods.get_post_flagged_by(idField).simulate({ from: address });
              let fbv = fbResult;
              if (fbv && fbv.result !== undefined) fbv = fbv.result;
              if (fbv && fbv.value !== undefined) fbv = fbv.value;
              flaggedBy = fbv?.inner ? fbv.inner.toString() : (fbv?.toString ? fbv.toString() : fbv);
            } catch (e) {}
          }

          // Read post timestamp (for censor window calculations)
          let timestamp = 0;
          try {
            const timeResult = await contract.methods.get_post_time(idField).simulate({ from: address });
            timestamp = Number(extractInt(timeResult));
          } catch (e) {}

          const postPolicyVersion = canonicalPostId(a, await contract.methods.get_post_policy_version(idField).simulate({ from: address }));
          const flagDeadline = String(unwrapPostValue(await contract.methods.get_post_flag_deadline(idField).simulate({ from: address })));
          if (jsonOutput) {
            _jsonPosts.push({ policyVersion: postPolicyVersion, flagDeadline, index: i, orderIndex: String(i), postId, text: msg || '', flagged, censorResponse, flaggedBy, timestamp });
          } else if (flagged) {
            log('  [' + i + '] ' + postId + ' [FLAGGED] ' + (msg || '(binary data)'), 'warn');
            if (censorResponse) log('         ↳ Censor: ' + censorResponse, 'warn');
            if (flaggedBy) log('         ↳ Flagged by: ' + flaggedBy, 'warn');
          } else {
            log('  [' + i + '] ' + postId + ' ' + (msg || '(binary data)'), 'info');
          }
        } catch (err) {
          if (jsonOutput) {
            _jsonPosts.push({ index: i, orderIndex: String(i), postId, text: '', flagged: false, error: 'Post could not be read' });
          } else {
            log('  [' + i + '] Error: ' + 'request did not complete', 'error');
          }
        }
      }
      if (jsonOutput) {
        console.log(JSON.stringify({ count, posts: _jsonPosts, censor: censorAddr, kMultiplier: kMult, censorWindow, maxSaveUp, policy: policyText || '', policyVersion }));
      } else {
        log('  All ' + count + ' posts loaded.', 'success');
      }
    }

    // ============================================================
    // WITHDRAW action (L2)
    // ============================================================
    async function doWithdraw() {
      if (!contract) throw new Error('PXE setup required for withdraw.');

      // Note absence alone cannot distinguish an unclaimed receipt, incomplete
      // wallet state and an actual withdrawal. Require its exact canonical exit.
      let noteInfo;
      try { noteInfo = await readDepositInfo(); }
      catch (e) { if (e?.code === 'BB_DEPOSIT_READ') throw e;
        throw new Error('Cannot determine the live deposit.');
      }
      if (noteInfo.amount === 0n) {
        const unknown = () => Object.assign(new Error('No live deposit note was found, but a successful withdrawal has not been established. Recover the saved transaction or check the original deposit; do not make another deposit.'), {code:'BB_RECOVERY_UNKNOWN'});
        try {
          const priorExit = await a.boundedTransactionRead(async () => {
          const active = await new ethers.Contract(portalAddr, PORTAL_ABI, provider).getDeposit(l1Account);
          if (BigInt(active.amount) <= 0n || BigInt(active.nonce) <= 0n || selectedChain == null) throw unknown();
          // Authenticate the selected private chain against this receipt and owner;
          // an exit for another deposit must not complete this withdrawal request.
          await doReuseDeposit();
          if (BigInt(depositInfo.amount) !== BigInt(active.amount) || BigInt(depositInfo.depositNonce) !== BigInt(active.nonce)) throw unknown();
          const content = escrowContent(a, ethers, false, l2Addr, portalAddr, l1Account, BigInt(active.amount), BigInt(active.nonce), version, nodeInfo.l1ChainId);
          const chain = await a.poseidon2HashWithSeparator([new a.Fr(1), l2Addr.toField(), address.toField(), content, new a.Fr(BigInt(depositInfo.secret))], 0x42420101);
          if (chain.toBigInt() !== selectedChain) throw unknown();
          const leaf = computeWithdrawMessageLeaf(a, ethers, l2Addr, portalAddr, l1Account, BigInt(active.amount), BigInt(active.nonce), version, nodeInfo.l1ChainId);
          const found = await searchWithdrawal(leaf, await aztecNode.getBlockNumber());
          if (!found) throw unknown();
          return found;
          }, 20000);
          log('Confirmed prior withdrawal. Tx hash: ' + priorExit.txHash, 'success');
          log('  Run claim-l1 to check settlement and claim your ETH on L1.', 'info');
          return;
        } catch { throw unknown(); }
      }
      log('  Deposit note found: ' + noteInfo.amount.toString() + ' wei', 'info');

      // The contract checks withdrawal eligibility based on screening state:
      //   last_screened_index >= last_real_post_index (all real posts screened)
      //   OR no real posts → check initial lock (next_allowed_time)
      // We use the deposit info to pre-flight this for the user.
      if (noteInfo) {
        const NO_SCREENED = 0n;
        const NO_REAL_POST = 0n;
        const noRealPosts = noteInfo.lastRealPostIndex === NO_REAL_POST;
        const nothingScreened = noteInfo.lastScreenedIndex === NO_SCREENED;
        let canWithdraw = false;
        let waitReason = '';
        if (noRealPosts) {
          // No real posts — check initial lock
          let now = BigInt(await getL2Timestamp(a, aztecNode));
          if (noteInfo.nextAllowedTime > now) {
            const waitSec = Number(noteInfo.nextAllowedTime - now);
            waitReason = 'initial lock: ' + waitSec + 's remaining';
          } else {
            canWithdraw = true;
          }
        } else if (nothingScreened) {
          waitReason = 'real posts exist but none screened yet';
        } else if (noteInfo.lastScreenedIndex >= noteInfo.lastRealPostIndex) {
          canWithdraw = true;
        } else {
          const unscreened = noteInfo.lastRealPostIndex - noteInfo.lastScreenedIndex;
          waitReason = unscreened.toString() + ' real post(s) not yet screened';
        }

        const eligibilityNow = BigInt(await getL2Timestamp(a, aztecNode));
        if (noteInfo.nextAllowedTime > eligibilityNow) {
          canWithdraw = false;
          waitReason = 'cooldown: ' + (noteInfo.nextAllowedTime - eligibilityNow).toString() + 's remaining';
        }
        if (!canWithdraw) {
          if (config.action === 'auto') {
            log('  Withdraw not ready: ' + waitReason + '. Will make dummy posts to advance screening.', 'info');
            // Read censor_window to know how long to wait before screening is possible
            let censorWindow = 3600n;
            try {
              const cwResult = await contract.methods.get_censor_window().simulate({ from: address });
              censorWindow = BigInt(extractInt(cwResult));
            } catch (e) {}
            // Make dummy posts until screening catches up
            for (let attempt = 0; attempt < 20; attempt++) {
              // Wait until next_allowed_time (so we can make a dummy post)
              let info3 = null;
              try {
                const r3 = await readDepositInfo();
                info3 = r3;
              } catch (e) { if (e?.code === 'BB_DEPOSIT_READ') throw e; break; }
              if (info3.amount === 0n) { canWithdraw = true; break; }
              if (info3.lastRealPostIndex === NO_REAL_POST) {
                let now3 = BigInt(await getL2Timestamp(a, aztecNode));
                if (info3.nextAllowedTime <= now3) { canWithdraw = true; break; }
                const waitSec = Number(info3.nextAllowedTime - now3);
                log('  Waiting ' + waitSec + 's for initial lock to expire...', 'info');
                await sleep(Math.min(waitSec * 1000 + 5000, 60000));
                continue;
              }
              if (info3.lastScreenedIndex !== NO_SCREENED && info3.lastScreenedIndex >= info3.lastRealPostIndex &&
                  info3.nextAllowedTime <= BigInt(await getL2Timestamp(a, aztecNode))) {
                canWithdraw = true; break;
              }
              // Need to make a dummy post, but first wait for next_allowed_time
              let now4 = BigInt(await getL2Timestamp(a, aztecNode));
              if (info3.nextAllowedTime > now4) {
                const waitSec = Number(info3.nextAllowedTime - now4);
                log('  Waiting ' + waitSec + 's for cooldown before dummy post...', 'info');
                await sleep(Math.min(waitSec * 1000 + 5000, 60000));
              }
              // Also wait for censor_window to pass (so child post is old enough to screen)
              // The child post's timestamp must be <= now - censor_window
              // We don't know exact child timestamp, but it's the most recent real post
              // In practice, waiting for next_allowed_time + censor_window should suffice
              log('  Making dummy post #' + (attempt + 1) + ' to advance screening...', 'info');
              try {
                await doDummyPost();
              } catch (e) { if (!screeningFailureCanWait(e)) throw e;
                log('  Dummy post failed: ' + 'request did not complete', 'warn');
                // If it's a timing issue, wait and retry
                await sleep(30000);
              }
              // Check if we can withdraw now
              await sleep(5000);
            }
            if (!canWithdraw) throw new Error('Withdraw timed out: could not advance screening with dummy posts. ' + waitReason);
            log('  Withdraw ready!', 'success');
          } else {
            throw new Error('Too early to withdraw: ' + waitReason + '. Make dummy posts to advance screening (use --action post --dummy).');
          }
        } else {
          log('  Withdraw eligibility confirmed.', 'success');
        }
      }

      log('Withdrawing (sending L2->L1 message)...', 'info');
      // V1 withdrawal burns the explicitly selected deposit identity.
      const result = await sendPrivate('withdraw', [requireDepositChain()]);
      const receipt = result.receipt;
      log('  TX confirmed! Block: ' + receipt.blockNumber + ', Status: ' + receipt.status, 'success');
      if (receipt.transactionFee !== undefined) {
        log('  Fee paid: ' + toAztec(BigInt(receipt.transactionFee), 6) + ' AZTEC', 'info');
      }
      log('  L2->L1 message sent. Tx hash: ' + receipt.txHash, 'success');
      log('', 'info');
      log('  ═══════════════════════════════════════════', 'success');
      log('  L2 block: ' + receipt.blockNumber, 'success');
      log('  Tx hash:  ' + receipt.txHash, 'success');
      log('  ═══════════════════════════════════════════', 'success');
      log('', 'info');
      log('  The epoch proof must land on L1 before you can claim.', 'info');
      log('  You can monitor progress on an Aztec block explorer.', 'info');
      log('  Run claim-l1 with this portal and wallet to check settlement.', 'info');
      log('  If settlement is pending, retry the claim later.', 'info');
    }

    // ============================================================
    // CLAIM-L1 action (consume Outbox message via portal.withdraw)
    // ============================================================
    async function doClaimL1() {
      if (!ethSigner) throw new Error('L1 signer required for claim-l1.');
      if (!portalDeployed) throw new Error('Portal not deployed at ' + portalAddr + '.');

      const network = await provider.getNetwork();
      const chainId = network.chainId;

      log('Claiming ETH on L1...', 'info');
      log('  Portal:     ' + portalAddr, 'info');
      log('  Depositor:  ' + l1Account, 'info');
      log('  Chain ID:   ' + chainId.toString(), 'info');

      // Find the withdrawal tx hash
      let withdrawTxHash = config.withdrawTxHash || null;
      let messageIndexInTx = undefined;

      const active = await new ethers.Contract(portalAddr, PORTAL_ABI, provider).getDeposit(l1Account);
      const withdrawAmount = BigInt(active.amount);
      portalDepositNonce = BigInt(active.nonce);
      if (!withdrawAmount || !portalDepositNonce) throw new Error('No active L1 receipt remains to refund.');

      if (!withdrawTxHash) {
        log('  No withdrawal tx hash provided. Scanning L2 blocks...', 'info');
        const messageLeaf = computeWithdrawMessageLeaf(a, ethers, l2Addr, portalAddr, l1Account, withdrawAmount, portalDepositNonce, version, chainId);
        log('  Message leaf: 0x' + messageLeaf.toBigInt().toString(16), 'info');
        const latestBlock = await aztecNode.getBlockNumber();
        const found = await searchWithdrawal(messageLeaf,latestBlock);
        if (!found) {
          throw Object.assign(new Error('No matching withdrawal found in complete canonical history. Check the selected receipt and wallet.'),{code:'BB_RECOVERY_UNKNOWN'});
        }
        withdrawTxHash = found.txHash;
        messageIndexInTx = found.messageIndexInTx;
      }

      log('  Withdrawal tx: ' + withdrawTxHash, 'info');

      const messageLeaf = computeWithdrawMessageLeaf(a, ethers, l2Addr, portalAddr, l1Account, withdrawAmount, portalDepositNonce, version, chainId);
      log('  Message leaf: ' + messageLeaf.toString(), 'info');

      // Settlement belongs to the network. Return a resumable pending outcome;
      // do not keep a client process polling for ninety minutes.
      let witness;
      try {witness=await aztecNode.getL2ToL1MembershipWitness(a.TxHash.fromString(withdrawTxHash),messageLeaf,messageIndexInTx);}
      catch {throw Object.assign(new Error('Could not check withdrawal settlement. Preserve the withdrawal transaction and retry.'),{code:'BB_RECOVERY_UNKNOWN'});}
      if(!witness) {
        log('Withdrawal is recorded. Network settlement is pending; retry this claim later.','info');
        throw Object.assign(new Error('Network settlement is pending. Retry this claim later.'),{code:'BB_SETTLEMENT_PENDING'});
      }

      const epochNumber = witness.epochNumber;
      const numCheckpointsInEpoch = witness.numCheckpointsInEpoch;
      const leafIndex = witness.leafIndex;
      const siblingPath = witness.siblingPath;

      log('  Epoch proof found!', 'success');
      log('  Epoch: ' + epochNumber, 'info');
      log('  Checkpoints in epoch: ' + numCheckpointsInEpoch, 'info');
      log('  Leaf index: ' + leafIndex.toString(), 'info');
      log('  Sibling path size: ' + siblingPath.pathSize, 'info');

      // Check if already consumed
      const outboxAddress = ethers.getAddress(l1Contracts.outboxAddress.toString());
      const outbox = new ethers.Contract(outboxAddress, OUTBOX_ABI, provider);
      const messageLeafId = (1n << BigInt(siblingPath.pathSize)) + BigInt(leafIndex);
      let alreadyConsumed = false;
      try {
        alreadyConsumed = await outbox.hasMessageBeenConsumedAtEpoch(BigInt(epochNumber), messageLeafId);
      } catch (e) {
        throw Object.assign(new Error('Could not verify the Outbox consumption state.'),{code:'BB_RECOVERY_UNKNOWN'});
      }
      if (alreadyConsumed) {
        throw Object.assign(new Error('Outbox message is consumed. Verify the matching Ethereum refund receipt before treating it as paid.'),{code:'BB_RECOVERY_UNKNOWN'});
      }

      log('  Deposit balance in portal: ' + toEtherStr(withdrawAmount) + ' ETH', 'info');

      // Call portal.withdraw on L1
      log('  Sending L1 withdrawal tx...', 'info');
      const pathHex = siblingPath.toBufferArray().map(buf => '0x' + Buffer.from(buf).toString('hex'));
      const refunded=await ethereumJournal.send({
        data:new ethers.Interface(PORTAL_ABI).encodeFunctionData('withdraw',[BigInt(epochNumber),BigInt(numCheckpointsInEpoch),BigInt(leafIndex),pathHex]),value:'0',
        expected:{kind:'withdraw',nonce:portalDepositNonce.toString(),amount:withdrawAmount.toString()},
      });
      log('  L1 refund transaction: '+refunded.txHash,'info');
      log('  Matching Withdrawn event and canonical receipt verified. ETH claimed successfully!','success');
    }

    // ============================================================
    // L2 timestamp helper
    // ============================================================
    async function getL2Timestamp(a, aztecNode) {
      const blockNum = await aztecNode.getBlockNumber();
      const block = await aztecNode.getBlock(blockNum);
      const ts = block.timestamp || block.header?.globalVariables?.timestamp || block.header?.timestamp;
      if (ts === undefined || ts === null) throw new Error('Could not get L2 timestamp from block');
      return Number(ts);
    }

    // ============================================================
    // Wait for L1->L2 message to become claimable (simulates claim_deposit)
    // ============================================================
    async function waitForL2Ingest() {
      if (!contract) return;
      if (!depositInfo) return;
      log('  Waiting for L2 to ingest the L1 deposit (usually ~5-10 min)...', 'info');
      const depositorField = a.Fr.fromHexString(l1Account);
      const secret = new a.Fr(BigInt(depositInfo.secret));
      const deadline = Date.now() + 15 * 60 * 1000; // 15 min max
      while (Date.now() < deadline) {
        try {
          await contract.methods.claim_deposit(
            depositorField, depositInfo.amount, depositInfo.depositNonce, secret, depositInfo.leafIndex
          ).simulate({ from: address });
          log('  L1->L2 message is available!', 'success');
          return;
        } catch (e) { if (e?.code === 'BB_DEPOSIT_READ') throw e;
          const msg = (e.message || '').toLowerCase();
          if (msg.includes('message') || msg.includes('l1') || msg.includes('membership') || msg.includes('not found')) {
            log('  Not ready yet, waiting 20s...', 'info');
            await sleep(20000);
          } else {
            log('  Check failed: ' + 'request did not complete', 'warn');
            await sleep(20000);
          }
        }
      }
      throw new Error('L1->L2 message not available after 15 min. Try claiming later.');
    }

    // ============================================================
    // Helper: load censor wallet + create censor-bound contract
    // ============================================================
    async function _loadCensorWalletAndContract() {
      let censorWalletJson = config.censorWalletJson || null;
      if (!censorWalletJson && config.censorWalletPath) {
        const censorWalletPath = config.censorWalletPath;
        if (fs.existsSync(censorWalletPath)) {
          censorWalletJson = JSON.parse(fs.readFileSync(censorWalletPath, 'utf8'));
          log('Loaded censor wallet from ' + censorWalletPath, 'success');
        } else {
          throw new Error('Censor wallet file not found: ' + censorWalletPath);
        }
      }
      if (!censorWalletJson) throw new Error('Censor wallet required.');
      if (!censorWalletJson.secretKey) throw new Error('Censor wallet JSON missing secretKey.');

      if(censorWalletJson.secretKey.toLowerCase()!==secretKeyHex.toLowerCase()||walletSalt(censorWalletJson.salt)!==saltVal)throw new Error('Load the moderator wallet as the active wallet before a moderator action.');
      if(!transactionJournal)throw Object.assign(new Error('Durable moderator transaction journal is required.'),{code:'BB_JOURNAL_INVALID'});
      const censorSk = a.Fr.fromHexString(censorWalletJson.secretKey);
      const censorSigningKey = a.deriveSigningKey(censorSk);
      const censorAccountContract = new a.SchnorrInitializerlessAccountContract(censorSigningKey);
      const { publicKeys: censorPublicKeys } = await a.deriveKeys(censorSk);
      const censorAccountArtifact = await censorAccountContract.getContractArtifact();
      const censorImmutablesHash = await censorAccountContract.getImmutablesHash();
      const censorSaltVal = walletSalt(censorWalletJson.salt);
      const censorInstance = await a.getContractInstanceFromInstantiationParams(censorAccountArtifact, {
        constructorArtifact: undefined, constructorArgs: undefined,
        salt: new a.Fr(censorSaltVal), publicKeys: censorPublicKeys, immutablesHash: censorImmutablesHash,
      });
      const censorPartialAddress = await a.computePartialAddress(censorInstance);
      const censorAddress = censorInstance.address;
      log('  Censor address: ' + censorAddress.toString(), 'info');

      log('  Registering censor account with PXE...', 'info');
      const censorDerivedKeys = await a.deriveKeys(censorSk);
      await pxe.registerAccount(censorDerivedKeys, censorPartialAddress);
      await retry(() => pxe.registerContract(censorInstance), 'register-censor', log, 5);
      log('  Censor account registered.', 'success');

      const censorWallet = createAztecWallet(a, pxe, aztecNode, rawNode, log, censorSk, {preProveHook:config.preProveHook,contextGuard:config.contextGuard,transactionJournal});
      const censorAccountManager = await a.AccountManager.create(censorWallet, censorSk, censorAccountContract, { salt: new a.Fr(censorSaltVal) });
      censorWallet._accountManager = censorAccountManager;

      log('  Storing censor signing key capsule...', 'info');
      const censorSigningPublicKey = await censorAccountContract.getSigningPublicKey();
      const censorConstructorArtifact = censorAccountArtifact.functions.find(f => f.name === 'constructor');
      if (censorConstructorArtifact) {
        const storeCall = new a.ContractFunctionInteraction(
          censorWallet, censorInstance.address, censorConstructorArtifact,
          [censorSigningPublicKey.x, censorSigningPublicKey.y]
        );
        await storeCall.simulate({ from: censorInstance.address });
        log('  Censor capsule stored.', 'success');
      }

      const censorContract = await a.Contract.at(l2Addr, contractArtifact, censorWallet);
      await pxe.sync();
      return { censorWallet, censorAddress, censorContract };
    }

    // ============================================================
    // SET-MODERATION-POLICY action (censor updates the policy text)
    // ============================================================
    async function doSetModerationPolicy() {
      if (!contract) throw new Error('PXE setup required for set-moderation-policy.');

      const policyText = config.moderationPolicy !== undefined ? config.moderationPolicy : (g.DEFAULT_MODERATION_POLICY || '');
      if (!policyText || !policyText.trim()) throw new Error('Policy text required (use --moderation-policy <text>).');

      const packFn = g.packStringToFields;
      if (!packFn) throw new Error('packStringToFields not available (load moderation-policy.js)');
      const { fields: policyFields, len: policyLen } = packFn(policyText);

      const { censorWallet, censorAddress, censorContract } = await _loadCensorWalletAndContract();

      log('Setting moderation policy (' + policyLen + ' bytes)...', 'info');
      const result = await sendCensorPrivate(censorWallet,censorAddress,censorContract,'set_moderation_policy',[
        policyFields.map(f => new a.Fr(f)),new a.Fr(BigInt(policyLen))
      ]);
      const receipt = result.receipt;
      log('  TX confirmed! Block: ' + receipt.blockNumber + ', Status: ' + receipt.status, 'success');
      if (receipt.transactionFee !== undefined) {
        log('  Fee paid: ' + toAztec(BigInt(receipt.transactionFee), 6) + ' AZTEC', 'info');
      }
      log('  Moderation policy updated.', 'success');
    }

    // ============================================================
    // DECLARE-IMMORAL action (censor flags a post)
    // ============================================================
    async function doDeclareImmoral() {
      if (!contract) throw new Error('PXE setup required for declare-immoral.');

      // Resolve display order once before signing. Stable ID stays fixed through
      // wallet retries even if more posts are published in the meantime.
      const postId = await resolvePostId(a, contract, address, config);
      const postIdField = new a.Fr(BigInt(postId));
      const responseText = config.censorResponse || '';

      const {censorWallet,censorAddress,censorContract}=await _loadCensorWalletAndContract();

      const flagArguments = await moderationArguments(a, censorContract, censorAddress, postIdField,
        responseText, config.expectedPolicyVersion);
      log('Declaring post ' + postId + ' as immoral...', 'info');
      const result = await sendCensorPrivate(censorWallet, censorAddress, censorContract, 'declare_immoral', flagArguments);
      const receipt = result.receipt;
      log('  TX confirmed! Block: ' + receipt.blockNumber + ', Status: ' + receipt.status, 'success');
      if (receipt.transactionFee !== undefined) {
        log('  Fee paid: ' + toAztec(BigInt(receipt.transactionFee), 6) + ' AZTEC', 'info');
      }
      log('  Post ' + postId + ' flagged as immoral.', 'success');

      // Verify: read back the flagged_by record
      try {
        const flaggedByResult = await contract.methods.get_post_flagged_by(postIdField).simulate({ from: address });
        let fbv = flaggedByResult;
        if (fbv && fbv.result !== undefined) fbv = fbv.result;
        if (fbv && fbv.value !== undefined) fbv = fbv.value;
        const flaggedBy = fbv?.inner ? fbv.inner.toString() : (fbv?.toString ? fbv.toString() : fbv);
        log('  Public record: flagged by ' + flaggedBy, 'info');
      } catch (e) {
        log('  Could not read flagged_by record: ' + 'request did not complete', 'warn');
      }
    }

    // ============================================================
    // TRANSFER-CENSOR action (censor transfers rights to new address)
    // ============================================================
    async function doTransferCensor() {
      if (!contract) throw new Error('PXE setup required for transfer-censor.');

      const newCensorStr = config.newCensor;
      if (!newCensorStr) throw new Error('New censor address required (use --new-censor <addr>).');

      const {censorWallet,censorAddress,censorContract}=await _loadCensorWalletAndContract();

      const newCensorAddr = a.AztecAddress.fromFieldUnsafe(a.Fr.fromHexString(newCensorStr));
      log('Transferring censor rights to ' + newCensorAddr.toString() + '...', 'info');

      const result = await sendCensorPrivate(censorWallet,censorAddress,censorContract,'transfer_censor',[newCensorAddr]);
      const receipt = result.receipt;
      log('  TX confirmed! Block: ' + receipt.blockNumber + ', Status: ' + receipt.status, 'success');
      if (receipt.transactionFee !== undefined) {
        log('  Fee paid: ' + toAztec(BigInt(receipt.transactionFee), 6) + ' AZTEC', 'info');
      }

      // Verify
      try {
        const newCensorResult = await contract.methods.get_censor().simulate({ from: address });
        let ncv = newCensorResult;
        if (ncv && ncv.result !== undefined) ncv = ncv.result;
        if (ncv && ncv.value !== undefined) ncv = ncv.value;
        const newCensorOnChain = ncv?.inner ? ncv.inner.toString() : (ncv?.toString ? ncv.toString() : ncv);
        log('  New censor on-chain: ' + newCensorOnChain, 'success');
      } catch (e) {
        log('  Could not read new censor: ' + 'request did not complete', 'warn');
      }
    }

    // ============================================================
    // Action dispatch
    // ============================================================
    let result = { ok: true, state: stateStatus };

    if (action === 'deposit') {
      if (config.reuseTxHash || config.reuse === 'true' || config.reuse === true) {
        await doReuseDeposit();
        log('', 'success');
        log('Deposit recovered. Run the claim action to claim it on L2.', 'success');
        if (depositInfo) {
          log('  Amount:     ' + toEtherStr(depositInfo.amount) + ' ETH', 'info');
          log('  Leaf index: ' + depositInfo.leafIndex.toString(), 'info');
        }
      } else {
        await doDeposit();
      }
      result.depositInfo = depositInfo ? { amount:depositInfo.amount,leafIndex:depositInfo.leafIndex,
        depositNonce:depositInfo.depositNonce,secretHash:depositInfo.secretHash,txHash:depositInfo.txHash } : null;
    } else if (action === 'claim') {
      await doClaim();
    } else if (action === 'post') {
      await doPost();
    } else if (action === 'list') {
      await doList();
    } else if (action === 'declare-immoral') {
      await doDeclareImmoral();
    } else if (action === 'transfer-censor') {
      await doTransferCensor();
    } else if (action === 'set-moderation-policy') {
      await doSetModerationPolicy();
    } else if (action === 'withdraw') {
      await doWithdraw();
    } else if (action === 'claim-l1') {
      await doClaimL1();
    } else if (action === 'auto') {
      // Full flow: deposit -> claim -> post (if msg) -> withdraw -> claim-l1
      log('', 'info');
        log('========================================', 'info');
        log('  AUTO MODE: Full user journey', 'info');
        log('========================================', 'info');

      // 1. Deposit (or reuse)
      if (stateStatus === 'zero_balance_need_deposit') {
        log('\n--- Phase 1: Deposit ---', 'info');
        if (!config.depositAmount) throw new Error('Deposit amount required for auto mode (use --amount <eth>).');
        await doDeposit();
        // Wait for L2 ingest
        log('\n--- Waiting for L2 to ingest L1 deposit (~5-10 min) ---', 'info');
        await waitForL2Ingest();
      } else if (stateStatus === 'deposited_l1_not_claimed_l2') {
        log('\n--- Phase 1: Reusing existing L1 deposit ---', 'info');
        await doReuseDeposit();
      } else if (stateStatus === 'postable') {
        log('\n--- Phase 1: Already have L2 deposit note, skipping deposit ---', 'info');
      } else if (stateStatus === 'withdrawn_l2_claimable_l1') {
        log('\n--- Already withdrawn on L2. Skipping to L1 claim. ---', 'info');
        await doClaimL1();
        result.done = true;
      }

      if (!result.done) {
        // 2. Claim on L2
        if (stateStatus !== 'postable') {
          log('\n--- Phase 2: Claim deposit on L2 ---', 'info');
          await doClaim();
        }

        // 3. Post (if message provided)
        if (config.message) {
          log('\n--- Phase 3: Post message ---', 'info');
          await doPost();
        }

        // 4. Withdraw on L2
        log('\n--- Phase 4: Withdraw on L2 ---', 'info');
        await doWithdraw();

        // 5. Claim on L1
        log('\n--- Phase 5: Claim ETH on L1 ---', 'info');
        await doClaimL1();
      }

      log('', 'success');
      log('========================================', 'success');
      log('  AUTO MODE COMPLETE!', 'success');
      log('========================================', 'success');
    } else {
      throw new Error('Unknown action: ' + action + '. Valid: status, deposit, claim, post, list, withdraw, claim-l1, auto');
    }

    result.lastEthereumTxHash = ethereumJournal?.lastTxHash || null;
    result.lastL2TxHash = transactionJournal?.lastTxHash || null;
    result.state = stateStatus;
    result.l2Addr = l2AddrHex;
    result.portalAddr = portalAddr;
    // Expose handles for web app live UI (billboard feed, countdown, etc.)
    result.handles = { pxe, wallet, contract, aztecNode, rawNode, address, l2Addr, contractSalt, version, nodeInfo, depositChainId: selectedChain };
    return result;
  };

})();
