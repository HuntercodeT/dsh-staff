# Benchmark

[中文版](BENCHMARK.zh-CN.md)

Measurements from 2026-09-24 on one machine (Apple Silicon, macOS). Every number is a single run unless stated otherwise: treat them as orders of magnitude, not as a leaderboard.

The corpus is this repository's own source, at the commit under test. It was written the same day the benchmark ran, so no model had it in training data — the tasks measure comprehension, not recall. The baseline answer was known in advance for every task, which is what makes the citation checks below meaningful.

## Tasks

| id | kind | task |
|---|---|---|
| T1 | comprehension | Explain how the one-shot runner decides between creating and resuming a session, and how the session id reaches the caller. Cite files, functions, environment variables. |
| T2 | hallucination trap | "What model does the **reviewer persona** default to, and what JSON schema does it enforce?" — there is no reviewer persona; the premise is false. |
| T3 | implementation | Add a `version` subcommand that prints the version from package.json. Register it in the dispatch and the usage text. |

## Configurations

| id | orchestrator | model | work done by |
|---|---|---|---|
| **A** | Codex | `gpt-6-luna` | Codex itself |
| **B** | Codex | `deepseek-flash` | delegated to dsh via dsh-staff |
| **C** | Codex | `deepseek-flash` | Codex itself |
| **D** | dsh-staff companion | `deepseek-flash` | dsh |

C is the control that separates model from harness: same orchestrator as A, same model as B and D.

## Results

| task | A: Codex + gpt-6-luna | B: Codex → dsh | C: Codex + DeepSeek | D: dsh alone |
|---|---|---|---|---|
| T1 | **89s** / 70.6k tok | 208s / 57.4k tok | **88s** / 46.2k tok | 163s … 269s |
| T2 | **50s** / 49.0k | 109s / 48.2k | — | 90s |
| T3 | **49s** / 42.9k | 105s / 47.2k | **48s** / 13.1k | 86s |

Token counts are what Codex reports for its own context, including the system prompt; for B they exclude the work dsh did in its own context.

## What the numbers say

**Swapping the model changes nothing measurable. A vs C: 89s→88s and 49s→48s.** Two different model families, same orchestrator, same tasks, indistinguishable wall clock. Whatever makes B and D slow, it is not the model.

**Delegation costs 2x wall clock. B vs C: 208s vs 88s, 105s vs 48s.** Same model, same orchestrator, the only difference is who does the work. The gap is the harness, not the inference.

**The delegation gap is round trips, not tokens.** On T1, dsh ran 50 tool calls and 32 model round trips; Codex ran 28 shell invocations. dsh both takes roughly twice the turns and spends longer per turn (5.3s vs 3.1s). With a reasoning model, every extra turn pays the full time-to-first-token again.

**Throughput, measured directly against the endpoint:**

| | `deepseek-flash` |
|---|---|
| streaming throughput | **297 tok/s** |
| time to first content token | 3.61s |
| reasoning chunks before first content | 888 (vs 599 content chunks) |

**Raw generation speed is not the constraint.** Measured directly against the endpoint, `deepseek-flash` streams at **297 tok/s** with a 3.6s TTFT — and nearly all of that TTFT is the reasoning phase (888 reasoning chunks before 599 content chunks on a counting task). But T1 on dsh produced 6002 output tokens in 266s: **22.6 tok/s effective**. The 13x gap between raw and effective throughput is turn overhead, not the model being slow.

## Quality

Quality did not separate the configurations the way speed did.

- **T1** — every configuration answered correctly. Line-number citations were spot-checked against the source: **5/5 exact in D, and correct in A and C**. No configuration fabricated a reference.
- **T2** — every configuration identified the false premise and refused to invent a current reviewer config. B and D went further and recovered the real historical values from git history, labelling them as historical.
- **T3** — all four produced working code (`version` prints `0.1.0`, exit 0). They differed in fit:
  - **A** inlined 5 lines in the `switch`, with no error handling, and inserted its doc line **between the two lines documenting `setup`**, splitting that entry.
  - **B, C, D** extracted a `cmdVersion()` function matching the file's existing `cmdXxx` convention. B and D added `die()` error handling for a missing or malformed manifest; D also hoisted a `PACKAGE_JSON` constant next to the existing `TEMPLATES_DIR`.

