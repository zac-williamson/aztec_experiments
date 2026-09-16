# Native attribution attempt031

Failed closed in272459ms, peak1424976KiB; all owned processes/data removed. The
real dummy proof emitted three active nullifiers in its single board private call.
The initial helper assumed one and rejected it at nullifier-shape. Its structure
was the expected sixteen-slot array with claimedLength3. No dummy was submitted.
Source immutability passed; this is an implementation assumption failure, not a
network/prover failure. Report: ../W01/application-c159465d-9cc9-41d7-9f5f-edbf1f784dc8.json.

The replacement identifies the actual persistent deposit note through scoped PXE
state and checks that its exact siloed nullifier appears uniquely among the board
call's emitted nullifiers and uniquely in final proof inputs. It does not accept
an arbitrary shared nullifier or guess which of the three belongs to the deposit.
Selected note scope, packed receipt/sequence and saved replacement identity are
checked before proving; final proof and durable ancestry enforce the same identity
again. Controlled tests102pass; genuine rerun034 remains pending.
