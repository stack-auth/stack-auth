// Token accounting for Claude Code stream-json traces.
//
// The final `result` message's `usage` cannot be trusted as a step total: in
// practice it often reflects only the last API call of the session (observed
// directly — multi-turn agentic steps stored e.g. 6 input tokens), which made
// costs undercount by orders of magnitude versus actual OpenRouter billing.
// Every `assistant` message carries that API call's own usage, so the real
// total is the sum across all calls, deduplicated by message id (stream-json
// repeats the same message id once per content block). The result message's
// `usage` and per-model `modelUsage` are still folded in as a floor in case a
// trace is missing assistant lines.

type UsageCounts = {
  input: number,
  output: number,
  cacheRead: number,
  cacheCreation: number,
};

export type StreamUsageTotals = {
  inputTokens: bigint,
  outputTokens: bigint,
  cacheReadTokens: bigint,
  cacheCreationTokens: bigint,
  /** False when no usage data was seen at all (e.g. setup steps). */
  sawUsage: boolean,
};

const ZERO: UsageCounts = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };

function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function fieldMax(a: UsageCounts, b: UsageCounts): UsageCounts {
  return {
    input: Math.max(a.input, b.input),
    output: Math.max(a.output, b.output),
    cacheRead: Math.max(a.cacheRead, b.cacheRead),
    cacheCreation: Math.max(a.cacheCreation, b.cacheCreation),
  };
}

function fromSnakeUsage(usage: Record<string, unknown>): UsageCounts {
  return {
    input: toCount(usage.input_tokens),
    output: toCount(usage.output_tokens),
    cacheRead: toCount(usage.cache_read_input_tokens),
    cacheCreation: toCount(usage.cache_creation_input_tokens),
  };
}

export class StreamUsageAccumulator {
  /** Field-wise max of usage per API call (assistant message) id. */
  private perCall = new Map<string, UsageCounts>();
  private anonymousCalls = 0;
  /** Cumulative figures self-reported by the final result message. */
  private resultFloor: UsageCounts = ZERO;
  private seenUsage = false;

  /** Feed one raw stream-json line; non-JSON and usage-less lines are ignored. */
  addLine(line: string): void {
    try {
      this.addMessage(JSON.parse(line));
    } catch {
      // not JSON (stdout noise) — nothing to account
    }
  }

  /** Feed one parsed stream-json message (assistant or result; others ignored). */
  addMessage(parsed: unknown): void {
    if (typeof parsed !== "object" || parsed === null) return;
    const message = parsed as Record<string, unknown>;
    if (message.type === "assistant") {
      const inner = message.message as Record<string, unknown> | undefined;
      const usage = inner?.usage as Record<string, unknown> | undefined;
      if (!usage) return;
      const counts = fromSnakeUsage(usage);
      if (counts.input + counts.output + counts.cacheRead + counts.cacheCreation === 0) return;
      this.seenUsage = true;
      const id = typeof inner?.id === "string" && inner.id !== ""
        ? inner.id
        : `anonymous-call-${this.anonymousCalls++}`;
      this.perCall.set(id, fieldMax(this.perCall.get(id) ?? ZERO, counts));
    } else if (message.type === "result") {
      const usage = message.usage as Record<string, unknown> | undefined;
      if (usage) {
        this.seenUsage = true;
        this.resultFloor = fieldMax(this.resultFloor, fromSnakeUsage(usage));
      }
      // modelUsage is Claude Code's cumulative per-model breakdown (camelCase).
      const modelUsage = message.modelUsage as Record<string, unknown> | undefined;
      if (modelUsage && typeof modelUsage === "object") {
        const summed: UsageCounts = { ...ZERO };
        for (const entry of Object.values(modelUsage)) {
          const m = entry as Record<string, unknown>;
          summed.input += toCount(m.inputTokens);
          summed.output += toCount(m.outputTokens);
          summed.cacheRead += toCount(m.cacheReadInputTokens);
          summed.cacheCreation += toCount(m.cacheCreationInputTokens);
        }
        if (summed.input + summed.output + summed.cacheRead + summed.cacheCreation > 0) {
          this.seenUsage = true;
          this.resultFloor = fieldMax(this.resultFloor, summed);
        }
      }
    }
  }

  totals(): StreamUsageTotals {
    const callSum: UsageCounts = { ...ZERO };
    for (const counts of this.perCall.values()) {
      callSum.input += counts.input;
      callSum.output += counts.output;
      callSum.cacheRead += counts.cacheRead;
      callSum.cacheCreation += counts.cacheCreation;
    }
    const best = fieldMax(callSum, this.resultFloor);
    return {
      inputTokens: BigInt(Math.round(best.input)),
      outputTokens: BigInt(Math.round(best.output)),
      cacheReadTokens: BigInt(Math.round(best.cacheRead)),
      cacheCreationTokens: BigInt(Math.round(best.cacheCreation)),
      sawUsage: this.seenUsage,
    };
  }
}
