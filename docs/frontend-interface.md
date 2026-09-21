# Frontend interface

Keep presentation changes in `apps/src/**/app.js`, templates, styles and
`shared/wallet-buttons.js`. Application behaviour lives in
`shared/application.js`; account behaviour lives in `shared/account.js`.
Existing engines remain their internal implementation. These are trusted code
boundaries, not a sandbox for third-party plugins.

The public feed/directory pages already use `shared/public-feed-browser.mjs`
(`BillboardPublic.readFeed`, `connectPublicBoard`, `createBoardDirectory`). Keep
using that existing reader interface; public reading does not need wallet code.

Create one `createBillboardApplication({kind:'author'})` per page. Other kinds are
`moderator`, `fees` and `deploy`. Deployment supplies an explicit
`deploymentConfig` function returning the validated manifest configuration and
its existing `pause` callback. No HTML element selects the operation mode.

```js
const app = createBillboardApplication({kind:'author'});
const result = await app.run('post', {message:'Hello'}, (message, level) => {
  // Render progress. Never parse progress text to determine transaction state.
});
```

`run(action, input, onProgress)` resolves with operation data or rejects with the
existing bounded application error. It owns wallet locks, context checks and
transaction acknowledgements. A returned transaction hash does not imply a
separate bridge settlement has completed: use the returned state and the relevant
claim/recovery operation. No SDK handles or receipt objects are returned.

| Area | Calls |
| --- | --- |
| Read | `readFeed({limit, cursor})`, `readPolicy()`, `readModerator()` |
| Account deposit state | `readDeposit()` returns deposit values and chain time |
| Author | `run('status')`, `run('deposit', {depositAmount})`, `run('claim', {reuseTxHash})`, `run('post', {message})`, `run('withdraw')`, `run('claim-l1')` |
| Moderation | `run('declare-immoral', {postIndex, censorResponse})`, `run('set-moderation-policy', {moderationPolicy})`, `run('transfer-censor', {newCensor})` |
| Recovery | `run('recover')`; fees use `run('recover-l2')`; `run('recover-eth', {retryEthereum})` |
| Deploy | `run('deploy', {readyTxHash, retryEthereum})` |

Amounts entered for deposits are decimal strings. Deposit values returned by
`readDeposit` are BigInts; chain time is a number. `connected` reports whether
application handles exist, and `revision` changes when the session resets.
Configuration changes reset the application internally. UI subscriptions only
clear rendered state. `reset()` closes the session when explicitly leaving it.

`BillboardAccount.configure` supplies `autoPasskey`, `requireEth`, `onReady`,
`onAztecLoad(address)`, `onChange(snapshot)` and `onMessage(message, level)`.
The snapshot contains public addresses, busy/invalidated state and Ethereum
connection status. Call `connect()`, `importPasskey()`, `importRecovery(file,
password)`, `create(password)` or `exportRecovery(password)` from controls.
Creation/export return encrypted recovery envelopes for the UI to download.
Passkey import can return `{reloadRequired:true}`; the UI must reload before
using the replacement account. Importing a recovery file requires an unopened
account, as before. Account invalidation requires reloading.

Do not read `window.walletState`, call contract methods or manage transaction
acknowledgements in UI code. The two modules' JSDoc describes their signatures;
`node --test scripts/test-application-interface.mjs` checks types and boundaries.
`readFundingRecovery()` and `importFundingRecovery(record)` handle fee-deposit
recovery records; the application persists them before continuing a payment.
`publicConfiguration(result, gasSettings, deploymentManifest)` prepares a deployed board's public
settings from the manifest captured for that deployment. These methods keep storage rules and address derivation out of the UI.
Existing Chrome tests cover wallet recovery, fee/deployment controls and feeds.
Agents should edit separate source files and integrate through these interfaces;
generated `apps/dist` files are rebuilt by the integrator.
