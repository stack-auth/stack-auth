import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

function getDatabaseConnectionStringEnvVarName() {
  const hexclaveValue = process.env.HEXCLAVE_DATABASE_CONNECTION_STRING;
  const stackValue = process.env.STACK_DATABASE_CONNECTION_STRING;
  if (hexclaveValue && stackValue && hexclaveValue !== stackValue) {
    throw new Error("Environment variables HEXCLAVE_DATABASE_CONNECTION_STRING and STACK_DATABASE_CONNECTION_STRING are both set to different values. Remove one of them or set them to the same value.");
  }
  return hexclaveValue ? 'HEXCLAVE_DATABASE_CONNECTION_STRING' : 'STACK_DATABASE_CONNECTION_STRING';
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'pnpm run db-seed-script',
  },
  datasource: {
    // Hexclave rebrand: prefer the canonical name, fall back to the legacy one
    // (empty counts as unset — the checked-in .env templates define empty placeholders).
    // eslint-disable-next-line no-restricted-properties
    url: env(getDatabaseConnectionStringEnvVarName()),
  },
  experimental: {
    externalTables: true,
  },
  tables: {
    external: [
      "public.BulldozerStorageEngine",
      // PK on JSONB[] (tableStoragePath) — not expressible via Prisma's @id
      // (list types are treated as non-required). Managed entirely by
      // bulldozer code via raw SQL. See schema.prisma note next to the
      // BulldozerTimeFoldMetadata model.
      "public.BulldozerTimeFoldDownstreamCascade",
    ],
  },
})
