/**
 * dsh-staff runner — a one-shot dsh (DeepSeek Harness) driver that speaks the
 * event protocol dsh-staff's companion already understands.
 *
 * It exists because the shipped `@deepseek-ai/dsh-headless` bundle gives a
 * one-shot runner two things the companion cannot work without:
 *
 *   1. no resume — it mints `session-${randomUUID()}` on every invocation, so
 *      `continue` / `restart` and background follow-ups have nothing to attach
 *      to. `AgentRegistry.resume()` exists in dsh core; the bundle just never
 *      calls it.
 *   2. no structured output — it prints the final assistant text and nothing
 *      else, so a caller cannot see tool activity while a long job runs, nor
 *      read back a status, a session id, or token accounting.
 *
 * This runner mounts in their place and emits one NDJSON record per line
 * (`--stream`) or a single result object, projecting dsh's `session/event`
 * firehose into the three record types the companion's observation layer
 * consumes: `init`, `step_update`, `result`.
 *
 * Provider reasoning still streams to stderr, exactly as the shipped bundle
 * does: stdout carries protocol, stderr carries progress.
 *
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from 'node:crypto';
import z from '@deepseek-ai/schemastery';
import { brandString } from '@deepseek-ai/dsh-brand';
import { installModelSelection } from '@deepseek-ai/dsh-agent';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { SessionSeq } from '@deepseek-ai/dsh-session';

/** Stable Cordis plugin name. */
export const name = 'dsh-staff-runner';

/** Core services required before the one-shot turn can start. */
export const inject = ['agentDefaultModel', 'agents', 'sessions'];

export const Config = z.object({
  /** The task text driving this one-shot turn. */
  task: z.string().required(),
  /** A persisted session id to resume instead of creating a new session. */
  resumeSessionId: z.string(),
  /** Emit the NDJSON record stream rather than a single result object. */
  stream: z.boolean(),
});

/** The process streams the runner writes to; tests substitute captures. */
export const internals = { stdout: process.stdout, stderr: process.stderr };

/** Best-effort text extraction from a tool result or assistant message whose
 *  exact block shape is owned by the producing plugin, not by this runner. */
function blockText(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block && (block.type === 'text' || typeof block.text === 'string'))
    .map((block) => block.text ?? '')
    .join('');
}

/** Token accounting in the shape the companion's `fmtTokens` already renders. */
function tokenUsage(usage) {
  if (!usage || typeof usage !== 'object') return undefined;
  return {
    input_tokens: usage.inputTokens ?? usage.input_tokens,
    output_tokens: usage.outputTokens ?? usage.output_tokens,
    cache_read_input_tokens: usage.cacheReadTokens ?? usage.cache_read_input_tokens,
    total_tokens: usage.totalTokens ?? usage.total_tokens,
  };
}

/**
 * Project a live session onto the companion's NDJSON record protocol.
 *
 * Step identity is assigned here rather than taken from dsh's `{turn, step}`
 * pair: a tool call and its result must share one step index so the companion
 * folds them into a single activity, while dsh reports both under the same
 * `step` as the assistant message that requested them.
 */
function createEmitter(conversationId, { stream, stdout }) {
  let nextStep = 0;
  const toolSteps = new Map();
  const responseSteps = new Map();
  const stepFor = (map, key) => {
    if (!map.has(key)) map.set(key, nextStep++);
    return map.get(key);
  };
  const write = (record) => {
    if (!stream) return;
    stdout.write(JSON.stringify(record) + '\n');
  };
  const stepUpdate = (body) => write({
    event: 'step_update',
    conversation_id: conversationId,
    step_update: { conversation_id: conversationId, ...body },
  });

  return {
    init: () => write({ event: 'init', init: { conversation_id: conversationId } }),
    /** One appended session event; unknown types are deliberately ignored so a
     *  dsh core that grows new event types does not break the projection. */
    accept: (event) => {
      const data = event?.data;
      if (!data) return;
      switch (event.type) {
        case 'tool/call':
          stepUpdate({
            step_index: stepFor(toolSteps, String(data.callId)),
            step_type: 'tool',
            state: 'ACTIVE',
            tool_name: data.name,
            tool_info: { name: data.name, parameters: data.arguments },
          });
          return;
        case 'tool/result': {
          const callId = String(data.message?.toolCallId ?? data.message?.callId ?? '');
          const text = blockText(data.message);
          stepUpdate({
            step_index: stepFor(toolSteps, callId),
            step_type: 'tool',
            state: 'DONE',
            tool_name: data.message?.toolName,
            tool_info: data.error
              ? { name: data.message?.toolName, error: `${data.error.code}: ${data.error.name}`, output: text }
              : { name: data.message?.toolName, output: text },
            error: data.error ? `${data.error.code}: ${data.error.name}` : undefined,
          });
          return;
        }
        case 'assistant/message': {
          const text = blockText(data.message);
          if (!text) return;
          stepUpdate({
            step_index: stepFor(responseSteps, `${data.turn}:${data.step}`),
            step_type: 'agent_response',
            state: data.interrupted ? 'ACTIVE' : 'DONE',
            text_delta: text,
          });
          return;
        }
        default:
          return;
      }
    },
    /** The terminal record. In stream mode it is the last NDJSON line; in
     *  single-result mode it is the only thing on stdout. */
    result: (payload) => {
      const record = { conversation_id: conversationId, ...payload };
      stdout.write(stream ? JSON.stringify({ event: 'result', result: record }) + '\n' : JSON.stringify(record) + '\n');
    },
  };
}

