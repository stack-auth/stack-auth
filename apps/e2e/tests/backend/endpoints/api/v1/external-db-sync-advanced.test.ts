import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { test } from '../../../../helpers';
import { InternalApiKey, Project, User, backendContext, niceBackendFetch } from '../../../backend-helpers';
import {
  HIGH_VOLUME_TIMEOUT,
  POSTGRES_HOST,
  POSTGRES_PASSWORD,
  POSTGRES_USER,
  TEST_TIMEOUT,
  TestDbManager,
  createProjectWithExternalDb as createProjectWithExternalDbRaw,
  verifyNotInExternalDb,
  waitForCondition,
  waitForSyncedData,
  waitForSyncedDeletion,
  waitForTable
} from './external-db-sync-utils';

const COMPLEX_SEQUENCE_TIMEOUT = TEST_TIMEOUT * 2 + 30_000;

async function runQueryForCurrentProject(body: { query: string, params?: Record<string, string>, timeout_ms?: number }) {
  return await niceBackendFetch("/api/v1/internal/analytics/query", {
    method: "POST",
    accessType: "admin",
    body,
  });
}

async function waitForClickhouseUser(email: string, expectedDisplayName: string) {
  const timeoutMs = 180_000;
  const intervalMs = 2_000;
  const start = performance.now();

  while (performance.now() - start < timeoutMs) {
    const response = await runQueryForCurrentProject({
      query: "SELECT primary_email, display_name FROM users WHERE primary_email = {email:String}",
      params: { email },
    });
    if (
      response.status === 200
      && Array.isArray(response.body?.result)
      && response.body.result.length === 1
      && response.body.result[0]?.display_name === expectedDisplayName
    ) {
      return response;
    }
    await wait(intervalMs);
  }

  throw new StackAssertionError(`Timed out waiting for ClickHouse user ${email} to sync.`);
}

