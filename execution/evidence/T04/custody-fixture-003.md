# Restore current app setup in custody regression fixture

The existing c01-user test fixture omitted the public configuration store now required by the built application. Three tests stopped at app subscription before exercising their custody assertions. The fixture now initializes the actual shared/public-app-config.js store and shared/app-env.js before the user app. No production source or custody assertions changed.

All eight tests pass in custody-fixture-003.log, including encrypted claim storage, wrong-wallet/corruption/scope and durability checks. This is lightweight fixture coverage, not an additional genuine browser proof. The graph validator regression suite also passes in graph-regression-003.log.
