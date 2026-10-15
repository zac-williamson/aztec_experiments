import { allToCompletion } from '@aztec-labs/foundation/promise';
/**
 * Runs `fn` as the operation's work and decides its change set.
 *
 * On success:
 * 1. Waits for every contributor to settle. A rejection vetoes the commit and the failure path below runs instead.
 * 2. Commits the change set.
 * 3. Notifies contributors of the outcome.
 *
 * On failure:
 * 1. Drains contributors, logging failures instead of propagating them so the discard runs to completion and the
 *    error that aborted the operation is not masked.
 * 2. Aborts the change set.
 * 3. Notifies contributors of the outcome.
 * 4. Rethrows.
 */ export async function runOperation(args, fn) {
    const { stagedWriteCoordinator, contributors, changeSetId, log } = args;
    try {
        const result = await fn();
        // Settling must stay outside the commit transaction: it can take arbitrarily long.
        await allToCompletion(contributors.map((contributor)=>contributor.settle?.(changeSetId)));
        log.verbose(`Committing operation ${changeSetId}`, {
            changeSetId
        });
        await stagedWriteCoordinator.commit(changeSetId);
        notifyOperationEnd(args, 'committed');
        return result;
    } catch (err) {
        log.verbose(`Aborting operation ${changeSetId}`, {
            changeSetId
        });
        await settleContributorsLoggingFailures(args);
        try {
            stagedWriteCoordinator.abort(changeSetId);
        } catch (abortErr) {
            // Nothing here can undo a failed abort, so it is logged, but the error that ended the operation is the one
            // reported.
            log.error(`Failed to abort operation ${changeSetId}`, abortErr, {
                changeSetId
            });
        }
        notifyOperationEnd(args, 'discarded');
        throw err;
    }
}
function notifyOperationEnd({ contributors, changeSetId, log }, outcome) {
    for (const contributor of contributors){
        // The change set has already been decided at this point, so a failed notification must not turn a committed
        // operation into a rejected one, nor mask the error that caused a discard.
        try {
            contributor.onOperationEnd(changeSetId, outcome);
        } catch (err) {
            log.warn(`Contributor failed to handle the end of operation ${changeSetId}`, {
                changeSetId,
                outcome,
                err
            });
        }
    }
}
async function settleContributorsLoggingFailures({ contributors, changeSetId, log }) {
    await allToCompletion(contributors.map((contributor)=>contributor.settle?.(changeSetId).catch((err)=>{
            log.warn(`Contributor failed to settle while discarding operation ${changeSetId}`, {
                changeSetId,
                err
            });
        })));
}
