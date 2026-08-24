// Uploads the packaged source tarball to the presigned object-storage slot.
//
// WHY node:http(s) AND NOT fetch. Global fetch is undici, and undici arms
// `headersTimeout` (300s by default) the moment the request goes on the wire —
// it is a socket READ timeout, and the object store sends nothing until it has
// the whole body, so nothing resets it while the body is still uploading. That
// makes it a wall-clock cap on the entire PUT rather than a cap on waiting for
// a reply: an upload that takes longer than five minutes to push dies with a
// bare `TypeError: fetch failed` on a perfectly healthy connection. At that cap
// a 39 MB source needs a sustained ~1.1 Mbit/s and the 50 MB ceiling needs
// ~1.4 Mbit/s, which is why shrinking a repository "fixed" it for anyone on a
// slower link. node:http has no default client-side timeout, so the deadlines
// below are ours to choose.
//
// The deadline that matters is the SLOT's: the presigned URL expires, and
// nothing can be written to a dead URL, so there is no reason to keep pushing
// past that moment and no reason to give up before it.

import http from "node:http";
import https from "node:https";
import { CliError } from "./errors.js";

// Used when the API did not say when the slot expires. Marshal's own
// UPLOAD_EXPIRY_SECONDS; duplicated rather than imported because the CLI takes
// no dependency on the runtime, and it is only a fallback — the real value
// travels with the upload slot.
export const DEFAULT_UPLOAD_DEADLINE_MS = 15 * 60 * 1000;
// Clamps on the deadline the API hands us: a slot that already expired is not a
// reason to skip the attempt entirely (clocks differ), and one that claims to
// last for hours is not a reason to hang for hours.
const MIN_UPLOAD_DEADLINE_MS = 60 * 1000;
const MAX_UPLOAD_DEADLINE_MS = 30 * 60 * 1000;
// No bytes FLUSHED for this long while the body is still being written. Reset
// by every chunk the stream confirms, so "slow" never trips it — only "stopped"
// does: a connection that died without a TCP reset (a suspended laptop, a
// dropped NAT mapping) fails in a minute instead of occupying the whole
// deadline above.
//
// Deliberately armed ONLY while writing. Once the body is out, the client is
// idle by definition — it is waiting for a reply, and the store says nothing
// until it has finished receiving what is still in flight. Timing out THAT
// window on inactivity is precisely undici's headersTimeout bug, which is what
// this module exists to avoid; past the last chunk the deadline is the only
// clock.
const DEFAULT_STALL_TIMEOUT_MS = 60 * 1000;
// The body is handed to the socket in pieces rather than in one call, so that
// backpressure is respected and a failure can say how far it got.
//
// The size is load-bearing for the stall timer, not just for memory: a flush
// callback is the only "still alive" signal there is, so the gap between them
// is CHUNK / throughput, and any link slower than CHUNK / stall-timeout gets
// mistaken for a dead one. At 64 KB and a 60s timeout that floor is ~1.1 KB/s,
// which is dead by any reading. At 1 MB it would be ~17 KB/s — fast enough to
// false-positive on the very slow links this module exists to keep working.
const WRITE_CHUNK_BYTES = 64 * 1024;
// An error body from object storage is XML and small; enough of it to name the
// problem, never enough to be worth streaming.
const MAX_ERROR_BODY_BYTES = 8 * 1024;

export type UploadSourceOptions = {
  uploadUrl: string,
  contentType: string,
  bytes: Uint8Array,
  /**
   * When the presigned slot expires, as the API reported it. This is the
   * upload's deadline. Null/undefined falls back to DEFAULT_UPLOAD_DEADLINE_MS.
   */
  expiresAtMillis?: number | null,
  /** Overridable for tests; see DEFAULT_STALL_TIMEOUT_MS. */
  stallTimeoutMs?: number,
  /**
   * The deadline to enforce, bypassing `expiresAtMillis` and its clamps.
   * Overridable for tests — the clamp floor is a minute, which no test can wait
   * for, and the deadline's teardown is exactly what needs covering.
   */
  deadlineMs?: number,
};

