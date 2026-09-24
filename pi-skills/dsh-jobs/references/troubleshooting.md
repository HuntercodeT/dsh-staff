<!-- Generated from skills/jobs/references/troubleshooting.md; run npm run generate:pi. Do not edit here. -->

# Troubleshooting

## Setup has not run

> Run `dsh-companion.mjs setup` first: it provisions the "dsh-staff" dsh profile …

The companion refuses to launch until the profile carries its runner and overlay. Run `setup`. This is also the message you get after a fresh clone or an upgrade that shipped a new runner.

## dsh is not on PATH

> dsh CLI not found or not working (tried `dsh --version`)

Install it with `npm i -g @deepseek-ai/dsh`, or set `DSH_BIN`. `DSH_BIN` may be a full command line, so `DSH_BIN="npx -y @deepseek-ai/dsh"` works without a global install (at the cost of npx resolution on every run).

## The key is rejected

> DeepSeek rejected the request — check DEEPSEEK_API_KEY

dsh reports this as `REQUEST_EXTENSION: DeepSeek request extension preparation failed`, which is what an absent or invalid key looks like. Export `DEEPSEEK_API_KEY` in the shell that runs the companion. If you are pointing at an OpenAI-compatible endpoint other than DeepSeek's own, `DEEPSEEK_BASE_URL` must be set in the same environment.

## A run comes back empty

Most often this is a restricted run. `--restricted` maps to dsh's `workspace-write` preset, whose approval policy is `ask`; in a headless run nothing can answer, so the first tool call needing approval produces no output. Drop `--restricted` (staffer, research, and implement default to unrestricted), or relax the per-repo policy with `setup --restrict none`.

## A continuation fails to resume

> cannot resume session <id>

dsh-staff resumes through dsh's `AgentRegistry.resume()`, which loads the persisted session from `$DSH_HOME/sessions`. A session removed, pruned, or created under a different `DSH_HOME` cannot be resumed. Start a new run instead of continuing.

## Sandboxes

dsh needs to read and write `$DSH_HOME` (its profile, plugin tree, and session log), reach the model endpoint over the network, and read and write the working directory it is launched in. A harness command sandbox that hides any of those will break a run. If a run fails with `operation not permitted`, re-run the companion command unsandboxed — in Codex, request escalated permissions for the command.
