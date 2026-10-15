import { BlockNumber } from '@aztec-labs/foundation/branded-types';
import { type Logger, type LoggerBindings, createLogger } from '@aztec-labs/foundation/log';
import { SerialQueue } from '@aztec-labs/foundation/queue';
import type { AztecAsyncKVStore } from '@aztec-labs/kv-store';
import type { L2TipsKVStore } from '@aztec-labs/kv-store/stores';
import {
  BlockHash,
  L2BlockStream,
  type L2BlockStreamEvent,
  type L2BlockStreamEventHandler,
} from '@aztec-labs/stdlib/block';
import type { BlockHeader } from '@aztec-labs/stdlib/tx';

import type { BlockSynchronizerConfig } from '../config/index.js';
import type { ContractSyncService } from '../contract/contract_sync_service.js';
import type { CachingAztecNode } from '../node/caching_aztec_node.js';
import type { AnchorBlockStore } from '../storage/anchor_block_store/index.js';
import type { Rollbackable } from '../storage/rollbackable.js';
import { blockStreamSourceFromAztecNode } from './block_stream_source.js';

/**
 * The BlockSynchronizer class orchestrates synchronization between PXE and Aztec node, maintaining an up-to-date
 * view of the L2 chain state. It handles block header retrieval, chain reorganizations, and provides an interface
 * for querying sync status.
 */
export class BlockSynchronizer implements L2BlockStreamEventHandler {
  private log: Logger;
  private isSyncing: Promise<void> | undefined;
  private readonly eventQueue = new SerialQueue();
  protected readonly blockStream: L2BlockStream;

  constructor(
    private readonly node: CachingAztecNode,
    private readonly store: AztecAsyncKVStore,
    private readonly anchorBlockStore: AnchorBlockStore,
    private readonly rollbackables: Rollbackable[],
    private readonly l2TipsStore: L2TipsKVStore,
    private readonly contractSyncService: ContractSyncService,
    private readonly config: Partial<BlockSynchronizerConfig> = {},
    bindings?: LoggerBindings,
  ) {
    this.log = createLogger('pxe:block_synchronizer', bindings);
    this.blockStream = this.createBlockStream();
    this.eventQueue.start();
  }

  protected createBlockStream(): L2BlockStream {
    return new L2BlockStream(
      blockStreamSourceFromAztecNode(this.node),
      this.l2TipsStore,
      this,
      createLogger('pxe:block_stream', this.log.getBindings()),
      {
        // PXE only tracks chain tips (it anchors on tip events and never replays payloads), so the stream runs
        // in tips-only mode: no block downloads, just the tip events that move the anchor and detect reorgs.
        tipsOnly: true,
      },
    );
  }

  /** Handle events emitted by the block stream. Serialized to prevent concurrent mutations to anchor state. */
  public handleBlockStreamEvent(event: L2BlockStreamEvent): Promise<void> {
    return this.eventQueue.put(async () => {
      try { await this.doHandleBlockStreamEvent(event); }
      catch { this.anchorEventFailed = true; throw new Error('PXE_REORG_ANCHOR_EVENT_FAILED'); }
    });
  }


  private anchorEventFailed = false;

  private async selectedAnchor() {
    const tips = await this.node.getChainTips();
    const tier = this.config.syncChainTip ?? 'proposed';
    return tier === 'proposed' ? tips.proposed : tips[tier].block;
  }

  private sameAnchor(a: { number: number; hash: string }, b: { number: number; hash: string }) {
    return a.number === b.number && a.hash === b.hash;
  }

  private async checkedHeader(block: { number: number; hash: string }) {
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

  private async checkedSelectedAnchor() {
    const block = await this.selectedAnchor();
    const header = await this.checkedHeader(block);
    if (!this.sameAnchor(block, await this.selectedAnchor())) throw new Error('PXE_REORG_ANCHOR_CHANGED');
    return { block, header };
  }

  private async doHandleBlockStreamEvent(event: L2BlockStreamEvent): Promise<void> {
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
        const tips = await this.node.getChainTips();
        if (!this.sameAnchor(tips.checkpointed.block, event.checkpointed.block) ||
            !this.sameAnchor(tips.proven.block, event.proven.block) ||
            !this.sameAnchor(target.block, await this.selectedAnchor())) {
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
          if (!this.sameAnchor(target.block, await this.selectedAnchor())) throw new Error('PXE_REORG_ANCHOR_CHANGED');
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

  /** Updates the anchor block header to the target block */
  private async updateAnchorBlockHeader(blockHeader: BlockHeader) {
    // Whenever the anchor block header is updated, we need to synchronize the private state of contracts again.
    // Therefore, we clear the contract synchronization cache here such that the sync is re-triggered upon new
    // execution.
    this.contractSyncService.wipe();

    // Cached node reads stay correct indefinitely, so this wipe is only about bounding memory growth. An anchor
    // update is the recurring trigger PXE already has.
    this.node.wipeCache();

    this.log.verbose(`Updated pxe last block to ${blockHeader.getBlockNumber()}`, blockHeader.toInspect());
    await this.anchorBlockStore.setHeader(blockHeader);
  }

  /**
   * Syncs PXE and the node by downloading the metadata of the latest blocks, allowing simulations to use
   * recent data (e.g. notes), and handling any reorgs that might have occurred.
   *
   * Note this BlockSynchronizer is designed to let its users control when a synchronization is run,
   * so this component doesn't proactively stay up to date with the blockchain.
   *
   * We do this so PXE can ensure data consistency.
   */
  public async sync() {
    if (this.isSyncing !== undefined) {
      this.log.debug(`Waiting for the ongoing sync to finish`);
      await this.isSyncing;
      return;
    }

    this.log.debug(`Syncing PXE with the node`);
    // Capture the promise locally so we always await the exact promise we created, even if this.isSyncing is modified
    // between assignment and await (e.g. due to future refactors introducing a yield point).
    const isSyncing = this.doSync();
    this.isSyncing = isSyncing;
    try {
      await isSyncing;
    } finally {
      this.isSyncing = undefined;
    }
  }

  /** Stops the block synchronizer, waiting for any in-progress sync and queued events to complete. */
  public async stop() {
    await this.isSyncing;
    await this.blockStream.stop();
    await this.eventQueue.end();
  }

  private async doSync() {
    let currentHeader;

    try {
      currentHeader = await this.anchorBlockStore.getBlockHeader();
    } catch {
      this.log.debug('Header is not set, requesting from the node');
    }
    if (!currentHeader) {
      // REFACTOR: We should know the header of the genesis block without having to request it from the node.
      await this.anchorBlockStore.setHeader((await this.node.getBlockData(BlockNumber.ZERO))!.header);
    }
    this.anchorEventFailed = false;
    await this.blockStream.sync();
    // L2BlockStream catches handler/source errors and AbortError internally.
    // Never report successful PXE sync merely because that promise resolved.
    if (this.anchorEventFailed) throw new Error('PXE_REORG_ANCHOR_EVENT_FAILED');
    const selected = await this.checkedSelectedAnchor();
    const anchor = await this.anchorBlockStore.getBlockHeader();
    if (anchor.getBlockNumber() !== selected.block.number ||
        (await anchor.hash()).toString() !== selected.block.hash) {
      throw new Error('PXE_REORG_ANCHOR_INCOMPLETE');
    }
  }
}
