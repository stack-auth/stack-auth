import { DEFAULT_DB_SYNC_MAPPINGS } from '@stackframe/stack-shared/dist/config/db-sync-mappings';
import { generateSecureRandomString } from '@stackframe/stack-shared/dist/utils/crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { test } from '../../../../helpers';
import { InternalApiKey, User, niceBackendFetch } from '../../../backend-helpers';
import {
  HIGH_VOLUME_TIMEOUT,
  TEST_TIMEOUT,
  TestDbManager,
  createProjectWithExternalDb,
  verifyNotInExternalDb,
  waitForCondition,
  waitForSyncedData,
  waitForSyncedDeletion,
  waitForTable
} from './external-db-sync-utils';

describe.sequential('External DB Sync - Advanced Tests', () => {
  let dbManager: TestDbManager;

  beforeAll(async () => {
    dbManager = new TestDbManager();
    await dbManager.init();
  });

  afterAll(async () => {
    await dbManager.cleanup();
  });

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

    const userA = await User.create({ emailAddress: 'user-a@example.com' });
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

    const userB = await User.create({ emailAddress: 'user-b@example.com' });
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
          const res1 = await clientA1.query(`SELECT * FROM "PartialUsers" WHERE "value" = $1`, ['user-a@example.com']);
          const res2 = await clientA2.query(`SELECT * FROM "PartialUsers" WHERE "value" = $1`, ['user-a@example.com']);
          return res1.rows.length === 1 && res2.rows.length === 1;
        } catch (err: any) {
          if (err.code === '42P01') return false;
          throw err;
        }
      },
      { description: 'User A to appear in both Project A databases', timeoutMs: 90000 }
    );

    await waitForCondition(
      async () => {
        try {
          const res1 = await clientB1.query(`SELECT * FROM "PartialUsers" WHERE "value" = $1`, ['user-b@example.com']);
          const res2 = await clientB2.query(`SELECT * FROM "PartialUsers" WHERE "value" = $1`, ['user-b@example.com']);
          const res3 = await clientB3.query(`SELECT * FROM "PartialUsers" WHERE "value" = $1`, ['user-b@example.com']);
          return res1.rows.length === 1 && res2.rows.length === 1 && res3.rows.length === 1;
        } catch (err: any) {
          if (err.code === '42P01') return false;
          throw err;
        }
      },
      { description: 'User B to appear in all three Project B databases', timeoutMs: 90000 }
    );

    const resA1 = await clientA1.query(`SELECT * FROM "PartialUsers" WHERE "value" = $1`, ['user-a@example.com']);
    expect(resA1.rows.length).toBe(1);
    expect(resA1.rows[0].displayName).toBe('User A');

    const resA2 = await clientA2.query(`SELECT * FROM "PartialUsers" WHERE "value" = $1`, ['user-a@example.com']);
    expect(resA2.rows.length).toBe(1);
    expect(resA2.rows[0].displayName).toBe('User A');

    const resB1_A = await clientB1.query(`SELECT * FROM "PartialUsers" WHERE "value" = $1`, ['user-a@example.com']);
    expect(resB1_A.rows.length).toBe(0);

    const resB2_A = await clientB2.query(`SELECT * FROM "PartialUsers" WHERE "value" = $1`, ['user-a@example.com']);
    expect(resB2_A.rows.length).toBe(0);

    const resB3_A = await clientB3.query(`SELECT * FROM "PartialUsers" WHERE "value" = $1`, ['user-a@example.com']);
    expect(resB3_A.rows.length).toBe(0);

    const resB1 = await clientB1.query(`SELECT * FROM "PartialUsers" WHERE "value" = $1`, ['user-b@example.com']);
    expect(resB1.rows.length).toBe(1);
    expect(resB1.rows[0].displayName).toBe('User B');

    const resB2 = await clientB2.query(`SELECT * FROM "PartialUsers" WHERE "value" = $1`, ['user-b@example.com']);
    expect(resB2.rows.length).toBe(1);
    expect(resB2.rows[0].displayName).toBe('User B');

    const resB3 = await clientB3.query(`SELECT * FROM "PartialUsers" WHERE "value" = $1`, ['user-b@example.com']);
    expect(resB3.rows.length).toBe(1);
    expect(resB3.rows[0].displayName).toBe('User B');

    const resA1_B = await clientA1.query(`SELECT * FROM "PartialUsers" WHERE "value" = $1`, ['user-b@example.com']);
    expect(resA1_B.rows.length).toBe(0);

    const resA2_B = await clientA2.query(`SELECT * FROM "PartialUsers" WHERE "value" = $1`, ['user-b@example.com']);
    expect(resA2_B.rows.length).toBe(0);
  }, TEST_TIMEOUT);

  /**
   * What it does:
   * - Syncs three baseline users to capture their sequence ordering, then exports a fourth user.
   * - Compares sequenceIds to ensure the newest export exceeds the previous maximum.
   *
   * Why it matters:
   * - Verifies ordering guarantees that drive pagination and conflict resolution.
   */
  test('SequenceId Tracking: Verify sync uses sequenceId correctly', async () => {
    const dbName = 'sequence_id_test';
    const connectionString = await dbManager.createDatabase(dbName);

    await createProjectWithExternalDb({
      main: {
        type: 'postgres',
        connectionString,
      }
    });

    const client = dbManager.getClient(dbName);

    const user1 = await User.create({ emailAddress: 'seq1@example.com' });
    const user2 = await User.create({ emailAddress: 'seq2@example.com' });
    const user3 = await User.create({ emailAddress: 'seq3@example.com' });

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

    await waitForTable(client, 'PartialUsers');

    await waitForCondition(
      async () => {
        const res = await client.query(`SELECT COUNT(*) as count FROM "PartialUsers"`);
        return parseInt(res.rows[0].count) === 3;
      },
      { description: 'all 3 users to be synced' }
    );

    const res1 = await client.query(`SELECT * FROM "PartialUsers" ORDER BY "sequenceId"`);
    expect(res1.rows.length).toBe(3);

    const seq1 = BigInt(res1.rows[0].sequenceId);
    const seq2 = BigInt(res1.rows[1].sequenceId);
    const seq3 = BigInt(res1.rows[2].sequenceId);

    expect(seq2).toBeGreaterThan(seq1);
    expect(seq3).toBeGreaterThan(seq2);

    const maxSeqRes = await client.query(`SELECT MAX("sequenceId") as max_seq FROM "PartialUsers"`);
    const maxSeq = BigInt(maxSeqRes.rows[0].max_seq);

    const user4 = await User.create({ emailAddress: 'seq4@example.com' });
    await niceBackendFetch(`/api/v1/users/${user4.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'User 4' }
    });

    await waitForSyncedData(client, 'seq4@example.com', 'User 4');
    const res2 = await client.query(`SELECT * FROM "PartialUsers" WHERE "value" = $1`, ['seq4@example.com']);
    expect(res2.rows.length).toBe(1);
    const seq4 = BigInt(res2.rows[0].sequenceId);
    expect(seq4).toBeGreaterThan(maxSeq);
    const finalRes = await client.query(`SELECT COUNT(*) as count FROM "PartialUsers"`);
    expect(parseInt(finalRes.rows[0].count)).toBe(4);
  }, TEST_TIMEOUT);

  /**
   * What it does:
   * - Exports a single user, records its sequenceId, then syncs again after adding a second user.
   * - Ensures the first user’s row count and sequenceId stay untouched.
   *
   * Why it matters:
   * - Confirms repeated sync runs don’t duplicate or rewrite already exported rows.
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

    const user1 = await User.create({ emailAddress: 'user1@example.com' });
    await niceBackendFetch(`/api/v1/users/${user1.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'User 1' }
    });

    const client = dbManager.getClient(dbName);

    await waitForSyncedData(client, 'user1@example.com', 'User 1');

    let res = await client.query(`SELECT * FROM "PartialUsers" WHERE "value" = $1`, ['user1@example.com']);
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].displayName).toBe('User 1');
    const user1SequenceId = res.rows[0].sequenceId;

    const user2 = await User.create({ emailAddress: 'user2@example.com' });
    await niceBackendFetch(`/api/v1/users/${user2.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'User 2' }
    });

    await waitForSyncedData(client, 'user2@example.com', 'User 2');

    const user1Row = await client.query(`SELECT * FROM "PartialUsers" WHERE "value" = $1`, ['user1@example.com']);
    const user2Row = await client.query(`SELECT * FROM "PartialUsers" WHERE "value" = $1`, ['user2@example.com']);

    expect(user1Row.rows.length).toBe(1);
    expect(user2Row.rows.length).toBe(1);
    expect(user1Row.rows[0].displayName).toBe('User 1');
    expect(user2Row.rows[0].displayName).toBe('User 2');
    expect(user1Row.rows[0].sequenceId).toBe(user1SequenceId);
  }, TEST_TIMEOUT);

  /**
   * What it does:
   * - Configures two mappings (PartialUsers and SimpleUsers), syncs once, and reads both tables.
   * - Verifies the exported display name matches across tables.
   *
   * Why it matters:
   * - Shows a single source mapping can feed multiple targets consistently.
   */
  test('Multiple Mappings: Sync to two different tables', async () => {
    const dbName = 'multi_mapping_test';
    const connectionString = await dbManager.createDatabase(dbName);

    await createProjectWithExternalDb({
      main: {
        type: 'postgres',
        connectionString,
        mappings: {
          "PartialUsers": DEFAULT_DB_SYNC_MAPPINGS.PartialUsers,
          "SimpleUsers": {
            sourceTables: { "ContactChannel": "ContactChannel", "ProjectUser": "ProjectUser" },
            targetTable: 'SimpleUsers',
            targetTablePrimaryKey: ['value'],
            targetTableSchema: `
              CREATE TABLE "SimpleUsers" (
                "value" text PRIMARY KEY,
                "displayName" text,
                "sequenceId" bigint
              );
              CREATE INDEX ON "SimpleUsers" ("sequenceId");
            `.trim(),
            internalDbFetchQuery: `
              SELECT
                "ContactChannel"."value",
                "ProjectUser"."displayName",
                GREATEST("ContactChannel"."sequenceId", "ProjectUser"."sequenceId") as "sequenceId"
              FROM "ContactChannel"
              JOIN "ProjectUser" ON "ContactChannel"."projectUserId" = "ProjectUser"."projectUserId" 
                AND "ContactChannel"."tenancyId" = "ProjectUser"."tenancyId"
              WHERE "ContactChannel"."isPrimary" = 'TRUE'
                AND "ContactChannel"."tenancyId" = $1::uuid
              ORDER BY "sequenceId" ASC
              LIMIT 1000
            `.trim(),
            externalDbUpdateQuery: `
              INSERT INTO "SimpleUsers" ("value", "displayName", "sequenceId")
              VALUES ($1, $2, $3)
              ON CONFLICT ("value") DO UPDATE
              SET
                "displayName" = EXCLUDED."displayName",
                "sequenceId" = EXCLUDED."sequenceId"
              WHERE EXCLUDED."sequenceId" > "SimpleUsers"."sequenceId"
            `.trim(),
          }
        }
      }
    });

    const user = await User.create({ emailAddress: 'multi-map@example.com' });
    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Multi Map User' }
    });

    const client = dbManager.getClient(dbName);

    await waitForCondition(
      async () => {
        try {
          const res = await client.query(`SELECT * FROM "PartialUsers" WHERE "value" = $1`, ['multi-map@example.com']);
          return res.rows.length === 1 && res.rows[0].displayName === 'Multi Map User';
        } catch (err: any) {
          if (err.code === '42P01') return false;
          throw err;
        }
      },
      { description: 'PartialUsers data to sync', timeoutMs: 90000 }
    );

    const res1 = await client.query(`SELECT * FROM "PartialUsers" WHERE "value" = $1`, ['multi-map@example.com']);
    expect(res1.rows[0].displayName).toBe('Multi Map User');

    await waitForCondition(
      async () => {
        try {
          const res = await client.query(`SELECT * FROM "SimpleUsers" WHERE "value" = $1`, ['multi-map@example.com']);
          return res.rows.length === 1;
        } catch (err: any) {
          if (err.code === '42P01') return false;
          throw err;
        }
      },
      { description: 'SimpleUsers data to sync', timeoutMs: 90000 }
    );

    const res2 = await client.query(`SELECT * FROM "SimpleUsers" WHERE "value" = $1`, ['multi-map@example.com']);
    expect(res2.rows[0].displayName).toBe('Multi Map User');
  });

  /**
   * What it does:
   * - Exports a user whose display name contains quotes, emoji, and non-Latin characters.
   * - Queries PartialUsers to confirm the string survives unchanged.
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
    const user = await User.create({ emailAddress: 'special@example.com' });
    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: specialName }
    });

    await waitForSyncedData(dbManager.getClient(dbName), 'special@example.com', specialName);

    const client = dbManager.getClient(dbName);
    const res = await client.query(`SELECT * FROM "PartialUsers" WHERE "value" = $1`, ['special@example.com']);
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].displayName).toBe(specialName);
  });

  /**
   * What it does:
   * - Creates 200 users, triggers sync repeatedly, and waits for the external row count to reach 200.
   *
   * Why it matters:
   * - Exercises batching code paths to ensure high volumes eventually flush completely.
   */
  test('High Volume: 200+ users to test batching', async () => {
    const dbName = 'high_volume_test';
    const connectionString = await dbManager.createDatabase(dbName);

    await createProjectWithExternalDb({
      main: {
        type: 'postgres',
        connectionString,
      }
    });

    await InternalApiKey.createAndSetProjectKeys();

    const batchSize = 20;
    const totalUsers = 200;
    let usersCreated = 0;
    let attemptCounter = 0;

    const createUserWithRetry = async () => {
      const maxRetries = 5;
      for (let retry = 0; retry < maxRetries; retry++) {
        const uniqueId = `${Date.now()}-${attemptCounter++}-${Math.floor(performance.now() * 1000000)}`;
        const result = await niceBackendFetch('/api/v1/auth/password/sign-up', {
          method: 'POST',
          accessType: 'client',
          body: {
            email: `hv-${uniqueId}@example.com`,
            password: 'testpassword123',
            verification_callback_url: 'http://localhost:3000/verify',
          },
        });
        if (result.status === 200) {
          return result;
        }
        if (result.status === 409 && result.body?.code === 'USER_EMAIL_ALREADY_EXISTS') {
          continue;
        }
        throw new Error(`Unexpected response: ${result.status} ${JSON.stringify(result.body)}`);
      }
      throw new Error('Failed to create user after max retries');
    };

    while (usersCreated < totalUsers) {
      const batchTarget = Math.min(batchSize, totalUsers - usersCreated);
      const batchPromises = [];
      for (let i = 0; i < batchTarget; i++) {
        batchPromises.push(createUserWithRetry());
      }
      await Promise.all(batchPromises);
      usersCreated += batchTarget;

      if (usersCreated < totalUsers) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    const client = dbManager.getClient(dbName);

    await waitForTable(client, 'PartialUsers');

    await waitForCondition(
      async () => {
        const res = await client.query(`SELECT COUNT(*) as count FROM "PartialUsers"`);
        return parseInt(res.rows[0].count) >= 200;
      },
      { description: 'all 200 users to be synced', timeoutMs: 180000 }
    );

    const res = await client.query(`SELECT COUNT(*) as count FROM "PartialUsers"`);
    const finalCount = parseInt(res.rows[0].count);
    expect(finalCount).toBeGreaterThanOrEqual(200);
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

    const user1 = await User.create({ emailAddress: 'seq1@example.com' });
    const user2 = await User.create({ emailAddress: 'seq2@example.com' });
    const user3 = await User.create({ emailAddress: 'seq3@example.com' });

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
          const res = await client.query(`SELECT COUNT(*) as count FROM "PartialUsers"`);
          return parseInt(res.rows[0].count) === 3;
        } catch (err: any) {
          if (err.code === '42P01') return false;
          throw err;
        }
      },
      { description: 'initial 3 users sync', timeoutMs: 90000 }
    );

    let res = await client.query(`SELECT COUNT(*) as count FROM "PartialUsers"`);
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

    const user4 = await User.create({ emailAddress: 'seq4@example.com' });
    await niceBackendFetch(`/api/v1/users/${user4.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'User 4' }
    });

    await waitForCondition(
      async () => {
        try {
          const res = await client.query(`SELECT * FROM "PartialUsers" ORDER BY "value"`);
          if (res.rows.length !== 3) return false;

          const emails = res.rows.map(r => r.value);
          if (emails.includes('seq1@example.com')) return false;
          if (!emails.includes('seq2@example.com')) return false;
          if (!emails.includes('seq3@example.com')) return false;
          if (!emails.includes('seq4@example.com')) return false;

          const user2Row = res.rows.find(r => r.value === 'seq2@example.com');
          return user2Row.displayName === 'User 2 Updated';
        } catch (err: any) {
          if (err.code === '42P01') return false;
          throw err;
        }
      },
      { description: 'final sync state correct', timeoutMs: 90000 }
    );

    res = await client.query(`SELECT * FROM "PartialUsers" ORDER BY "value"`);
    expect(res.rows.length).toBe(3);

    const emails = res.rows.map(r => r.value);
    expect(emails).not.toContain('seq1@example.com');
    expect(emails).toContain('seq2@example.com');
    expect(emails).toContain('seq3@example.com');
    expect(emails).toContain('seq4@example.com');

    const user2Row = res.rows.find(r => r.value === 'seq2@example.com');
    expect(user2Row.displayName).toBe('User 2 Updated');
  }, TEST_TIMEOUT);

  /**
   * What it does:
   * - Creates a readonly database role, grants SELECT on PartialUsers, and tests SELECT/INSERT/UPDATE/DELETE commands.
   * - Expects reads to succeed while writes fail.
   *
   * Why it matters:
   * - Protects external tables from being mutated by consumers using readonly credentials.
   */
  test('External write protection: readonly client cannot modify PartialUsers', async () => {
    const dbName = 'write_protection_test';
    const connectionString = await dbManager.createDatabase(dbName);

    await createProjectWithExternalDb({
      main: {
        type: 'postgres',
        connectionString,
      },
    });

    const superClient = dbManager.getClient(dbName);

    const user = await User.create({ emailAddress: 'write-protect@example.com' });
    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Write Protect User' },
    });
    await waitForTable(superClient, 'PartialUsers');
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
        `SELECT * FROM "PartialUsers" WHERE "value" = $1`,
        ['write-protect@example.com'],
      );
      expect(selectRes.rows.length).toBe(1);
      await expect(
        readonlyClient.query(
          `INSERT INTO "PartialUsers" ("id", "value") VALUES (gen_random_uuid(), $1)`,
          ['should-not-insert@example.com'],
        ),
      ).rejects.toThrow();

      await expect(
        readonlyClient.query(
          `UPDATE "PartialUsers" SET "displayName" = 'Hacked' WHERE "value" = $1`,
          ['write-protect@example.com'],
        ),
      ).rejects.toThrow();

      await expect(
        readonlyClient.query(
          `DELETE FROM "PartialUsers" WHERE "value" = $1`,
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
   * - Checks PartialUsers to confirm only the final name persists.
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

    const user = await User.create({ emailAddress: 'multi-update@example.com' });

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

    await waitForTable(client, 'PartialUsers');
    await waitForSyncedData(client, 'multi-update@example.com', 'Name v3');

    const row = await client.query(
      `SELECT * FROM "PartialUsers" WHERE "value" = $1`,
      ['multi-update@example.com'],
    );
    expect(row.rows.length).toBe(1);
    expect(row.rows[0].displayName).toBe('Name v3');
  }, TEST_TIMEOUT);

  /**
   * What it does:
   * - Creates then deletes a user before the first sync happens.
   * - Runs sync and checks that PartialUsers never receives the email.
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

    const user = await User.create({ emailAddress: 'delete-before-sync@example.com' });
    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'To Be Deleted' },
    });
    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'DELETE',
    });

    await waitForTable(client, 'PartialUsers');

    await waitForCondition(
      async () => {
        const res = await client.query(
          `SELECT * FROM "PartialUsers" WHERE "value" = $1`,
          ['delete-before-sync@example.com'],
        );
        return res.rows.length === 0;
      },
      { description: 'deleted user should never appear', timeoutMs: 90000 }
    );

    const res = await client.query(
      `SELECT * FROM "PartialUsers" WHERE "value" = $1`,
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

    const firstUser = await User.create({ emailAddress: email });
    await niceBackendFetch(`/api/v1/users/${firstUser.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Original Export' },
    });

    await waitForSyncedData(client, email, 'Original Export');

    let res = await client.query(
      `SELECT "id", "sequenceId" FROM "PartialUsers" WHERE "value" = $1`,
      [email],
    );
    expect(res.rows.length).toBe(1);
    const firstRow = res.rows[0];
    const firstSequence = BigInt(firstRow.sequenceId);

    await niceBackendFetch(`/api/v1/users/${firstUser.userId}`, {
      accessType: 'admin',
      method: 'DELETE',
    });

    await waitForSyncedDeletion(client, email);
    await verifyNotInExternalDb(client, email);

    const secondUser = await User.create({ emailAddress: email });
    await niceBackendFetch(`/api/v1/users/${secondUser.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Recreated Export' },
    });

    await waitForSyncedData(client, email, 'Recreated Export');

    res = await client.query(
      `SELECT "id", "sequenceId", "displayName" FROM "PartialUsers" WHERE "value" = $1`,
      [email],
    );
    expect(res.rows.length).toBe(1);

    const recreatedRow = res.rows[0];
    expect(recreatedRow.displayName).toBe('Recreated Export');
    expect(recreatedRow.id).not.toBe(firstRow.id);
    expect(BigInt(recreatedRow.sequenceId)).toBeGreaterThan(firstSequence);

    await waitForCondition(
      async () => {
        const followUp = await client.query(
          `SELECT "displayName" FROM "PartialUsers" WHERE "value" = $1`,
          [email],
        );
        return followUp.rows.length === 1 && followUp.rows[0].displayName === 'Recreated Export';
      },
      { description: 'recreated row persists after extra sync', timeoutMs: 90000 },
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

    const user1 = await User.create({ emailAddress: email });
    await niceBackendFetch(`/api/v1/users/${user1.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Initial Name' },
    });

    await waitForSyncedData(client, email, 'Initial Name');

    let res = await client.query(`SELECT * FROM "PartialUsers" WHERE "value" = $1`, [email]);
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].displayName).toBe('Initial Name');
    const firstId = res.rows[0].id;
    const firstSeq = BigInt(res.rows[0].sequenceId);

    await niceBackendFetch(`/api/v1/users/${user1.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Updated Once' },
    });

    await waitForSyncedData(client, email, 'Updated Once');

    res = await client.query(`SELECT * FROM "PartialUsers" WHERE "value" = $1`, [email]);
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].displayName).toBe('Updated Once');
    expect(res.rows[0].id).toBe(firstId);
    expect(BigInt(res.rows[0].sequenceId)).toBeGreaterThan(firstSeq);
    const secondSeq = BigInt(res.rows[0].sequenceId);

    await niceBackendFetch(`/api/v1/users/${user1.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Updated Twice' },
    });

    await waitForSyncedData(client, email, 'Updated Twice');

    res = await client.query(`SELECT * FROM "PartialUsers" WHERE "value" = $1`, [email]);
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].displayName).toBe('Updated Twice');
    expect(res.rows[0].id).toBe(firstId);
    expect(BigInt(res.rows[0].sequenceId)).toBeGreaterThan(secondSeq);

    await niceBackendFetch(`/api/v1/users/${user1.userId}`, {
      accessType: 'admin',
      method: 'DELETE',
    });

    await waitForSyncedDeletion(client, email);

    res = await client.query(`SELECT * FROM "PartialUsers" WHERE "value" = $1`, [email]);
    expect(res.rows.length).toBe(0);

    const user2 = await User.create({ emailAddress: email });
    await niceBackendFetch(`/api/v1/users/${user2.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Recreated User' },
    });

    await waitForSyncedData(client, email, 'Recreated User');

    res = await client.query(`SELECT * FROM "PartialUsers" WHERE "value" = $1`, [email]);
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].displayName).toBe('Recreated User');
    expect(res.rows[0].id).not.toBe(firstId);
    const newId = res.rows[0].id;
    const newSeq = BigInt(res.rows[0].sequenceId);

    await niceBackendFetch(`/api/v1/users/${user2.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Final Name' },
    });

    await waitForSyncedData(client, email, 'Final Name');

    res = await client.query(`SELECT * FROM "PartialUsers" WHERE "value" = $1`, [email]);
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].displayName).toBe('Final Name');
    expect(res.rows[0].id).toBe(newId);
    expect(BigInt(res.rows[0].sequenceId)).toBeGreaterThan(newSeq);
  }, TEST_TIMEOUT);

  /**
   * What it does:
   * - Exports 50 users, deletes 10, inserts 10 replacements, and syncs again.
   * - Validates the final PartialUsers dataset contains the remaining 40 originals plus 10 replacements (total 50).
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

    await InternalApiKey.createAndSetProjectKeys();

    const client = dbManager.getClient(dbName);
    const initialUserCount = 50;
    const deletions = 10;
    const replacements = 10;

    const initialUsers: { userId: string, email: string }[] = [];

    const batchSize = 10;
    const testRunId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    for (let batchStart = 0; batchStart < initialUserCount; batchStart += batchSize) {
      const batchEnd = Math.min(batchStart + batchSize, initialUserCount);

      const batchPromises = [];
      for (let i = batchStart; i < batchEnd; i++) {
        const email = `interleave-${i}-${testRunId}@example.com`;
        batchPromises.push(
          User.create({ emailAddress: email }).then(async (user) => {
            await niceBackendFetch(`/api/v1/users/${user.userId}`, {
              accessType: 'admin',
              method: 'PATCH',
              body: { display_name: `Interleave User ${i}` },
            });
            return { userId: user.userId, email };
          })
        );
      }

      const batchResults = await Promise.all(batchPromises);
      initialUsers.push(...batchResults);

      if (batchEnd < initialUserCount) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    await waitForTable(client, 'PartialUsers');

    await waitForCondition(
      async () => {
        const countRes = await client.query(`SELECT COUNT(*) as count FROM "PartialUsers"`);
        return parseInt(countRes.rows[0].count) === initialUserCount;
      },
      { description: 'initial batch exported', timeoutMs: 60000 },
    );

    const deletedUsers = initialUsers.slice(0, deletions);
    for (const entry of deletedUsers) {
      await niceBackendFetch(`/api/v1/users/${entry.userId}`, {
        accessType: 'admin',
        method: 'DELETE',
      });
    }
    await waitForCondition(
      async () => {
        const countRes = await client.query(`SELECT COUNT(*) as count FROM "PartialUsers"`);
        return parseInt(countRes.rows[0].count) === (initialUserCount - deletions);
      },
      { description: 'deletions synced to external DB', timeoutMs: 180000 },
    );

    const replacementEmails: string[] = [];

    await InternalApiKey.createAndSetProjectKeys();

    const replacementPromises = [];
    for (let i = 0; i < replacements; i++) {
      const email = `interleave-replacement-${i}-${testRunId}@example.com`;
      replacementPromises.push(
        User.create({ emailAddress: email }).then(async (user) => {
          await niceBackendFetch(`/api/v1/users/${user.userId}`, {
            accessType: 'admin',
            method: 'PATCH',
            body: { display_name: `Replacement ${i}` },
          });
          return email;
        })
      );
    }

    const createdReplacementEmails = await Promise.all(replacementPromises);
    replacementEmails.push(...createdReplacementEmails);

    const expectedFinalCount = initialUserCount - deletions + replacements;
    await waitForCondition(
      async () => {
        const countRes = await client.query(`SELECT COUNT(*) as count FROM "PartialUsers"`);
        return parseInt(countRes.rows[0].count) === expectedFinalCount;
      },
      { description: 'final mixed batch exported', timeoutMs: 180000 },
    );

    const finalRows = await client.query(`SELECT "value" FROM "PartialUsers"`);
    const finalEmails = new Set(finalRows.rows.map((row) => row.value));
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
  }, HIGH_VOLUME_TIMEOUT);
});
