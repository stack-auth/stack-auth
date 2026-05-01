import { createBetterAuthStackPersistence } from "../src";

const clerkApiBaseUrl = "https://api.clerk.com/v1";
const userCount = 100;
const runId = `stack-migration-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
const importedPasswordHash = "$2a$10$TVyY/gpw9Db/w1fBeJkCgeNg2Rae2JfNqrPnSAKtj.ufAO5cVF13.";

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (value == null || value === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function clerkFetch(path: string, options: RequestInit = {}): Promise<unknown> {
  const secretKey = getRequiredEnv("CLERK_SECRET_KEY");
  const response = await fetch(`${clerkApiBaseUrl}${path}`, {
    ...options,
    headers: {
      "authorization": `Bearer ${secretKey}`,
      "content-type": "application/json",
      ...options.headers,
    },
  });

  const text = await response.text();
  const body = text === "" ? null : JSON.parse(text);
  if (!response.ok) {
    throw new Error(`Clerk ${options.method ?? "GET"} ${path} failed with ${response.status}: ${text}`);
  }
  return body;
}

function readObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error(`${label} must be an object`);
}

function readString(value: unknown, label: string): string {
  if (typeof value === "string") {
    return value;
  }
  throw new Error(`${label} must be a string`);
}

function readMaybeString(value: unknown, label: string): string | null {
  if (value == null) {
    return null;
  }
  return readString(value, label);
}

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  throw new Error(`${label} must be a boolean`);
}

function readDateIso(value: unknown, label: string): string {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`${label} must be a string or number timestamp`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label} is not a valid timestamp`);
  }
  return date.toISOString();
}

function readPrimaryEmail(user: Record<string, unknown>): { email: string, verified: boolean } {
  const primaryEmailAddressId = readString(user.primary_email_address_id, "primary_email_address_id");
  if (!Array.isArray(user.email_addresses)) {
    throw new Error("email_addresses must be an array");
  }

  const primaryEmail = user.email_addresses
    .map((email) => readObject(email, "email_address"))
    .find((email) => email.id === primaryEmailAddressId);
  if (primaryEmail == null) {
    throw new Error(`No primary email found for Clerk user ${String(user.id)}`);
  }

  return {
    email: readString(primaryEmail.email_address, "email_address.email_address"),
    verified: readString(readObject(primaryEmail.verification, "email_address.verification").status, "email_address.verification.status") === "verified",
  };
}

async function seedClerkUser(index: number): Promise<Record<string, unknown>> {
  const paddedIndex = String(index).padStart(3, "0");
  const externalId = `${runId}-${paddedIndex}`;
  return readObject(await clerkFetch("/users", {
    method: "POST",
    body: JSON.stringify({
      external_id: externalId,
      email_address: [`${externalId}@stack-generated.example.com`],
      first_name: "Stack",
      last_name: `Migration ${paddedIndex}`,
      password_digest: importedPasswordHash,
      password_hasher: "bcrypt",
      public_metadata: {
        stackMigrationRunId: runId,
        seedIndex: index,
      },
      private_metadata: {
        source: "clerk-test-seed",
      },
      skip_password_checks: true,
    }),
  }), "Clerk create user response");
}

async function seedClerkUsers(): Promise<Record<string, unknown>[]> {
  const users: Record<string, unknown>[] = [];
  for (let index = 0; index < userCount; index++) {
    users.push(await seedClerkUser(index));
    if ((index + 1) % 10 === 0) {
      console.log(`Seeded ${index + 1}/${userCount} Clerk users`);
      await wait(1200);
    }
  }
  return users;
}

async function main(): Promise<void> {
  const stackApiUrl = process.env.STACK_API_URL ?? "http://localhost:8102";
  const stackProjectId = process.env.STACK_PROJECT_ID ?? "internal";
  const stackSecretServerKey = process.env.STACK_SECRET_SERVER_KEY ?? "this-secret-server-key-is-for-local-development-only";
  const stackPublishableClientKey = process.env.STACK_PUBLISHABLE_CLIENT_KEY ?? "this-publishable-client-key-is-for-local-development-only";

  console.log(`Starting Clerk -> Better Auth persistence -> Stack Auth test run ${runId}`);
  const clerkUsers = await seedClerkUsers();

  const persistence = createBetterAuthStackPersistence();
  for (const clerkUser of clerkUsers) {
    const clerkUserId = readString(clerkUser.id, "Clerk user id");
    const externalId = readMaybeString(clerkUser.external_id, "Clerk external id") ?? clerkUserId;
    const primaryEmail = readPrimaryEmail(clerkUser);
    const firstName = readMaybeString(clerkUser.first_name, "first_name");
    const lastName = readMaybeString(clerkUser.last_name, "last_name");
    const displayName = [firstName, lastName].filter((value) => value != null && value !== "").join(" ") || null;

    await persistence.adapter.create({
      model: "user",
      data: {
        id: externalId,
        email: primaryEmail.email,
        emailVerified: primaryEmail.verified,
        name: displayName,
        image: readMaybeString(clerkUser.image_url, "image_url"),
        createdAt: readDateIso(clerkUser.created_at, "created_at"),
        updatedAt: readDateIso(clerkUser.updated_at, "updated_at"),
        banned: readBoolean(clerkUser.banned, "banned"),
      },
    });

    await persistence.adapter.create({
      model: "account",
      data: {
        id: `${externalId}-credential`,
        userId: externalId,
        accountId: externalId,
        providerId: "credential",
        password: importedPasswordHash,
      },
    });
  }

  const plan = persistence.buildPlan();
  console.log(`Built Stack Auth import plan: ${plan.users.length} users, ${plan.teams.length} teams, ${plan.memberships.length} memberships`);
  const result = await persistence.flushToStackAuth({
    apiUrl: stackApiUrl,
    projectId: stackProjectId,
    secretServerKey: stackSecretServerKey,
    publishableClientKey: stackPublishableClientKey,
  });
  console.log(`Imported ${result.userIdMap.size} users into Stack Auth internal project`);
  console.log(`Run id: ${runId}`);
}

await main();
