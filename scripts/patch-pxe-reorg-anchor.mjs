import { createHash } from 'node:crypto';
import { readFile, lstat, realpath, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Explicit stopped-consumer dependency bootstrap only. No runtime mutation,
// retry, alternate node, retained orphan notes, or synthetic balance recovery.
export const PXE_REORG_ANCHOR_PINS = Object.freeze([
  Object.freeze({ path: 'src/block_synchronizer/block_synchronizer.ts', before: '82e7349e9e56c4d0943f81a4c11cd5fed39f04b41044d5583f5fdfdedbe21b72', previous: '5a3680b79b182d9c7d291f8329abb3809489c6293ab7f9bb32ebe80d0e9bff20', after: 'f895806904e315a314a56ec80736f28a89453bf821fbb084d3e1a71701a652fd' }),
  Object.freeze({ path: 'dest/block_synchronizer/block_synchronizer.js', before: 'bf55d5e76660f5b59fca66380575a8ad15005e263dd6a6c8f9a8f79b4936a69a', previous: '9e5fc3fc5ee5578d582aac089a4c99f335f66fb01a041ecd79e0837ed68aae78', after: 'c845d93e1fbe90855810a615607da8ac781f0c4d65f2dc2eb0c1ca4bf01f2771' }),
]);
const sha = value => createHash('sha256').update(value).digest('hex');
function methods(ts) {
  const t = value => ts ? value : '';
  return `
  ${t('private ')}anchorEventFailed = false;
  ${t('private ')}syncTips${t(": Awaited<ReturnType<CachingAztecNode['getChainTips']>> | undefined")} = undefined;

  ${t('private ')}syncPass${t(': { failed: boolean; pending: Set<Promise<unknown>> } | undefined')} = undefined;

  ${t('private ')}observeSource${t('<T>')}(read${t(': () => Promise<T>')})${t(': Promise<T>')} {
    const pass = this.syncPass;
    if (!pass) throw new Error('PXE_REORG_ANCHOR_SOURCE_FAILED');
    // Retain abandoned prefetches too. Their failure belongs to this pass,
    // never to a later sync, and must be observed before ownership is released.
    const promise = Promise.resolve().then(read).catch(() => {
      pass.failed = true;
      throw new Error('PXE_REORG_ANCHOR_SOURCE_FAILED');
    });
    pass.pending.add(promise);
    promise.then(() => pass.pending.delete(promise), () => pass.pending.delete(promise));
    return promise;
  }

  ${t('private ')}async drainSourceReads(pass${t(': { pending: Set<Promise<unknown>> }')}) {
    while (pass.pending.size) await Promise.allSettled([...pass.pending]);
  }

  ${t('private ')}snapshotBlockStreamSource() {
    const source = blockStreamSourceFromAztecNode(this.node);
    const tips = source.getL2Tips.bind(source);
    source.getL2Tips = () => this.observeSource(async () => {
      // The stream owns one atomic source plan, and may replace it only at
      // its existing post-prune reread. Never substitute a later live tip in
      // the middle of acknowledging events from that plan.
      this.syncTips = structuredClone(await tips());
      return structuredClone(this.syncTips);
    });
    const block = source.getBlockData.bind(source);
    source.getBlockData = query => this.observeSource(() => block(query));
    const blocks = source.getBlocks.bind(source);
    source.getBlocks = query => this.observeSource(() => blocks(query));
    return source;
  }

  ${t('private ')}async selectedAnchor() {
    const tips = this.syncTips;
    if (!tips) throw new Error('PXE_REORG_ANCHOR_INCOMPLETE');
    const tier = this.config.syncChainTip ?? 'proposed';
    return tier === 'proposed' ? tips.proposed : tips[tier].block;
  }

  ${t('private ')}sameAnchor(a${t(': { number: number; hash: string }')}, b${t(': { number: number; hash: string }')}) {
    return a.number === b.number && a.hash === b.hash;
  }

  ${t('private ')}async checkedHeader(block${t(': { number: number; hash: string }')}) {
    // The hash parameter is an actual SDK BlockHash, for native AND RPC nodes.
    // A hash-pinned cached response alone does not establish current canonicality.
    const pinned = await this.node.getBlock({ hash: BlockHash.fromString(block.hash) });
    const canonical = await this.node.getBlock(BlockNumber(block.number));
    if (!pinned || !canonical || pinned.header.getBlockNumber() !== block.number ||
        canonical.header.getBlockNumber() !== block.number ||
        pinned.hash.toString() !== block.hash || canonical.hash.toString() !== block.hash ||
        (await pinned.header.hash()).toString() !== block.hash ||
        (await canonical.header.hash()).toString() !== block.hash) {
      throw new Error('PXE_REORG_ANCHOR_UNAVAILABLE');
    }
    return pinned.header;
  }

  ${t('private ')}async checkedSelectedAnchor() {
    const block = await this.selectedAnchor();
    const tips = await this.node.getChainTips();
    const tier = this.config.syncChainTip ?? 'proposed';
    const live = tier === 'proposed' ? tips.proposed : tips[tier].block;
    if (live.number < block.number ||
        (live.number === block.number && !this.sameAnchor(live, block))) {
      throw new Error('PXE_REORG_ANCHOR_CHANGED');
    }
    // An advancing tier is allowed only while BOTH its current header and the
    // captured pass's exact header are canonical. No orphan cache is authority.
    if (!this.sameAnchor(live, block)) await this.checkedHeader(live);
    await this.checkedHeader(block);
    const afterTips = await this.node.getChainTips();
    const after = tier === 'proposed' ? afterTips.proposed : afterTips[tier].block;
    if (after.number < block.number ||
        (after.number === block.number && !this.sameAnchor(after, block))) {
      throw new Error('PXE_REORG_ANCHOR_CHANGED');
    }
    if (!this.sameAnchor(after, live)) await this.checkedHeader(after);
    // A reorg while checking the newer live header must not bless an orphan
    // captured header. Reauthenticate the exact pass anchor last.
    return { block, header: await this.checkedHeader(block) };
  }

  ${t('private ')}async checkAcknowledgedSnapshot() {
    const expected = this.syncTips;
    if (!expected) throw new Error('PXE_REORG_ANCHOR_INCOMPLETE');
    const actual = await this.l2TipsStore.getL2Tips();
    if (!this.sameAnchor(actual.proposed, expected.proposed)) throw new Error('PXE_REORG_ANCHOR_INCOMPLETE');
    for (const tier of ['checkpointed', 'proven', 'finalized']${t(' as const')}) {
      if (!this.sameAnchor(actual[tier].block, expected[tier].block)) {
        throw new Error('PXE_REORG_ANCHOR_INCOMPLETE');
      }
    }
  }

  ${t('private ')}async doHandleBlockStreamEvent(event${t(': L2BlockStreamEvent')})${t(': Promise<void>')} {
    if (event.type === 'chain-pruned') {
      const current = await this.anchorBlockStore.getBlockHeader();
      if (current.getBlockNumber() > event.block.number) {
        // Resolve BOTH headers before writes. Sparse history can conservatively
        // prune to 10 even though the configured canonical tier is already 12.
        // Keep the conservative rollback; never keep unknown/orphan private state.
        await this.checkedHeader(event.block);
        const target = await this.checkedSelectedAnchor();
        if (target.block.number < event.block.number) throw new Error('PXE_REORG_ANCHOR_CHANGED');
        // Check the prune event's source snapshot as well as our configured tier.
        const tips = this.syncTips;
        if (!tips || !this.sameAnchor(tips.checkpointed.block, event.checkpointed.block) ||
            !this.sameAnchor(tips.proven.block, event.proven.block) ||
            !this.sameAnchor(target.block, (await this.checkedSelectedAnchor()).block)) {
          throw new Error('PXE_REORG_ANCHOR_CHANGED');
        }
        await this.store.transactionAsync(async () => {
          for (const rollbackable of this.rollbackables) await rollbackable.rollbackToBlock(event.block.number);
          // Wipes contract sync and node caches: rediscovery uses the canonical
          // header, not synthetic retained notes.
          await this.updateAnchorBlockHeader(target.header);
        });
        // SDK tips store opens its own transaction: do not nest on IndexedDB.
        // A rollback/anchor failure cannot acknowledge the prune cursor.
        await this.l2TipsStore.handleBlockStreamEvent(event);
        return;
      }
      // A prune ignored below our configured tier still cannot bless a source
      // contradiction at/below the finalized floor (the stream will not walk it).
      await this.checkedHeader({ number: current.getBlockNumber(), hash: (await current.hash()).toString() });
    } else if (event.type !== 'blocks-added') {
      const tier = this.config.syncChainTip ?? 'proposed';
      if (event.type === 'chain-' + tier) {
        const target = await this.checkedSelectedAnchor();
        if (!this.sameAnchor(target.block, event.block)) throw new Error('PXE_REORG_ANCHOR_CHANGED');
        const current = await this.anchorBlockStore.getBlockHeader();
        const currentId = { number: current.getBlockNumber(), hash: (await current.hash()).toString() };
        if (!this.sameAnchor(currentId, target.block)) {
          // Moving an orphan anchor without the preceding conservative rollback
          // would retain private state from the old fork. Never do that, including
          // contradictions at the stream's finalized walk-back floor.
          if (currentId.number >= target.block.number) throw new Error('PXE_REORG_ANCHOR_CHANGED');
          await this.checkedHeader(currentId);
          if (!this.sameAnchor(target.block, (await this.checkedSelectedAnchor()).block)) throw new Error('PXE_REORG_ANCHOR_CHANGED');
        }
        await this.store.transactionAsync(async () => {
          await this.updateAnchorBlockHeader(target.header);
        });
        // SDK tips store opens its own transaction: do not nest on IndexedDB.
        // A rollback/anchor failure cannot acknowledge the prune cursor.
        await this.l2TipsStore.handleBlockStreamEvent(event);
        return;
      }
    }
    // Unselected tips and no-op prunes keep the SDK's normal cursor semantics.
    await this.l2TipsStore.handleBlockStreamEvent(event);
  }

`;
}
function transformed(source, ts, previous = false) {
  const begin = previous ? source.indexOf(ts ? '\n  private anchorEventFailed = false;' : '\n  anchorEventFailed = false;') : source.indexOf(ts ? '  private async doHandleBlockStreamEvent(' : '    async doHandleBlockStreamEvent(');
  const end = source.indexOf('/** Updates the anchor block header', begin);
  if (begin < 0 || end < 0) throw new Error('PXE_REORG_PATCH_LAYOUT');
  let result = source.slice(0, begin) + methods(ts) + '  ' + source.slice(end);
  const handler = ts ? 'return this.eventQueue.put(() => this.doHandleBlockStreamEvent(event));' : 'return this.eventQueue.put(()=>this.doHandleBlockStreamEvent(event));';
  if (!previous && result.split(handler).length !== 2) throw new Error('PXE_REORG_PATCH_LAYOUT');
  if (!previous) result = result.replace(handler, `return this.eventQueue.put(async () => {
      try { await this.doHandleBlockStreamEvent(event); }
      catch { this.anchorEventFailed = true; throw new Error('PXE_REORG_ANCHOR_EVENT_FAILED'); }
    });`);
  const sourceCall = 'blockStreamSourceFromAztecNode(this.node)';
  // The inserted helper also contains this call; replace only the original
  // createBlockStream occurrence before the methods region.
  const sourceAt = result.indexOf(sourceCall);
  if (sourceAt < 0 || sourceAt >= begin) throw new Error('PXE_REORG_PATCH_LAYOUT');
  result = result.slice(0, sourceAt) + 'this.snapshotBlockStreamSource()' + result.slice(sourceAt + sourceCall.length);
  const sync = previous ? `this.anchorEventFailed = false;
    await this.blockStream.sync();
    // L2BlockStream catches handler/source errors and AbortError internally.
    // Never report successful PXE sync merely because that promise resolved.
    if (this.anchorEventFailed) throw new Error('PXE_REORG_ANCHOR_EVENT_FAILED');
    const selected = await this.checkedSelectedAnchor();
    const anchor = await this.anchorBlockStore.getBlockHeader();
    if (anchor.getBlockNumber() !== selected.block.number ||
        (await anchor.hash()).toString() !== selected.block.hash) {
      throw new Error('PXE_REORG_ANCHOR_INCOMPLETE');
    }` : 'await this.blockStream.sync();';
  if (result.split(sync).length !== 2) throw new Error('PXE_REORG_PATCH_LAYOUT');
  result = result.replace(sync, `this.anchorEventFailed = false;
    this.syncTips = undefined;
    const pass = { failed: false, pending: new Set${ts ? '<Promise<unknown>>' : ''}() };
    this.syncPass = pass;
    try {
      await this.blockStream.sync();
      await this.drainSourceReads(pass);
      // The stream swallows source/handler errors; a captured plan and exact
      // acknowledgement are required even when its promise resolves.
      if (this.anchorEventFailed || pass.failed) throw new Error('PXE_REORG_ANCHOR_EVENT_FAILED');
      const selected = await this.checkedSelectedAnchor();
      const anchor = await this.anchorBlockStore.getBlockHeader();
      if (anchor.getBlockNumber() !== selected.block.number ||
          (await anchor.hash()).toString() !== selected.block.hash) {
        throw new Error('PXE_REORG_ANCHOR_INCOMPLETE');
      }
      await this.checkAcknowledgedSnapshot();
    } finally {
      await this.drainSourceReads(pass);
      this.syncTips = undefined;
      this.syncPass = undefined;
    }`);
  return result;
}
export function transformPxeReorgAnchor(source, path) {
  const pin = PXE_REORG_ANCHOR_PINS.find(pin => pin.path === path);
  if (!pin || typeof source !== 'string' || ![pin.before,pin.previous].includes(sha(source))) throw new Error('PXE_REORG_PATCH_SOURCE');
  const output = transformed(source, path.endsWith('.ts'),sha(source)===pin.previous);
  if (sha(output) !== pin.after) throw new Error('PXE_REORG_PATCH_OUTPUT');
  return output;
}
async function checkedPaths(packageRoot) {
  if (typeof packageRoot !== 'string' || !packageRoot) throw new Error('PXE_REORG_PATCH_ROOT');
  const root = resolve(packageRoot);
  if (await realpath(root) !== root) throw new Error('PXE_REORG_PATCH_SYMLINK');
  const paths = [];
  for (const pin of PXE_REORG_ANCHOR_PINS) {
    const path = join(root, pin.path);
    if (!(await lstat(path)).isFile() || await realpath(path) !== path) throw new Error('PXE_REORG_PATCH_SYMLINK');
    paths.push({ pin, path, source: await readFile(path, 'utf8') });
  }
  return paths;
}
export async function inspectPxeReorgAnchor(packageRoot) {
  const paths = await checkedPaths(packageRoot);
  const states = paths.map(({ pin, source }) => sha(source) === pin.before ? 'original' : sha(source) === pin.after ? 'patched' : sha(source) === pin.previous ? 'previous' : 'unknown');
  if (states.includes('unknown') || states[0] !== states[1]) throw new Error('PXE_REORG_PATCH_STATE');
  return Object.freeze({ state: states[0], files: Object.freeze(paths.map(({ pin, source }) => Object.freeze({ path: pin.path, sha256: sha(source) }))) });
}
export async function patchPxeReorgAnchor(packageRoot) {
  const paths = await checkedPaths(packageRoot);
  const state = await inspectPxeReorgAnchor(packageRoot);
  if (state.state === 'patched') return state;
  const outputs = paths.map(({ pin, source }) => transformPxeReorgAnchor(source, pin.path));
  for (let i = 0; i < paths.length; i++) await writeFile(paths[i].path, outputs[i]);
  return inspectPxeReorgAnchor(packageRoot);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, root, ...extra] = process.argv.slice(2);
  if (!root || extra.length || !['--verify', '--apply'].includes(mode)) {
    process.stderr.write('Usage: patch-pxe-reorg-anchor.mjs --verify|--apply EXPLICIT_PACKAGE_ROOT\n'); process.exitCode = 1;
  } else {
    try { process.stdout.write(`${JSON.stringify(await (mode === '--verify' ? inspectPxeReorgAnchor : patchPxeReorgAnchor)(root))}\n`); }
    catch { process.stderr.write('PXE_REORG_PATCH_FAILED\n'); process.exitCode = 1; }
  }
}
