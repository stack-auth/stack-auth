import fs from "node:fs";
import path from "node:path";
import { urlString } from "@hexclave/shared/dist/utils/urls";
import { expect } from "vitest";
import { it } from "../../../../../helpers";
import { Auth, Payments, Project, niceBackendFetch } from "../../../../backend-helpers";

const USER_COUNT = 6;
const ITEM_UPDATES_PER_USER = 10;

// The benchmark can be run against a tenancy that already holds payments data, to see how the
// measured flows scale with the amount of data Bulldozer keeps in its trees. One prefill unit is one
// fully-populated customer (a subscription purchase, a one-time purchase, two granted stackable
// products and ITEM_UPDATES_PER_USER item-quantity changes) written into the same tenancy before
// each measured workload.
const PREFILL_VALUE = process.env.HEXCLAVE_PAYMENTS_PERF_PREFILL;
const PREFILL_STAGES_VALUE = process.env.HEXCLAVE_PAYMENTS_PERF_PREFILL_STAGES;
if (PREFILL_VALUE != null && PREFILL_STAGES_VALUE != null) {
  throw new Error("HEXCLAVE_PAYMENTS_PERF_PREFILL and HEXCLAVE_PAYMENTS_PERF_PREFILL_STAGES cannot both be set");
}

function parseNonNegativeInteger(envName: string, value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${envName} must be a non-negative integer, got ${value}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${envName} must be a non-negative integer, got ${value}`);
  }
  return parsed;
}

function parsePositiveInteger(envName: string, value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${envName} must be a positive integer, got ${value}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${envName} must be a positive integer, got ${value}`);
  }
  return parsed;
}

function parsePrefillStages(value: string): number[] {
  const stages: number[] = [];
  for (const rawStage of value.split(",")) {
    const stageValue = rawStage.trim();
    if (!/^\d+$/.test(stageValue)) {
      throw new Error(
        `HEXCLAVE_PAYMENTS_PERF_PREFILL_STAGES must be a comma-separated list of strictly increasing non-negative integers, offending value ${rawStage}`,
      );
    }
    const stage = Number(stageValue);
    if (!Number.isSafeInteger(stage)) {
      throw new Error(
        `HEXCLAVE_PAYMENTS_PERF_PREFILL_STAGES must be a comma-separated list of strictly increasing non-negative integers, offending value ${rawStage}`,
      );
    }
    if (stages.length > 0 && stage <= stages[stages.length - 1]) {
      throw new Error(
        `HEXCLAVE_PAYMENTS_PERF_PREFILL_STAGES must be strictly increasing, offending value ${rawStage}`,
      );
    }
    stages.push(stage);
  }
  return stages;
}

const PREFILL_CUSTOMERS = PREFILL_VALUE == null ? 0 : parseNonNegativeInteger("HEXCLAVE_PAYMENTS_PERF_PREFILL", PREFILL_VALUE);
const PREFILL_STAGES = PREFILL_STAGES_VALUE == null ? [PREFILL_CUSTOMERS] : parsePrefillStages(PREFILL_STAGES_VALUE);
const PREFILL_CONCURRENCY_VALUE = process.env.HEXCLAVE_PAYMENTS_PERF_PREFILL_CONCURRENCY;
const PREFILL_CONCURRENCY = PREFILL_CONCURRENCY_VALUE == null
  ? 8
  : parsePositiveInteger("HEXCLAVE_PAYMENTS_PERF_PREFILL_CONCURRENCY", PREFILL_CONCURRENCY_VALUE);
const OUTPUT_PATH = process.env.HEXCLAVE_PAYMENTS_PERF_OUTPUT;
if (OUTPUT_PATH != null && OUTPUT_PATH.trim() === "") {
  throw new Error(`HEXCLAVE_PAYMENTS_PERF_OUTPUT must be a non-empty path, got ${OUTPUT_PATH}`);
}
if (PREFILL_STAGES.length > 1 && OUTPUT_PATH != null && !OUTPUT_PATH.includes("{prefill}")) {
  throw new Error("HEXCLAVE_PAYMENTS_PERF_OUTPUT must contain the {prefill} placeholder when multiple prefill stages are configured");
}

// The per-stage summaries only land once a stage completes, which for the larger stages is tens of
// minutes of blindness. This log instead appends one line per prefilled customer as it finishes, so
// the shape of the curve (and any regression in it) is visible while the sweep is still running.
const PREFILL_LOG_PATH = process.env.HEXCLAVE_PAYMENTS_PERF_PREFILL_LOG;
if (PREFILL_LOG_PATH != null && PREFILL_LOG_PATH.trim() === "") {
  throw new Error(`HEXCLAVE_PAYMENTS_PERF_PREFILL_LOG must be a non-empty path, got ${PREFILL_LOG_PATH}`);
}

