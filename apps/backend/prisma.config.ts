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
})

