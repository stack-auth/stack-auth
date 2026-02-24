import { PrismaClientTransaction } from "@/prisma-client";
import { refundTransaction } from "../refund";
import { BuiltTransactionsList } from "./list";

export { refundTransaction };

export function getTransactionsPaginatedList(prisma: PrismaClientTransaction, tenancyId: string) {
  return new BuiltTransactionsList(prisma, tenancyId);
}
