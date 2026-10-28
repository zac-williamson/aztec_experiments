# Refund allocation qualification — pinned current PrivateFPC

## Result and scope

For every valid continuation produced by the application's three PrivateFPC payment entrypoints, the current compiled `_complete_refund` consumes at most **30,336 L2 gas and 320 DA gas**. Therefore the declared **40,000 L2 / 512 DA** allocation is sufficient for that continuation, including when the application reverts or exhausts its application-phase gas. This is a fixed-control-flow bound for this compiled artifact and pinned native gas schedule, supported by actual native execution of every successful refund branch and adversarial transaction contexts. It is not a promise that every transaction succeeds or is admitted.

FPC class: `0x1486ccd3db8737232e7922da7b7fbc70d780043d51b1426986c7d2f20e3684c6`. Native simulator/constants packages: `6.0.0`. Production declaration: `billboard/private_fee_contract/refund-gas.json`. Any FPC bytecode, compiler, native gas schedule or supported application-composition change requires requalification. The durable test loads the actual artifact rather than accepting a class-name/profile substitute.

## Complete payment-route coverage

| Application payment | Private entrypoints | Teardown arguments |
|---|---|---|
| Existing credit, all ordinary Board/profile/moderator/collateral/Bok/thread actions | `pay_fee` | reservation, principal0 |
| Larger bridge top-up, optionally combined with an app action | FeeJuice claim + `mint_and_pay_fee` | reservation, principal0 |
| Small bridge top-up paid using existing credit | FeeJuice claim + `mint` + `pay_fee` | reservation, principal0 |
| Paid like | `pay_like_and_fee`, otherwise empty application batch | reservation, principal20FEE |
| Direct FeeJuice-funded deployment/operator calls | No PrivateFPC payment | No `_complete_refund`; allocation claim not applicable |

`mint` alone installs no teardown. Board and Bok install none. Each supported app payload selects one payment method; only the three FPC payment entrypoints set this teardown. Thus supported app batches do not share this budget with another continuation. Source: `shared/private-fee-payment.mjs`, `shared/rolling/application.mjs` interaction builder; `billboard/private_fee_contract/src/main.nr` lines75,94,160. The native private-call API sets the teardown sender to the FPC's own address; public `only_self` checks that sender. The reservation nullifier is authenticated setup state, not authority supplied by public callers.

## Structural bound, not sampled input-size headroom

The continuation has four scalar arguments plus its fixed selector (five calldata fields). All integers have fixed widths (u32/u128), all hashes have fixed-size inputs. It performs exactly two nullifier existence lookups, fixed-width fee/principal checks and arithmetic, optionally emits one note hash, and always emits one seven-field public log. It has no loop, external call, storage write or user-sized array/string. `paid` selects whether to restore20FEE; it does not change the number of marker lookups. The only output-size branch is zero versus positive refund. All successful control-flow alternatives are exercised: both paid states with zero/positive principal and zero/positive refund; extrema include zero partial, field maximum, u32 maximum and maximum safe u128 refund sum.

Native gas for the successful branches is exactly:
- Positive refund:30,336 L2 /320 DA.
- Zero refund:9,345 L2 /288 DA.

DA follows directly from the pinned opcode table: log base64 + seven payload fields×32 =288; optional note hash adds32 =320. The L2 total includes public dispatch and checks; the costly optional note emission alone has base19,275, while nullifier checks have fixed base903 each. The pinned schedule contains no warm/cold surcharge for these operations. Dynamic copy/log charges depend on the above fixed lengths. State-tree occupancy, marker origin, values and prior outputs do not create a variable-size instruction path. Boundary contexts confirm the same total for settled and same-transaction markers, a cold FPC call, full nullifier capacity and the final available note/log capacity. This is source/control-flow reasoning plus native enumeration, not a separately machine-checked compiler or AVM correctness proof.

Pinned evidence paths under retained build `/private/tmp/rolling-browser-proof-spans-build/`:
- `node_modules/@aztec-labs/constants/dest/constants.gen.js`: gas constants419–477; max note/nullifier counts34–35; private-log count42; public-log payload length180.
- `node_modules/@aztec-labs/simulator/dest/public/fixtures/public_processor_test_env.js`: real native WSDB + spawned AVM + PublicProcessor wiring.
- `node_modules/@aztec-labs/simulator/dest/public/public_tx_simulator/public_tx_simulator.js`: actual native simulator dispatch, not an estimated-gas mock.
- `.build/owner-delivery/aztec-nr/aztec/src/context/private_context.nr`: `set_public_teardown_function_with_calldata_hash` binds sender/address/calldata.
- `.build/owner-delivery/aztec-nr/aztec/src/macros/internals_functions_generation/external/public.nr`: `only_self` assertion.
- `billboard/private_credit/src/lib.nr`: fixed-width `note_hash`; setup `consume` bounds inputs at8.

Earlier exploratory `stats.total_instructions_executed` values are **whole-transaction** totals. In particular638 with an application assertion and28,628 with many app logs include application execution. They must not be described as teardown instruction counts. This qualification uses native `gasUsed.teardownGas` for phase gas.

## Output capacities across supported app compositions

