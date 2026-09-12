# Execution plan

**State: execution started by the user. See graph.json and status.md for current progress.**

The user can reply **start**. The agent then follows AGENTS.md, validates this
graph, and begins `P01`. The objective is a production-ready release package of
this repository's anonymous message board. A ready graph is not a ready product.

## Durable records

- `graph.json`: authoritative tasks, dependency edges, acceptance criteria, and state.
- `requirements.md`: product invariants and release requirements.
- `tasks/`: readable work-package plans, generated from graph.json.
- `decisions.md`: engineering defaults and material decisions still needed.
- `status.md`: current checkpoint, blockers, and next action.
- `baseline/`: frozen readiness review and diagnostic evidence; historical only.
- `evidence/`: per-task acceptance records and supporting output produced during execution.
- `release/`: final manifest, requirement-to-evidence matrix, and operator handover, to be built.
- `graph.py`: local, standard-library-only graph validation and ready-task selection.

From the repository root:

    python3 execution/graph.py validate
    python3 execution/graph.py next
    python3 execution/graph.py status
    python3 execution/graph.py render
    python3 -m unittest discover -s execution/tests -v

`next` is read-only: it selects work; it does not run code, spawn agents, or send
transactions. `render` refreshes task documents and GRAPH.md after graph edits.
These files preserve context across runs. They do not schedule background runs
or keep a stopped session alive. Real elapsed-time tests must be supervised or
explicitly scheduled; do not fabricate elapsed time.

## Work loop

1. Validate the graph; check git state and the latest checkpoint.
2. Resume the active package, or select the first ready internal package.
   Selection uses ascending priority: the shell boundary repair follows the
   toolchain, and fee feasibility is addressed before lengthy contract work.
3. Confirm prerequisite outputs and their interfaces against the current source.
   If a change invalidates an assumption, reopen affected verification and record why.
4. Set status `active`, capture a specific next action, and work within scope.
5. Set `verification`, run the package's acceptance checks, then set `review`.
   Examine the diff and test independence; fix failures before proceeding.
6. Save `evidence/<ID>.json` and its referenced files. All criteria require results
   and artifact hashes. A regression test should fail for the known bad behavior
   and pass after the repair when that comparison is practical.
7. Mark `done` only after the evidence passes validation. Update status.md and
   decisions.md. Continue to the next ready package during the active run.

`planned → active → verification → review → done` is the normal lifecycle.
`blocked` requires a reason, evidence of the obstacle, a concrete unblock condition,
and next action. Reopen a completed task when its claimed behavior no longer holds.
Record prior evidence before replacing it, so the history remains reviewable.

If validation reports stale release evidence, archive it, return that gate and
its downstream dependent tasks to `planned`, and update the checkpoint. Regenerate
only the evidence affected by the change, with independent disposition where
required. An expired network check is a reason to refresh that check, not to stop
unrelated engineering. If a downstream task is already active, preserve its work
and make it planned before reopening its prerequisite. Keep one active package.

## Evidence rules

The evidence template and protocol are in `evidence/README.md`. The validator checks
structure, dependency completion, criterion coverage, hashes, and final-source
binding. It cannot judge whether a claim or an independent reviewer is truthful;
the tests, review reports, and user-visible release dossier supply that assurance.

Ordinary task evidence is historical evidence for its recorded source snapshot.
The final verification task `T05` must rerun/reconcile every completed package's
acceptance criteria against one candidate, and bind all criteria to fresh evidence.
The audit closure, soak, and final gate must bind to the same current application
fingerprint. Any application edit after those checks invalidates release eligibility.
Execution documentation and generated runtime state are excluded from that fingerprint;
release artifact contents and build inputs are included through tracked application
files and the release manifest. T05 verifies the manifest and its referenced hashes.

Independent review and target-network clearance are external gates. Start preparation
early, but do not invent a reviewer or clearance. Ask the user for an audit contact
or authorization to procure review only after preparing a concrete review packet.
An unavailable external gate does not stop unrelated internal tasks.

## Scope and scheduling

Keep the existing ETH-escrow and centrally administered moderation architecture
unless evidence requires a change. Implement the narrowest production scope in
decisions.md. Every B01–B12 finding and every production component in the baseline
has assigned packages and requirements. New findings get new IDs and dependencies.

Use a rolling forecast: estimate the next milestone after P02/P03 establish toolchain
and reproduction costs; revise at integrated testnet and audit milestones. The
baseline's 8–12 weeks assumes a staffed team and outside review, and is not an AI
delivery promise. Mandatory elapsed soak time and external review cannot be replaced
by additional agents or more generated tests.

Do not begin the whole graph by designing a separate orchestration product. This
repository's small graph and validator are sufficient to begin implementation.
