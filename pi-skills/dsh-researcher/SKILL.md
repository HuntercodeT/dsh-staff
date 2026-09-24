---
name: dsh-researcher
description: Delegate a deep research or survey task to DeepSeek Harness (dsh staffer). Use when the user says /skill:dsh-researcher, "ask dsh to research", "have the dsh staffer survey X", or wants a second, independent deep-dive on a topic or codebase without spending the host model's quota.
---

<!-- Generated from skills/researcher/SKILL.md; run npm run generate:pi. Do not edit here. -->

# dsh researcher

Delegate a research task to the dsh staffer via the shared companion script. You are a thin shell: build the command, run it, return dsh's report verbatim.

## Locating the companion

This skill file lives at `<plugin-root>/pi-skills/dsh-researcher/SKILL.md`; resolve the companion path relative to this skill directory:

```bash
node "<skill-dir>/../../companion/dsh-companion.mjs" research [flags] --prompt "what to research"
```

Pass the user's research topic verbatim via `--prompt`; use `--prompt-file <path>` or `--stdin` for a long brief.

> [!IMPORTANT]
> Run this command **unsandboxed** — dsh reads and writes `$DSH_HOME` (profile, plugin tree, session log), reaches the model endpoint over the network, and works in the launch directory. A harness sandbox that hides any of those breaks the run. In Codex, request escalated permissions for the command. Details: `../dsh-jobs/references/troubleshooting.md`.

## Collecting the result

The command returns a job id. Read `../dsh-jobs/SKILL.md` for result collection and recovery: dispatch, wait for the final result, then validate as needed. Do not proactively observe progress, read logs or inspect intermediate artifacts while running. Observe only when the user explicitly asks for progress; diagnose a failure or a result requiring intervention under the jobs protocol.

## Flags (all optional)

- `--continue` — reuse the last research conversation (quota-friendly, served largely from cache); `--conversation <id>` targets a specific one.
- `--model <id>` or `--effort low|medium|high` — default model is `deepseek-v4-pro`.
- `--restricted` / `--unrestricted` — permission profile. research defaults to unrestricted, so it works out of the box with no setup. `--restricted` is the opt-in hardening path: dsh runs without `--dangerously-skip-permissions` and may only use allowlisted tools, so it needs the setup flow's evidence-gathering allowlist to be useful — and some native dsh tools ignore allow-rules headless, so restricted runs can still come back empty.
- `--prompt <text>` / `--prompt-file <path>` / `--stdin` — the task, from exactly one of these three sources. Use file/stdin for long prompts.
- `--timeout <dur>` — default 60m, maximum 120m hard execution limit.

## Rules

- Do not do the research yourself and do not re-verify dsh's findings.
- Return the companion stdout verbatim. The `[dsh-staff]` telemetry line goes to stderr (and into `jobs/<id>.log` for background runs) — it is metadata for you, the calling agent, not something to show the user.
- Pass the user's explicit authorizations through to the task string verbatim. The prompt template default-denies costly or irreversible side effects (commits/pushes, deleting files outside the workspace, side-effectful network calls, commands that burn paid API quota); that default opens only when the request itself asks for the operation — so keep "run the e2e tests" or "call the staging API" in the prompt instead of trimming it.
- If a `--restricted` run reports an empty response due to denied permissions, relay the companion's guidance: run the setup flow once (see `../dsh-jobs/references/setup.md`), or drop `--restricted`.
- For errors and recovery, follow `../dsh-jobs/SKILL.md`.

For an existing conversation, `--continue` / `--conversation <id>` inherit its recorded model and permission profile unless explicitly overridden. The unrestricted defaults above apply to new tasks.

## Host compatibility

When this skill or its referenced instructions require a tool that the current environment does not provide, use available capabilities to achieve an equivalent result. Adapt only the tool-specific execution method; preserve the task goal, authorization requirements, explicit confirmation steps, result delivery, and stopping conditions.

If an equivalent result cannot be achieved, or you cannot establish that an alternative is equivalent, explain the missing capability and its impact, and ask the user for help. Do not silently skip requirements or bypass the environment's restrictions.
