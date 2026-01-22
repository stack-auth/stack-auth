import { getSoleTenancyFromProjectBranch, DEFAULT_BRANCH_ID } from "@/lib/tenancies";
import { globalPrismaClient } from "@/prisma-client";
import { SubscriptionStatus } from "@/generated/prisma/client";
import type { OrganizationRenderedConfig } from "@stackframe/stack-shared/dist/config/schema";
import type { Transaction, TransactionEntry } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import { FAR_FUTURE_DATE, addInterval, getIntervalsElapsed, type DayInterval } from "@stackframe/stack-shared/dist/utils/dates";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { deepPlainEquals, filterUndefined, omit } from "@stackframe/stack-shared/dist/utils/objects";
import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { deindent, stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import { urlString } from "@stackframe/stack-shared/dist/utils/urls";
import fs from "fs";

const prismaClient = globalPrismaClient;
const OUTPUT_FILE_PATH = "./verify-data-integrity-output.untracked.json";

type EndpointOutput = {
  status: number,
  responseJson: any,
};

type OutputData = Record<string, EndpointOutput[]>;

type CustomerType = "user" | "team" | "custom";

type PaymentsConfig = OrganizationRenderedConfig["payments"];
type PaymentsProduct = PaymentsConfig["products"][string];

type LedgerTransaction = {
  amount: number,
  grantTime: Date,
  expirationTime: Date,
};

type CustomerTransactionEntry = {
  transactionId: string,
  createdAtMillis: number,
  entry: TransactionEntry,
};

type ExpectedOwnedProduct = {
  id: string | null,
  type: "one_time" | "subscription",
  quantity: number,
};

let targetOutputData: OutputData | undefined = undefined;
const currentOutputData: OutputData = {};


async function main() {
  console.log();
  console.log();
  console.log();
  console.log();
  console.log();
  console.log();
  console.log();
  console.log();
  console.log("===================================================");
  console.log("Welcome to verify-data-integrity.ts.");
  console.log();
  console.log("This script will ensure that the data in the");
  console.log("database is not corrupted.");
  console.log();
  console.log("It will call the most important endpoints for");
  console.log("each project and every user, and ensure that");
  console.log("the status codes are what they should be.");
  console.log();
  console.log("It's a good idea to run this script on REPLICAS");
  console.log("of the production database regularly (not the actual");
  console.log("prod db!); it should never fail at any point in time.");
  console.log();
  console.log("");
  console.log("\x1b[41mIMPORTANT\x1b[0m: This script may modify");
  console.log("the database during its execution in all sorts of");
  console.log("ways, so don't run it on production!");
  console.log();
  console.log("===================================================");
  console.log();
  console.log();
  console.log();
  console.log();
  console.log();
  console.log();
  console.log();
  console.log();
  console.log("Starting in 3 seconds...");
  await wait(1000);
  console.log("2...");
  await wait(1000);
  console.log("1...");
  await wait(1000);
  console.log();
  console.log();
  console.log();
  console.log();

  const numericArgs = process.argv.filter(arg => arg.match(/^[0-9]+$/)).map(arg => +arg);
  const startAt = Math.max(0, (numericArgs[0] ?? 1) - 1);
  const count = numericArgs[1] ?? Infinity;
  const flags = process.argv.slice(1);
  const skipUsers = flags.includes("--skip-users");
  const shouldSaveOutput = flags.includes("--save-output");
  const shouldVerifyOutput = flags.includes("--verify-output");
  const shouldSkipNeon = flags.includes("--skip-neon");
  const recentFirst = flags.includes("--recent-first");


  if (shouldSaveOutput) {
    console.log(`Will save output to ${OUTPUT_FILE_PATH}`);
  }
  if (shouldSkipNeon) {
    console.log(`Will skip Neon projects.`);
  }

  if (shouldVerifyOutput) {
    if (!fs.existsSync(OUTPUT_FILE_PATH)) {
      throw new Error(`Cannot verify output: ${OUTPUT_FILE_PATH} does not exist`);
    }
    try {
      targetOutputData = JSON.parse(fs.readFileSync(OUTPUT_FILE_PATH, 'utf8'));

      // TODO next-release these are hacks for the migration, delete them
      if (targetOutputData) {
        targetOutputData["/api/v1/internal/projects/current"] = targetOutputData["/api/v1/internal/projects/current"].map(output => {
          if ("config" in output.responseJson) {
            delete output.responseJson.config.id;
            output.responseJson.config.oauth_providers = output.responseJson.config.oauth_providers
              .filter((provider: any) => provider.enabled)
              .map((provider: any) => omit(provider, ["enabled"]));
          }
          return output;
        });
      }

      console.log(`Loaded previous output data for verification`);
    } catch (error) {
      throw new Error(`Failed to parse output file: ${error}`);
    }
  }

  const projects = await prismaClient.project.findMany({
    select: {
      id: true,
      displayName: true,
      description: true,
    },
    orderBy: recentFirst ? {
      updatedAt: "desc",
    } : {
      id: "asc",
    },
  });
  console.log(`Found ${projects.length} projects, iterating over them.`);
  if (startAt !== 0) {
    console.log(`Starting at project ${startAt}.`);
  }

  const maxUsersPerProject = 100;

  const endAt = Math.min(startAt + count, projects.length);
  for (let i = startAt; i < endAt; i++) {
    const projectId = projects[i].id;
    await recurse(`[project ${(i + 1) - startAt}/${endAt - startAt}] ${projectId} ${projects[i].displayName}`, async (recurse) => {
      if (shouldSkipNeon && projects[i].description.includes("Neon")) {
        return;
      }

      const [currentProject, users, projectPermissionDefinitions, teamPermissionDefinitions] = await Promise.all([
        expectStatusCode(200, `/api/v1/internal/projects/current`, {
          method: "GET",
          headers: {
            "x-stack-project-id": projectId,
            "x-stack-access-type": "admin",
            "x-stack-development-override-key": getEnvVariable("STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY"),
          },
        }),
        expectStatusCode(200, `/api/v1/users?limit=${maxUsersPerProject}`, {
          method: "GET",
          headers: {
            "x-stack-project-id": projectId,
            "x-stack-access-type": "admin",
            "x-stack-development-override-key": getEnvVariable("STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY"),
          },
        }),
        expectStatusCode(200, `/api/v1/project-permission-definitions`, {
          method: "GET",
          headers: {
            "x-stack-project-id": projectId,
            "x-stack-access-type": "admin",
            "x-stack-development-override-key": getEnvVariable("STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY"),
          },
        }),
        expectStatusCode(200, `/api/v1/team-permission-definitions`, {
          method: "GET",
          headers: {
            "x-stack-project-id": projectId,
            "x-stack-access-type": "admin",
            "x-stack-development-override-key": getEnvVariable("STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY"),
          },
        }),
      ]);

      const tenancy = await getSoleTenancyFromProjectBranch(projectId, DEFAULT_BRANCH_ID, true);
      const paymentsConfig = tenancy ? (tenancy.config as OrganizationRenderedConfig).payments : undefined;
      const paymentsVerifier = tenancy && paymentsConfig
        ? await createPaymentsVerifier({
          projectId,
          tenancyId: tenancy.id,
          paymentsConfig,
        })
        : null;

      const verifiedTeams = new Set<string>();

      if (!skipUsers) {
        for (let j = 0; j < users.items.length; j++) {
          const user = users.items[j];
          await recurse(`[user ${j + 1}/${users.items.length}] ${user.display_name ?? user.primary_email}`, async (recurse) => {
            // get user individually
            await expectStatusCode(200, `/api/v1/users/${user.id}`, {
              method: "GET",
              headers: {
                "x-stack-project-id": projectId,
                "x-stack-access-type": "admin",
                "x-stack-development-override-key": getEnvVariable("STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY"),
              },
            });

            // list project permissions
            const projectPermissions = await expectStatusCode(200, `/api/v1/project-permissions?user_id=${user.id}`, {
              method: "GET",
              headers: {
                "x-stack-project-id": projectId,
                "x-stack-access-type": "admin",
                "x-stack-development-override-key": getEnvVariable("STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY"),
              },
            });
            for (const projectPermission of projectPermissions.items) {
              if (!projectPermissionDefinitions.items.some((p: any) => p.id === projectPermission.id)) {
                throw new StackAssertionError(deindent`
                  Project permission ${projectPermission.id} not found in project permission definitions.
                `);
              }
            }

            // list teams
            const teams = await expectStatusCode(200, `/api/v1/teams?user_id=${user.id}`, {
              method: "GET",
              headers: {
                "x-stack-project-id": projectId,
                "x-stack-access-type": "admin",
                "x-stack-development-override-key": getEnvVariable("STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY"),
              },
            });

            for (const team of teams.items) {
              await recurse(`[team ${team.id}] ${team.name}`, async (recurse) => {
                // list team permissions
                const teamPermissions = await expectStatusCode(200, `/api/v1/team-permissions?team_id=${team.id}`, {
                  method: "GET",
                  headers: {
                    "x-stack-project-id": projectId,
                    "x-stack-access-type": "admin",
                    "x-stack-development-override-key": getEnvVariable("STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY"),
                  },
                });
                for (const teamPermission of teamPermissions.items) {
                  if (!teamPermissionDefinitions.items.some((p: any) => p.id === teamPermission.id)) {
                    throw new StackAssertionError(deindent`
                      Team permission ${teamPermission.id} not found in team permission definitions.
                    `);
                  }
                }
              });

              if (paymentsVerifier && !verifiedTeams.has(team.id)) {
                await paymentsVerifier.verifyCustomerPayments({
                  customerType: "team",
                  customerId: team.id,
                });
                verifiedTeams.add(team.id);
              }
            }

            if (paymentsVerifier) {
              await paymentsVerifier.verifyCustomerPayments({
                customerType: "user",
                customerId: user.id,
              });
            }
          });
        }

        if (paymentsVerifier) {
          for (const customCustomerId of paymentsVerifier.customCustomerIds) {
            await paymentsVerifier.verifyCustomerPayments({
              customerType: "custom",
              customerId: customCustomerId,
            });
          }
        }
      }
    });
  }

  if (targetOutputData && !deepPlainEquals(currentOutputData, targetOutputData)) {
    throw new StackAssertionError(deindent`
      Output data mismatch between final and target output data.
    `);
  }
  if (shouldSaveOutput) {
    fs.writeFileSync(OUTPUT_FILE_PATH, JSON.stringify(currentOutputData, null, 2));
    console.log(`Output saved to ${OUTPUT_FILE_PATH}`);
  }

  console.log();
  console.log();
  console.log();
  console.log();
  console.log();
  console.log();
  console.log();
  console.log();
  console.log("===================================================");
  console.log("All good!");
  console.log();
  console.log("Goodbye.");
  console.log("===================================================");
  console.log();
  console.log();
}
// eslint-disable-next-line no-restricted-syntax
main().catch((...args) => {
  console.error();
  console.error();
  console.error(`\x1b[41mERROR\x1b[0m! Could not verify data integrity. See the error message for more details.`);
  console.error(...args);
  process.exit(1);
});

async function expectStatusCode(expectedStatusCode: number, endpoint: string, request: RequestInit) {
  const apiUrl = new URL(getEnvVariable("NEXT_PUBLIC_STACK_API_URL"));
  const response = await fetch(new URL(endpoint, apiUrl), {
    ...request,
    headers: {
      "x-stack-disable-artificial-development-delay": "yes",
      "x-stack-development-disable-extended-logging": "yes",
      ...filterUndefined(request.headers ?? {}),
    },
  });

  const responseText = await response.text();

  if (response.status !== expectedStatusCode) {
    throw new StackAssertionError(deindent`
      Expected status code ${expectedStatusCode} but got ${response.status} for ${endpoint}:

          ${responseText}
    `, { request, response });
  }

  const responseJson = JSON.parse(responseText);
  const currentOutput: EndpointOutput = {
    status: response.status,
    responseJson,
  };

  appendOutputData(endpoint, currentOutput);

  return responseJson;
}

function appendOutputData(endpoint: string, output: EndpointOutput) {
  if (!(endpoint in currentOutputData)) {
    currentOutputData[endpoint] = [];
  }
  const newLength = currentOutputData[endpoint].push(output);
  if (targetOutputData) {
    if (!(endpoint in targetOutputData)) {
      throw new StackAssertionError(deindent`
        Output data mismatch for endpoint ${endpoint}:
          Expected ${endpoint} to be in targetOutputData, but it is not.
      `, { endpoint });
    }
    if (targetOutputData[endpoint].length < newLength) {
      throw new StackAssertionError(deindent`
        Output data mismatch for endpoint ${endpoint}:
          Expected ${targetOutputData[endpoint].length} outputs but got at least ${newLength}.
      `, { endpoint });
    }
    if (!(deepPlainEquals(targetOutputData[endpoint][newLength - 1], output))) {
      throw new StackAssertionError(deindent`
        Output data mismatch for endpoint ${endpoint}:
          Expected output[${JSON.stringify(endpoint)}][${newLength - 1}] to be:
            ${JSON.stringify(targetOutputData[endpoint][newLength - 1], null, 2)}
          but got:
            ${JSON.stringify(output, null, 2)}.
      `, { endpoint });
    }
  }
}

const DEFAULT_PRODUCT_START_DATE = new Date("1973-01-01T12:00:00.000Z");

type IncludedItemConfig = {
  quantity?: number,
  repeat?: DayInterval | "never" | null,
  expires?: "never" | "when-purchase-expires" | "when-repeated" | null,
};

type SubscriptionSnapshot = {
  id: string,
  quantity: number,
  status: SubscriptionStatus,
  currentPeriodStart: Date,
  currentPeriodEnd: Date | null,
  cancelAtPeriodEnd: boolean,
  createdAt: Date,
  refundedAt: Date | null,
};

type OneTimePurchaseSnapshot = {
  id: string,
  quantity: number,
  createdAt: Date,
  refundedAt: Date | null,
};

type ItemQuantityChangeSnapshot = {
  id: string,
  createdAt: Date,
  expiresAt: Date | null,
};

function getCustomerKey(customerType: CustomerType, customerId: string) {
  return `${customerType}:${customerId}`;
}

function isCustomerTransactionEntry(entry: TransactionEntry): entry is Extract<TransactionEntry, { customer_type: CustomerType, customer_id: string }> {
  return "customer_type" in entry && "customer_id" in entry;
}

function normalizeRepeat(repeat: unknown): DayInterval | null {
  if (repeat === "never") return null;
  if (!Array.isArray(repeat) || repeat.length !== 2) return null;
  const [amount, unit] = repeat;
  if (typeof amount !== "number") return null;
  if (unit !== "day" && unit !== "week" && unit !== "month" && unit !== "year") return null;
  return [amount, unit];
}

function pushLedgerEntry(ledgerByItemId: Map<string, LedgerTransaction[]>, itemId: string, entry: LedgerTransaction) {
  const existing = ledgerByItemId.get(itemId);
  if (existing) {
    existing.push(entry);
    return;
  }
  ledgerByItemId.set(itemId, [entry]);
}

function computeLedgerBalanceAtNow(transactions: LedgerTransaction[], now: Date): number {
  const grantedAt = new Map<number, number>();
  const expiredAt = new Map<number, number>();
  const usedAt = new Map<number, number>();
  const timeSet = new Set<number>();

  for (const t of transactions) {
    const grantTime = t.grantTime.getTime();
    if (t.grantTime <= now && t.amount < 0 && t.expirationTime > now) {
      usedAt.set(grantTime, (-1 * t.amount) + (usedAt.get(grantTime) ?? 0));
    }
    if (t.grantTime <= now && t.amount > 0) {
      grantedAt.set(grantTime, (grantedAt.get(grantTime) ?? 0) + t.amount);
    }
    if (t.expirationTime <= now && t.amount > 0) {
      const time2 = t.expirationTime.getTime();
      expiredAt.set(time2, (expiredAt.get(time2) ?? 0) + t.amount);
      timeSet.add(time2);
    }
    timeSet.add(grantTime);
  }
  const times = Array.from(timeSet.values()).sort((a, b) => a - b);
  if (times.length === 0) {
    return 0;
  }

  let grantedSum = 0;
  let expiredSum = 0;
  let usedSum = 0;
  let usedOrExpiredSum = 0;
  for (const t of times) {
    const g = grantedAt.get(t) ?? 0;
    const e = expiredAt.get(t) ?? 0;
    const u = usedAt.get(t) ?? 0;
    grantedSum += g;
    expiredSum += e;
    usedSum += u;
    usedOrExpiredSum = Math.max(usedOrExpiredSum + u, expiredSum);
  }
  return grantedSum - usedOrExpiredSum;
}

function addWhenRepeatedItemWindowTransactions(options: {
  baseQty: number,
  repeat: DayInterval,
  anchor: Date,
  nowClamped: Date,
  hardEnd: Date | null,
}): LedgerTransaction[] {
  const { baseQty, repeat, anchor, nowClamped } = options;
  const endLimit = options.hardEnd ?? FAR_FUTURE_DATE;
  const finalNow = nowClamped < endLimit ? nowClamped : endLimit;
  if (finalNow < anchor) return [];

  const entries: LedgerTransaction[] = [];
  const elapsed = getIntervalsElapsed(anchor, finalNow, repeat);

  for (let i = 0; i <= elapsed; i++) {
    const windowStart = addInterval(new Date(anchor), [repeat[0] * i, repeat[1]]);
    const windowEnd = addInterval(new Date(windowStart), repeat);
    entries.push({ amount: baseQty, grantTime: windowStart, expirationTime: windowEnd });
  }

  return entries;
}

function addSubscriptionIncludedItems(options: {
  ledgerByItemId: Map<string, LedgerTransaction[]>,
  includedItems: Record<string, IncludedItemConfig> | undefined,
  subscription: Pick<SubscriptionSnapshot, "quantity" | "currentPeriodStart" | "currentPeriodEnd" | "createdAt">,
  now: Date,
}) {
  const { subscription, ledgerByItemId, includedItems, now } = options;
  for (const [itemId, inc] of Object.entries(includedItems ?? {})) {
    const baseQty = (inc.quantity ?? 0) * subscription.quantity;
    if (baseQty <= 0) continue;
    const pStart = subscription.currentPeriodStart;
    const pEnd = subscription.currentPeriodEnd ?? FAR_FUTURE_DATE;
    const nowClamped = now < pEnd ? now : pEnd;
    if (nowClamped < pStart) continue;

    const repeat = normalizeRepeat(inc.repeat ?? null);
    const expires = inc.expires ?? "never";

    if (!repeat) {
      const expirationTime = expires === "when-purchase-expires" ? pEnd : FAR_FUTURE_DATE;
      pushLedgerEntry(ledgerByItemId, itemId, {
        amount: baseQty,
        grantTime: pStart,
        expirationTime,
      });
      continue;
    }

    if (expires === "when-purchase-expires") {
      const elapsed = getIntervalsElapsed(pStart, nowClamped, repeat);
      const occurrences = elapsed + 1;
      const amount = occurrences * baseQty;
      pushLedgerEntry(ledgerByItemId, itemId, {
        amount,
        grantTime: pStart,
        expirationTime: pEnd,
      });
      continue;
    }

    if (expires === "when-repeated") {
      const entries = addWhenRepeatedItemWindowTransactions({
        baseQty,
        repeat,
        anchor: subscription.createdAt,
        nowClamped,
        hardEnd: subscription.currentPeriodEnd,
      });
      for (const entry of entries) {
        pushLedgerEntry(ledgerByItemId, itemId, entry);
      }
      continue;
    }

    const elapsed = getIntervalsElapsed(pStart, nowClamped, repeat);
    const occurrences = elapsed + 1;
    const amount = occurrences * baseQty;
    pushLedgerEntry(ledgerByItemId, itemId, {
      amount,
      grantTime: pStart,
      expirationTime: FAR_FUTURE_DATE,
    });
  }
}

function addOneTimeIncludedItems(options: {
  ledgerByItemId: Map<string, LedgerTransaction[]>,
  includedItems: Record<string, IncludedItemConfig> | undefined,
  quantity: number,
  createdAt: Date,
}) {
  const { ledgerByItemId, includedItems, quantity, createdAt } = options;
  for (const [itemId, inc] of Object.entries(includedItems ?? {})) {
    const baseQty = (inc.quantity ?? 0) * quantity;
    if (baseQty <= 0) continue;
    pushLedgerEntry(ledgerByItemId, itemId, {
      amount: baseQty,
      grantTime: createdAt,
      expirationTime: FAR_FUTURE_DATE,
    });
  }
}

function buildExpectedItemQuantitiesForCustomer(options: {
  entries: CustomerTransactionEntry[],
  defaultProducts: Array<{ productId: string, product: PaymentsProduct }>,
  itemQuantityChangeById: Map<string, ItemQuantityChangeSnapshot>,
  subscriptionById: Map<string, SubscriptionSnapshot>,
  oneTimePurchaseById: Map<string, OneTimePurchaseSnapshot>,
  now: Date,
}) {
  const ledgerByItemId = new Map<string, LedgerTransaction[]>();

  for (const { entry, transactionId, createdAtMillis } of options.entries) {
    if (entry.type === "item_quantity_change") {
      const change = options.itemQuantityChangeById.get(transactionId);
      if (!change) {
        throw new StackAssertionError("Item quantity change not found for transaction entry", { transactionId });
      }
      pushLedgerEntry(ledgerByItemId, entry.item_id, {
        amount: entry.quantity,
        grantTime: change.createdAt,
        expirationTime: change.expiresAt ?? FAR_FUTURE_DATE,
      });
      continue;
    }

    if (entry.type !== "product_grant") continue;

    const includedItems = entry.product.included_items;

    if (entry.subscription_id) {
      const subscription = options.subscriptionById.get(entry.subscription_id);
      if (!subscription) {
        throw new StackAssertionError("Subscription not found for transaction entry", { transactionId, subscriptionId: entry.subscription_id });
      }
      addSubscriptionIncludedItems({
        ledgerByItemId,
        includedItems,
        subscription,
        now: options.now,
      });
      continue;
    }

    if (entry.one_time_purchase_id) {
      const purchase = options.oneTimePurchaseById.get(entry.one_time_purchase_id);
      if (!purchase) {
        throw new StackAssertionError("One-time purchase not found for transaction entry", { transactionId, purchaseId: entry.one_time_purchase_id });
      }
      addOneTimeIncludedItems({
        ledgerByItemId,
        includedItems,
        quantity: purchase.quantity,
        createdAt: purchase.createdAt,
      });
      continue;
    }

    addOneTimeIncludedItems({
      ledgerByItemId,
      includedItems,
      quantity: entry.quantity,
      createdAt: new Date(createdAtMillis),
    });
  }

  for (const { product } of options.defaultProducts) {
    addSubscriptionIncludedItems({
      ledgerByItemId,
      includedItems: product.includedItems,
      subscription: {
        quantity: 1,
        currentPeriodStart: DEFAULT_PRODUCT_START_DATE,
        currentPeriodEnd: null,
        createdAt: DEFAULT_PRODUCT_START_DATE,
      },
      now: options.now,
    });
  }

  const results = new Map<string, number>();
  for (const [itemId, ledger] of ledgerByItemId) {
    results.set(itemId, computeLedgerBalanceAtNow(ledger, options.now));
  }
  return results;
}

function buildExpectedOwnedProductsForCustomer(options: {
  entries: CustomerTransactionEntry[],
  defaultProducts: Array<{ productId: string, product: PaymentsProduct }>,
  subscriptionById: Map<string, SubscriptionSnapshot>,
  oneTimePurchaseById: Map<string, OneTimePurchaseSnapshot>,
}) {
  const expected: ExpectedOwnedProduct[] = [];
  for (const { entry, transactionId } of options.entries) {
    if (entry.type !== "product_grant") continue;

    if (entry.subscription_id) {
      const subscription = options.subscriptionById.get(entry.subscription_id);
      if (!subscription) {
        throw new StackAssertionError("Subscription not found for transaction entry", { transactionId, subscriptionId: entry.subscription_id });
      }
      if (subscription.status !== SubscriptionStatus.active && subscription.status !== SubscriptionStatus.trialing) {
        continue;
      }
      expected.push({
        id: entry.product_id ?? null,
        type: "subscription",
        quantity: subscription.quantity,
      });
      continue;
    }

    if (entry.one_time_purchase_id) {
      const purchase = options.oneTimePurchaseById.get(entry.one_time_purchase_id);
      if (!purchase) {
        throw new StackAssertionError("One-time purchase not found for transaction entry", { transactionId, purchaseId: entry.one_time_purchase_id });
      }
      if (purchase.refundedAt) continue;
      expected.push({
        id: entry.product_id ?? null,
        type: "one_time",
        quantity: purchase.quantity,
      });
      continue;
    }

    expected.push({
      id: entry.product_id ?? null,
      type: "one_time",
      quantity: entry.quantity,
    });
  }

  for (const { productId } of options.defaultProducts) {
    expected.push({
      id: productId,
      type: "subscription",
      quantity: 1,
    });
  }

  return expected;
}

function getDefaultProductsForCustomer(options: {
  paymentsConfig: PaymentsConfig,
  customerType: CustomerType,
  subscribedProductLineIds: Set<string>,
  subscribedProductIds: Set<string>,
}) {
  const defaultsByProductLine = new Map<string, { productId: string, product: PaymentsProduct }>();
  const ungroupedDefaults: Array<{ productId: string, product: PaymentsProduct }> = [];

  for (const [productId, product] of Object.entries(options.paymentsConfig.products)) {
    if (product.customerType !== options.customerType) continue;
    if (product.prices !== "include-by-default") continue;

    if (product.productLineId) {
      if (!defaultsByProductLine.has(product.productLineId)) {
        defaultsByProductLine.set(product.productLineId, { productId, product });
      }
      continue;
    }

    ungroupedDefaults.push({ productId, product });
  }

  const defaults: Array<{ productId: string, product: PaymentsProduct }> = [];
  for (const [productLineId, product] of defaultsByProductLine) {
    if (options.subscribedProductLineIds.has(productLineId)) continue;
    defaults.push(product);
  }
  for (const product of ungroupedDefaults) {
    if (options.subscribedProductIds.has(product.productId)) continue;
    defaults.push(product);
  }
  return defaults;
}

function normalizeOwnedProducts(list: ExpectedOwnedProduct[]) {
  return list
    .map((item) => ({
      id: item.id ?? null,
      type: item.type,
      quantity: item.quantity,
    }))
    .sort((a, b) => {
      const aId = a.id ?? "";
      const bId = b.id ?? "";
      if (aId !== bId) return stringCompare(aId, bId);
      if (a.type !== b.type) return stringCompare(a.type, b.type);
      return a.quantity - b.quantity;
    });
}

async function fetchAllTransactionsForProject(projectId: string) {
  const transactions: Transaction[] = [];
  let cursor: string | null = null;

  do {
    const params = new URLSearchParams({ limit: "200" });
    if (cursor) params.set("cursor", cursor);
    const endpoint = urlString`/api/v1/internal/payments/transactions` + (params.toString() ? `?${params.toString()}` : "");
    const response = await expectStatusCode(200, endpoint, {
      method: "GET",
      headers: {
        "x-stack-project-id": projectId,
        "x-stack-access-type": "admin",
        "x-stack-development-override-key": getEnvVariable("STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY"),
      },
    }) as { transactions: Transaction[], next_cursor: string | null };
    transactions.push(...response.transactions);
    cursor = response.next_cursor;
  } while (cursor);

  return transactions;
}

async function fetchAllOwnedProductsForCustomer(options: {
  projectId: string,
  customerType: CustomerType,
  customerId: string,
}) {
  const items: Array<ExpectedOwnedProduct> = [];
  let cursor: string | null = null;

  do {
    const params = new URLSearchParams({ limit: "100" });
    if (cursor) params.set("cursor", cursor);
    const endpoint = urlString`/api/v1/payments/products/${options.customerType}/${options.customerId}` + (params.toString() ? `?${params.toString()}` : "");
    const response = await expectStatusCode(200, endpoint, {
      method: "GET",
      headers: {
        "x-stack-project-id": options.projectId,
        "x-stack-access-type": "admin",
        "x-stack-development-override-key": getEnvVariable("STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY"),
      },
    }) as { items: Array<ExpectedOwnedProduct>, pagination: { next_cursor: string | null } };
    items.push(...response.items.map((item) => ({
      id: item.id ?? null,
      type: item.type,
      quantity: item.quantity,
    })));
    cursor = response.pagination.next_cursor;
  } while (cursor);

  return items;
}

async function createPaymentsVerifier(options: {
  projectId: string,
  tenancyId: string,
  paymentsConfig: PaymentsConfig,
}) {
  const transactions = await fetchAllTransactionsForProject(options.projectId);
  const paymentsConfig = options.paymentsConfig;

  const entriesByCustomer = new Map<string, CustomerTransactionEntry[]>();
  const subscriptionIds = new Set<string>();
  const oneTimePurchaseIds = new Set<string>();
  const itemQuantityChangeIds = new Set<string>();
  const customCustomerIds = new Set<string>();

  for (const transaction of transactions) {
    for (const entry of transaction.entries) {
      if (!isCustomerTransactionEntry(entry)) continue;
      const customerKey = getCustomerKey(entry.customer_type, entry.customer_id);
      const entries = entriesByCustomer.get(customerKey) ?? [];
      entries.push({
        transactionId: transaction.id,
        createdAtMillis: transaction.created_at_millis,
        entry,
      });
      entriesByCustomer.set(customerKey, entries);

      if (entry.customer_type === "custom") {
        customCustomerIds.add(entry.customer_id);
      }

      if (entry.type === "item_quantity_change") {
        itemQuantityChangeIds.add(transaction.id);
        continue;
      }
      if (entry.type !== "product_grant") continue;
      if (entry.subscription_id) {
        subscriptionIds.add(entry.subscription_id);
      }
      if (entry.one_time_purchase_id) {
        oneTimePurchaseIds.add(entry.one_time_purchase_id);
      }
    }
  }

  const subscriptionIdList = Array.from(subscriptionIds);
  const oneTimePurchaseIdList = Array.from(oneTimePurchaseIds);
  const itemQuantityChangeIdList = Array.from(itemQuantityChangeIds);

  const [subscriptions, oneTimePurchases, itemQuantityChanges] = await Promise.all([
    subscriptionIdList.length === 0 ? [] : prismaClient.subscription.findMany({
      where: {
        tenancyId: options.tenancyId,
        id: { in: subscriptionIdList },
      },
      select: {
        id: true,
        quantity: true,
        status: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
        createdAt: true,
        refundedAt: true,
      },
    }),
    oneTimePurchaseIdList.length === 0 ? [] : prismaClient.oneTimePurchase.findMany({
      where: {
        tenancyId: options.tenancyId,
        id: { in: oneTimePurchaseIdList },
      },
      select: {
        id: true,
        quantity: true,
        createdAt: true,
        refundedAt: true,
      },
    }),
    itemQuantityChangeIdList.length === 0 ? [] : prismaClient.itemQuantityChange.findMany({
      where: {
        tenancyId: options.tenancyId,
        id: { in: itemQuantityChangeIdList },
      },
      select: {
        id: true,
        createdAt: true,
        expiresAt: true,
      },
    }),
  ]);

  const subscriptionById = new Map(subscriptions.map((subscription) => [subscription.id, subscription]));
  const oneTimePurchaseById = new Map(oneTimePurchases.map((purchase) => [purchase.id, purchase]));
  const itemQuantityChangeById = new Map(itemQuantityChanges.map((change) => [change.id, change]));

  async function verifyCustomerPayments(customer: { customerType: CustomerType, customerId: string }) {
    const entries = entriesByCustomer.get(getCustomerKey(customer.customerType, customer.customerId)) ?? [];
    const now = new Date();

    const subscribedProductLineIds = new Set<string>();
    const subscribedProductIds = new Set<string>();
    for (const { entry } of entries) {
      if (entry.type !== "product_grant") continue;
      if (!entry.subscription_id) continue;
      if (!entry.product_id) continue;
      subscribedProductIds.add(entry.product_id);
      const configProduct = paymentsConfig.products[entry.product_id] as PaymentsProduct | undefined;
      if (!configProduct) {
        continue;
      }
      if (configProduct.productLineId) {
        subscribedProductLineIds.add(configProduct.productLineId);
      }
    }

    const defaultProducts = getDefaultProductsForCustomer({
      paymentsConfig,
      customerType: customer.customerType,
      subscribedProductLineIds,
      subscribedProductIds,
    });

    const expectedItems = buildExpectedItemQuantitiesForCustomer({
      entries,
      defaultProducts,
      itemQuantityChangeById,
      subscriptionById,
      oneTimePurchaseById,
      now,
    });

    for (const [itemId, item] of Object.entries(paymentsConfig.items)) {
      if (item.customerType !== customer.customerType) continue;
      const expectedQuantity = expectedItems.get(itemId) ?? 0;
      const endpoint = urlString`/api/v1/payments/items/${customer.customerType}/${customer.customerId}/${itemId}`;
      const response = await expectStatusCode(200, endpoint, {
        method: "GET",
        headers: {
          "x-stack-project-id": options.projectId,
          "x-stack-access-type": "admin",
          "x-stack-development-override-key": getEnvVariable("STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY"),
        },
      }) as { quantity: number };
      if (response.quantity !== expectedQuantity) {
        throw new StackAssertionError(deindent`
          Item quantity mismatch for ${customer.customerType} ${customer.customerId} item ${itemId}.
          Expected ${expectedQuantity} but got ${response.quantity}.
        `, { expectedQuantity, actualQuantity: response.quantity });
      }
    }

    const expectedProducts = buildExpectedOwnedProductsForCustomer({
      entries,
      defaultProducts,
      subscriptionById,
      oneTimePurchaseById,
    });
    const actualProducts = await fetchAllOwnedProductsForCustomer({
      projectId: options.projectId,
      customerType: customer.customerType,
      customerId: customer.customerId,
    });

    const normalizedExpected = normalizeOwnedProducts(expectedProducts);
    const normalizedActual = normalizeOwnedProducts(actualProducts);

    if (!deepPlainEquals(normalizedExpected, normalizedActual)) {
      throw new StackAssertionError(deindent`
        Owned products mismatch for ${customer.customerType} ${customer.customerId}.
        Expected:
          ${JSON.stringify(normalizedExpected, null, 2)}
        Actual:
          ${JSON.stringify(normalizedActual, null, 2)}
      `, { expected: normalizedExpected, actual: normalizedActual });
    }
  }

  return {
    verifyCustomerPayments,
    customCustomerIds,
  };
}

let lastProgress = performance.now() - 9999999999;

type RecurseFunction = (progressPrefix: string, inner: (recurse: RecurseFunction) => Promise<void>) => Promise<void>;

const _recurse = async (progressPrefix: string | ((...args: any[]) => void), inner: Parameters<RecurseFunction>[1]): Promise<void> => {
  const progressFunc = typeof progressPrefix === "function" ? progressPrefix : (...args: any[]) => {
    console.log(`${progressPrefix}`, ...args);
  };
  if (performance.now() - lastProgress > 1000) {
    progressFunc();
    lastProgress = performance.now();
  }
  try {
    return await inner(
      (progressPrefix, inner) => _recurse(
        (...args) => progressFunc(progressPrefix, ...args),
        inner,
      ),
    );
  } catch (error) {
    progressFunc(`\x1b[41mERROR\x1b[0m!`);
    throw error;
  }
};
const recurse: RecurseFunction = _recurse;
