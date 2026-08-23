import type { ChannelContinuationOps } from "eve/channels";
import { phaseComplete, phaseFail } from "#lib/hexclave-client.ts";
import { parsePhaseContinuationToken } from "#lib/phase-continuation.ts";

export type PhaseSettlementContext = {
  readonly continuation?: ChannelContinuationOps["continuation"],
};


export async function settleGrowthPhaseFromTerminalEvent(channel: PhaseSettlementContext, failureMessage: string | null): Promise<void> {
  const continuationToken = channel.continuation?.token;
  if (continuationToken == null) return;
  const identity = parsePhaseContinuationToken(continuationToken);
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
