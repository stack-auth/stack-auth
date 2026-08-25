import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { CliError } from "./errors.js";
import { DEFAULT_UPLOAD_DEADLINE_MS, formatBytes, formatDuration, formatRate, uploadDeadlineMs, uploadSource } from "./source-upload.js";

// A stand-in for the object store. `bytesPerSecond` throttles how fast it
// DRAINS the request body, which is the whole point of these tests: the failure
// this module exists to fix is a wall-clock one, invisible on a fast link.
type ServerOptions = {
  status?: number,
  body?: string,
  bytesPerSecond?: number,
  // Accept the body and then never answer: a server that went quiet AFTER the
  // upload finished, which is a deadline case rather than a stall.
  neverRespond?: boolean,
  // Stop draining the body entirely once this many bytes are in, so the
  // client's writes stop flushing — a stall DURING the upload.
  stopReadingAfterBytes?: number,
  // Answer on the headers without reading the body at all: a proxy or CDN
  // refusing (or accepting) an upload before it has one.
  respondBeforeReadingBody?: boolean,
};

const servers: http.Server[] = [];

type StartedServer = {
  url: string,
  received: () => number,
  requestHeaders: () => http.IncomingHttpHeaders,
  close: () => void,
};

async function startServer(options: ServerOptions = {}): Promise<StartedServer> {
  let received = 0;
  let requestHeaders: http.IncomingHttpHeaders = {};
  const server = http.createServer((request, response) => {
    requestHeaders = request.headers;
    if (options.respondBeforeReadingBody === true) {
      response.writeHead(options.status ?? 200, { "content-type": "text/plain" });
      response.end(options.body ?? "");
      return;
    }
    const startedAt = Date.now();
    request.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (options.stopReadingAfterBytes !== undefined && received >= options.stopReadingAfterBytes) {
        request.pause();
        return;
      }
      if (options.bytesPerSecond === undefined) return;
      // Hold the socket back until the clock catches up with the rate we allow.
      const owed = (received / options.bytesPerSecond) * 1000 - (Date.now() - startedAt);
      if (owed <= 0) return;
      request.pause();
      setTimeout(() => request.resume(), owed);
    });
    request.on("error", () => {});
    request.on("end", () => {
      if (options.neverRespond === true) return;
      response.writeHead(options.status ?? 200, { "content-type": "text/plain" });
      response.end(options.body ?? "");
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/upload`,
    received: () => received,
    requestHeaders: () => requestHeaders,
    close: () => server.close(),
  };
}

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

const body = (megabytes: number) => new Uint8Array(Math.round(megabytes * 1024 * 1024));

describe("uploading the packaged source", () => {
  it("PUTs the whole body with the signed headers", async () => {
    const server = await startServer();
    const bytes = body(3);
    await uploadSource({ uploadUrl: server.url, contentType: "application/gzip", bytes });
    expect(server.received()).toBe(bytes.byteLength);
    // Both headers are signed into the presigned URL; a mismatch is a 403 from
    // the real store, which no test server would catch.
    expect(server.requestHeaders()["content-type"]).toBe("application/gzip");
    expect(server.requestHeaders()["content-length"]).toBe(String(bytes.byteLength));
  });

  it("finishes a slow upload that outlives every clock a fast one would meet", async () => {
    // THE REGRESSION, scaled down. On global fetch this shape dies with
    // `TypeError: fetch failed` / UND_ERR_HEADERS_TIMEOUT once the body takes
    // more than five minutes to push, because undici arms headersTimeout when
    // the request is written and nothing resets it while the body uploads. A
    // 300s test is not a test anyone runs, so what is asserted here is the
    // property that made it fail: an upload that takes many times longer than
    // the timeouts in play still completes.
    const server = await startServer({ bytesPerSecond: 256 * 1024 });
    const bytes = body(1);
    const startedAt = Date.now();
    await uploadSource({ uploadUrl: server.url, contentType: "application/gzip", bytes, stallTimeoutMs: 1_500 });
    const elapsed = Date.now() - startedAt;
    // Took longer than the stall timeout it ran with, several times over: a
    // progressing upload must never be mistaken for a dead one, however slow.
    expect(elapsed).toBeGreaterThan(3_000);
    expect(server.received()).toBe(bytes.byteLength);
  }, 30_000);

  it("keeps a very slow upload alive by chunking finely enough to prove liveness", async () => {
    // Regression guard on the WRITE_CHUNK_BYTES / stall-timeout relationship: a
    // flush callback is the only liveness signal, so a chunk that takes longer
    // than the stall timeout to flush reads as a dead connection. With 1 MB
    // chunks this exact case false-failed at ~17 KB/s.
    const server = await startServer({ bytesPerSecond: 64 * 1024 });
    const bytes = body(0.35);
    await uploadSource({ uploadUrl: server.url, contentType: "application/gzip", bytes, stallTimeoutMs: 1_500 });
    expect(server.received()).toBe(bytes.byteLength);
  }, 30_000);

  it("gives up at the deadline, and says how far it got and how fast", async () => {
    // The reported bug, in miniature: a body too big to push before the clock
    // runs out. What differs from the fetch version is not that it fails — it
    // is that the failure names the upload, the numbers and the cause.
    const server = await startServer({ bytesPerSecond: 256 * 1024 });
    const error = await uploadSource({
      uploadUrl: server.url,
      contentType: "application/gzip",
      bytes: body(4),
      deadlineMs: 1_500,
    }).catch((e: unknown) => e as CliError);
    expect(error).toBeInstanceOf(CliError);
    const message = (error as CliError).message;
    expect(message).toContain("Uploading the packaged source timed out after 2s");
    // How far it got, out of how much, and the throughput that explains it.
    // The rate is what was FLUSHED, so socket buffering can make it read faster
    // than the wire; the point is that a number is there at all.
    expect(message).toMatch(/[\d.]+ MB of 4\.0 MB in [\d.]+s \(about [\d.]+ [KM]B\/s\)/);
    expect(message).toContain(".gitignore/.dockerignore");
  }, 30_000);

  it("blames the connection, not the slot, when the deadline is not the slot's expiry", async () => {
    // The slot outlives the deadline on both the upper clamp and the default,
    // so "the upload slot expires after that" would tell the user their upload
    // was impossible when retrying it would have worked.
    const server = await startServer({ bytesPerSecond: 256 * 1024 });
    const error = await uploadSource({
      uploadUrl: server.url,
      contentType: "application/gzip",
      bytes: body(4),
      expiresAtMillis: Date.now() + 6 * 60 * 60 * 1000,
      deadlineMs: 1_000,
    }).catch((e: unknown) => e as CliError);
    expect(error).toBeInstanceOf(CliError);
    const message = (error as CliError).message;
    expect(message).toContain("timed out");
    expect(message).toContain("connection may be too slow");
    expect(message).not.toContain("upload slot expires");
  }, 30_000);

  it("prefers an explicit deadline over the slot expiry", async () => {
    const server = await startServer({ bytesPerSecond: 256 * 1024 });
    const error = await uploadSource({
      uploadUrl: server.url,
      contentType: "application/gzip",
      bytes: body(4),
      // An hour of slot left, but the caller said one second.
      expiresAtMillis: Date.now() + 60 * 60 * 1000,
      deadlineMs: 1_000,
    }).catch((e: unknown) => e as CliError);
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).message).toContain("timed out");
  }, 30_000);

  it("reports a non-2xx from object storage with the store's own explanation", async () => {
    const server = await startServer({ status: 403, body: "<Error><Code>SignatureDoesNotMatch</Code></Error>" });
    const error = await uploadSource({
      uploadUrl: server.url,
      contentType: "application/gzip",
      bytes: body(1),
    }).catch((e: unknown) => e as CliError);
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).message).toContain("403 from object storage");
    expect((error as CliError).message).toContain("SignatureDoesNotMatch");
  });

  it("names a stall mid-upload, with the bytes, instead of a bare TypeError", async () => {
    // The peer stops reading and never comes back: a connection that died
    // without a reset — a suspended laptop, a dropped NAT mapping.
    const server = await startServer({ stopReadingAfterBytes: 128 * 1024 });
    const error = await uploadSource({
      uploadUrl: server.url,
      contentType: "application/gzip",
      bytes: body(24),
      stallTimeoutMs: 1_000,
      deadlineMs: 15_000,
    }).catch((e: unknown) => e as CliError);
    expect(error).toBeInstanceOf(CliError);
    const message = (error as CliError).message;
    expect(message).toContain("stalled");
    expect(message).toContain("no data was sent for 1s");
    // It stopped part-way, and says so — the number is the diagnosis.
    expect(message).toMatch(/of 24\.0 MB in [\d.]+s/);
    expect(message).toContain("Check your network connection");
  }, 30_000);

  it("waits out a silent server until the DEADLINE, never on inactivity", async () => {
    // The design decision this module exists for, pinned: once the body is
    // written the client is idle by definition, and ending that wait on
    // inactivity is exactly undici's headersTimeout bug. Only the deadline may
    // end it — so this fails with the deadline message, not the stall one,
    // even though the stall timeout is far shorter.
    const server = await startServer({ neverRespond: true });
    const error = await uploadSource({
      uploadUrl: server.url,
      contentType: "application/gzip",
      bytes: body(1),
      stallTimeoutMs: 300,
      deadlineMs: 2_000,
    }).catch((e: unknown) => e as CliError);
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).message).toContain("timed out after 2s");
    expect((error as CliError).message).not.toContain("stalled");
  }, 30_000);

  it("names a refused connection rather than letting a TypeError escape", async () => {
    const server = await startServer();
    const url = server.url;
    server.close();
    // Give the listener a moment to actually stop accepting.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const error = await uploadSource({
      uploadUrl: url,
      contentType: "application/gzip",
      bytes: body(0.1),
    }).catch((e: unknown) => e as CliError);
    expect(error).toBeInstanceOf(CliError);
    const message = (error as CliError).message;
    expect(message).toContain("The source upload failed");
    expect(message).toMatch(/ECONNREFUSED|ECONNRESET/);
    // A connection that never opened has no progress worth reporting; "0 B of
    // 100.0 KB in 0s" would be noise dressed as a diagnosis.
    expect(message).not.toContain("0 B of");
  });

  it("names a middlebox that resets mid-upload, and the byte it died on", async () => {
    // THE REPORTED SYMPTOM. A proxy with an upload cap that RSTs instead of
    // answering fails in milliseconds and only above its cap — which is why a
    // smaller repository "fixed" it. On fetch this is a bare
    // `TypeError: fetch failed`, naming neither the upload nor the size.
    const cap = 2 * 1024 * 1024;
    const rude = net.createServer((socket) => {
      let seen = 0;
      socket.on("data", (chunk: Buffer) => {
        seen += chunk.length;
        if (seen > cap) socket.resetAndDestroy();
      });
      socket.on("error", () => {});
    });
    await new Promise<void>((resolve) => rude.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(rude.address() as AddressInfo).port}/upload`;
    try {
      const error = await uploadSource({
        uploadUrl: url,
        contentType: "application/gzip",
        bytes: body(16),
        deadlineMs: 15_000,
      }).catch((e: unknown) => e as CliError);
      expect(error).toBeInstanceOf(CliError);
      const message = (error as CliError).message;
      expect(message).toContain("The source upload failed");
      expect(message).toMatch(/ECONNRESET|EPIPE/);
      // The byte it died on is the whole diagnosis: it points at a size cap
      // between the client and the store rather than at a slow link.
      expect(message).toMatch(/of 16\.0 MB/);
    } finally {
      rude.close();
    }
  }, 20_000);

  it("refuses a 2xx that arrives before the body was sent", async () => {
    // REGRESSION: a store or proxy that answers on the headers used to RESOLVE
    // this in milliseconds having sent a fraction of the tarball. The deploy
    // then referenced an upload whose object was truncated, and died minutes
    // later in the builder saying nothing about the upload.
    const server = await startServer({ respondBeforeReadingBody: true, status: 200 });
    const error = await uploadSource({
      uploadUrl: server.url,
      contentType: "application/gzip",
      bytes: body(24),
      deadlineMs: 15_000,
    }).catch((e: unknown) => e as CliError);
    expect(error).toBeInstanceOf(CliError);
    const message = (error as CliError).message;
    expect(message).toContain("did not receive the whole source");
    expect(message).toContain("of 24.0 MB");
    expect(message).toContain("proxy or upload size limit");
  }, 30_000);

  it("still refuses a non-2xx that arrives before the body was sent", async () => {
    // The size-cap case with a well-behaved middlebox: the status is what the
    // user needs, so it must survive rather than becoming the truncation error.
    const server = await startServer({ respondBeforeReadingBody: true, status: 413, body: "<Error><Code>EntityTooLarge</Code></Error>" });
    const error = await uploadSource({
      uploadUrl: server.url,
      contentType: "application/gzip",
      bytes: body(24),
      deadlineMs: 15_000,
    }).catch((e: unknown) => e as CliError);
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).message).toContain("413 from object storage");
    expect((error as CliError).message).toContain("EntityTooLarge");
  }, 30_000);

  it("reports a failed CONNECT as a connection error, never as a stall", async () => {
    // REGRESSION: the stall timer used to be armed before the first flush, so a
    // connection that never opened was reported as "no data was sent for 1s,
    // after 0 B of 1.0 MB" — the exact noise the error path strips on purpose.
    // Connecting is the deadline's to bound.
    const server = await startServer();
    const url = server.url;
    server.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const error = await uploadSource({
      uploadUrl: url,
      contentType: "application/gzip",
      bytes: body(1),
      stallTimeoutMs: 300,
      deadlineMs: 15_000,
    }).catch((e: unknown) => e as CliError);
    expect(error).toBeInstanceOf(CliError);
    const message = (error as CliError).message;
    expect(message).not.toContain("stalled");
    expect(message).toMatch(/ECONNREFUSED|ECONNRESET/);
  }, 30_000);

  it("rejects a URL that is not one it can PUT to", async () => {
    await expect(uploadSource({ uploadUrl: "not a url", contentType: "application/gzip", bytes: body(0.01) }))
      .rejects.toThrow(/invalid object-storage upload URL/);
    await expect(uploadSource({ uploadUrl: "ftp://example.com/x", contentType: "application/gzip", bytes: body(0.01) }))
      .rejects.toThrow(/unsupported protocol/);
  });
});