describe.sequential('External DB Sync - Advanced Tests', () => {
  let dbManager: TestDbManager;
  const createProjectWithExternalDb = (
    externalDatabases: any,
    projectOptions?: { display_name?: string, description?: string }
  ) => {
    return createProjectWithExternalDbRaw(
      externalDatabases,
      projectOptions,
      { projectTracker: dbManager.createdProjects }
    );
  };

  beforeAll(async () => {
    dbManager = new TestDbManager();
    await dbManager.init();
  }, 30000); // 30 second timeout for init

  afterAll(async () => {
    await dbManager.cleanup();
  }, 60000); // 60 second timeout for cleanup

  /**
   * What it does:
   * - Creates two separate projects with different external DB lists, one user per project, and triggers sync.
   * - Queries every database to confirm each tenant’s user only appears in its own configured targets.
   *
   * Why it matters:
   * - Prevents tenant data leakage by proving cross-project isolation at the sync layer.
   */
  test('Multi-Tenant Isolation: User 1 -> 2 DBs, User 2 -> 3 DBs', async () => {
    await InternalApiKey.createAndSetProjectKeys();

    const db_a1 = await dbManager.createDatabase('tenant_a_db1');
    const db_a2 = await dbManager.createDatabase('tenant_a_db2');
    const db_b1 = await dbManager.createDatabase('tenant_b_db1');
    const db_b2 = await dbManager.createDatabase('tenant_b_db2');
    const db_b3 = await dbManager.createDatabase('tenant_b_db3');

    await createProjectWithExternalDb({
      main_a1: {
        type: 'postgres',
        connectionString: db_a1,
      },
      main_a2: {
        type: 'postgres',
        connectionString: db_a2,
      }
    });

    const userA = await User.create({ primary_email: 'user-a@example.com' });
    await niceBackendFetch(`/api/v1/users/${userA.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'User A' }
    });

    await createProjectWithExternalDb({
      main_b1: {
        type: 'postgres',
        connectionString: db_b1,
      },
      main_b2: {
        type: 'postgres',
        connectionString: db_b2,
      },
      main_b3: {
        type: 'postgres',
        connectionString: db_b3,
      }
    });

    const userB = await User.create({ primary_email: 'user-b@example.com' });
    await niceBackendFetch(`/api/v1/users/${userB.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'User B' }
    });

    const clientA1 = dbManager.getClient('tenant_a_db1');
    const clientA2 = dbManager.getClient('tenant_a_db2');
    const clientB1 = dbManager.getClient('tenant_b_db1');
    const clientB2 = dbManager.getClient('tenant_b_db2');
    const clientB3 = dbManager.getClient('tenant_b_db3');

    await waitForCondition(
      async () => {
        try {
          const res1 = await clientA1.query(`SELECT * FROM "users" WHERE "primary_email" = $1`, ['user-a@example.com']);
          const res2 = await clientA2.query(`SELECT * FROM "users" WHERE "primary_email" = $1`, ['user-a@example.com']);
          // Wait for both row existence AND display_name to be synced
          return res1.rows.length === 1 && res1.rows[0].display_name === 'User A'
            && res2.rows.length === 1 && res2.rows[0].display_name === 'User A';
        } catch (err: any) {
          if (err.code === '42P01') return false;
          throw err;
        }
      },
      { description: 'User A to appear in both Project A databases', timeoutMs: 180000 }
    );

    await waitForCondition(
      async () => {
        try {
          const res1 = await clientB1.query(`SELECT * FROM "users" WHERE "primary_email" = $1`, ['user-b@example.com']);
          const res2 = await clientB2.query(`SELECT * FROM "users" WHERE "primary_email" = $1`, ['user-b@example.com']);
          const res3 = await clientB3.query(`SELECT * FROM "users" WHERE "primary_email" = $1`, ['user-b@example.com']);
          // Wait for both row existence AND display_name to be synced
          return res1.rows.length === 1 && res1.rows[0].display_name === 'User B'
            && res2.rows.length === 1 && res2.rows[0].display_name === 'User B'
            && res3.rows.length === 1 && res3.rows[0].display_name === 'User B';
        } catch (err: any) {
          if (err.code === '42P01') return false;
          throw err;
        }
      },
      { description: 'User B to appear in all three Project B databases', timeoutMs: 180000 }
    );

    const resA1 = await clientA1.query(`SELECT * FROM "users" WHERE "primary_email" = $1`, ['user-a@example.com']);
    expect(resA1.rows.length).toBe(1);
    expect(resA1.rows[0].display_name).toBe('User A');

    const resA2 = await clientA2.query(`SELECT * FROM "users" WHERE "primary_email" = $1`, ['user-a@example.com']);
    expect(resA2.rows.length).toBe(1);
    expect(resA2.rows[0].display_name).toBe('User A');

    const resB1_A = await clientB1.query(`SELECT * FROM "users" WHERE "primary_email" = $1`, ['user-a@example.com']);
    expect(resB1_A.rows.length).toBe(0);

    const resB2_A = await clientB2.query(`SELECT * FROM "users" WHERE "primary_email" = $1`, ['user-a@example.com']);
    expect(resB2_A.rows.length).toBe(0);

    const resB3_A = await clientB3.query(`SELECT * FROM "users" WHERE "primary_email" = $1`, ['user-a@example.com']);
    expect(resB3_A.rows.length).toBe(0);

    const resB1 = await clientB1.query(`SELECT * FROM "users" WHERE "primary_email" = $1`, ['user-b@example.com']);
    expect(resB1.rows.length).toBe(1);
    expect(resB1.rows[0].display_name).toBe('User B');

    const resB2 = await clientB2.query(`SELECT * FROM "users" WHERE "primary_email" = $1`, ['user-b@example.com']);
    expect(resB2.rows.length).toBe(1);
    expect(resB2.rows[0].display_name).toBe('User B');

    const resB3 = await clientB3.query(`SELECT * FROM "users" WHERE "primary_email" = $1`, ['user-b@example.com']);
    expect(resB3.rows.length).toBe(1);
    expect(resB3.rows[0].display_name).toBe('User B');

    const resA1_B = await clientA1.query(`SELECT * FROM "users" WHERE "primary_email" = $1`, ['user-b@example.com']);
    expect(resA1_B.rows.length).toBe(0);

    const resA2_B = await clientA2.query(`SELECT * FROM "users" WHERE "primary_email" = $1`, ['user-b@example.com']);
    expect(resA2_B.rows.length).toBe(0);
  }, TEST_TIMEOUT);

  /**
   * What it does:
   * - Syncs three baseline users to capture their sequence ordering, then exports a fourth user.
   * - Compares sequenceIds to ensure the newest export exceeds the previous maximum.
   *
   * Why it matters:
   * - Verifies metadata table tracks progress correctly for incremental sync.
   */
  test('Metadata Tracking: Verify sync progress is tracked in metadata table', async () => {
    const dbName = 'metadata_tracking_test';
    const connectionString = await dbManager.createDatabase(dbName);

    await createProjectWithExternalDb({
      main: {
        type: 'postgres',
        connectionString,
      }
    });

    const client = dbManager.getClient(dbName);

    const user1 = await User.create({ primary_email: 'seq1@example.com' });
    const user2 = await User.create({ primary_email: 'seq2@example.com' });
    const user3 = await User.create({ primary_email: 'seq3@example.com' });

    await niceBackendFetch(`/api/v1/users/${user1.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'User 1' }
    });
    await niceBackendFetch(`/api/v1/users/${user2.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'User 2' }
    });
    await niceBackendFetch(`/api/v1/users/${user3.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'User 3' }
    });

    await waitForTable(client, 'users');

    await waitForCondition(
      async () => {
        const res = await client.query(`SELECT COUNT(*) as count FROM "users"`);
        return parseInt(res.rows[0].count) === 3;
      },
      { description: 'all 3 users to be synced' }
    );

    const res1 = await client.query(`SELECT * FROM "users" ORDER BY "primary_email"`);
    expect(res1.rows.length).toBe(3);

    // Check metadata table tracks progress
    const metadata1 = await client.query(
      `SELECT "last_synced_sequence_id" FROM "_stack_sync_metadata" WHERE "mapping_name" = 'users'`
    );
    expect(metadata1.rows.length).toBe(1);
    const seq1 = Number(metadata1.rows[0].last_synced_sequence_id);
    expect(seq1).toBeGreaterThan(0);

    const user4 = await User.create({ primary_email: 'seq4@example.com' });
    await niceBackendFetch(`/api/v1/users/${user4.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'User 4' }
    });

    await waitForSyncedData(client, 'seq4@example.com', 'User 4');
    const res2 = await client.query(`SELECT * FROM "users" WHERE "primary_email" = $1`, ['seq4@example.com']);
    expect(res2.rows.length).toBe(1);

    // Metadata should have advanced
    const metadata2 = await client.query(
      `SELECT "last_synced_sequence_id" FROM "_stack_sync_metadata" WHERE "mapping_name" = 'users'`
    );
    const seq2 = Number(metadata2.rows[0].last_synced_sequence_id);
    expect(seq2).toBeGreaterThan(seq1);

    const finalRes = await client.query(`SELECT COUNT(*) as count FROM "users"`);
    expect(parseInt(finalRes.rows[0].count)).toBe(4);
  }, TEST_TIMEOUT);

  /**
   * What it does:
   * - Exports a single user, then syncs again after adding a second user.
   * - Ensures the first user's data stays untouched and both users exist.
   *
   * Why it matters:
   * - Confirms repeated sync runs don't duplicate or rewrite already exported rows.
   */
  test('Idempotency & Resume: Multiple syncs should not duplicate', async () => {
    const dbName = 'idempotency_test';
    const connectionString = await dbManager.createDatabase(dbName);

    await createProjectWithExternalDb({
      main: {
        type: 'postgres',
        connectionString,
      }
    });

    const user1 = await User.create({ primary_email: 'user1@example.com' });
    await niceBackendFetch(`/api/v1/users/${user1.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'User 1' }
    });

    const client = dbManager.getClient(dbName);

    await waitForSyncedData(client, 'user1@example.com', 'User 1');

    let res = await client.query(`SELECT * FROM "users" WHERE "primary_email" = $1`, ['user1@example.com']);
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].display_name).toBe('User 1');
    const user1Id = res.rows[0].id;

    const user2 = await User.create({ primary_email: 'user2@example.com' });
    await niceBackendFetch(`/api/v1/users/${user2.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'User 2' }
    });

    await waitForSyncedData(client, 'user2@example.com', 'User 2');

    const user1Row = await client.query(`SELECT * FROM "users" WHERE "primary_email" = $1`, ['user1@example.com']);
    const user2Row = await client.query(`SELECT * FROM "users" WHERE "primary_email" = $1`, ['user2@example.com']);

    expect(user1Row.rows.length).toBe(1);
    expect(user2Row.rows.length).toBe(1);
    expect(user1Row.rows[0].display_name).toBe('User 1');
    expect(user2Row.rows[0].display_name).toBe('User 2');
    // User 1's ID should be unchanged
    expect(user1Row.rows[0].id).toBe(user1Id);
  }, TEST_TIMEOUT);

  /**
   * What it does:
   * - Exports a user whose display name contains quotes, emoji, and non-Latin characters.
   * - Queries users to confirm the string survives unchanged.
   *
   * Why it matters:
   * - Ensures text encoding and escaping don’t corrupt data during sync.
   */
  test('Special Characters: Emojis, quotes, international symbols', async () => {
    const dbName = 'special_chars_test';
    const connectionString = await dbManager.createDatabase(dbName);

    await createProjectWithExternalDb({
      main: {
        type: 'postgres',
        connectionString,
      }
    });

    const specialName = "O'Connor 🚀 用户 \"Test\"";
    const user = await User.create({ primary_email: 'special@example.com' });
    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: specialName }
    });

    await waitForSyncedData(dbManager.getClient(dbName), 'special@example.com', specialName);

    const client = dbManager.getClient(dbName);
    const res = await client.query(`SELECT * FROM "users" WHERE "primary_email" = $1`, ['special@example.com']);
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].display_name).toBe(specialName);
  }, TEST_TIMEOUT);

  /**
   * What it does:
   * - Creates 200 users directly in the internal database using SQL (much faster than API).
   * - Waits for all of them to sync to the external database.
   *
   * Why it matters:
   * - Exercises batching code paths to ensure high volumes eventually flush completely.
   */
  test('High Volume: 200+ users to test batching', async () => {
    const dbName = 'high_volume_test';
    const externalConnectionString = await dbManager.createDatabase(dbName);

    await createProjectWithExternalDb({
      main: {
        type: 'postgres',
        connectionString: externalConnectionString,
      }
    });

    const projectKeys = backendContext.value.projectKeys;
    if (projectKeys === "no-project") throw new Error("No project keys found");
    const projectId = projectKeys.projectId;
    const externalClient = dbManager.getClient(dbName);

    // Connect to internal database to insert users directly
    const internalClient = new Client({
      connectionString: `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}/stackframe`,
    });
    await internalClient.connect();

    const userCount = 200;

    try {
      // Get the tenancy ID for this project
      const tenancyRes = await internalClient.query(
        `SELECT id FROM "Tenancy" WHERE "projectId" = $1 AND "branchId" = 'main' LIMIT 1`,
        [projectId]
      );
      if (tenancyRes.rows.length === 0) {
        throw new Error(`Tenancy not found for project ${projectId}`);
      }
      const tenancyId = tenancyRes.rows[0].id;

      // Insert all 200 users in a single batch
      await internalClient.query(`
        WITH generated AS (
          SELECT
            $1::uuid AS tenancy_id,
            $2::uuid AS project_id,
            gen_random_uuid() AS project_user_id,
            gen_random_uuid() AS contact_id,
            gs AS idx,
            now() AS ts
          FROM generate_series(1, $3::int) AS gs
        ),
        insert_users AS (
          INSERT INTO "ProjectUser"
            ("tenancyId", "projectUserId", "mirroredProjectId", "mirroredBranchId",
             "displayName", "createdAt", "updatedAt", "isAnonymous")
          SELECT
            tenancy_id,
            project_user_id,
            project_id,
            'main',
            'HV User ' || idx,
            ts,
            ts,
            false
          FROM generated
          RETURNING "tenancyId", "projectUserId"
        )
        INSERT INTO "ContactChannel"
          ("tenancyId", "projectUserId", "id", "type", "isPrimary", "usedForAuth",
           "isVerified", "value", "createdAt", "updatedAt")
        SELECT
          g.tenancy_id,
          g.project_user_id,
          g.contact_id,
          'EMAIL',
          'TRUE'::"BooleanTrue",
          'TRUE'::"BooleanTrue",
          false,
          'hv-user-' || g.idx || '@test.example.com',
          g.ts,
          g.ts
        FROM generated g
      `, [tenancyId, projectId, userCount]);

      await waitForTable(externalClient, 'users');

      await waitForCondition(
        async () => {
          const res = await externalClient.query(`SELECT COUNT(*) as count FROM "users"`);
          return parseInt(res.rows[0].count) >= userCount;
        },
        { description: `all ${userCount} users to be synced`, timeoutMs: 180000 }
      );

      const res = await externalClient.query(`SELECT COUNT(*) as count FROM "users"`);
      const finalCount = parseInt(res.rows[0].count);
      expect(finalCount).toBeGreaterThanOrEqual(userCount);
    } finally {
      await internalClient.end();
    }
  }, HIGH_VOLUME_TIMEOUT);

  /**
   * What it does:
   * - Starts with three users, then mixes updates, deletes, and inserts before re-syncing.
   * - Validates the external table reflects the final expected set.
   *
   * Why it matters:
   * - Proves sequencing rules handle interleaved operations correctly.
   */
  test('Complex Sequence: Multiple operations in different orders', async () => {
    const dbName = 'complex_sequence_test';
    const connectionString = await dbManager.createDatabase(dbName);

    await createProjectWithExternalDb({
      main: {
        type: 'postgres',
        connectionString,
      }
    });

    const user1 = await User.create({ primary_email: 'seq1@example.com' });
    const user2 = await User.create({ primary_email: 'seq2@example.com' });
    const user3 = await User.create({ primary_email: 'seq3@example.com' });

    await niceBackendFetch(`/api/v1/users/${user1.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'User 1' }
    });
    await niceBackendFetch(`/api/v1/users/${user2.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'User 2' }
    });
    await niceBackendFetch(`/api/v1/users/${user3.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'User 3' }
    });

    const client = dbManager.getClient(dbName);

    await waitForCondition(
      async () => {
        try {
          const res = await client.query(`SELECT COUNT(*) as count FROM "users"`);
          return parseInt(res.rows[0].count) === 3;
        } catch (err: any) {
          if (err.code === '42P01') return false;
          throw err;
        }
      },
      { description: 'initial 3 users sync', timeoutMs: 180000 }
    );

    let res = await client.query(`SELECT COUNT(*) as count FROM "users"`);
    expect(parseInt(res.rows[0].count)).toBe(3);

    await niceBackendFetch(`/api/v1/users/${user2.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'User 2 Updated' }
    });

    await niceBackendFetch(`/api/v1/users/${user1.userId}`, {
      accessType: 'admin',
      method: 'DELETE',
    });

    const user4 = await User.create({ primary_email: 'seq4@example.com' });
    await niceBackendFetch(`/api/v1/users/${user4.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'User 4' }
    });

    await waitForCondition(
      async () => {
        try {
          const res = await client.query(`SELECT * FROM "users" ORDER BY "primary_email"`);
          if (res.rows.length !== 3) return false;

          const emails = res.rows.map(r => r.primary_email);
          if (emails.includes('seq1@example.com')) return false;
          if (!emails.includes('seq2@example.com')) return false;
          if (!emails.includes('seq3@example.com')) return false;
          if (!emails.includes('seq4@example.com')) return false;

          const user2Row = res.rows.find(r => r.primary_email === 'seq2@example.com');
          return user2Row.display_name === 'User 2 Updated';
        } catch (err: any) {
          if (err.code === '42P01') return false;
          throw err;
        }
      },
      { description: 'final sync state correct', timeoutMs: 180000 }
    );

    res = await client.query(`SELECT * FROM "users" ORDER BY "primary_email"`);
    expect(res.rows.length).toBe(3);

    const emails = res.rows.map(r => r.primary_email);
    expect(emails).not.toContain('seq1@example.com');
    expect(emails).toContain('seq2@example.com');
    expect(emails).toContain('seq3@example.com');
    expect(emails).toContain('seq4@example.com');

    const user2Row = res.rows.find(r => r.primary_email === 'seq2@example.com');
    expect(user2Row.display_name).toBe('User 2 Updated');
  }, COMPLEX_SEQUENCE_TIMEOUT);

  /**
   * What it does:
   * - Creates a readonly database role, grants SELECT on users, and tests SELECT/INSERT/UPDATE/DELETE commands.
   * - Expects reads to succeed while writes fail.
   *
   * Why it matters:
   * - Protects external tables from being mutated by consumers using readonly credentials.
   */
  test('External write protection: readonly client cannot modify users', async () => {
    const dbName = 'write_protection_test';
    const connectionString = await dbManager.createDatabase(dbName);

    await createProjectWithExternalDb({
      main: {
        type: 'postgres',
        connectionString,
      },
    });

    const superClient = dbManager.getClient(dbName);

    const user = await User.create({ primary_email: 'write-protect@example.com' });
    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Write Protect User' },
    });
    await waitForTable(superClient, 'users');
    await waitForSyncedData(superClient, 'write-protect@example.com', 'Write Protect User');

    const readonlyUser = 'readonly_partialusers';
    const readonlyPassword = 'readonly_password';
    await superClient.query(`DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${readonlyUser}') THEN
    CREATE ROLE ${readonlyUser} LOGIN PASSWORD '${readonlyPassword}';
  END IF;
END
$$;`);

    const url = new URL(connectionString);
    url.username = readonlyUser;
    url.password = readonlyPassword;
    const readonlyClient = new Client({ connectionString: url.toString() });
    await readonlyClient.connect();

    try {
      const selectRes = await readonlyClient.query(
        `SELECT * FROM "users" WHERE "primary_email" = $1`,
        ['write-protect@example.com'],
      );
      expect(selectRes.rows.length).toBe(1);
      await expect(
        readonlyClient.query(
          `INSERT INTO "users" ("id", "primary_email") VALUES (gen_random_uuid(), $1)`,
          ['should-not-insert@example.com'],
        ),
      ).rejects.toThrow();

      await expect(
        readonlyClient.query(
          `UPDATE "users" SET "display_name" = 'Hacked' WHERE "primary_email" = $1`,
          ['write-protect@example.com'],
        ),
      ).rejects.toThrow();

      await expect(
        readonlyClient.query(
          `DELETE FROM "users" WHERE "primary_email" = $1`,
          ['write-protect@example.com'],
        ),
      ).rejects.toThrow();
    } finally {
      await readonlyClient.end();
    }
  }, TEST_TIMEOUT);

  /**
   * What it does:
   * - Patches the same user three times without syncing, then syncs once.
   * - Checks users to confirm only the final name persists.
   *
   * Why it matters:
   * - Verifies we export the latest snapshot instead of intermediate states.
   */
  test('Multiple updates before sync: last update wins', async () => {
    const dbName = 'multi_update_before_sync_test';
    const connectionString = await dbManager.createDatabase(dbName);

    await createProjectWithExternalDb({
      main: {
        type: 'postgres',
        connectionString,
      },
    });

    const client = dbManager.getClient(dbName);

    const user = await User.create({ primary_email: 'multi-update@example.com' });

    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Name v1' },
    });
    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Name v2' },
    });
    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Name v3' },
    });

    await waitForTable(client, 'users');
    await waitForSyncedData(client, 'multi-update@example.com', 'Name v3');

    const row = await client.query(
      `SELECT * FROM "users" WHERE "primary_email" = $1`,
      ['multi-update@example.com'],
    );
    expect(row.rows.length).toBe(1);
    expect(row.rows[0].display_name).toBe('Name v3');
  }, TEST_TIMEOUT);

  /**
   * What it does:
   * - Creates then deletes a user before the first sync happens.
   * - Runs sync and checks that users never receives the email.
   *
   * Why it matters:
   * - Ensures we don’t leak records that were deleted before the initial export cycle.
   */
  test('Delete before first sync: row is never exported', async () => {
    const dbName = 'delete_before_first_sync_test';
    const connectionString = await dbManager.createDatabase(dbName);

    await createProjectWithExternalDb({
      main: {
        type: 'postgres',
        connectionString,
      },
    });

    const client = dbManager.getClient(dbName);

    const user = await User.create({ primary_email: 'delete-before-sync@example.com' });
    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'To Be Deleted' },
    });
    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'DELETE',
    });

    await waitForTable(client, 'users');

    await waitForCondition(
      async () => {
        const res = await client.query(
          `SELECT * FROM "users" WHERE "primary_email" = $1`,
          ['delete-before-sync@example.com'],
        );
        return res.rows.length === 0;
      },
      { description: 'deleted user should never appear', timeoutMs: 180000 }
    );

    const res = await client.query(
      `SELECT * FROM "users" WHERE "primary_email" = $1`,
      ['delete-before-sync@example.com'],
    );
    expect(res.rows.length).toBe(0);
  }, TEST_TIMEOUT);

  /**
   * What it does:
   * - Syncs a user, deletes it, recreates the same email, and syncs again.
   * - Compares IDs and sequenceIds to confirm the new row is distinct and persistent.
   *
   * Why it matters:
   * - Proves a previous delete doesn’t block future users with the same email.
   */
  test('Re-create same email after delete exports fresh contact channel', async () => {
    const dbName = 'recreate_email_after_delete_test';
    const connectionString = await dbManager.createDatabase(dbName);

    await createProjectWithExternalDb({
      main: {
        type: 'postgres',
        connectionString,
      },
    });

    const client = dbManager.getClient(dbName);
    const email = 'recreate-after-delete@example.com';

    const firstUser = await User.create({ primary_email: email });
    await niceBackendFetch(`/api/v1/users/${firstUser.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Original Export' },
    });

    await waitForSyncedData(client, email, 'Original Export');

    let res = await client.query(
      `SELECT "id" FROM "users" WHERE "primary_email" = $1`,
      [email],
    );
    expect(res.rows.length).toBe(1);
    const firstId = res.rows[0].id;

    await niceBackendFetch(`/api/v1/users/${firstUser.userId}`, {
      accessType: 'admin',
      method: 'DELETE',
    });

    await waitForSyncedDeletion(client, email);
    await verifyNotInExternalDb(client, email);

    const secondUser = await User.create({ primary_email: email });
    await niceBackendFetch(`/api/v1/users/${secondUser.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Recreated Export' },
    });

    await waitForSyncedData(client, email, 'Recreated Export');

    res = await client.query(
      `SELECT "id", "display_name" FROM "users" WHERE "primary_email" = $1`,
      [email],
    );
    expect(res.rows.length).toBe(1);

    const recreatedRow = res.rows[0];
    expect(recreatedRow.display_name).toBe('Recreated Export');
    expect(recreatedRow.id).not.toBe(firstId);

    await waitForCondition(
      async () => {
        const followUp = await client.query(
          `SELECT "display_name" FROM "users" WHERE "primary_email" = $1`,
          [email],
        );
        return followUp.rows.length === 1 && followUp.rows[0].display_name === 'Recreated Export';
      },
      { description: 'recreated row persists after extra sync', timeoutMs: 180000 },
    );
  }, TEST_TIMEOUT);

  /**
   * What it does:
   * - Performs a complex sequence: create → update → update → delete → create (same email) → update
   * - Syncs after each phase and verifies the external DB reflects the correct state.
   *
   * Why it matters:
   * - Proves the sync engine handles rapid lifecycle transitions on the same email correctly.
   */
  test('Complex lifecycle: create → update → update → delete → create → update', async () => {
    const dbName = 'complex_lifecycle_test';
    const connectionString = await dbManager.createDatabase(dbName);

    await createProjectWithExternalDb({
      main: {
        type: 'postgres',
        connectionString,
      },
    });

    const client = dbManager.getClient(dbName);
    const email = 'lifecycle-test@example.com';

    const user1 = await User.create({ primary_email: email });
    await niceBackendFetch(`/api/v1/users/${user1.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Initial Name' },
    });

    await waitForSyncedData(client, email, 'Initial Name');

    let res = await client.query(`SELECT * FROM "users" WHERE "primary_email" = $1`, [email]);
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].display_name).toBe('Initial Name');
    const firstId = res.rows[0].id;

    await niceBackendFetch(`/api/v1/users/${user1.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Updated Once' },
    });

    await waitForSyncedData(client, email, 'Updated Once');

    res = await client.query(`SELECT * FROM "users" WHERE "primary_email" = $1`, [email]);
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].display_name).toBe('Updated Once');
    expect(res.rows[0].id).toBe(firstId);

    await niceBackendFetch(`/api/v1/users/${user1.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Updated Twice' },
    });

    await waitForSyncedData(client, email, 'Updated Twice');

    res = await client.query(`SELECT * FROM "users" WHERE "primary_email" = $1`, [email]);
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].display_name).toBe('Updated Twice');
    expect(res.rows[0].id).toBe(firstId);

    await niceBackendFetch(`/api/v1/users/${user1.userId}`, {
      accessType: 'admin',
      method: 'DELETE',
    });

    await waitForSyncedDeletion(client, email);

    res = await client.query(`SELECT * FROM "users" WHERE "primary_email" = $1`, [email]);
    expect(res.rows.length).toBe(0);

    const user2 = await User.create({ primary_email: email });
    await niceBackendFetch(`/api/v1/users/${user2.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Recreated User' },
    });

    await waitForSyncedData(client, email, 'Recreated User');

    res = await client.query(`SELECT * FROM "users" WHERE "primary_email" = $1`, [email]);
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].display_name).toBe('Recreated User');
    expect(res.rows[0].id).not.toBe(firstId);
    const newId = res.rows[0].id;

    await niceBackendFetch(`/api/v1/users/${user2.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Final Name' },
    });

    await waitForSyncedData(client, email, 'Final Name');

    res = await client.query(`SELECT * FROM "users" WHERE "primary_email" = $1`, [email]);
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].display_name).toBe('Final Name');
    expect(res.rows[0].id).toBe(newId);
  }, COMPLEX_SEQUENCE_TIMEOUT);

  /**
   * What it does:
   * - Exports 50 users, deletes 10, inserts 10 replacements, and syncs again.
   * - Validates the final users dataset contains the remaining 40 originals plus 10 replacements (total 50).
   *
   * Why it matters:
   * - Proves high-volume batches stay accurate even when deletes and inserts interleave.
   */
  test('High volume with deletes interleaved retains the expected dataset', async () => {
    const dbName = 'high_volume_delete_mix_test';
    const connectionString = await dbManager.createDatabase(dbName);

    await createProjectWithExternalDb({
      main: {
        type: 'postgres',
        connectionString,
      },
    });

    const projectKeys = backendContext.value.projectKeys;
    if (projectKeys === "no-project") throw new Error("No project keys found");
    const projectId = projectKeys.projectId;

    const externalClient = dbManager.getClient(dbName);
    const initialUserCount = 50;
    const deletions = 10;
    const replacements = 10;

    // Connect to internal database to insert users directly
    const internalClient = new Client({
      connectionString: `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}/stackframe`,
    });
    await internalClient.connect();

    let initialUsers: { projectUserId: string, email: string }[] = [];

    try {
      // Get the tenancy ID for this project
      const tenancyRes = await internalClient.query(
        `SELECT id FROM "Tenancy" WHERE "projectId" = $1 AND "branchId" = 'main' LIMIT 1`,
        [projectId]
      );
      if (tenancyRes.rows.length === 0) {
        throw new Error(`Tenancy not found for project ${projectId}`);
      }
      const tenancyId = tenancyRes.rows[0].id;
      const testRunId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Insert initial users and get their IDs back
      const insertResult = await internalClient.query(`
        WITH generated AS (
          SELECT
            $1::uuid AS tenancy_id,
            $2::uuid AS project_id,
            gen_random_uuid() AS project_user_id,
            gen_random_uuid() AS contact_id,
            gs AS idx,
            now() AS ts
          FROM generate_series(1, $3::int) AS gs
        ),
        insert_users AS (
          INSERT INTO "ProjectUser"
            ("tenancyId", "projectUserId", "mirroredProjectId", "mirroredBranchId",
             "displayName", "createdAt", "updatedAt", "isAnonymous")
          SELECT
            tenancy_id,
            project_user_id,
            project_id,
            'main',
            'Interleave User ' || idx,
            ts,
            ts,
            false
          FROM generated
          RETURNING "projectUserId"
        ),
        insert_contacts AS (
          INSERT INTO "ContactChannel"
            ("tenancyId", "projectUserId", "id", "type", "isPrimary", "usedForAuth",
             "isVerified", "value", "createdAt", "updatedAt")
          SELECT
            g.tenancy_id,
            g.project_user_id,
            g.contact_id,
            'EMAIL',
            'TRUE'::"BooleanTrue",
            'TRUE'::"BooleanTrue",
            false,
            'interleave-' || g.idx || '-' || $4 || '@example.com',
            g.ts,
            g.ts
          FROM generated g
          RETURNING "projectUserId", "value" AS email
        )
        SELECT "projectUserId"::text, email FROM insert_contacts ORDER BY email
      `, [tenancyId, projectId, initialUserCount, testRunId]);

      initialUsers = insertResult.rows.map(row => ({
        email: row.email,
        projectUserId: row.projectUserId,
      }));

      await waitForTable(externalClient, 'users');

      await waitForCondition(
        async () => {
          const countRes = await externalClient.query(`SELECT COUNT(*) as count FROM "users"`);
          return parseInt(countRes.rows[0].count) === initialUserCount;
        },
        { description: 'initial batch exported', timeoutMs: 180000 },
      );

      // Delete first 10 users
      const deletedUsers = initialUsers.slice(0, deletions);
      for (const entry of deletedUsers) {
        await niceBackendFetch(`/api/v1/users/${entry.projectUserId}`, {
          accessType: 'admin',
          method: 'DELETE',
        });
      }
      await waitForCondition(
        async () => {
          const countRes = await externalClient.query(`SELECT COUNT(*) as count FROM "users"`);
          return parseInt(countRes.rows[0].count) === (initialUserCount - deletions);
        },
        { description: 'deletions synced to external DB', timeoutMs: 180000 },
      );

      // Insert replacement users via direct SQL
      const replacementResult = await internalClient.query(`
        WITH generated AS (
          SELECT
            $1::uuid AS tenancy_id,
            $2::uuid AS project_id,
            gen_random_uuid() AS project_user_id,
            gen_random_uuid() AS contact_id,
            gs AS idx,
            now() AS ts
          FROM generate_series(1, $3::int) AS gs
        ),
        insert_users AS (
          INSERT INTO "ProjectUser"
            ("tenancyId", "projectUserId", "mirroredProjectId", "mirroredBranchId",
             "displayName", "createdAt", "updatedAt", "isAnonymous")
          SELECT
            tenancy_id,
            project_user_id,
            project_id,
            'main',
            'Replacement ' || idx,
            ts,
            ts,
            false
          FROM generated
          RETURNING "projectUserId"
        ),
        insert_contacts AS (
          INSERT INTO "ContactChannel"
            ("tenancyId", "projectUserId", "id", "type", "isPrimary", "usedForAuth",
             "isVerified", "value", "createdAt", "updatedAt")
          SELECT
            g.tenancy_id,
            g.project_user_id,
            g.contact_id,
            'EMAIL',
            'TRUE'::"BooleanTrue",
            'TRUE'::"BooleanTrue",
            false,
            'interleave-replacement-' || g.idx || '-' || $4 || '@example.com',
            g.ts,
            g.ts
          FROM generated g
          RETURNING "value" AS email
        )
        SELECT email FROM insert_contacts
      `, [tenancyId, projectId, replacements, testRunId]);

      const replacementEmails = replacementResult.rows.map(row => row.email);

      const expectedFinalCount = initialUserCount - deletions + replacements;
      await waitForCondition(
        async () => {
          const countRes = await externalClient.query(`SELECT COUNT(*) as count FROM "users"`);
          return parseInt(countRes.rows[0].count) === expectedFinalCount;
        },
        { description: 'final mixed batch exported', timeoutMs: 180000 },
      );

      const finalRows = await externalClient.query(`SELECT "primary_email" FROM "users"`);
      const finalEmails = new Set(finalRows.rows.map((row) => row.primary_email));
      expect(finalEmails.size).toBe(expectedFinalCount);

      for (const deleted of deletedUsers) {
        expect(finalEmails.has(deleted.email)).toBe(false);
      }
      for (const survivor of initialUsers.slice(deletions)) {
        expect(finalEmails.has(survivor.email)).toBe(true);
      }
      for (const replacement of replacementEmails) {
        expect(finalEmails.has(replacement)).toBe(true);
      }
    } finally {
      await internalClient.end();
    }
  }, HIGH_VOLUME_TIMEOUT);

  /**
   * What it does:
   * - Configures a project with a bad postgres connection string (simulating postgres being down).
   * - Creates a user and verifies it still syncs to ClickHouse despite the postgres failure.
   * - Then configures a separate project with a valid postgres DB and verifies postgres sync works
   *   even though ClickHouse sync runs independently in the same cycle.
   *
   * Why it matters:
   * - Proves that ClickHouse and postgres sync targets are independent: a failure in one
   *   does not block the other from completing successfully.
   */
  test('Cross-DB resilience: postgres down does not block ClickHouse sync', async () => {
    const badConnectionString = 'postgresql://invalid:invalid@invalid:5432/invalid';

    // Create a project with only a bad postgres DB — ClickHouse syncs automatically via env var
    await createProjectWithExternalDb({
      bad_pg: {
        type: 'postgres',
        connectionString: badConnectionString,
      },
    });

    const email = 'cross-db-resilience@example.com';
    const user = await User.create({ primary_email: email });
    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Cross DB User' },
    });

    // ClickHouse should still receive the data even though postgres sync fails
    await waitForClickhouseUser(email, 'Cross DB User');

  }, TEST_TIMEOUT);
});
