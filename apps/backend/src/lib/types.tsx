import { PrismaClient } from "@prisma/client";

export type PrismaTransaction = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
