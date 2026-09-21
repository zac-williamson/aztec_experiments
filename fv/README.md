# Verification scope

Run the maintained finite transition checks with:

```sh
python3 fv/model-checks/check.py
```

See [model-checks/README.md](model-checks/README.md) for their state bounds,
assumptions and limitations. These checks are not cryptographic proofs or proofs
that the implementation is equivalent to the model.

The Lean and Verity files in this directory are unsupported. They have no pinned,
self-contained toolchain and contain assumptions and models that do not establish
security or privacy for the current application. Do not treat their theorem names
or comments as current assurance claims.
