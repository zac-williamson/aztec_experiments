import assert from 'node:assert/strict';
const run = name => async ctx => (await import('./scenario-flows.mjs'))[name](ctx);

// Explicit named scenarios. Unknown names fail; there are no compatibility aliases.
const records = [
  Object.freeze({
    name: 'repeated-private-posts', deadlineMs: 540000, evidenceTask: 'T03',
    description: 'Same-board A1 A2 B1 private-fee public footprint',
    fixture: 'activated-board', authors: 1, applicationThreads: 1, browser: 'none',
    run: run('repeatedPrivatePosts'),
  }),
  Object.freeze({
    name: 'node', deadlineMs: 60000, evidenceTask: 'C01',
    description: 'Ordinary verifier node startup',
    fixture: 'node', authors: 1, applicationThreads: 1, browser: 'none',
    run: run('fixtureOnly'),
  }),
  Object.freeze({
    name: 'included-board', deadlineMs: 120000, evidenceTask: 'C01',
    description: 'Genuine board deployment and ordinary inclusion',
    fixture: 'included-board', authors: 1, applicationThreads: 1, browser: 'none',
    run: run('fixtureOnly'),
  }),
  Object.freeze({
    name: 'activated-board', deadlineMs: 180000, evidenceTask: 'C01',
    description: 'Genuine Ready message and controlled portal activation',
    fixture: 'activated-board', authors: 1, applicationThreads: 1, browser: 'none',
    run: run('fixtureOnly'),
  }),
  Object.freeze({
    name: 'censor-commands', deadlineMs: 540000, evidenceTask: 'O01',
    description: 'Packaged censor succession and policy commands',
    fixture: 'included-board', authors: 1, applicationThreads: 1, browser: 'none',
    run: run('censorCommands'),
  }),
  Object.freeze({
    name: 'private-fees', deadlineMs: 540000, evidenceTask: 'W01',
    description: 'Private fee claim exit and refund',
    fixture: 'activated-board', authors: 1, applicationThreads: 1, browser: 'none',
    run: run('privateFees'),
  }),
  Object.freeze({
    name: 'private-fee-post', deadlineMs: 540000, evidenceTask: 'W01',
    description: 'Cold private fee claim and ordinary post',
    fixture: 'activated-board', authors: 1, applicationThreads: 1, browser: 'none',
    run: run('privateFeePost'),
  }),
  Object.freeze({
    name: 'flagged-journey', deadlineMs: 540000, evidenceTask: 'T02',
    description: 'Flagged post screening exit and refund',
    fixture: 'activated-board', authors: 1, applicationThreads: 1, browser: 'none',
    run: run('flaggedJourney'),
  }),
  Object.freeze({
    name: 'unflagged-journey', deadlineMs: 540000, evidenceTask: 'T02',
    description: 'Unflagged post screening exit and refund',
    fixture: 'activated-board', authors: 1, applicationThreads: 1, browser: 'none',
    run: run('unflaggedJourney'),
  }),
  Object.freeze({
    name: 'redeposit', deadlineMs: 540000, evidenceTask: 'T02',
    description: 'Refund redeposit and replay rejection',
    fixture: 'activated-board', authors: 1, applicationThreads: 1, browser: 'none',
    run: run('redeposit'),
  }),
  Object.freeze({
    name: 'proof-recovery', deadlineMs: 540000, evidenceTask: 'W03',
    description: 'Stale proof replacement with private fees',
    fixture: 'activated-board', authors: 1, applicationThreads: 1, browser: 'none',
    run: run('proofRecovery'),
  }),
  Object.freeze({
    name: 'note-attribution', deadlineMs: 540000, evidenceTask: 'W03',
    description: 'Same-note dummy and withdrawal attribution',
    fixture: 'activated-board', authors: 1, applicationThreads: 1, browser: 'none',
    run: run('noteAttribution'),
  }),
  Object.freeze({
    name: 'contention', deadlineMs: 540000, evidenceTask: 'C03',
    description: 'Ten distinct authors using explicit genesis-funded fixture fees',
    fixture: 'activated-board', authors: 10, applicationThreads: 2, browser: 'none',
    run: run('contention'),
  }),
  Object.freeze({
    name: 'screening', deadlineMs: 540000, evidenceTask: 'C02',
    description: 'Authenticated screening contract checks with explicit genesis-funded fixture fees',
    fixture: 'activated-board', authors: 1, applicationThreads: 1, browser: 'none',
    run: run('screening'),
  }),
  Object.freeze({
    name: 'browser-post', deadlineMs: 540000, evidenceTask: 'U01',
    description: 'Actual browser private-fee post',
    fixture: 'activated-board', authors: 1, applicationThreads: 1, browser: 'post',
    run: run('browserPost'),
  }),
  Object.freeze({
    name: 'browser-journey', deadlineMs: 540000, evidenceTask: 'T04',
    description: 'Actual browser deposit through refund lifecycle',
    fixture: 'activated-board', authors: 1, applicationThreads: 1, browser: 'lifecycle',
    run: run('browserLifecycle'),
  }),
  Object.freeze({
    name: 'browser-post-recovery', deadlineMs: 540000, evidenceTask: 'T04',
    description: 'Accepted browser post and full-process recovery',
    fixture: 'activated-board', authors: 1, applicationThreads: 1, browser: 'recovery',
    run: run('browserRecovery'),
  }),
];
const scenarios = new Map(records.map(record => [record.name, record]));
export function getScenario(name) {
  assert.equal(typeof name, 'string');
  assert(scenarios.has(name), 'Unknown application scenario');
  return scenarios.get(name);
}
