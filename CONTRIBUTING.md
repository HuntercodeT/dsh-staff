# Contributing

Thanks for looking. Before anything else, two things that will save you time:

**This project has no working test suite.** `npm test` fails on purpose. The inherited suite in `legacy-tests/` drives a file this fork renamed and asserts behaviour the retarget removed. Porting it is the single most valuable contribution available here — see [Porting the tests](#porting-the-tests).

**dsh is a developer preview** and its maintainers say compatibility-breaking changes should be expected. `runner/index.mjs` depends on three dsh core interfaces — `agents.create`, `agents.resume`, and the `session/event` feed. If dsh breaks something, that is where it will show first.

## Getting set up

```bash
npm i -g @deepseek-ai/dsh          # global, not npx — see Traps below
export DEEPSEEK_API_KEY=<key>
export DEEPSEEK_BASE_URL=https://<endpoint>/v1
export DSH_STAFF_DEFAULT_MODEL=<a model id your endpoint actually serves>

node companion/dsh-companion.mjs setup
node companion/dsh-companion.mjs ask --prompt "Reply with exactly: ok"
```

If `ask` prints `ok`, the whole chain works: companion → provider → dsh → the runner → the record protocol → triage.

## What is original here and what is inherited

| path | origin |
|---|---|
| `runner/` | original — the dsh plugin that adds session resume and the record protocol |
| `companion/providers/` | original — launch spec, model catalog, failure diagnosis |
| `profiles/` | original — the dsh profile overlay |
| `docs/` | original |
| `companion/dsh-companion.mjs` | inherited, heavily edited — job state machine, CLI, triage |
| `companion/{observation,state-lock,stream-worker}.mjs` | inherited, lightly edited |
| `skills/`, `templates/`, `scripts/` | inherited, edited |
| `legacy-tests/` | inherited, untouched and unported |

Inherited code comes from [agy-staff](https://github.com/keli-wen/agy-staff) under MIT. Keep the upstream copyright in `LICENSE`; it is a license condition, not a courtesy.

## Rules that the CI enforces

- **`pi-skills/` is generated from `skills/`.** Edit the canonical copy under `skills/`, then run `npm run generate:pi`. CI fails on drift.
- **Everything must parse.** CI runs `node --check` over `companion/`, `runner/`, and `scripts/`.

## Rules the CI cannot enforce

- **Changing `runner/` or `profiles/` requires re-running `setup`.** They are installed into `$DSH_HOME/profiles/dsh-staff/`, so editing them in the repo changes nothing until you reinstall. Forgetting this will have you debugging a version of the code that is not running.
- **Performance claims need a controlled measurement.** One endpoint across all arms, one variable at a time, and the run-to-run variance stated. The same task under the same configuration has produced 163s and 269s here, so a single 20% improvement is not a result. `docs/BENCHMARK.md` has the method and the reproduction commands; a change that claims to make things faster should add its numbers there, including the arms that did not improve.
- **Report what you actually measured.** This repository documents a hypothesis that looked like a 3.7x win and turned out to be an uncontrolled run measuring nothing. That entry stays because the next person will have the same idea. Negative and inconclusive results are welcome; dressed-up ones are not.

## Traps

Each of these cost real debugging time:

- **The runner must be a directory with its own `package.json` carrying a `version`.** dsh's plugin inventory resolves every mounted entry to its nearest manifest and rejects one without a version. A bare `.mjs` in the profile root resolves to the profile's own manifest, which dsh generates without a version field — every request then dies in `prepareExtensions` with `REQUEST_EXTENSION`, *before anything is sent*, which looks nothing like its cause.
- **A ternary in the profile YAML needs a folded block scalar.** `thinking: !!js a === b ? 'x' : 'y'` parses `?` as an explicit-key marker and yields an object. Write it as `!!js >-` followed by the expression, which is how dsh's own config handles the same shape.
- **Do not register a request extension for a field dsh already sets.** `thinking` belongs to `llm-deepseek`; registering it collides. Configure the owning plugin instead.
- **`DEEPSEEK_BASE_URL` must include the API path prefix.** dsh requests `${base}/chat/completions`. Point it at a host root and you will get an HTML page parsed as an event stream, reported as `STREAM_CLOSED: SSE stream ended without [DONE]` — which reads like a streaming bug and is not one.
- **`DSH_STAFF_MODEL` is set by the companion, not by you.** Running `dsh --profile dsh-staff` by hand skips that, the overlay falls back to its default model id, and your endpoint answers `No matching provider found`.
- **dsh cannot run inside a harness command sandbox.** It needs `$DSH_HOME`, the network, and the working directory. In Codex, use `codex exec --dangerously-bypass-approvals-and-sandbox`.
- **Install dsh globally.** Through npx it re-resolves the package on every call: ~3100ms against ~90ms, paid again for every background job.

## Porting the tests

The provider-agnostic half of `legacy-tests/` still describes code that exists unchanged: the background-job state machine, the file locking, the NDJSON stream parser, the observation byte budgets, and the detached-process cleanup. Those are worth recovering.

The rest assumes agy: `fake-agy.mjs` speaks agy's `stream-json` protocol, and several tests assert a `review` mode and `--json-schema` output that this fork does not have. A port needs a `fake-dsh` emitting the `init` / `step_update` / `result` records that `runner/index.mjs` produces — the protocol is documented in that file's header and in `companion/observation.mjs`.

Partial ports are fine. A single file moved back to a working `tests/` directory, with `npm test` wired to run only what passes, is more useful than a stalled full port.

## Commits and PRs

Commit subjects follow `type: what changed` — `fix:`, `feat:`, `docs:`, `perf:`, `chore:`. Bodies explain *why*, and say what was measured or verified rather than asserting it works. Look at `git log` for the register.

For a PR, say what you ran. "Ran `setup` and `ask` against a DeepSeek endpoint" is a real statement; "tested" is not — there is no test suite to have run.

## Scope

In scope: the dsh integration, the runner, the provider layer, the profile overlay, porting the tests, measurement.

Probably out of scope: adding providers for other model families. The companion's provider seam exists, but a second provider without someone committed to maintaining it is a liability. Open an issue first.

Upstream fixes to inherited code are better sent to [agy-staff](https://github.com/keli-wen/agy-staff) where they benefit both projects; this fork can take them via `upstream`.
