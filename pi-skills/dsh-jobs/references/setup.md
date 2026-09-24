<!-- Generated from skills/jobs/references/setup.md; run npm run generate:pi. Do not edit here. -->

# Setup

`setup` provisions the dsh profile dsh-staff runs on. Unlike the upstream project this derives from, setup is **required once before the first run** — not only for restricted runs — because the profile carries dsh-staff's own runner.

```bash
node "<skill-dir>/../../companion/dsh-companion.mjs" setup
```

What it does:

1. **Checks dsh.** Probes `dsh --version`. If dsh is not on PATH, install it (`npm i -g @deepseek-ai/dsh`) or set `DSH_BIN` — which may be a full command line, e.g. `DSH_BIN="npx -y @deepseek-ai/dsh"`.
2. **Creates the `dsh-staff` profile** under `$DSH_HOME/profiles/` (default `~/.dsh/profiles/`), from dsh's shipped `headless` template.
3. **Installs `runner.mjs` and `cordis.patch.yml`** into that profile. The overlay disables dsh's shipped one-shot runner and mounts dsh-staff's, which adds session resume and the record stream the companion reads. It also reads the model from `DSH_STAFF_MODEL` so one profile serves every mode, and disables dsh's OTEL session telemetry.
4. **Reports whether `DEEPSEEK_API_KEY` is set.** dsh reads the key at request time from the environment; dsh-staff never reads, stores, or logs its value. To reach an OpenAI-compatible endpoint other than DeepSeek's own, also set `DEEPSEEK_BASE_URL`.

Re-run `setup` after upgrading dsh-staff: it refreshes the installed runner and overlay in place.

## Permission profiles

dsh-staff maps its two profiles onto dsh's own permission presets. There is no separate allowlist to maintain.

- **unrestricted** (default for staffer, research, implement) — dsh's `danger-full-access` preset: approval policy `never`. Tool calls run without a prompt. This is what a headless run needs, because nothing is present to answer an approval.
- **restricted** (opt-in via `--restricted`, or per-repo via `setup --restrict <modes>`) — dsh's `workspace-write` preset: approval policy `ask`. In a headless run nobody can answer, so the first tool call needing approval yields an empty response. Use it to keep a mode from touching anything, not as a security boundary.

Neither profile is a sandbox for untrusted input. For that, use an isolated checkout.

`setup --restrict staffer,research` writes a per-repo policy to `.dsh-staff/config.json`; `setup --restrict none` clears it. A `--restricted` / `--unrestricted` flag on a call still overrides the policy. The file is per-repo and per-machine (normally git-ignored), and it is a run policy, not a security boundary.

## Telemetry

dsh ships with OTEL session export to DeepSeek enabled (`FEEDBACK_ONLY`, to `harness-telemetry.deepseeksvc.com`). Because dsh-staff is normally pointed at private repositories, the installed overlay disables that plugin and every run also sets `DSH_TELEMETRY_DISABLED=1`. To opt back in, unset that variable and re-enable the plugin in the profile's `cordis.patch.yml`.
