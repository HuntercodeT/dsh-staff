---
name: staffer
description: Delegate a general-purpose task to DeepSeek Harness (dsh staffer) with a minimal, unopinionated prompt. Use when the user says /dsh:staffer, "have dsh do/handle X", or the task fits none of the specialist personas (researcher / implementer) — the template adds no role, rules, or output format, so the task text alone shapes the output.
argument-hint: '[--restricted|--unrestricted] [--model <id>|--effort low|medium|high] [--timeout <dur>] [--prompt-file <path>|--stdin] "task"'
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), Bash(gh:*)
---

# dsh staffer

The general-purpose persona: a clean entry point for tasks that none of the specialists fit. Its prompt template is deliberately minimal — the task text, the environment (cwd, branch, date), and the safety guardrails, nothing else. No role framing, no rules, no output format: the task defines its own output, and no unrelated template context can pull the run off course.

Prefer a specialist when one fits: `researcher` for surveys and deep dives, `implementer` for edits to the working tree.

staffer is also the route to any dsh tool a specialist persona does not cover. dsh exposes bash, filesystem read/write/search, web search and fetch, todo and goal tracking, subagents, and workflows; name the tool or the outcome in the task text.

## Locating the companion

This skill file lives at `<plugin-root>/skills/staffer/SKILL.md`; resolve the companion path relative to this skill directory:

```bash
node "<skill-dir>/../../companion/dsh-companion.mjs" staffer [flags] --prompt "task"
```

Pass the user's task text verbatim via `--prompt`; use `--prompt-file <path>` or `--stdin` for long text.

> [!IMPORTANT]
> Run this command **unsandboxed** — dsh reads and writes `$DSH_HOME` (profile, plugin tree, session log), reaches the model endpoint over the network, and works in the launch directory. A harness sandbox that hides any of those breaks the run. In Codex, request escalated permissions for the command. Details: `../jobs/references/troubleshooting.md`.

## Collecting the result

The command returns a job id. Read `../jobs/SKILL.md` for result collection and recovery: dispatch, wait for the final result, then validate as needed. Do not proactively observe progress, read logs or inspect intermediate artifacts while running. Observe only when the user explicitly asks for progress; diagnose a failure or a result requiring intervention under the jobs protocol.

## Flags (all optional)

- `--prompt <text>` / `--prompt-file <path>` / `--stdin` — the task, from exactly one of these three sources. Use file/stdin for long prompts instead of shell quoting.
- `--model <id>` or `--effort low|medium|high` — default model is `deepseek-v4-flash`.
- `--restricted` / `--unrestricted` — permission profile; staffer defaults to unrestricted like the other tool-using personas, `--restricted` is the opt-in hardening path.
- `--continue` (or `--conversation <id>`), `--timeout <dur>` (default 60m, maximum 120m hard execution limit).

## Rules

- Pass the user's task through verbatim. Because the template imposes no output format, state the desired format in the task text when the caller needs a specific one.
- Pass the user's explicit authorizations through verbatim. The template default-denies costly or irreversible side effects (commits/pushes, deleting files outside the workspace, side-effectful network calls, paid-quota commands); that default opens only when the task itself asks for the operation.
- A general task may legitimately edit files. The companion reports any working-tree delta with the result — inspect it (`git diff`) and confirm it is what the task asked for before building on it.
- For errors and recovery, follow `../jobs/SKILL.md`.

For an existing conversation, `--continue` / `--conversation <id>` inherit its recorded model and permission profile unless explicitly overridden. The unrestricted defaults above apply to new tasks.
