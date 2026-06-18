import { fetchBulldozerServerJson } from "../src/lib/bulldozer-server-client";
import type { PrismaClientTransaction } from "../src/prisma-client";

export async function runBulldozerPaymentsInit(_prisma: PrismaClientTransaction) {
  await fetchBulldozerServerJson<{ success: true }>({
    method: "POST",
    path: "/internal/payments/init",
  });
}
