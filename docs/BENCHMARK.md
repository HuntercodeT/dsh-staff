# Benchmark

[中文版](BENCHMARK.zh-CN.md)

Whether delegating work to dsh is worth it, where it is slow, and how to make it faster. Measured on one machine (Apple Silicon / macOS, 2026-09). **Every number is a single run** — enough to guide how you use this, not enough to cite as benchmark data.

## In short

1. **Turning off the model's reasoning phase is the largest lever**, worth 34–73%, with **no drop in quality** on either research or code-writing tasks. Use `DSH_STAFF_THINKING=off`.
2. **Delegation costs 23%, not a multiple** — once reasoning is off. With it on the same comparison reads 3.4x, and that number will send you to the wrong conclusion.
3. **Delegation buys context isolation and parallelism, never latency.** At its best measured setting it is still 184s against 150s inline.
4. **Model choice is endpoint-dependent; measure your own.** The same two model families go from indistinguishable to 2.5x apart when the relay changes.
5. **Install dsh globally**, not through npx — about 1.9s per call.

## How to use this

- **Set `DSH_STAFF_THINKING=off` before judging anything else.** A decision made from reasoning-on numbers is made from the wrong number. Turn it back on for steps that need the model to plan.
- **For "have another model look at this", switch models rather than delegating.** Where the host endpoint serves more than one model family, that is one flag — no plugin, no background job, no fixed overhead. Delegation adds exactly one thing here: a *separate context*, which matters when the reviewer should not see the orchestrator's reasoning.
- **Do the work inline when the task is small** and has one right answer. Delegation's fixed cost — process launch, job dispatch, polling — does not shrink with the task. On the smallest probe, answering "pong", it was 9s inline against 32s delegated.
- **Delegate when the investigation would eat the orchestrator's context.** This is the one confirmed benefit: 57.4k orchestrator tokens delegated against 70.6k inline on one research task, **19% saved**, and the margin grows with the size of the search.
- **Delegate when several independent things should run at once.** dsh jobs are detached processes; a single Codex or Claude Code session is serial. Structural, untested here.
- **Do not delegate to go faster.**

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

## Speed

One endpoint across every arm, one task (T1, research):

| arm | configuration | wall | orchestrator tokens |
|---|---|---|---|
| A | Codex + GPT | **61s** | 61.4k |
| C | Codex + DeepSeek, direct | 150s | 51.7k |
| B | Codex → dsh, reasoning **off** | 184s | 49.6k |
| B | Codex → dsh, reasoning **on** | 515s | 56.3k |
| D | dsh alone, reasoning **off** | 133s | — |
| D | dsh alone, reasoning **on** | 489s | — |

**Most of the delegation gap is reasoning, not round trips.** With reasoning off, delegation is 184s against 150s direct (+23%); with it on, 515s against 150s (3.4x). The round trips did not change: on T1 dsh ran 50 tool calls and 32 model round trips against Codex's 28 shell invocations. **Turns are the multiplier; reasoning is what they multiply** — each turn paying a full reasoning pass is what turns a per-turn difference into a multiple. Reducing turns is still worth doing, just not first.

## The reasoning switch

Controlled runs on one endpoint, `thinking` the only variable, on both task shapes:

| task | path | reasoning on | reasoning off | cut |
|---|---|---|---|---|
| T1 research | dsh alone | 489s | **133s** | −73% |
| T1 research | Codex → dsh | 515s | **184s** | −64% |
| T3 implement | dsh alone | 209s | **103s** | −51% |
| T3 implement | Codex → dsh | 189s | **124s** | −34% |

**Quality held on both task shapes, including the one that should have been most at risk.** T3 writes code, so it depends on planning in a way research does not. All four T3 arms produced a working `version` subcommand (exit 0, correct output), touched exactly one file, updated both the header docs and the usage string, extracted a `cmdVersion()` function matching the file's convention, and added `die()` error handling. The reasoning-off runs were not thinner: dsh alone produced 22 changed lines without reasoning against 18 with it, hoisting a `PACKAGE_JSON` constant and documenting why the manifest resolves against the script rather than the caller's cwd — the single trap in that task. On T1 the delegated arms produced the same 24 distinct file:line citations either way.

The mechanism is visible at the endpoint: given an agent-shaped prompt and a 1200-token budget, reasoning-on spent the entire budget reasoning and **produced no answer at all**; reasoning-off answered in 165 tokens with a 1.21s time-to-first-token.

It is configured on `llm-deepseek`, which owns the `thinking` field — registering it as a request extension fails with a collision. Off by default: reasoning is how the model plans, and every cell here is a single run.

## The endpoint matters more than the model

Same two model families, same orchestrator, same task. Change the relay and the conclusion reverses:

