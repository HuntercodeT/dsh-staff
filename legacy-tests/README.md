# legacy-tests — upstream's suite, not yet ported

These are agy-staff's tests, inherited unchanged by the fork. **They do not run green.** They drive `companion/agy-companion.mjs`, which this repository renamed to `dsh-companion.mjs`, and they assert behaviour the retarget removed — a `review` mode, `--json-schema` output, and agy's `--output-format stream-json` protocol among it.

They are kept rather than deleted because the provider-agnostic half is worth recovering: the background-job state machine, the file locking, the streaming NDJSON parser, the observation byte budgets, and the detached-process cleanup all still exist in this codebase under the same shapes. Porting them is the largest open piece of work here.

`npm test` is deliberately not wired to this directory. There is no green run to read into it.

The original suite's own documentation is in `README.original.md`.
