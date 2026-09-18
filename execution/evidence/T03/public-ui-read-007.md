# Complete neutral public reads at UI call sites

Integration review found six direct public reads outside the shared engine: the user and moderator pages each read current censor, penalty multiplier and moderation policy. They now use the same SDK NO_FROM as the engine. No other direct simulation sites were found in supported non-engine browser source. Private owner queries and signed actions remain unchanged.

The extended public-read regression, original custody checks and configuration integration checks pass (30 tests, public-ui-read-007.log). The canonical application rebuild passes (app-build-007.log). Real browser qualification of this final change remains assigned to the next T04 run; historical observation044 remains pre-change evidence.