describe("the upload deadline", () => {
  const now = 1_000_000;

  it("is the slot's own expiry, because a dead URL cannot be written to", () => {
    expect(uploadDeadlineMs(now + 10 * 60 * 1000, now)).toBe(10 * 60 * 1000);
  });

  it("falls back when the API did not say", () => {
    expect(uploadDeadlineMs(null, now)).toBe(DEFAULT_UPLOAD_DEADLINE_MS);
    expect(uploadDeadlineMs(undefined, now)).toBe(DEFAULT_UPLOAD_DEADLINE_MS);
    expect(uploadDeadlineMs(Number.NaN, now)).toBe(DEFAULT_UPLOAD_DEADLINE_MS);
  });

  it("falls back to the default when the slot reads as expired, rather than to the floor", () => {
    // REGRESSION: this used to clamp UP to the 60s floor, which is SHORTER than
    // the default — so a client whose clock had drifted got a harsher deadline
    // than one the API had told nothing, on exactly the slow upload this module
    // exists to keep alive. A slot minted seconds ago with fifteen minutes of
    // life cannot really be expired; a skewed client clock is the explanation.
    expect(uploadDeadlineMs(now - 60_000, now)).toBe(DEFAULT_UPLOAD_DEADLINE_MS);
    // Implausibly-soon reads the same way.
    expect(uploadDeadlineMs(now + 5_000, now)).toBe(DEFAULT_UPLOAD_DEADLINE_MS);
  });

  it("clamps an implausibly distant expiry, so a misconfiguration cannot hang the CLI", () => {
    expect(uploadDeadlineMs(now + 6 * 60 * 60 * 1000, now)).toBe(30 * 60 * 1000);
  });

  it("is comfortably more than undici's 300s, which is the whole point", () => {
    expect(DEFAULT_UPLOAD_DEADLINE_MS).toBeGreaterThan(300_000);
  });
});

describe("the numbers an upload failure reports", () => {
  it("formats sizes the way a reader states them", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(39 * 1024 * 1024)).toBe("39.0 MB");
  });

  it("formats durations past a minute as minutes and seconds", () => {
    expect(formatDuration(45_000)).toBe("45s");
    // A connection cut in milliseconds must not read as "0s".
    expect(formatDuration(420)).toBe("0.4s");
    expect(formatDuration(300_000)).toBe("5m00s");
    expect(formatDuration(905_000)).toBe("15m05s");
  });

  it("states throughput, which is what tells a user it is their link and not the tool", () => {
    // 28 MB in 300s is the boundary the reported bug sat on.
    expect(formatRate(28 * 1024 * 1024, 300_000)).toBe("95.6 KB/s");
    expect(formatRate(0, 1_000)).toBeNull();
    expect(formatRate(1_000, 0)).toBeNull();
    // Too short a sample to be throughput: 9.7 MB flushed into a socket buffer
    // in 40ms is not a 240 MB/s link, and printing that helps nobody.
    expect(formatRate(9_700_000, 40)).toBeNull();
  });
});