/**
 * Stream provider reasoning to stderr for the exact agent this invocation owns,
 * terminating an unfinished reasoning line on teardown.
 */
function streamReasoning(ctx, agent, stderr) {
  let open = false;
  let endsWithNewline = true;
  const close = () => {
    if (!open) return;
    if (!endsWithNewline) stderr.write('\n');
    open = false;
    endsWithNewline = true;
  };
  const dispose = ctx.on('agent/assistant-stream', ({ agent: subject, frame }) => {
    if (subject !== agent) return;
    if (frame.type === 'start' || frame.type === 'end') return close();
    const chunk = frame.chunk;
    if (chunk.type === 'reasoning-delta') {
      if (chunk.text === '') return;
      if (!open) {
        stderr.write('dsh: reasoning:\n');
        open = true;
      }
      stderr.write(chunk.text);
      endsWithNewline = chunk.text.endsWith('\n');
      return;
    }
    if (chunk.type === 'block-start' && chunk.blockType !== 'reasoning') return close();
    if (chunk.type === 'block-end' && chunk.block?.type !== 'reasoning') return close();
    if (chunk.type === 'text-delta' || chunk.type === 'tool-call-delta' || chunk.type === 'finish') return close();
  });
  return () => {
    dispose();
    close();
  };
}

/** Aggregate the final assistant text, turn outcome, and token usage over the
 *  exact interval this invocation owns. */
function summarize(session, firstSeq) {
  let started = false;
  let text = '';
  let reason;
  let usage;
  let turns = 0;
  const length = session.seq;
  for (let seq = firstSeq; seq < length; seq++) {
    const event = session.eventAt(SessionSeq(seq));
    if (event === undefined) continue;
    if (event.type === 'turn/start') {
      started = true;
      turns += 1;
      continue;
    }
    if (!started) continue;
    if (event.type === 'assistant/message') {
      const joined = blockText(event.data.message);
      if (joined !== '') text = joined;
      if (event.data.usage) usage = event.data.usage;
    }
    if (event.type === 'turn/end') reason = event.data.reason;
  }
  return { text, reason, usage, turns };
}

async function run(ctx, config, io) {
  await ctx.get('loader')?.await();
  const agents = ctx.get('agents');
  const defaultModel = ctx.get('agentDefaultModel');
  const sessions = ctx.get('sessions');
  if (agents === undefined || defaultModel === undefined || sessions === undefined) return;

  const selection = defaultModel.currentSelection();
  const agentOptions = { provider: selection.provider, model: selection.model };
  const setup = (agentCtx) => {
    installModelSelection(agentCtx, { current: selection, assembled: undefined });
  };

  const startedAt = Date.now();
  const resumeId = config.resumeSessionId?.trim();
  let handle;
  try {
    handle = resumeId
      ? await agents.resume({ resumeSessionId: brandString(resumeId), agentOptions, setup })
      : await agents.create({
          sessionId: brandString(`session-${randomUUID()}`),
          meta: { cwd: process.cwd() },
          agentOptions,
          setup,
        });
  } catch (error) {
    // A resume of an id that no longer exists is the one failure a caller can
    // act on directly, so it is reported as such rather than as a crash.
    if (resumeId) {
      throw Object.assign(new Error(`cannot resume session ${resumeId}: ${error instanceof Error ? error.message : String(error)}`), { cause: error });
    }
    throw error;
  }
  const { agent } = handle;

  const conversationId = String(agent.session.id);
  const emitter = createEmitter(conversationId, { stream: config.stream, stdout: io.stdout });
  emitter.init();

  await agent.whenIdle();
  const firstSeq = agent.session.seq;

  // Only this invocation's session is projected: a subagent's own session runs
  // through the same firehose and must not enter this job's activity feed.
  const stopEvents = ctx.on('session/event', (session, event) => {
    if (session !== agent.session) return;
    emitter.accept(event);
  });
  const stopReasoning = streamReasoning(ctx, agent, io.stderr);

  let outcome;
  try {
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: config.task }],
      source: { kind: 'user' },
    }));
    await agent.whenIdle();
  } finally {
    stopReasoning();
    stopEvents();
  }

  await sessions.flush(agent.session);
  outcome = summarize(agent.session, firstSeq);

  const completed = outcome.reason?.kind === 'completed';
  if (!completed && outcome.reason?.kind === 'error') {
    io.stderr.write(`dsh: ${outcome.reason.error.code}: ${outcome.reason.error.message}\n`);
  }
  emitter.result({
    status: completed ? 'SUCCESS' : 'ERROR',
    response: outcome.text,
    error: completed ? undefined : outcome.reason?.error?.message ?? outcome.reason?.kind,
    num_turns: outcome.turns,
    duration_seconds: Math.round((Date.now() - startedAt) / 1000),
    usage: tokenUsage(outcome.usage),
  });
  io.exit(completed ? 0 : 1);
}

export function apply(ctx, config) {
  const exit = ctx.get('appExit');
  if (exit === undefined) throw new Error('dsh-staff-runner: the launcher must provide ctx.appExit before the tree mounts');
  const io = { stdout: internals.stdout, stderr: internals.stderr, exit };
  run(ctx, config, io).catch((error) => {
    io.stderr.write(`dsh: ${error instanceof Error ? error.message : String(error)}\n`);
    io.exit(1);
  });
}
