// Resilient consumption of a Vercel Sandbox command log stream.
//
// `command.logs()` is a long-lived NDJSON HTTP stream. On long agent steps the
// underlying socket can drop mid-stream (surfaced by undici/Node as a generic
// `TypeError` — often message "terminated" — whose real reason lives in
// `.cause` with a code like ECONNRESET) even though the command keeps running
// inside the sandbox. The SDK's built-in retry only covers establishing the
// connection, not a drop while the body is streaming, so we must reconnect
// ourselves. The logs endpoint always replays output from the *start* (there is
// no offset parameter), so to deliver each line exactly once across reconnects
// we track how many raw characters of each stream we've already delivered and
// skip them on replay.

import { StreamError } from "@vercel/sandbox";

const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "ENETUNREACH",
  "ENETDOWN",
  "EHOSTUNREACH",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

const TRANSIENT_MESSAGE_FRAGMENTS = [
  "terminated",
  "other side closed",
  "socket hang up",
  "fetch failed",
  "network",
  "premature close",
];

// True for connection-level failures that are worth reconnecting on. A
// server-side `StreamError` (e.g. the sandbox was stopped) anywhere in the
// cause chain is deliberately excluded: replaying would just hit the same
// terminal error, so it must propagate.
export function isTransientNetworkError(error: unknown): boolean {
  const chain: Error[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    current = (current as { cause?: unknown }).cause;
  }
  if (chain.some(level => level instanceof StreamError)) return false;
  return chain.some(level => {
    const code = (level as { code?: unknown }).code;
    if (typeof code === "string" && TRANSIENT_NETWORK_CODES.has(code)) return true;
    const message = level.message.toLowerCase();
    return TRANSIENT_MESSAGE_FRAGMENTS.some(fragment => message.includes(fragment));
  });
}

type LogStream = "stdout" | "stderr";

// Demultiplexes a (possibly replayed-from-start) command log stream into
// exactly-once, newline-delimited callbacks. Empty/whitespace-only lines are
// dropped, matching the previous inline behaviour.
export class ResumableLogDemuxer {
  private deliveredStdout = 0;
  private deliveredStderr = 0;
  private bufStdout = "";
  private bufStderr = "";
  // Characters seen *within the current connection* — reset on each reconnect
  // since the endpoint replays from the start.
  private seenStdout = 0;
  private seenStderr = 0;

  constructor(
    private readonly onStdoutLine?: (line: string) => void,
    private readonly onStderrLine?: (line: string) => void,
  ) {}

  // Must be called before (re)playing chunks from a fresh connection.
  beginConnection(): void {
    this.seenStdout = 0;
    this.seenStderr = 0;
  }

  // Feed one raw chunk from the stream; only not-yet-delivered characters are
  // turned into line callbacks.
  push(stream: LogStream, data: string): void {
    if (stream === "stdout") {
      const start = this.seenStdout;
      this.seenStdout += data.length;
      if (this.seenStdout <= this.deliveredStdout) return; // entire chunk already delivered
      const fresh = data.slice(Math.max(0, this.deliveredStdout - start));
      this.deliveredStdout += fresh.length;
      this.bufStdout = this.emitLines(this.bufStdout + fresh, this.onStdoutLine);
    } else {
      const start = this.seenStderr;
      this.seenStderr += data.length;
      if (this.seenStderr <= this.deliveredStderr) return;
      const fresh = data.slice(Math.max(0, this.deliveredStderr - start));
      this.deliveredStderr += fresh.length;
      this.bufStderr = this.emitLines(this.bufStderr + fresh, this.onStderrLine);
    }
  }

  // Total characters delivered so far across both streams. Used by the caller
  // to detect whether forward progress was made between reconnect attempts.
  get deliveredChars(): number {
    return this.deliveredStdout + this.deliveredStderr;
  }

  // Emit any trailing partial (unterminated) lines. Call once the stream has
  // ended for good.
  flush(): void {
    if (this.bufStdout.trim() !== "") this.onStdoutLine?.(this.bufStdout);
    if (this.bufStderr.trim() !== "") this.onStderrLine?.(this.bufStderr);
    this.bufStdout = "";
    this.bufStderr = "";
  }

  private emitLines(buffer: string, emit?: (line: string) => void): string {
    const lines = buffer.split("\n");
    const remainder = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim() !== "") emit?.(line);
    }
    return remainder;
  }
}
