# Public-read metadata minimization

The user engine formerly supplied the private account as `from` for caller-independent public getters. The installed BaseWallet static-public simulation path copies this into public call sender and synthetic fee payer, unnecessarily disclosing that account to the RPC.

The 26 getter sites now use the SDK-supported NO_FROM, which the installed SDK maps to AztecAddress.ZERO. Contract source inspection found no caller-dependent behavior in these views. Private screen hints/deposit queries, all signed operations and the SDK account class/upgrade checks are unchanged. This does not hide the author from the separate getContract lookup or provide network anonymity.

99 focused integration tests pass in public-read-006.log, including execution of the installed BaseWallet simulation path and preservation of private screen owner/chain. apps/build.mjs passed in app-build-006.log. The earlier genuine browser trace044 is historical pre-change evidence. T04's next genuine lifecycle run must qualify the new integrated build and retain RPC observation; no post-change genuine result is claimed yet.
