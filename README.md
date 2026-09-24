# dsh-staff

Hand a task to **DeepSeek Harness** (`dsh`) from inside Claude Code or Codex, and get on with something else. The task runs as a detached background job in its own context; you keep the decisions, the review, and the delivery.

```
$ /dsh:researcher survey how session resume is wired through this repo

Started background research job.
job id: research-muf88u1c-236a3811 (pid 41207)
model: deepseek-flash  profile: unrestricted  timeout: 60m
Collect: run `wait research-muf88u1c-236a3811 --timeout 10m`
```

The job reads code, runs commands, and writes its answer to a file. Your session is not blocked and its context is not spent on the search — on one measured task, delegating used 49.6k orchestrator tokens against 70.6k doing the same work inline.

**Delegation does not make things faster.** It costs about 23% more wall clock than doing the work in your own session. What it buys is context and parallelism. If you want speed, or just another model's opinion on something, switch models in your own session instead — that is one flag, with none of this machinery.

## Install

```bash
npm i -g @deepseek-ai/dsh
export DEEPSEEK_API_KEY=<your key>
```

Install dsh globally rather than pointing `DSH_BIN` at npx — npx re-resolves the package on every single call, about 3s each time, paid again for every background job.

This repo is a plugin marketplace for both hosts:

```bash
# Claude Code
claude plugin marketplace add /path/to/dsh-staff
claude plugin install dsh@dsh-staff

# Codex
codex plugin marketplace add /path/to/dsh-staff
codex plugin add dsh@dsh-staff
```

Then provision the dsh profile, once:

```bash
node companion/dsh-companion.mjs setup
node companion/dsh-companion.mjs ask --prompt "Reply with exactly: ok"
```

If that prints `ok`, everything is wired. `setup` creates a `dsh-staff` profile under `$DSH_HOME/profiles/`, installs the runner and its overlay, and tells you whether your key is visible. Re-run it after every upgrade — the runner lives in that profile, so a new version does nothing until it is reinstalled.

**In Codex, run unsandboxed.** dsh needs `$DSH_HOME`, the network, and the working directory; the default command sandbox hides at least one of those. Use `codex exec --dangerously-bypass-approvals-and-sandbox`, or approve with escalated permissions interactively.

## The three personas

| | for | notes |
|---|---|---|
| `staffer` | anything the other two do not fit | minimal prompt — no role, no output format, the task text alone shapes the result |
| `researcher` | surveys and deep dives | gathers its own evidence; expects a structured report back |
| `implementer` | changes to the working tree | the companion reports the git delta alongside the result and tells the caller to inspect it |

All three run in the background. There is also an internal `ask` mode — tool-free, foreground, no template — used mainly to smoke-test that the chain works.

## Working with jobs

Dispatching returns a job id immediately. From there:

```bash
wait <job-id> --timeout 10m     # blocks until done; exit 0 = result printed, 2 = still running
result <job-id>                 # the finished output
observe <job-id>                # a progress snapshot: recent tool calls, latest text
cancel <job-id>                 # stop it and clean up the process tree
continue --job <id>             # follow up in the same conversation
restart <job-id>                # re-run with a fresh budget, keeping the old record
```

Progress is a real projection, not a spinner: the runner streams one record per tool call and per assistant message, so `observe` shows the last five tool invocations with input and output excerpts. It is bounded to 8 KiB, so a runaway job cannot flood your context.

Timeouts are handled rather than swallowed. A job that hits its limit after producing text delivers that text with a warning; one that produces nothing reports `attention` with the conversation id, the last snapshot, and an exact command to continue.

In a host session you normally reach all of this through the `jobs` skill rather than typing the commands.

## Configuration

Everything is environment variables; there is no config file to learn.

```bash
export DEEPSEEK_API_KEY=<key>
export DEEPSEEK_BASE_URL=https://your-gateway/v1   # optional, for a non-DeepSeek endpoint
export DSH_STAFF_DEFAULT_MODEL=deepseek-flash      # whatever id your endpoint serves
export DSH_STAFF_THINKING=off                      # optional, see Speed
```

Two things about endpoints are worth knowing before you hit them:

