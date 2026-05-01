# Stack Auth migrations

Utilities for migrating users, organizations, memberships, password hashes, and OAuth accounts from other auth providers to Stack Auth.

## Better Auth

Better Auth is supported as a migration engine. This is useful when another provider, such as WorkOS or Clerk, already has a Better Auth migration path. Let Better Auth normalize the source provider's data into Better Auth model writes, but point those writes at Stack Auth migration persistence instead of a Better Auth database.

```ts
import { createBetterAuthStackPersistence } from "@stackframe/migrations";

const persistence = createBetterAuthStackPersistence();

// In your Better Auth migration script, replace ctx.adapter with
// persistence.adapter for all migration writes:
await persistence.adapter.create({
  model: "user",
  data: {
    id: "external-user-id",
    email: "user@example.com",
    emailVerified: true,
    name: "User Name",
  },
});

await persistence.flushToStackAuth({
  apiUrl: "http://localhost:8102",
  projectId: process.env.STACK_PROJECT_ID!,
  secretServerKey: process.env.STACK_SECRET_SERVER_KEY!,
});
```

The package captures Better Auth `user`, `account`, `organization`, and `member` writes, converts them into Stack Auth users, OAuth accounts, teams, and memberships, and imports them through Stack Auth's server REST API.