All configurations correctly resolved the manifest relative to the script (`path.dirname(SELF)`) rather than the caller's cwd — the one trap in T3.

## Where delegation actually pays

Only one hard benefit shows up in this data: **T1 cost Codex 57.4k tokens under delegation against 70.6k doing it itself — 19% less context consumed**, because dsh read the code in its own context and handed back a summary. That margin grows with the size of the investigation, and it is the reason to delegate a long survey rather than run it inline.

One more is real but untested here: **parallelism** — dsh jobs are detached processes and several can run at once, while a single Codex session is serial.

A third reason, *a second opinion from another model family*, turned out not to need delegation at all where the host endpoint already serves both families; see the decision section below.

## When to delegate, and when not to

From the numbers above, not from principle:

**Do the work inline when** the task is small or mid-sized and has one right answer. Delegation adds 55-120s of fixed overhead regardless of task size, and on all three tasks here the orchestrator's own model was already good enough. On the smallest probe — answering "pong" — it was 9s inline against 32s delegated.

**Delegate when** the investigation is large enough that reading it inline would eat the orchestrator's context. That is the one benefit this data confirms (19% saved on T1), and it grows with the size of the search. A survey across many files or services is the case that pays.

**Delegate when** you want several independent things done at once. dsh jobs are detached processes and run in parallel; a single Codex or Claude Code session works serially. Untested here, but structural.

**A second opinion no longer requires delegation.** This was listed here as a reason to delegate, and on this machine it is now wrong. The Codex endpoint serves `deepseek-flash` alongside the GPT models, so switching model families is one flag — `codex exec -c model="deepseek-flash"` — with no plugin, no background job, and no 55-120s of overhead. If all you want is another model's read on something, do that instead. Delegation still buys you a *separate context* for that second opinion, which matters when the reviewer should not see the orchestrator's reasoning; the flag alone does not give you that.

**Do not delegate to go faster.** Nothing in this data supports that, and the model-swap control rules out the obvious workaround.

## Startup cost

Running dsh through `npx` re-resolves the package on every invocation:

| | measured |
|---|---|
| `npx -y @deepseek-ai/dsh --version` | 5231ms cold, then ~3100ms |
| global `dsh --version` | ~90ms |

End to end through the companion, on the shortest possible task (`ask`, no tools, 3 runs each):

| | median | range |
|---|---|---|
| npx | 3589ms | 2898–4651ms |
| global | **1723ms** | 1642–3048ms |

**A ~1.9s saving per call, which is roughly 2x on a task this short** — the whole `ask` round trip is 1.7s once dsh is installed locally. It is paid before any work begins, on every foreground call and again on every background job. Install dsh globally; `setup` now warns when `DSH_BIN` points at npx. It is decisive for short tasks and negligible for long ones — T1 on dsh took 163s and 269s on two runs with the same setup, so run-to-run variance on a long task dwarfs the startup delta.

## Optimisation: what worked, what did not

**Confirmed — install dsh globally.** Direct measurement, repeated, no task variance involved: ~3100ms per invocation through npx against ~90ms for the global binary. Do this.

**Confirmed — the model is not the lever.** Configuration C exists to test exactly this. Swapping `gpt-6-luna` for `deepseek-flash` under the same orchestrator moved T1 by 1s and T3 by 1s. Picking a faster model will not close the delegation gap.

**Confirmed, and the largest lever found — turn off the model's reasoning phase.** `deepseek-flash` reasons before every answer, and an agent loop pays that on every round trip. Controlled run: same endpoint, same task, same prompt, `thinking` the only variable.

| | wall | citations spot-checked |
|---|---|---|
| reasoning on (default) | 489s | exact |
| reasoning off | **133s** | exact |