| relay | A: Codex + GPT | C: Codex + DeepSeek |
|---|---|---|
| one | 89s | 88s |
| another | 61s | 150s |

The cause is the endpoint, not the models. Measured directly against each, on the same DeepSeek model:

| endpoint / model | TTFT | throughput |
|---|---|---|
| one / DeepSeek | 1.66s | 240–297 tok/s |
| another / DeepSeek | 3.83s | 102 tok/s |
| another / GPT | 3.39s | 41.7 tok/s |

An agent loop multiplies time-to-first-token by its round-trip count, so a 2.2s TTFT difference is worth minutes. **Do not pick a model from anyone else's numbers, including these — measure your own endpoint.**

A second data point for the same conclusion: 297 tok/s streaming directly, but one dsh task produced 6002 output tokens in 266s — **22.6 tok/s effective**. The 13x gap is turn overhead. Generation speed was never the constraint.

## Quality

Quality did not separate the configurations the way speed did.

- **T1** — every configuration answered correctly. Line-number citations were spot-checked against the source: **5/5 exact in D, and correct in A and C**. No configuration fabricated a reference.
- **T2** — every configuration identified the false premise and refused to invent a current reviewer config. B and D went further and recovered the real historical values from git history, labelling them as historical.
- **T3** — all four produced working code (`version` prints `0.1.0`, exit 0). They differed in fit:
  - **A** inlined 5 lines in the `switch`, with no error handling, and inserted its doc line **between the two lines documenting `setup`**, splitting that entry.
  - **B, C, D** extracted a `cmdVersion()` function matching the file's existing `cmdXxx` convention. B and D added `die()` error handling for a missing or malformed manifest; D also hoisted a `PACKAGE_JSON` constant next to the existing `TEMPLATES_DIR`.

All configurations correctly resolved the manifest relative to the script (`path.dirname(SELF)`) rather than the caller's cwd — the one trap in T3.

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

**Confirmed — turn off reasoning.** The largest lever by a wide margin; see [the reasoning switch](#the-reasoning-switch) for the numbers and the quality checks.

**Confirmed — install dsh globally.** Repeated direct measurement, no task variance involved: ~3100ms per invocation through npx against ~90ms for the global binary.

**Ruled out — picking a faster model.** Arm C exists to test exactly this. Under one orchestrator, swapping model families moved T1 by 1s and T3 by 1s on one relay. On another relay the same swap is worth 89s — but that is the endpoint, not the model, and no model choice fixes it.

**Not demonstrated — trimming the tool set.** dsh mounts bash, filesystem, search, web, todo, goal, skill, subagent and workflow tools, and ships their schemas on every request; the hypothesis was that a smaller catalog would cut both round trips and per-turn cost. Disabling the nine tools a local code-research task cannot need gave 184s against a 269s baseline — but that same baseline task, unchanged, had already run in 163s and 269s. **184s is inside the noise, so this measures nothing.** An uncontrolled attempt appeared to show 71s, a 3.7x win; that run bypassed the companion's research template, so the model answered a much smaller question. It is not evidence.

Testing it properly needs repeated runs on both arms. The `--patch` mechanism supports a per-persona tool set, so the change is cheap once there is evidence it helps.

## Prior art: the agy measurements this fork replaces

dsh-staff is a fork of agy-staff, which drove Google's Antigravity CLI. Earlier measurements of that harness (2026-09-22, different corpus — a production Go codebase — so not directly comparable):

| | agy | Claude | Codex |
|---|---|---|---|
| review | 184s | 57s | 127s |
| implement | **566s**, status=ERROR, output limit hit (135k output tokens) | 55s | 97s |
| research | 339s | 96s | 722s |

Its recorded failure modes were fabricated detail — it reported an error code as `42007` when the real value was `0404701` — and blowing the output limit on implementation tasks. The conclusion at the time was to use it only as a second opinion whose specifics must be re-checked.

dsh behaves differently on both counts. Its slowdown is consistent (1.75x–1.85x of Codex across all three tasks, against agy's 0.47x–5.8x swing), it completed the implementation task without hitting any limit, and in these tasks it fabricated nothing — the citation spot-checks came back exact. Different corpus and different tasks, so this is not a controlled comparison of the two harnesses; it does mean the "verify every specific it gives you" caveat that applied to agy did not reproduce here.

## Limitations

- **Every cell is a single run.** The same task under the same configuration produced 163s and 269s on two attempts; that is the scale of the variance.
- **One inversion is recorded rather than smoothed over:** with reasoning on, T3 delegated beat T3 standalone (189s vs 209s), which T1 does not predict. As likely variance as signal.
- **Two of delegation's benefits were not measured at all:** parallelism, and a second opinion from another model family. Every task here has a single verifiable answer, which is exactly the shape that cannot reveal them.
- Hard numbers worth citing would need five or more runs per arm.

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
