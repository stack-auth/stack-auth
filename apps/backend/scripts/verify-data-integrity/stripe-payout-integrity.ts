import type { Tenancy } from "@/lib/tenancies";
import { getStripeForAccount } from "@/lib/stripe";
import type { Transaction } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import { urlString } from "@stackframe/stack-shared/dist/utils/urls";

import type { ExpectStatusCode } from "./api";

export async function fetchAllTransactionsForProject(options: {
  projectId: string,
  expectStatusCode: ExpectStatusCode,
}) {
  const transactions: Transaction[] = [];
  let cursor: string | null = null;

  do {
    const params = new URLSearchParams({ limit: "200" });
    if (cursor) params.set("cursor", cursor);
    const endpoint = urlString`/api/v1/internal/payments/transactions` + (params.toString() ? `?${params.toString()}` : "");
    const response = await options.expectStatusCode(200, endpoint, {
      method: "GET",
      headers: {
        "x-stack-project-id": options.projectId,
        "x-stack-access-type": "admin",
        "x-stack-development-override-key": getEnvVariable("STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY"),
      },
    }) as { transactions: Transaction[], next_cursor: string | null };
    transactions.push(...response.transactions);
    cursor = response.next_cursor;
  } while (cursor);

  return transactions;
}

function parseMoneyAmountToMinorUnits(amount: string, decimals: number): bigint {
  const [wholePart, fractionalPart = ""] = amount.split(".");
  if (fractionalPart.length > decimals) {
    throw new StackAssertionError("Money amount has too many decimals", { amount, decimals });
  }
  const paddedFraction = fractionalPart.padEnd(decimals, "0");
  return BigInt(`${wholePart}${paddedFraction}`);
}

function formatMinorUnitsToMoneyString(amount: bigint, decimals: number): string {
  const isNegative = amount < 0n;
  const absolute = isNegative ? -amount : amount;
  const absoluteString = absolute.toString().padStart(decimals + 1, "0");
  const wholePart = absoluteString.slice(0, -decimals);
  const fractionalPart = absoluteString.slice(-decimals).replace(/0+$/, "");
  const rendered = fractionalPart.length > 0 ? `${wholePart}.${fractionalPart}` : wholePart;
  return isNegative ? `-${rendered}` : rendered;
}

function sumMoneyTransfersUsdMinorUnits(transactions: Transaction[]): bigint {
  let total = 0n;
  for (const transaction of transactions) {
    for (const entry of transaction.entries) {
      if (entry.type !== "money_transfer") continue;
      total += parseMoneyAmountToMinorUnits(entry.net_amount.USD, 2);
    }
  }
  return total;
}

type StripeBalanceTransactionList = {
  data: Array<{
    id: string,
    amount: number,
    currency: string,
    reporting_category?: string | null,
  }>,
  has_more: boolean,
};

async function fetchStripeBalanceTransactionTotalUsdMinorUnits(options: {
  tenancy: Tenancy,
  stripeAccountId: string,
}): Promise<bigint> {
  const stripe = await getStripeForAccount({
    tenancy: options.tenancy,
    accountId: options.stripeAccountId,
  });

  let total = 0n;
  const includeCategories = new Set([
    "charge",
    "refund",
    "dispute",
    "dispute_reversal",
    "partial_capture_reversal",
  ]);
  let startingAfter: string | undefined = undefined;

  do {
    const page: StripeBalanceTransactionList = await stripe.balanceTransactions.list({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const balanceTransaction of page.data) {
      if (balanceTransaction.currency !== "usd") continue;
      if (!balanceTransaction.reporting_category) continue;
      if (!includeCategories.has(balanceTransaction.reporting_category)) continue;
      total += BigInt(balanceTransaction.amount);
    }
    startingAfter = page.has_more ? page.data.at(-1)?.id : undefined;
  } while (startingAfter);

  return total;
}

export async function verifyStripePayoutIntegrity(options: {
  projectId: string,
  tenancy: Tenancy,
  stripeAccountId: string,
  expectStatusCode: ExpectStatusCode,
}) {
  if (options.projectId === '6fbbf22e-f4b2-4c6e-95a1-beab6fa41063') {
    // Dummy project doesn't have a real stripe account, so we skip the verification.
    return;
  }
  const transactions = await fetchAllTransactionsForProject({
    projectId: options.projectId,
    expectStatusCode: options.expectStatusCode,
  });
  const moneyTransferTotalUsdMinor = sumMoneyTransfersUsdMinorUnits(transactions);
  const stripeBalanceTransactionTotalUsdMinor = await fetchStripeBalanceTransactionTotalUsdMinorUnits({
    tenancy: options.tenancy,
    stripeAccountId: options.stripeAccountId,
  });
  if (moneyTransferTotalUsdMinor !== stripeBalanceTransactionTotalUsdMinor) {
    throw new StackAssertionError(deindent`
      Stripe balance transaction mismatch for project ${options.projectId}.
      Money transfers total USD ${formatMinorUnitsToMoneyString(moneyTransferTotalUsdMinor, 2)} vs Stripe balance transactions USD ${formatMinorUnitsToMoneyString(stripeBalanceTransactionTotalUsdMinor, 2)}.
    `, {
      projectId: options.projectId,
      moneyTransferTotalUsdMinor: moneyTransferTotalUsdMinor.toString(),
      stripeBalanceTransactionTotalUsdMinor: stripeBalanceTransactionTotalUsdMinor.toString(),
    });
  }
}

