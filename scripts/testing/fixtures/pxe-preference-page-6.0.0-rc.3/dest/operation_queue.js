import { SerialQueue } from '@aztec-labs/foundation/queue';
import { Timer } from '@aztec-labs/foundation/timer';
import { SimulationError } from '@aztec-labs/stdlib/errors';
import { runOperation } from './operation_lifecycle.js';
/**
 * Serializes the PXE's operations, since concurrent execution is not supported: operations execute oracles that read
 * and write the PXE stores, and concurrent runs would interfere with one another.
 *
 * Synced operations additionally run after a sync with the node and inside a staged-write session (see
 * {@link StagedWriteCoordinator}): staged writes are committed if the operation succeeds and discarded if it throws.
 */ export class OperationQueue {
    static WARN_QUEUE_DEPTH = 10;
    static WARN_WAIT_MS = 30_000;
    static WARN_INTERVAL_MS = 60_000;
    lastPressureWarningAt = -Infinity;
    queue = new SerialQueue();
    node;
    synchronizer;
    anchorBlockStore;
    stagedWriteCoordinator;
    contributors;
    autoSync;
    log;
    constructor(args){
        this.node = args.node;
        this.synchronizer = args.synchronizer;
        this.anchorBlockStore = args.anchorBlockStore;
        this.stagedWriteCoordinator = args.stagedWriteCoordinator;
        this.contributors = args.contributors;
        this.autoSync = args.autoSync;
        this.log = args.log;
    }
    start() {
        this.queue.start();
    }
    async stop() {
        await this.queue.end();
    }
    /**
   * Runs an operation once no other operations are running. Returns a promise that will resolve once the operation
   * is complete.
   *
   * Useful for tasks that cannot run concurrently, such as contract function simulation.
   */ run(fn) {
        // TODO(#12636): relax the conditions under which we forbid concurrency.
        const queued = new Timer();
        const queueDepth = this.queue.length();
        if (queueDepth >= OperationQueue.WARN_QUEUE_DEPTH) {
            this.warnQueuePressure('depth', queueDepth, 0);
        }
        const waitWarning = setTimeout(()=>{
            this.warnQueuePressure('wait', this.queue.length(), queued.ms());
        }, OperationQueue.WARN_WAIT_MS);
        return this.queue.put(()=>{
            clearTimeout(waitWarning);
            this.log.debug('Starting queued PXE operation', {
                eventName: 'pxe_operation_started',
                queueDepth,
                waitMs: queued.ms()
            });
            return fn();
        }).finally(()=>clearTimeout(waitWarning));
    }
    warnQueuePressure(reason, queueDepth, waitMs) {
        const now = Date.now();
        if (now - this.lastPressureWarningAt < OperationQueue.WARN_INTERVAL_MS) {
            return;
        }
        this.lastPressureWarningAt = now;
        this.log.warn('PXE operation queue is congested', {
            eventName: 'pxe_operation_queue_pressure',
            reason,
            queueDepth,
            waitMs
        });
    }
    /**
   * Runs an operation (`fn`) after a sync with the node (skipped when the `autoSync` config flag is disabled, unless
   * `forceSync` is set). If the operation succeeds, then all staged writes are committed. If it rejects, then all
   * staged writes are discarded.
   */ runSynced(fn, { errorContext, forceSync = false } = {}) {
        return this.run(async ()=>{
            const totalTimer = new Timer();
            const recording = this.node.startRecording();
            try {
                const syncTimer = new Timer();
                if (forceSync || this.autoSync) {
                    await this.synchronizer.sync();
                }
                const syncTime = syncTimer.ms();
                const anchorBlockHeader = await this.anchorBlockStore.getBlockHeader();
                const changeSetId = this.stagedWriteCoordinator.begin();
                this.log.verbose(`Beginning operation ${changeSetId}`, {
                    changeSetId,
                    syncMs: syncTime
                });
                const operationArgs = {
                    stagedWriteCoordinator: this.stagedWriteCoordinator,
                    contributors: this.contributors,
                    changeSetId,
                    log: this.log
                };
                return await runOperation(operationArgs, ()=>fn({
                        changeSetId,
                        syncTime,
                        anchorBlockHeader,
                        recording,
                        totalMs: ()=>totalTimer.ms()
                    }));
            } catch (err) {
                throw errorContext ? this.#contextualizeError(err, ...errorContext()) : err;
            } finally{
                recording.stop();
            }
        });
    }
    #contextualizeError(err, ...context) {
        let contextStr = '';
        if (context.length > 0) {
            contextStr = `\nContext:\n${context.join('\n')}`;
        }
        if (err instanceof SimulationError) {
            err.setAztecContext(contextStr);
        } else {
            this.log.error(err.name, err);
            this.log.debug(contextStr);
        }
        return err;
    }
}