type PerfMetric = {
  name: string,
  count: number,
  elapsedMs: number,
};

type RequestUserAuth = {
  accessToken?: string,
  refreshToken?: string,
};

// Prefill requests use server/admin access and explicit customer IDs, so an empty override avoids
// pinning a 60-second user token while also suppressing the shared ambient auth state.
const PREFILL_NO_USER_AUTH: RequestUserAuth = {};

async function measure<T>(name: string, count: number, fn: () => Promise<T>, metrics: PerfMetric[]): Promise<T> {
  const startedAt = performance.now();
  const result = await fn();
  const elapsedMs = performance.now() - startedAt;
  metrics.push({ name, count, elapsedMs });
  const throughput = count === 0 ? "n/a" : `${(count / elapsedMs * 1000).toFixed(2)} ops/s`;
  console.log(`[bulldozer-payments-e2e-perf] ${name}: ${elapsedMs.toFixed(1)} ms (${count} ops, ${throughput})`);
  return result;
}

async function createPurchaseCode(options: { customerType: "user", customerId: string, productId: string, userAuth?: RequestUserAuth }) {
  const res = await niceBackendFetch("/api/latest/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "server",
    body: {
      customer_type: options.customerType,
      customer_id: options.customerId,
      product_id: options.productId,
    },
    userAuth: options.userAuth,
  });
  expect(res.status).toBe(200);
  const codeMatch = (res.body.url as string).match(/\/purchase\/([a-z0-9-_]+)/);
  const code = codeMatch ? codeMatch[1] : undefined;
  expect(code).toBeDefined();
  return code as string;
}

async function listAllTransactions() {
  const transactions: unknown[] = [];
  let cursor: string | null = null;
  do {
    const response = await niceBackendFetch("/api/latest/internal/payments/transactions", {
      accessType: "admin",
      query: {
        limit: "200",
        ...(cursor == null ? {} : { cursor }),
      },
    });
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.transactions)).toBe(true);
    transactions.push(...response.body.transactions);
    cursor = response.body.next_cursor;
  } while (cursor != null);
  return transactions;
}

const BASE_TEST_TIMEOUT_MS = 240_000;
const PREFILL_TIMEOUT_MS = 30_000;
const MAX_NODE_TIMER_MS = 2 ** 31 - 1;
const MAX_PREFILL_CUSTOMERS = PREFILL_STAGES.reduce((maximum, stage) => Math.max(maximum, stage), 0);
const MAX_ALLOWED_PREFILL_CUSTOMERS = Math.floor(
  (MAX_NODE_TIMER_MS - BASE_TEST_TIMEOUT_MS * PREFILL_STAGES.length) / PREFILL_TIMEOUT_MS,
);
if (MAX_ALLOWED_PREFILL_CUSTOMERS < 0 || MAX_PREFILL_CUSTOMERS > MAX_ALLOWED_PREFILL_CUSTOMERS) {
  const prefillVariable = PREFILL_STAGES_VALUE == null
    ? "HEXCLAVE_PAYMENTS_PERF_PREFILL"
    : "HEXCLAVE_PAYMENTS_PERF_PREFILL_STAGES";
  throw new Error(
    `${prefillVariable} assumes the derived test timeout stays within Node's maximum timer delay of ${MAX_NODE_TIMER_MS} ms; effective maximum cumulative prefill count is ${Math.max(0, MAX_ALLOWED_PREFILL_CUSTOMERS)} for ${PREFILL_STAGES.length} stage(s), got ${MAX_PREFILL_CUSTOMERS}`,
  );
}
const TEST_TIMEOUT_MS = BASE_TEST_TIMEOUT_MS * PREFILL_STAGES.length
  + MAX_PREFILL_CUSTOMERS * PREFILL_TIMEOUT_MS;

let prefillLogInitialized = false;
function appendPrefillLog(index: number, stage: number, elapsedMs: number): void {
  if (PREFILL_LOG_PATH == null) return;
  if (!prefillLogInitialized) {
    fs.mkdirSync(path.dirname(path.resolve(PREFILL_LOG_PATH)), { recursive: true });
    fs.writeFileSync(PREFILL_LOG_PATH, "index,stage,finished_at_iso,elapsed_ms\n");
    prefillLogInitialized = true;
  }
  fs.appendFileSync(PREFILL_LOG_PATH, `${index},${stage},${new Date().toISOString()},${elapsedMs.toFixed(3)}\n`);
}