- **`DEEPSEEK_BASE_URL` must include the API path prefix.** dsh requests `${base}/chat/completions`, so a gateway served under `/v1` needs `https://host/v1`. Point it at a bare host and you get `STREAM_CLOSED: SSE stream ended without [DONE]`, which is dsh parsing an HTML page as an event stream — it reads like a streaming bug and is not one.
- **Model ids belong to your endpoint.** The built-in per-persona defaults are DeepSeek's public ids; a gateway often namespaces them differently. Set `DSH_STAFF_DEFAULT_MODEL` once rather than passing `--model` every time.

### Permissions

Two profiles, mapped onto dsh's own presets — there is no separate allowlist to maintain.

- **unrestricted** (default for all three personas) → dsh's `danger-full-access`: approval `never`. A headless run needs this; nothing is present to answer a prompt.
- **restricted** (`--restricted`, or per-repo with `setup --restrict <modes>`) → `workspace-write`: approval `ask`. Nobody answers in a headless run, so the first tool call needing approval yields an empty response. Use it to keep a mode from touching anything, not as a security boundary.

Neither is a sandbox for untrusted input. Use an isolated checkout for that.

### Telemetry

dsh ships with OTEL session export to DeepSeek enabled. Because this is usually pointed at private repositories, the installed overlay disables that plugin and every run also sets `DSH_TELEMETRY_DISABLED=1`. Undo both to opt back in.

## Speed

The single biggest lever is turning off the model's reasoning phase:

```bash
export DSH_STAFF_THINKING=off
```

`deepseek-flash` reasons before every answer, and an agent loop pays that on every round trip. Measured on two task shapes, same endpoint, that flag the only variable:

| task | standalone | delegated |
|---|---|---|
| research | 489s → **133s** | 515s → **184s** |
| implement | 209s → **103s** | 189s → **124s** |

Quality held in every arm — identical citations on the research task, and on the coding task all four produced working code with the same structure, the reasoning-off runs if anything more thorough. It is off by default because reasoning is how the model plans: keep it for work that needs judgement, drop it for mechanical steps.

It is also the difference between delegation appearing to cost 3.4x and actually costing 23%, so turn it off before drawing any conclusion about delegation's overhead.

[docs/BENCHMARK.md](docs/BENCHMARK.md) ([中文](docs/BENCHMARK.zh-CN.md)) has the full comparison against running the same tasks inline, the control that separates model from harness, the quality checks, and one hypothesis that measured nothing and is written up as such.

## Limitations

- **No working test suite.** `npm test` fails on purpose rather than pretending otherwise. The inherited suite under [`legacy-tests/`](legacy-tests/README.md) targets a file this fork renamed; porting the provider-agnostic half is the largest open piece of work here.
- **No schema-enforced output.** A structured-output request is carried in the prompt and is not enforced, because dsh has no equivalent of a response schema.
- **dsh is a developer preview** whose maintainers expect compatibility-breaking changes. [`runner/index.mjs`](runner/index.mjs) depends on `agents.create`, `agents.resume`, and the `session/event` feed by name; a change to any of those breaks first.
- **Measurements here are single runs.** The same task under the same configuration has produced 163s and 269s. Useful for choosing how to work, not for citing.

## How it works

`setup` installs [`runner/index.mjs`](runner/index.mjs) into the dsh profile as a Cordis plugin, replacing dsh's own one-shot runner. dsh's shipped runner mints a new session on every invocation and prints only the final assistant message, which leaves a delegation harness unable to continue a conversation or see a long job's progress. Both capabilities exist in dsh core — `AgentRegistry.resume()` loads a persisted session, `session/event` is a live append feed — so the replacement runner exposes them:

- **Session resume**, which is what makes `continue` and `restart` work.
- **A record stream** — `init` / `step_update` / `result` as NDJSON — which is what `observe`, `cancel`, and the timeout reporting read.

Everything else belongs to dsh: its tools, sandbox, permission presets, compaction, and subagents. The companion (`companion/dsh-companion.mjs`) owns the job state machine, file locking, workspace guards, and the CLI.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) — setup, the traps that cost real debugging time, what CI can and cannot check, and what porting the test suite would involve.

## Credits and license

MIT. dsh-staff is a fork of [agy-staff](https://github.com/keli-wen/agy-staff) by Keli (pkuwkl), retargeted from Google's Antigravity CLI onto DeepSeek Harness. The job state machine, file locking, streaming worker, workspace observation, prompt templates, and CLI surface originate there; the dsh runner, provider layer, and profile overlay are original to this project. Both are MIT and the upstream copyright notice is retained in [LICENSE](LICENSE).