/** The deadline to enforce, in ms from now, clamped to something sane. */
export function uploadDeadlineMs(expiresAtMillis: number | null | undefined, now: number): number {
  if (typeof expiresAtMillis !== "number" || !Number.isFinite(expiresAtMillis)) return DEFAULT_UPLOAD_DEADLINE_MS;
  const remaining = expiresAtMillis - now;
  return Math.min(MAX_UPLOAD_DEADLINE_MS, Math.max(MIN_UPLOAD_DEADLINE_MS, remaining));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(millis: number): string {
  // Sub-second gets a decimal: a connection cut at "0s" reads as a bug in the
  // message, and how fast it died is part of the diagnosis.
  if (millis < 1000) return `${(millis / 1000).toFixed(1)}s`;
  const seconds = Math.round(millis / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
}

/**
 * Throughput as a reader would state it, or null when the sample is too short
 * to mean anything — a socket reset a few hundred milliseconds in "measures"
 * gigabits per second, which is the buffer emptying, not the link.
 */
export function formatRate(bytes: number, millis: number): string | null {
  if (millis < 1000 || bytes <= 0) return null;
  return `${formatBytes(Math.round(bytes / (millis / 1000)))}/s`;
}

/**
 * "12.3 MB of 39.0 MB in 5m00s (about 41.9 KB/s)" — the three numbers that turn
 * a failed upload into a diagnosis: how far it got, how long that took, and
 * therefore whether the connection or the source size is the problem.
 */
function progressSummary(sent: number, total: number, elapsedMillis: number): string {
  const rate = formatRate(sent, elapsedMillis);
  return `${formatBytes(sent)} of ${formatBytes(total)} in ${formatDuration(elapsedMillis)}${rate === null ? "" : ` (about ${rate})`}`;
}

const TOO_LARGE_HINT = "Check your .gitignore/.dockerignore — build outputs and large assets shouldn't be uploaded.";

/**
 * PUTs `bytes` to the presigned URL, or throws a CliError that says what went
 * wrong in the terms the user can act on.
 *
 * Every failure path here used to surface as an unwrapped `TypeError: fetch
 * failed` printed by the CLI's top-level handler, which named neither the
 * upload, nor its size, nor the deadline it hit.
 */
export async function uploadSource(options: UploadSourceOptions): Promise<void> {
  const { uploadUrl, contentType, bytes } = options;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(uploadUrl);
  } catch {
    throw new CliError("The Hexclave API returned an invalid object-storage upload URL.");
  }
  const transport = parsedUrl.protocol === "https:" ? https : parsedUrl.protocol === "http:" ? http : null;
  if (transport === null) {
    throw new CliError("The Hexclave API returned an upload URL with an unsupported protocol.");
  }

  const total = bytes.byteLength;
  const startedAt = Date.now();
  const deadlineMs = options.deadlineMs ?? uploadDeadlineMs(options.expiresAtMillis, startedAt);
  const stallTimeoutMs = options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS;
  const elapsed = () => Date.now() - startedAt;
  // Bytes the stream has confirmed it flushed, not bytes handed to write() —
  // the difference is a socket buffer, and overstating progress in a timeout
  // message is exactly the wrong direction.
  let sent = 0;

  await new Promise<void>((resolve, reject) => {
    const request = transport.request(parsedUrl, {
      method: "PUT",
      headers: {
        // Signed into the R2/S3 URL: it must match exactly or the store 403s.
        "content-type": contentType,
        "content-length": String(total),
      },
    });

    let settled = false;
    let deadlineTimer: NodeJS.Timeout | undefined = setTimeout(() => {
      fail(new CliError([
        `Uploading the packaged source timed out after ${formatDuration(deadlineMs)}: ${progressSummary(sent, total, elapsed())}.`,
        `The upload slot expires after that, so a slower upload cannot finish. ${TOO_LARGE_HINT}`,
      ].join("\n")));
    }, deadlineMs);
    // Never let the deadline hold the event loop open on its own; the request
    // does that, and the timer is cleared with it.
    deadlineTimer.unref();

    function settle(action: () => void): void {
      if (settled) return;
      settled = true;
      if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
      deadlineTimer = undefined;
      disarmStall();
      action();
    }
    function fail(error: Error): void {
      settle(() => {
        request.destroy();
        reject(error);
      });
    }

    // Armed while writing, disarmed at the last chunk — see DEFAULT_STALL_TIMEOUT_MS.
    // `bodyWritten` is what makes the disarm stick: a chunk's flush callback
    // fires AFTER end() for the final chunk, so without it that callback would
    // re-arm the timer over the response wait and reintroduce the very timeout
    // this module removes.
    let bodyWritten = false;
    let stallTimer: NodeJS.Timeout | undefined;
    function disarmStall(): void {
      if (stallTimer !== undefined) clearTimeout(stallTimer);
      stallTimer = undefined;
    }
    function armStall(): void {
      if (settled || bodyWritten) return;
      disarmStall();
      stallTimer = setTimeout(() => {
        fail(new CliError(
          `The source upload stalled: no data was sent for ${formatDuration(stallTimeoutMs)}, after ${progressSummary(sent, total, elapsed())}. Check your network connection and try again.`,
        ));
      }, stallTimeoutMs);
      stallTimer.unref();
    }

    request.on("error", (error: NodeJS.ErrnoException) => {
      // Reached only for a real transport failure — every deliberate teardown
      // above has already settled, and `settle` makes this a no-op afterwards.
      const code = typeof error.code === "string" ? ` (${error.code})` : "";
      // How far it got is the diagnosis when it got somewhere; on a connection
      // that never opened it is just "0 B of 39.0 MB in 0s", which says nothing.
      const progress = sent === 0 ? "" : ` after ${progressSummary(sent, total, elapsed())}`;
      fail(new CliError(
        `The source upload failed${code}${progress}: ${error.message}. Check your network connection and try again.`,
      ));
    });

    request.on("response", (response) => {
      const status = response.statusCode ?? 0;
      const ok = status >= 200 && status < 300;
      const chunks: Buffer[] = [];
      let bodyBytes = 0;
      response.on("data", (chunk: Buffer) => {
        // A success body is discarded; a failure body is kept up to the cap so
        // the store's own explanation survives into the error.
        if (ok || bodyBytes >= MAX_ERROR_BODY_BYTES) return;
        bodyBytes += chunk.length;
        chunks.push(chunk);
      });
      response.on("error", (error: NodeJS.ErrnoException) => {
        fail(new CliError(`The source upload failed while reading the object store's reply: ${error.message}.`));
      });
      response.on("end", () => {
        if (ok) {
          settle(resolve);
          return;
        }
        const body = Buffer.concat(chunks).toString("utf-8").slice(0, 1000);
        fail(new CliError(`Source upload failed (${status} from object storage): ${body}`));
      });
    });

    // Chunked rather than one write() call: it honours backpressure instead of
    // handing the socket up to 50 MB at once, and it is what makes `sent`
    // meaningful when something goes wrong mid-upload.
    let offset = 0;
    function writeNext(): void {
      if (settled) return;
      if (offset >= total) {
        bodyWritten = true;
        disarmStall();
        request.end();
        return;
      }
      const end = Math.min(offset + WRITE_CHUNK_BYTES, total);
      const chunk = bytes.subarray(offset, end);
      offset = end;
      const flushed = request.write(chunk, () => {
        sent = end;
        armStall();
      });
      if (flushed) {
        // Yield rather than recursing: the whole body would otherwise be pushed
        // synchronously, starving the timers and the response handler.
        setImmediate(writeNext);
      } else {
        request.once("drain", writeNext);
      }
    }
    armStall();
    writeNext();
  });
}