async function prefillOne(index: number, stage: number): Promise<void> {
  const startedAt = performance.now();
  const { userId } = await Auth.fastSignUp();

  const subscriptionCode = await createPurchaseCode({
    customerType: "user",
    customerId: userId,
    productId: "perf-sub",
    userAuth: PREFILL_NO_USER_AUTH,
  });
  const subscriptionResponse = await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
    accessType: "admin",
    method: "POST",
    body: { full_code: subscriptionCode, price_id: "monthly", quantity: 1 },
    userAuth: PREFILL_NO_USER_AUTH,
  });
  expect(subscriptionResponse.status).toBe(200);

  const oneTimeCode = await createPurchaseCode({
    customerType: "user",
    customerId: userId,
    productId: "perf-otp",
    userAuth: PREFILL_NO_USER_AUTH,
  });
  const oneTimeResponse = await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
    accessType: "admin",
    method: "POST",
    body: { full_code: oneTimeCode, price_id: "single", quantity: 2 },
    userAuth: PREFILL_NO_USER_AUTH,
  });
  expect(oneTimeResponse.status).toBe(200);

  for (let grant = 0; grant < 2; grant++) {
    const grantResponse = await niceBackendFetch(urlString`/api/v1/payments/products/user/${userId}`, {
      method: "POST",
      accessType: "server",
      body: { product_id: "perf-api-grant", quantity: 1 },
      userAuth: PREFILL_NO_USER_AUTH,
    });
    expect(grantResponse.status).toBe(200);
  }

  for (let update = 0; update < ITEM_UPDATES_PER_USER; update++) {
    const itemId = update % 2 === 0 ? "credits" : "boosts";
    const updateResponse = await niceBackendFetch(urlString`/api/latest/payments/items/user/${userId}/${itemId}/update-quantity`, {
      method: "POST",
      accessType: "server",
      query: { allow_negative: "false" },
      body: { delta: update + 1, description: `prefill-${index}-${update}` },
      userAuth: PREFILL_NO_USER_AUTH,
    });
    expect(updateResponse.status).toBe(200);
  }

  appendPrefillLog(index, stage, performance.now() - startedAt);
}

async function prefillCustomersInRange(startIndex: number, count: number, stage: number): Promise<void> {
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const offset = nextIndex++;
      if (offset >= count) return;
      await prefillOne(startIndex + offset, stage);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PREFILL_CONCURRENCY, count) }, worker));
}

async function setupPayments(): Promise<void> {
  await Project.createAndSwitch();
  await Payments.setup();
  await Project.updateConfig({
    payments: {
      testMode: true,
      products: {
        "perf-sub": {
          displayName: "Perf Subscription",
          customerType: "user",
          serverOnly: false,
          stackable: true,
          prices: {
            monthly: { USD: "10.00", interval: [1, "month"] },
          },
          includedItems: {
            credits: { quantity: 10, repeat: [1, "month"], expires: "when-repeated" },
            seats: { quantity: 1, expires: "when-purchase-expires" },
          },
        },
        "perf-otp": {
          displayName: "Perf One-Time Purchase",
          customerType: "user",
          serverOnly: false,
          stackable: true,
          prices: {
            single: { USD: "5.00" },
          },
          includedItems: {
            credits: { quantity: 5, expires: "never" },
          },
        },
        "perf-api-grant": {
          displayName: "Perf API Grant",
          customerType: "user",
          serverOnly: false,
          stackable: true,
          prices: {
            monthly: { USD: "0.00", interval: [1, "month"] },
          },
          includedItems: {
            credits: { quantity: 3, expires: "when-purchase-expires" },
          },
        },
      },
      items: {
        credits: { displayName: "Credits", customerType: "user" },
        seats: { displayName: "Seats", customerType: "user" },
        boosts: { displayName: "Boosts", customerType: "user" },
      },
    },
  });
}

type PerfSummary = {
  prefillCustomers: number,
  prefillCustomersAdded: number,
  prefillConcurrency: number,
  users: number,
  transactions: number,
  metrics: Array<{
    name: string,
    count: number,
    elapsedMs: number,
    opsPerSecond: number | null,
  }>,
};

