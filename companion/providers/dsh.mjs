/**
 * dsh provider — launches DeepSeek Harness (`dsh`) for the companion.
 *
 * The companion drives an agent through one narrow contract: build a launch
 * spec, get back `{status, response, conversation_id, ...}` (or the NDJSON
 * record stream carrying the same). dsh's shipped headless bundle does not
 * speak that contract, so `runner/runner.mjs` — installed into the profile by
 * `setup` — mounts in place of the shipped runner and emits it.
 *
 * Everything variable per invocation travels as an environment variable rather
 * than a CLI flag, because dsh's one-shot profile takes only the task text.
 * The profile's `cordis.patch.yml` reads these back through `!!js` expressions.
 *
 * SPDX-License-Identifier: MIT
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** The dsh profile `setup` provisions and every run boots. */
export const PROFILE = 'dsh-staff';

/** How to launch dsh. A value containing spaces is a command line (e.g.
 *  `npx -y @deepseek-ai/dsh`), so it is split; anything else names a binary. */
const DSH_BIN = process.env.DSH_BIN || 'dsh';

export function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

export function profileDir() {
  return path.join(dshHome(), 'profiles', PROFILE);
}

function binaryParts() {
  const parts = DSH_BIN.trim().split(/\s+/);
  return { cmd: parts[0], prefix: parts.slice(1) };
}

/** Model ids this provider accepts, sourced from dsh's own DeepSeek provider
 *  plugin rather than assumed. `deepseek-flash` is the shipped default alias. */
export const KNOWN_MODELS = new Set([
  'deepseek-v4-pro',
  'deepseek-v4-flash',
  'deepseek-v4-flash-vision-exp',
  'deepseek-flash',
]);

/** DeepSeek exposes no effort suffix, so `--effort` selects between models. */
const EFFORT_MODELS = {
  low: 'deepseek-v4-flash',
  medium: 'deepseek-v4-flash',
  high: 'deepseek-v4-pro',
};

const MODEL_ALIASES = {
  flash: 'deepseek-v4-flash',
  pro: 'deepseek-v4-pro',
};

/** Per-mode defaults: the cheap flash model carries routine delegation, the pro
 *  model carries the two modes whose output is acted on directly.
 *
 *  DSH_STAFF_DEFAULT_MODEL overrides all four. An endpoint that serves its own
 *  catalog — a gateway, a proxy, a self-hosted deployment — rarely uses
 *  DeepSeek's public model ids, and pinning one there should not mean passing
 *  --model on every call. */
export const DEFAULT_MODELS = (() => {
  const override = process.env.DSH_STAFF_DEFAULT_MODEL?.trim();
  if (override) return { staffer: override, research: override, implement: override, ask: override };
  return {
    staffer: 'deepseek-v4-flash',
    research: 'deepseek-v4-pro',
    implement: 'deepseek-v4-pro',
    ask: 'deepseek-v4-flash',
  };
})();

/**
 * Normalize a user-supplied `--model` / `--effort` pair to an id dsh accepts.
 * Unknown ids pass through: dsh owns the model catalog and a newer dsh may know
 * ids this table does not, so a stale table must not block a valid model.
 */
export function normalizeModel(raw, effort) {
  const override = process.env.DSH_STAFF_DEFAULT_MODEL?.trim();
  if (!raw) {
    if (override && !effort) return override;
    return EFFORT_MODELS[effort || 'medium'] ?? EFFORT_MODELS.medium;
  }
  const name = MODEL_ALIASES[raw] || raw;
  return name;
}

/** True when a model id is one this provider knows; callers warn rather than
 *  refuse, since dsh validates the id itself. */
export function isKnownModel(model) {
  return KNOWN_MODELS.has(model);
}

/**
 * Build the launch spec for one invocation.
 *
 * @param invoke - prompt, model, workspace, conversation, permission profile.
 * @param format - 'json' for a single result object, 'stream-json' for records.
 */
export function launchSpec(invoke, format) {
  const { cmd, prefix } = binaryParts();
  return {
    cmd,
    args: [...prefix, '--profile', PROFILE, invoke.prompt],
    // dsh resolves the sandbox workspace root from the working directory, so
    // the workspace is set here rather than passed as a flag.
    cwd: invoke.workspace,
    env: {
      ...process.env,
      DSH_STAFF_STREAM: format === 'stream-json' ? '1' : '0',
      DSH_STAFF_RESUME: invoke.conversation || '',
      DSH_STAFF_MODEL: invoke.model,
      // dsh's own preset names: `danger-full-access` sets approval to `never`,
      // which is what a headless run needs; `workspace-write` still asks and so
      // fails closed on any tool call the preset does not already allow.
      DSH_PERMISSION_MODE: invoke.unrestricted ? 'danger-full-access' : 'workspace-write',
      // Off by default: this runs against private repositories. A user who
      // wants DeepSeek's telemetry can unset it in their own environment.
      DSH_TELEMETRY_DISABLED: process.env.DSH_TELEMETRY_DISABLED ?? '1',
      ...(invoke.toolsMode ? { DSH_TOOLS_MODE: invoke.toolsMode } : {}),
    },
  };
}

/** Whether `setup` has provisioned the profile this provider boots. */
export function profileReady() {
  const dir = profileDir();
  return fs.existsSync(path.join(dir, 'runner', 'index.mjs')) && fs.existsSync(path.join(dir, 'cordis.patch.yml'));
}

/** Locate the dsh executable, or return null when it is not on PATH. */
export function locate() {
  const { cmd, prefix } = binaryParts();
  const probe = spawnSync(cmd, [...prefix, '--version'], { encoding: 'utf8', timeout: 120_000, windowsHide: true });
  if (probe.error || probe.status !== 0) return null;
  return (probe.stdout || '').trim();
}

/** Classify a dsh failure whose text the companion surfaces to the caller.
 *  Only patterns dsh actually emits are matched; nothing is guessed. */
export function diagnose(errText) {
  const hints = [];
  if (/HTTP_401|HTTP_403|unauthorized|forbidden|invalid api key/i.test(errText)) {
    hints.push('the endpoint rejected the credentials — check DEEPSEEK_API_KEY');
  }
  if (/HTTP_404|not supported by any configured account|model.*not found/i.test(errText)) {
    hints.push('the endpoint does not serve that model id — list what it offers and pass --model accordingly');
  }
  if (/STREAM_CLOSED|SSE stream ended/i.test(errText)) {
    hints.push('the endpoint returned a non-SSE body (often an HTML page): check that DEEPSEEK_BASE_URL includes the API path prefix, e.g. https://host/v1');
  }
  // REQUEST_EXTENSION is raised before any request leaves the process, so it is
  // never a credential or endpoint fault. It is dsh's plugin inventory failing
  // to resolve a mounted entry to a package manifest that declares a version.
  if (/REQUEST_EXTENSION/i.test(errText)) {
    hints.push('dsh could not resolve a mounted plugin to a versioned package manifest — re-run `setup` to reinstall the runner package');
  }
  if (/cannot resume session/i.test(errText)) {
    hints.push('the session id is no longer in $DSH_HOME/sessions — start a new run instead of continuing');
  }
  if (/ENOENT|not found/i.test(errText)) {
    hints.push('dsh is not on PATH — install it with `npm i -g @deepseek-ai/dsh`, or set DSH_BIN');
  }
  return hints;
}
