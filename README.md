# dsh-staff

Delegate work to **DeepSeek Harness** (`dsh`) from Claude Code and Codex — as a background staffer, researcher, or implementer — while your host agent keeps the decisions, the review, and the delivery.

> **Derived work.** dsh-staff is a fork of [agy-staff](https://github.com/keli-wen/agy-staff) by Keli (pkuwkl), retargeted from Google's Antigravity CLI onto DeepSeek Harness. The job state machine, file locking, streaming worker, workspace observation, prompt templates, and CLI surface come from there. Both projects are MIT; the upstream copyright notice is retained in [LICENSE](LICENSE).

## Why a runner of its own

dsh ships a headless bundle, but it is a one-shot driver in the strict sense: it mints a fresh session id on every invocation and prints only the final assistant message. That leaves a delegation harness with no way to continue a conversation and no way to see what a long job is doing.

Both capabilities already exist in dsh core — `AgentRegistry.resume()` loads a persisted session, and `session/event` is a live append feed — they are simply not exposed by that bundle. So dsh-staff ships [`runner/index.mjs`](runner/index.mjs), a cordis plugin that mounts in place of the shipped runner and adds exactly two things:

- **Session resume**, so `continue` and `restart` work.
- **A record stream** (`init` / `step_update` / `result` as NDJSON), so a running job can be observed, cancelled, and accounted for.

Everything else is dsh's own: its tools, sandbox, permission presets, compaction, and subagents.

## Install

```bash
npm i -g @deepseek-ai/dsh          # or set DSH_BIN="npx -y @deepseek-ai/dsh"
export DEEPSEEK_API_KEY=<your key>
```

Add the plugin to Claude Code (this repo is a marketplace), then provision the dsh profile **once**:

```bash
node companion/dsh-companion.mjs setup
```

Setup creates the `dsh-staff` profile under `$DSH_HOME/profiles/`, installs the runner and its overlay, and reports whether your key is set. Re-run it after upgrading.

## Personas

| Persona | Model default | What it is for |
|---|---|---|
| `staffer` | `deepseek-v4-flash` | General delegation; a minimal template that adds no role or output format |
| `researcher` | `deepseek-v4-pro` | Surveys and deep dives that gather their own evidence |
| `implementer` | `deepseek-v4-pro` | Edits the working tree; the companion reports the git delta with the result |

All three run in the background and return a job id; `jobs` covers collection, waiting, and recovery.

## Bring your own endpoint

dsh reads `DEEPSEEK_API_KEY` and, when set, `DEEPSEEK_BASE_URL`. Pointing the latter at an OpenAI-compatible endpoint is the supported path to another provider — verified against a third-party gateway.

Two things to get right, both learned the hard way:

- **`DEEPSEEK_BASE_URL` must include the API path prefix.** dsh requests `${base}/chat/completions`, so a gateway served under `/v1` needs `https://host/v1`, not `https://host`. Get it wrong and the run fails with `STREAM_CLOSED: SSE stream ended without [DONE]` — that is dsh trying to parse an HTML page as an event stream.
- **Model ids come from the endpoint, not from DeepSeek.** A gateway often namespaces them (`deepseek/deepseek-flash`). Set `DSH_STAFF_DEFAULT_MODEL` once instead of passing `--model` on every call; it overrides the per-mode defaults.

```bash
export DEEPSEEK_API_KEY=<key>
export DEEPSEEK_BASE_URL=https://your-gateway/v1
export DSH_STAFF_DEFAULT_MODEL=deepseek/deepseek-flash
```

Internally the companion sets `DSH_STAFF_MODEL` on every invocation, so one profile serves every mode without a rewrite. The overlay also reads `DSH_STAFF_PROVIDER` for dsh's provider id, but the companion never sets that one — export it yourself to override the `deepseek-official` default.

## Telemetry is off

dsh ships with OTEL session export to DeepSeek enabled (`FEEDBACK_ONLY`). Because this harness is normally pointed at private repositories, the installed overlay disables that plugin and every run also sets `DSH_TELEMETRY_DISABLED=1`. Undo both to opt back in.

## Permission model

dsh-staff's two profiles map onto dsh's own presets — there is no separate allowlist.

- **unrestricted** (the default for all three personas) → `danger-full-access`: approval `never`. A headless run needs this, because nothing is present to answer an approval prompt.
- **restricted** (`--restricted`, or per-repo via `setup --restrict <modes>`) → `workspace-write`: approval `ask`. In a headless run nobody answers, so a tool call needing approval yields an empty response.

Neither is a sandbox for untrusted input. Use an isolated checkout for that.

## Known gaps

- **The test suite is still written against agy** (`tests/*.test.mjs`, `tests/fake-agy.mjs`) and has not been ported. It does not run green.
- **No `reviewer` or `ask` persona.** Upstream has both; they are not part of this first cut. `ask` survives as an internal mode for smoke-testing the launch path.
- **No schema-enforced output.** agy has `--json-schema`; dsh has no equivalent, so a structured-output request is carried in the prompt and is not enforced.
- **dsh is a developer preview** and its maintainers state that compatibility-breaking changes should be expected. The runner uses `agents.create` / `agents.resume` / `session/event`, so a change to any of those is what would break first.

## License

MIT. See [LICENSE](LICENSE), which retains the upstream copyright notice.
