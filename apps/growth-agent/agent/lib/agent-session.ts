import type { SendFn } from "eve/channels";
import { buildGrowthSessionAuth, type GrowthSessionAuthInput } from "#lib/run-context.ts";
import type { JsonValue } from "#lib/types.ts";

/**
 * Starting a task-mode eve session and following it to a terminal event.
 *
 * Extracted from run-analysis-phase.ts when the ads-execution run kind arrived (PART VI / X8): the
 * stream/timeout/terminal-event handling below is subtle enough that a second copy of it would
 * drift, and the only things that legitimately differ between run kinds are the session cap, the
 * customer-facing timeout sentence, and whether the session is asked for a structured result.
 */

/**
 * Error whose message is safe to show to the customer in the dashboard (no stack traces, URLs, or
 * internal identifiers). Anything else that escapes a run is reported with a generic message
 * instead. Shared by every run kind so the "is this string customer-safe" question has exactly one
 * answer in this app.
 */
export class SafeRunError extends Error {}

export function safeMessageFromError(error: unknown, fallback: string): string {
  return error instanceof SafeRunError ? error.message : fallback;
}

export type AgentSessionOutcome = {
  readonly sessionId: string,
  /**
   * The payload of the last `result.completed` event, i.e. the structured result eve validated
   * against `outputSchema`. `null` when no schema was requested, and also when one was requested but
   * the session completed without ever emitting a result — callers must handle that case rather than
   * assuming a schema request guarantees a value.
   *
   * `unknown`, not a JSON type: eve validated it against the schema we supplied, but this module has
   * no business asserting the shape a particular caller asked for. Callers narrow it themselves.
   */
  readonly structuredResult: unknown,
};

/**
 * Starts a task-mode session on the root agent and waits for it to finish by following its durable
 * event stream. Throws on session failure or timeout.
 */
export async function runAgentSession(options: {
  readonly send: SendFn,
  readonly message: string,
  readonly context: GrowthSessionAuthInput,
  readonly continuationToken: string,
  readonly title: string,
  /**
   * Upper bound on this session. The backend's liveness protection is a heartbeat reap, which our
   * 60s heartbeat defeats for as long as this process is alive — so without a local cap, a session
   * stuck in an endless tool loop would hold its anchor forever. Every caller's value is far above
   * any legitimate duration for its run kind and exists purely to convert "stuck forever" into a
   * reported failure.
   */
  readonly maxSessionMs: number,
  /** Customer-facing sentence used when {@link maxSessionMs} elapses. Raised as a `SafeRunError`. */
  readonly timeoutMessage: string,
  /**
   * JSON Schema the session's final result must match. When present eve enforces it and surfaces the
   * validated value as a `result.completed` event; in `mode: "task"` a session that cannot produce a
   * matching result finishes as an error. Keep every field optional unless the run genuinely cannot
   * proceed without it — a schema the model can fail to satisfy turns a successful run into a failed
   * one.
   */
  readonly outputSchema?: Readonly<Record<string, JsonValue>>,
}): Promise<AgentSessionOutcome> {
  const session = await options.send(
    // The plain-string form is kept for the (common) no-schema case so this refactor cannot change
    // how existing run kinds are dispatched; `outputSchema` is only expressible on the payload form.
    options.outputSchema === undefined ? options.message : { message: options.message, outputSchema: options.outputSchema },
    {
      auth: buildGrowthSessionAuth(options.context),
      continuationToken: options.continuationToken,
      // Task mode: the session must run to completion on its own. It has no
      // human to wait for, so an empty turn or input request finishes as an
      // error instead of parking forever.
      mode: "task",
      title: options.title,
    },
  );
  const stream = await session.getEventStream({ startIndex: 0 });
  const reader = stream.getReader();
  // One resolve-only timer races against every read below; racing (instead of
  // cancelling the reader from inside the timer callback) keeps all the
  // control flow — including the reader.cancel() — in this function, where
  // errors propagate normally.
  let timeoutTimer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<"timeout">((resolve) => {
    timeoutTimer = setTimeout(() => resolve("timeout"), options.maxSessionMs);
    timeoutTimer.unref();
  });
  let structuredResult: unknown = null;
  try {
    while (true) {
      const readResult = await Promise.race([reader.read(), timeoutPromise]);
      if (readResult === "timeout") {
        await reader.cancel();
        throw new SafeRunError(options.timeoutMessage);
      }
      const { done, value: event } = readResult;
      if (done) {
        // A stream that ends without a terminal session event means the
        // session infrastructure dropped it — surface loudly instead of
        // guessing an outcome.
        throw new Error(`Agent session event stream ended without a terminal event: session=${session.id}`);
      }
      switch (event.type) {
        case "result.completed": {
          // Recorded rather than returned: `result.completed` precedes the terminal event, and a
          // multi-turn session can emit more than one. The last one before completion is the answer.
          structuredResult = event.data.result;
          break;
        }
        case "session.completed": {
          return { sessionId: session.id, structuredResult };
        }
        case "session.failed": {
          // event.data.message may contain provider/internal detail; callers
          // sanitize before anything user-visible (see executeAnalysisPhase).
          throw new Error(`Agent session failed: session=${session.id} code=${event.data.code} message=${event.data.message}`);
        }
        case "session.waiting": {
          // Task mode should never park; if it does, treat it as a failure so
          // the run does not hang until the timeout.
          throw new Error(`Agent session parked waiting for input in task mode: session=${session.id}`);
        }
        default: {
          // Progress events (turn/step/message/subagent/...) — keep waiting.
          break;
        }
      }
    }
  } finally {
    if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
    reader.releaseLock();
  }
}
