import { describe, expect, it } from "vitest";
import { ResumableLogDemuxer, isTransientNetworkError } from "./log-stream";

function collect() {
  const out: string[] = [];
  const err: string[] = [];
  const demuxer = new ResumableLogDemuxer(line => out.push(line), line => err.push(line));
  return { out, err, demuxer };
}

describe("ResumableLogDemuxer", () => {
  it("emits complete lines and drops empty/whitespace-only ones", () => {
    const { out, demuxer } = collect();
    demuxer.beginConnection();
    demuxer.push("stdout", "a\n\n  \nb\nta");
    expect(out).toEqual(["a", "b"]);
    demuxer.push("stdout", "il\n");
    expect(out).toEqual(["a", "b", "tail"]);
  });

  it("flushes an unterminated trailing line", () => {
    const { out, demuxer } = collect();
    demuxer.beginConnection();
    demuxer.push("stdout", "x\npartial");
    expect(out).toEqual(["x"]);
    demuxer.flush();
    expect(out).toEqual(["x", "partial"]);
  });

  it("delivers each line exactly once when the stream is replayed after a drop", () => {
    const { out, demuxer } = collect();
    // Connection 1 drops mid-line.
    demuxer.beginConnection();
    demuxer.push("stdout", "line1\nline2\nlin");
    expect(out).toEqual(["line1", "line2"]);
    // Connection 2 replays from the start with *different* chunk boundaries,
    // then continues with new output. Nothing already delivered repeats.
    demuxer.beginConnection();
    demuxer.push("stdout", "line1\n");
    demuxer.push("stdout", "line2\nline3\n");
    demuxer.push("stdout", "line4\n");
    demuxer.flush();
    expect(out).toEqual(["line1", "line2", "line3", "line4"]);
  });

  it("survives repeated drops without duplicating output", () => {
    const { out, demuxer } = collect();
    const full = "m1\nm2\nm3\nm4\nm5\n";
    // Replay a growing prefix on each (re)connection, as the logs endpoint does.
    for (const prefixLen of [3, 6, 9, full.length]) {
      demuxer.beginConnection();
      demuxer.push("stdout", full.slice(0, prefixLen));
    }
    demuxer.flush();
    expect(out).toEqual(["m1", "m2", "m3", "m4", "m5"]);
  });

  it("tracks stdout and stderr offsets independently", () => {
    const { out, err, demuxer } = collect();
    demuxer.beginConnection();
    demuxer.push("stdout", "o1\n");
    demuxer.push("stderr", "e1\n");
    demuxer.beginConnection();
    demuxer.push("stdout", "o1\no2\n");
    demuxer.push("stderr", "e1\ne2\n");
    expect(out).toEqual(["o1", "o2"]);
    expect(err).toEqual(["e1", "e2"]);
  });
});

describe("isTransientNetworkError", () => {
  it("treats a socket reset in the cause chain as transient", () => {
    const cause = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
    const error = Object.assign(new TypeError("terminated"), { cause });
    expect(isTransientNetworkError(error)).toBe(true);
  });

  it("treats undici 'terminated' as transient even without a code", () => {
    expect(isTransientNetworkError(new TypeError("terminated"))).toBe(true);
  });

  it("treats a generic 'fetch failed' as transient", () => {
    expect(isTransientNetworkError(new TypeError("fetch failed"))).toBe(true);
  });

  it("returns false for unrelated errors and non-Error values", () => {
    expect(isTransientNetworkError(new Error("boom"))).toBe(false);
    expect(isTransientNetworkError("nope")).toBe(false);
    expect(isTransientNetworkError(undefined)).toBe(false);
  });
});
