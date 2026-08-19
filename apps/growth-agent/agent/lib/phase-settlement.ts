import { phaseComplete, phaseFail } from "#lib/hexclave-client.ts";
import { parsePhaseContinuationToken } from "#lib/phase-continuation.ts";

export type PhaseSettlementContext = {
  readonly continuationToken: string,
};


/**
 * Settles a growth phase from the channel's terminal session event (`session.completed` /
 * `session.failed`).
 *
 * A settlement failure is logged and deliberately NOT re-thrown. eve runs channel event handlers
 * through `callAdapterEventHandler`, which catches whatever a handler throws and only logs
 * ("adapter event handler threw — event swallowed"); its callers for the terminal events
 * (`emitTerminalSessionCompletionStep` / `emitTerminalSessionFailureStep`) wrap that call in a
 * catch of their own as well. A throw therefore cannot fail the durable step or earn a retry —
 * it would only trade our log line, which names the run/phase/attempt, for eve's generic one.
 * A phase left unsettled is instead reaped by the backend's stuck-phase check (`isPhaseStuck`),
 * which sees a RUNNING row whose heartbeat stopped.
 */
export async function settleGrowthPhaseFromTerminalEvent(channel: PhaseSettlementContext, failureMessage: string | null): Promise<void> {
  const identity = parsePhaseContinuationToken(channel.continuationToken);
  if (identity == null) return;
  try {
    if (failureMessage == null) {
      await phaseComplete(identity);
    } else {
      await phaseFail({ ...identity, error_message: failureMessage });
    }
  } catch (error) {
    console.error(`[growth-agent] failed to settle phase from its terminal event: run=${identity.run_id} phase=${identity.phase_key} attempt=${identity.attempt}`, error);
  }
}
