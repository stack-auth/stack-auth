import http from "node:http";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";

// Mock Eve server for the growth engine e2e suite.
//
// The backend dispatches growth agent invocations as HTTP POSTs to
// getEnvVariable("HEXCLAVE_GROWTH_EVE_URL"), which apps/e2e/.env.development keeps in sync with the
// backend's development URL. Because that URL is the single Eve endpoint, only one server can play
// Eve at a time — so:
//   - withMockEve serializes concurrent entries within this process via a module-level
//     promise-chain mutex, and
//   - only ONE e2e file may use this helper (growth-workflows.test.ts) — vitest runs test FILES in
//     separate workers, and a second file binding the same port would flake with EADDRINUSE.
//
// The real agent can own this same port when started explicitly with
// `pnpm -C apps/growth-agent dev:agent`; stop it before running this suite.
//
// The server answers every POST with 200 {"accepted":true} (the real Eve app's ack contract) and
// records it. Note that while the mock is listening, engine ticks triggered by OTHER concurrently
// running growth e2e tests (their onboarding routes kick the engine inline) can also land here, so
// consumers must always filter dispatches by project/run rather than asserting on global counts.

export type MockEveDispatch = {
  path: string,
  body: any, // eslint-disable-line @typescript-eslint/no-explicit-any -- dispatch bodies are backend-defined JSON; tests narrow them per-path at the assertion site
  authorization: string | undefined,
  receivedAtMillis: number,
  /** The HTTP status the mock answered with (200, or 500 while a failNextDispatches window is active). */
  respondedWithStatus: number,
};

type FailWindow = {
  remaining: number,
  // Predicate extension over the plain failNextDispatches(count) contract: while the mock is up,
  // dispatches for unrelated projects/branches (from other growth tests' inline engine kicks, or
  // the daily rollup which iterates every onboarded branch) can arrive interleaved and would
  // otherwise consume the failure budget. The predicate scopes the 500s to the dispatches the test
  // actually means to fail.
  predicate: (dispatch: MockEveDispatch) => boolean,
};

type Responder = {
  predicate: (dispatch: MockEveDispatch) => boolean,
  response: { status?: number, body: unknown },
};

export type MockEve = {
  dispatches: MockEveDispatch[],
  waitForDispatch(predicate: (dispatch: MockEveDispatch) => boolean, opts?: { timeoutMs?: number }): Promise<MockEveDispatch>,
  clear(): void,
  /** Makes the server respond 500 to the next `count` POSTs matching `predicate` (default: all). */
  failNextDispatches(count: number, opts?: { predicate?: (dispatch: MockEveDispatch) => boolean }): void,
  /**
   * Registers a canned response for dispatches matching `predicate` (later registrations win over
   * earlier ones; failNextDispatches windows still take precedence). The default 200
   * {"accepted":true} stays in place for everything unmatched — this hook exists for the request/
   * response routes (currently only /interview) where the backend consumes the response body, unlike
   * the fire-and-forget run routes.
   */
  respondWith(predicate: (dispatch: MockEveDispatch) => boolean, response: { status?: number, body: unknown }): void,
};

export const MOCK_EVE_HOST = "127.0.0.1";

function getMockEvePort(): number {
  const configuredUrl = getEnvVariable("HEXCLAVE_GROWTH_EVE_URL");
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(configuredUrl);
  } catch (error) {
    throw new Error(`HEXCLAVE_GROWTH_EVE_URL must be a valid URL for the e2e Eve mock: ${JSON.stringify(configuredUrl)}`, { cause: error });
  }
  if (parsedUrl.protocol !== "http:" || parsedUrl.hostname !== MOCK_EVE_HOST || parsedUrl.port === "" || parsedUrl.pathname !== "/" || parsedUrl.search !== "" || parsedUrl.hash !== "") {
    throw new Error(
      `HEXCLAVE_GROWTH_EVE_URL must be an http URL on ${MOCK_EVE_HOST} with an explicit port and no path or query for the e2e Eve mock: ${JSON.stringify(configuredUrl)}`,
    );
  }
  const port = Number(parsedUrl.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`HEXCLAVE_GROWTH_EVE_URL has an invalid port for the e2e Eve mock: ${JSON.stringify(configuredUrl)}`);
  }
  return port;
}