The refund emits at most1 note hash,1 public log (9 serialized fields including its two-field header),0 nullifiers,0 private logs,0 public-data writes and0 L2-to-L1 messages. Protocol caps relevant here are64 note hashes,64 nullifiers,64 private logs and4096 flattened public-log payload fields (not4096 log objects).

Supported app batches are bounded in `shared/rolling/application.mjs`, not arbitrary external multicalls. Thread limits are4 plain posts or3 posts plus one Bok invocation. A conservative sum of component maxima, including refund, is10: small-top-up `mint`+`pay_fee` can emit3 FPC notes; a named3-post thread contributes3 posts+1 updated deposit+1 name; Bok contributes1 balance-change+1 request-control note. This sum deliberately combines maxima that cannot all occur together: the current app accepts feeReceipt only on claim actions, so a small-top-up+thread batch is not supported. The actual named3-post+Bok thread uses2 FPC notes, giving9. Thus10 is a safe loose upper bound across all supported batches, not a claim that a10-note batch is reachable. Other flows (single actions, paid like including author tip, bridge claims, name+avatar, request cancellation/refund) are smaller. Consumed same-transaction notes may be squashed, so these are conservative creation counts, not a required exact receipt count.

Largest public-log composition is name registration plus maximal avatar plus refund:11+276+9 =296 serialized fields. Four posts emit4×(48 PostPublished+7 PostTipKey)+9=229. Three posts with one Bok add8 PluginInvoked+12 AccountingChanged:165+8+12+9=194. Paid like uses13 TIP+8 LikeChanged+9 refund=30. Other permitted single-event actions are smaller. These figures concern serialized fields, including per-log headers, and remain far below4096. Data content cannot increase the fixed ABI array sizes.

Input nullifiers may approach protocol capacity, particularly recursive Bok balance consumption, but teardown emits no nullifier. FPC consumption itself uses at most8 input nullifiers plus its reservation marker; the paid marker belongs to the application phase. Native test with64 existing nullifiers still refunds successfully. Private logs are not consumed by this continuation. A transaction whose private proof/setup exceeds protocol limits is not admitted; increasing teardown gas cannot repair it.

A custom non-app batch that deliberately leaves64 note hashes or too few log fields can fail the refund with a capacity error even with more gas. Tests explicitly demonstrate these distinct failures. Native exceptional halts charge the allocation, so remaining-gas arithmetic is not used to classify them. The native error identifies the capacity limit. Valid supported app compositions above reserve sufficient room.

## Phase and fee safety

The reservation marker is setup/nonrevertible. The paid marker and author tip are application/revertible. Native contexts verify both an explicit application revert and application L2 exhaustion erase the paid marker while retaining setup; refund then restores principal. App gas exhaustion cannot spend the reserved teardown allowance. Native full lifecycle additionally covers actual private authorization, mint, paid-like success/revert, tip-funded post, mixed inputs and discovery; its integrated patch uses the same declared40,000/512 rather than150,000/1,000.

`Credit.reserve` requires reservation≥overall DA limit×maxDAprice + overall L2 limit×maxL2price. Overall limits already include teardown; adding it twice would be wrong. Native effective price is base + min(priority,max−base); admitted prices never exceed the maxima. A base-price rise over a signed maximum rejects admission rather than silently increasing the refund bill. Priority and nonzero DA prices therefore cannot enlarge the instruction path or cause actualfee>reservation for an otherwise valid admitted transaction. Tests include nonzero DA, priorities and priority capping.

For ordinary/mint principal0, value≤reservation≤u128max. Paid-like setup already checks `reservation +20FEE` as u128 before debit, so later `reservation−actual+20FEE` cannot overflow. The actualfee cast is checked and reservation is at least the signed transaction maximum. Invalid commitments, foreign callers, invalid principals, under-reservation and one-L2-gas-short allocations are rejected in native tests. These are not valid admitted continuation cases.

## Test evidence and limits

`refund-context-tests.patch` extends `scripts/private-credit-refund-gas.test.mjs` and switches `scripts/testing/private-paid-like-native.mjs` to the declared cap, rejecting a native network whose limits cannot accommodate it (never silently shrinking it).

Native AVM qualification:9 successful scalar branches +5 authorization/gas negatives;8 successful transaction contexts +2 explicit capacity negatives. Contexts cover same-tx marker, successful paid marker, app revert, app gas exhaustion,63 preceding notes+64 nullifiers,4093 log fields after refund, DA/priorities, and capped priorities. Every successful positive-refund context reports30,336/320 with exact returned value and native siloed note hash/index checked. Log: `/private/tmp/private-credit-refund-gas/context-test.log`.

The cheap AVM fixture intentionally uses fabricated carrier private effects and `skipFeeEnforcement:true`; it measures the real public continuation, phase rollback and native gas/capacity behavior, not private kernel authorization, bridge membership or fee-payer solvency. The full native lifecycle supplies that complementary evidence; it passed at the declared cap on29October2026: mint, paid-like success/revert, tip-funded and ordinary-credit posts, mixed inputs, competing-spend rejection and empty-reader discovery. See `execution/evidence/G21/stable6/gas-optimization/compact-native-lifecycle.json`. There are no contract, network or service changes in this patch.
