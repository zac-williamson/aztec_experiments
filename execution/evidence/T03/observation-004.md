# Initial genuine browser privacy observation

The existing actual browser post profile passed in275840ms with1337536KiB sampled
aggregate peak, under unchanged540s/2GiB bounds. All owned resources were removed.
The native fixture supplies collateral/private credit; browser actually proves,
locally verifies and submits the included post. No production anonymity claim.

The actual-state insufficient-credit probe rejected with the intended code before
submission and retained private/public balances and the deposit note. Direct
wallet/node send/prove guards recorded zero calls; source review confirms the
preparer is register/read-only. This is not exhaustive instrumentation of every
internal PXE method. Normal actual browser success follows as positive control.

304 fixture RPC observations were captured. No observation-count limit was hit,
but some argument traversals reached their separate depth/node bounds; use the
per-row classificationTruncated flags and summary004 count. The historical global
truncationOccurred flag meant observation drops only; it does not establish fully
traversed arguments. Response contents and pre-dispatch rejected requests are excluded.

A getContract query contains the author address. The public transaction classifier
found no exact author match in its named public fields and confirms shared FPC
payer, not author payer. RPC privacy is therefore a different boundary from public
chain privacy. Funder matches in transaction/simulation objects need semantic
attribution: this fixture also uses its L1 funding account as sequencer coinbase.
Do not infer a real funding leak from that alias without examining the field.

There is one post and one author in this run. Exact-value classification cannot
prove unlinkability, derived-tag security or a large anonymity set. Repeated-user,
cross-user, funding/recovery and broader observer scenarios remain open T03/T04 work.