export const MOCK_EVE_PORT = getMockEvePort();

// Module-level mutex: chains every withMockEve entry so two tests in the same worker never race
// for the shared port. (Across workers there is no such protection — hence the one-file rule above.)
let mockEveMutex: Promise<void> = Promise.resolve();

export async function withMockEve<T>(fn: (mock: MockEve) => Promise<T>): Promise<T> {
  const previous = mockEveMutex;
  let release!: () => void;
  mockEveMutex = new Promise((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    const dispatches: MockEveDispatch[] = [];
    let failWindow: FailWindow | null = null;
    const responders: Responder[] = [];

    const server = http.createServer((req, res) => {
      if (req.method !== "POST") {
        res.writeHead(405).end();
        return;
      }
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const rawBody = Buffer.concat(chunks).toString("utf-8");
        let parsedBody: unknown;
        try {
          parsedBody = JSON.parse(rawBody);
        } catch {
          // The backend always sends JSON, so this is a broken dispatch. Respond 500 (which the
          // engine surfaces via captureError) and record the raw text so the test's waitForDispatch
          // timeout error at least has something to point at.
          const dispatch: MockEveDispatch = {
            path: req.url ?? "<missing url>",
            body: rawBody,
            authorization: req.headers.authorization,
            receivedAtMillis: Date.now(),
            respondedWithStatus: 500,
          };
          dispatches.push(dispatch);
          res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: "mock Eve received a non-JSON body" }));
          return;
        }
        const dispatch: MockEveDispatch = {
          path: req.url ?? "<missing url>",
          body: parsedBody,
          authorization: req.headers.authorization,
          receivedAtMillis: Date.now(),
          respondedWithStatus: 200,
        };
        if (failWindow != null && failWindow.remaining > 0 && failWindow.predicate(dispatch)) {
          failWindow.remaining--;
          dispatch.respondedWithStatus = 500;
          dispatches.push(dispatch);
          res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: "mock Eve simulated dispatch failure" }));
          return;
        }
        // Later registrations win so a test can override an earlier catch-all within its own scope.
        const responder = [...responders].reverse().find((candidate) => candidate.predicate(dispatch));
        if (responder != null) {
          dispatch.respondedWithStatus = responder.response.status ?? 200;
          dispatches.push(dispatch);
          res.writeHead(dispatch.respondedWithStatus, { "content-type": "application/json" }).end(JSON.stringify(responder.response.body));
          return;
        }
        dispatches.push(dispatch);
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ accepted: true }));
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE") {
          reject(new Error(
            `mock Eve could not bind ${MOCK_EVE_HOST}:${MOCK_EVE_PORT} — the single configured Eve port is already taken. `
            + `Stop the real agent started by \`pnpm -C apps/growth-agent dev:agent\` (or any other Eve process) `
            + `before running growth-workflows.test.ts; only one Eve owner can use HEXCLAVE_GROWTH_EVE_URL at a time.`,
          ));
        } else {
          reject(error);
        }
      });
      server.listen(MOCK_EVE_PORT, MOCK_EVE_HOST, () => resolve());
    });

    try {
      const mock: MockEve = {
        dispatches,
        async waitForDispatch(predicate, opts = {}) {
          const timeoutMs = opts.timeoutMs ?? 30_000;
          const deadline = Date.now() + timeoutMs;
          while (true) {
            const match = dispatches.find(predicate);
            if (match != null) return match;
            if (Date.now() > deadline) {
              throw new Error(`mock Eve: no dispatch matched the predicate within ${timeoutMs}ms. Recorded dispatches: ${JSON.stringify(dispatches, null, 2)}`);
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        },
        clear() {
          dispatches.length = 0;
        },
        failNextDispatches(count, opts = {}) {
          failWindow = { remaining: count, predicate: opts.predicate ?? (() => true) };
        },
        respondWith(predicate, response) {
          responders.push({ predicate, response });
        },
      };
      return await fn(mock);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error != null ? reject(error) : resolve());
      });
    }
  } finally {
    release();
  }
}
