# Disabled portal constructor encoding diagnosis

Run027 failed after47299ms/798832KiB at helper portal deployment line46, with complete owned cleanup; it never executed an operator command. Source comparison with existing c01-ready-flow identified that get_config_hash is a decoded numeric Field: toString() emitted decimal text, whereas the Solidity constructor requires bytes32. The established Ready helper explicitly wraps the value in Fr first.

A cheap actual viem encodeDeployData call with the current portal ABI reproduced rejection for123n.toString(), and accepted new Fr(123n).toString() with the same constructor arguments. The new helper now uses that same canonical Fr conversion. No Solidity, Noir, production application or limits changed. The exhausted earlier investigation is retained in run reports; a new source-backed encoding hypothesis precedes another genuine run.
