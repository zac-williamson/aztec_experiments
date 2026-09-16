# Moderator recovery and shared custody

All three moderator actions use the same wallet setup and durable L2 journal.
The active wallet must match the moderator credentials. Exact operation metadata
is authenticated with transaction bytes before broadcast. The restricted daemon
supplies its own reconciliation flag; an identical canonical successful operation
returns the original receipt without another proof/payment. Reverts permit a new
attempt; unresolved outcomes block. Model output cannot choose recovery arguments.
The moderator browser exposes explicit recovery and in-memory acknowledgements.

Collateral-secret custody is now shared by every browser wallet screen, so a
recovery file remains complete when restored/exported through a different role.
The implementation was moved intact from the user app, and source-based tests now
load the shared module. All frontend provenance inventories include it.

moderator-integrated-004.log:198 passing application/journal/custody checks.
moderator-daemon-004.log:76 moderation tests,83 signer tests,22 daemon integration
cases and11 wallet-authority tests pass. The daemon integration uses controlled
model/CLI fixtures; actual engine dispatch and real journal serialization are
separately exercised in the integrated tests. moderator-browser-004.log:actual
three-profile built-browser restore, including moderator-screen claims/journals;
one attempted external request was blocked. No external transaction or real proof
was performed for this client integration. Artifact, frontend and CLI SDK guards
pass; see moderator-artifacts-004.log and moderator-cli-sdk-004.log. Canonical SDK
and apps builds pass. Source binding:source-moderator-004.json and
artifact-manifest-moderator-004.json. Root self-review only after agent quota errors.

Open: private-fee approval/funding/claim and deployment journals, stale L2 proof
replacement, complete application interruption qualification. Durable moderation
queue and historical policy retrieval remain M02. No W03 or production completion
is claimed by this milestone.