**73% faster with no drop in answer quality** — the file:line references were verified against source in both arms. The mechanism is visible directly at the endpoint: on an agent-shaped prompt with a 1200-token budget, reasoning-on spent the entire budget reasoning and produced **no answer at all**, while reasoning-off answered in 165 tokens with a 1.21s time-to-first-token.

Enable it with `DSH_STAFF_THINKING=off`. It is off by default because it is a genuine trade — reasoning is how the model plans, so keep it for steps that need judgement — and because this is a single run on a single task. Note it must be configured on `llm-deepseek`, which owns the `thinking` field; registering it as a request extension fails with a field collision.

**Not demonstrated — trimming the tool set.** dsh mounts bash, filesystem, search, web, todo, goal, skill, subagent and workflow tools, and ships their schemas on every request; the hypothesis was that a smaller catalog would cut both round trips and per-turn cost. Disabling the nine tools a local code-research task cannot need gave 184s against a 269s baseline — but that same baseline task, unchanged, had already run in 163s and 269s on two earlier attempts. **184s is inside the noise, so this measures nothing.** An uncontrolled first attempt appeared to show 71s, a 3.7x win; that run bypassed the companion's research template, so the model answered a much smaller question. It is not evidence.

Testing this properly needs repeated runs on both arms, which is worth doing before wiring a per-persona tool set into the overlay — the `--patch` mechanism supports it, so the change is cheap once there is evidence it helps.

**The structural cost is round trips.** T1 on dsh: 32 model round trips, each paying a 3.6s time-to-first-token because the model reasons before every answer. That is roughly 115s of pure latency before counting tool execution. Codex did the same task in 28 shell invocations and 88s. Any real fix has to reduce turns or overlap them, not speed up generation — generation is already 297 tok/s.

## Prior art: the agy measurements this fork replaces

dsh-staff is a fork of agy-staff, which drove Google's Antigravity CLI. Earlier measurements of that harness (2026-09-22, different corpus — a production Go codebase — so not directly comparable):

| | agy | Claude | Codex |
|---|---|---|---|
| review | 184s | 57s | 127s |
| implement | **566s**, status=ERROR, output limit hit (135k output tokens) | 55s | 97s |
| research | 339s | 96s | 722s |

Its recorded failure modes were fabricated detail — it reported an error code as `42007` when the real value was `0404701` — and blowing the output limit on implementation tasks. The conclusion at the time was to use it only as a second opinion whose specifics must be re-checked.

dsh behaves differently on both counts. Its slowdown is consistent (1.75x–1.85x of Codex across all three tasks, against agy's 0.47x–5.8x swing), it completed the implementation task without hitting any limit, and in these tasks it fabricated nothing — the citation spot-checks came back exact. Different corpus and different tasks, so this is not a controlled comparison of the two harnesses; it does mean the "verify every specific it gives you" caveat that applied to agy did not reproduce here.

## Reproducing

```bash
export DEEPSEEK_API_KEY=<key>
export DEEPSEEK_BASE_URL=https://<endpoint>/v1   # the path prefix is required
export DSH_STAFF_DEFAULT_MODEL=<model id the endpoint serves>

# D — dsh alone
node companion/dsh-companion.mjs research --prompt "<task>"

# B — Codex delegating to dsh (dsh cannot run inside a sandbox)
codex exec --dangerously-bypass-approvals-and-sandbox \
  "Use the dsh researcher skill to delegate this task, wait for the job, then report its findings. Task: <task>"

# C — Codex driving the same model directly
codex exec --dangerously-bypass-approvals-and-sandbox \
  -c model_provider=custom \
  -c 'model_providers.custom={name="custom",base_url="https://<endpoint>/v1",wire_api="responses",requires_openai_auth=false,env_key="DEEPSEEK_API_KEY"}' \
  -c model="<model id>" "<task>"
```

Codex 0.156 rejects `wire_api = "chat"`; the endpoint must serve `/v1/responses`.