async function runMeasuredWorkload(
  prefillCustomers: number,
  prefillCustomersAdded: number,
  prefillConcurrency: number,
  metricsBeforeWorkload: PerfMetric[],
): Promise<PerfSummary> {
  const metrics = metricsBeforeWorkload.map((metric) => ({ ...metric }));
  const users = await measure("create users", USER_COUNT, async () => {
    const createdUsers: string[] = [];
    for (let i = 0; i < USER_COUNT; i++) {
      const { userId } = await Auth.fastSignUp();
      createdUsers.push(userId);
    }
    return createdUsers;
  }, metrics);

  await measure("create + redeem test-mode subscription purchases", users.length, async () => {
    for (const userId of users) {
      const code = await createPurchaseCode({ customerType: "user", customerId: userId, productId: "perf-sub" });
      const response = await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
        accessType: "admin",
        method: "POST",
        body: { full_code: code, price_id: "monthly", quantity: 1 },
      });
      expect(response.status).toBe(200);
    }
  }, metrics);

  await measure("create + redeem test-mode one-time purchases", users.length, async () => {
    for (const userId of users) {
      const code = await createPurchaseCode({ customerType: "user", customerId: userId, productId: "perf-otp" });
      const response = await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
        accessType: "admin",
        method: "POST",
        body: { full_code: code, price_id: "single", quantity: 2 },
      });
      expect(response.status).toBe(200);
    }
  }, metrics);

  await measure("grant stackable subscription products via server API", users.length * 2, async () => {
    for (const userId of users) {
      for (let i = 0; i < 2; i++) {
        const response = await niceBackendFetch(urlString`/api/v1/payments/products/user/${userId}`, {
          method: "POST",
          accessType: "server",
          body: {
            product_id: "perf-api-grant",
            quantity: 1,
          },
        });
        expect(response.status).toBe(200);
      }
    }
  }, metrics);

  await measure("write manual item quantity changes", users.length * ITEM_UPDATES_PER_USER, async () => {
    for (const userId of users) {
      for (let i = 0; i < ITEM_UPDATES_PER_USER; i++) {
        const itemId = i % 2 === 0 ? "credits" : "boosts";
        const response = await niceBackendFetch(urlString`/api/latest/payments/items/user/${userId}/${itemId}/update-quantity`, {
          method: "POST",
          accessType: "server",
          query: { allow_negative: "false" },
          body: {
            delta: i + 1,
            description: `perf-${i}`,
          },
        });
        expect(response.status).toBe(200);
      }
    }
  }, metrics);

  await measure("read owned products for all users", users.length, async () => {
    for (const userId of users) {
      const response = await niceBackendFetch(urlString`/api/v1/payments/products/user/${userId}`, {
        accessType: "server",
      });
      expect(response.status).toBe(200);
      expect(response.body.items.length).toBeGreaterThan(0);
    }
  }, metrics);

  await measure("read item quantities for all users", users.length * 3, async () => {
    for (const userId of users) {
      for (const itemId of ["credits", "seats", "boosts"]) {
        const response = await niceBackendFetch(urlString`/api/latest/payments/items/user/${userId}/${itemId}`, {
          accessType: "server",
        });
        expect(response.status).toBe(200);
        expect(typeof response.body.quantity).toBe("number");
      }
    }
  }, metrics);

  const transactions = await measure("list all transactions with pagination", 1, listAllTransactions, metrics);
  expect(transactions.length).toBeGreaterThanOrEqual(users.length * 4);

  const summary: PerfSummary = {
    prefillCustomers,
    prefillCustomersAdded,
    prefillConcurrency,
    users: users.length,
    transactions: transactions.length,
    metrics: metrics.map((metric) => ({
      name: metric.name,
      count: metric.count,
      elapsedMs: Number(metric.elapsedMs.toFixed(1)),
      opsPerSecond: metric.count === 0 ? null : Number((metric.count / metric.elapsedMs * 1000).toFixed(2)),
    })),
  };
  console.log("[bulldozer-payments-e2e-perf] summary", JSON.stringify(summary));
  return summary;
}

function writeSummary(summary: PerfSummary, outputPath: string): void {
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2));
}

it("benchmarks backend-level payments flows through the Bulldozer HTTP boundary", { timeout: TEST_TIMEOUT_MS }, async () => {
  const setupMetrics: PerfMetric[] = [];
  await measure("setup project + payments config", 1, setupPayments, setupMetrics);

  let previousPrefillCustomers = 0;
  for (const prefillCustomers of PREFILL_STAGES) {
    const delta = prefillCustomers - previousPrefillCustomers;
    console.log(`[bulldozer-payments-e2e-perf] prefill stage ${prefillCustomers}: adding ${delta} customers`);
    const metricsBeforeWorkload = setupMetrics.map((metric) => ({ ...metric }));
    // Prefill runs before measurements, so bounded concurrency cannot taint the measured workload.
    await measure(
      "prefill existing payments data",
      delta,
      () => prefillCustomersInRange(previousPrefillCustomers, delta, prefillCustomers),
      metricsBeforeWorkload,
    );

    const summary = await runMeasuredWorkload(prefillCustomers, delta, PREFILL_CONCURRENCY, metricsBeforeWorkload);
    if (OUTPUT_PATH != null) {
      const outputPath = OUTPUT_PATH.replace(/\{prefill\}/g, String(prefillCustomers));
      writeSummary(summary, outputPath);
    }
    previousPrefillCustomers = prefillCustomers;
  }
});
