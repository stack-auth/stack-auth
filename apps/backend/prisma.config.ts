import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'pnpm run db-seed-script',
  },
  datasource: {
    url: env('STACK_DATABASE_CONNECTION_STRING'),
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

