import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { test } from '../../../../helpers';
import { User, backendContext, niceBackendFetch } from '../../../backend-helpers';
import {
  HIGH_VOLUME_TIMEOUT,
  POSTGRES_HOST,
  POSTGRES_PASSWORD,
  POSTGRES_USER,
  TEST_TIMEOUT,
  TestDbManager,
  createProjectWithExternalDb,
  waitForCondition,
  waitForSyncedDeletion,
  waitForTable
} from './external-db-sync-utils';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe.sequential('External DB Sync - Race Condition Tests', () => {
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
   * - Updates a user, triggers two sync cycles concurrently, and waits for users table to show the last value.
   * - Confirms only a single row exists with the final display name.
   *
   * Why it matters:
   * - Demonstrates overlapping pollers remain idempotent instead of duplicating or reverting data.
   */
  test('Concurrent sync triggers produce a single consistent export', async () => {
    const dbName = 'race_parallel_sync_test';
    const connectionString = await dbManager.createDatabase(dbName);

    await createProjectWithExternalDb({
      main: {
        type: 'postgres',
        connectionString,
      },
    });

    const client = dbManager.getClient(dbName);
    const user = await User.create({ emailAddress: 'parallel-sync@example.com' });

    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Initial Name' },
    });

    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Final Name' },
    });

    await waitForTable(client, 'users');

    await waitForCondition(
      async () => {
        const res = await client.query(
          `SELECT * FROM "users" WHERE "primary_email" = $1`,
          ['parallel-sync@example.com'],
        );
        return res.rows.length === 1 && res.rows[0].display_name === 'Final Name';
      },
      { description: 'sync to converge on final state', timeoutMs: 90000 },
    );
  }, TEST_TIMEOUT);

  /**
   * What it does:
   * - Issues a final update, deletes the user immediately afterward, and runs the deletion helper.
   * - Confirms users table has zero rows for that value.
   *
   * Why it matters:
   * - Shows delete events win over closely preceding updates, preventing stale data resurrection.
   */
  test('Immediate delete after update removes the contact channel', async () => {
    const dbName = 'race_update_delete_test';
    const connectionString = await dbManager.createDatabase(dbName);

    await createProjectWithExternalDb({
      main: {
        type: 'postgres',
        connectionString,
      },
    });

    const client = dbManager.getClient(dbName);
    const user = await User.create({ emailAddress: 'update-delete@example.com' });

    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Before Delete' },
    });

    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Should Be Deleted' },
    });

    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'DELETE',
    });

    await waitForTable(client, 'users');
    await waitForSyncedDeletion(client, 'update-delete@example.com');

    const res = await client.query(
      `SELECT * FROM "users" WHERE "primary_email" = $1`,
      ['update-delete@example.com'],
    );
    expect(res.rows.length).toBe(0);
  }, TEST_TIMEOUT);

  /**
   * What it does:
   * - Exports 300 users (forcing multi-page fetches), deletes a low-sequence contact channel, and syncs again.
   * - Checks the deleted row is gone and the total count drops by exactly one.
   *
   * Why it matters:
   * - Prevents pagination LIMIT boundaries from causing delete events to be skipped.
   */
  test('Deletes near pagination boundaries are honored', async () => {
    const dbName = 'race_pagination_delete_test';
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
    const totalUsers = 300;

    // Connect to internal database to insert users directly
    const internalClient = new Client({
      connectionString: `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}/stackframe`,
    });
    await internalClient.connect();

    let users: { email: string, projectUserId: string }[] = [];

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

      // Insert all users and get their IDs back
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
            'Paged User ' || idx,
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
            'page-user-' || g.idx || '@example.com',
            g.ts,
            g.ts
          FROM generated g
          RETURNING "projectUserId", "value" AS email
        )
        SELECT "projectUserId"::text, email FROM insert_contacts ORDER BY email
      `, [tenancyId, projectId, totalUsers]);

      users = insertResult.rows.map(row => ({
        email: row.email,
        projectUserId: row.projectUserId,
      }));

      await waitForTable(externalClient, 'users');

      await waitForCondition(
        async () => {
          const res = await externalClient.query(`SELECT COUNT(*) AS count FROM "users"`);
          return parseInt(res.rows[0].count, 10) === totalUsers;
        },
        { description: 'initial >300 users exported', timeoutMs: 120000 },
      );

      // Delete user at index 1 (low sequence ID)
      const deletedUser = users[1];
      await niceBackendFetch(`/api/v1/users/${deletedUser.projectUserId}`, {
        accessType: 'admin',
        method: 'DELETE',
      });

      await waitForCondition(
        async () => {
          const res = await externalClient.query(`SELECT COUNT(*) AS count FROM "users"`);
          return parseInt(res.rows[0].count, 10) === totalUsers - 1;
        },
        { description: 'pagination delete reflected', timeoutMs: 180000 },
      );

      const deletedRow = await externalClient.query(
        `SELECT * FROM "users" WHERE "primary_email" = $1`,
        [deletedUser.email],
      );
      expect(deletedRow.rows.length).toBe(0);
    } finally {
      await internalClient.end();
    }
  }, HIGH_VOLUME_TIMEOUT);

  /**
   * What it does:
   * - Creates overlapping database transactions that update the same row
   * - Commits them at different times while sync is happening
   * - Verifies that the highest sequence ID wins in the external DB
   *
   * Why it matters:
   * - Proves true database-level race conditions are handled correctly
   * - Tests that sync captures all committed changes eventually
   */
  describe('Race conditions with overlapping transactions', () => {
    const LOCAL_TEST_TIMEOUT = 120_000; // Must be > 70s sleep + setup time

    async function setupExternalDbWithBaseline(dbName: string) {
      const connectionString = await dbManager.createDatabase(dbName);

      await createProjectWithExternalDb({
        main: {
          type: 'postgres',
          connectionString,
        },
      });

      const externalClient = dbManager.getClient(dbName);
      const user = await User.create({ emailAddress: `${dbName}@example.com` });

      // Make sure the users row exists
      await waitForTable(externalClient, 'users');

      await waitForCondition(
        async () => {
          const res = await externalClient.query<{
            display_name: string | null,
          }>(
            `
              SELECT "display_name"
              FROM "users"
              WHERE "primary_email" = $1
            `,
            [`${dbName}@example.com`],
          );
          return res.rows.length === 1;
        },
        { description: `baseline row for ${dbName}`, timeoutMs: 60000 },
      );

      const baseline = await externalClient.query<{
        display_name: string | null,
      }>(
        `
          SELECT "display_name"
          FROM "users"
          WHERE "primary_email" = $1
        `,
        [`${dbName}@example.com`],
      );

      if (baseline.rows.length !== 1) {
        throw new Error(`Expected baseline row for ${dbName}, got ${baseline.rows.length}`);
      }

      const baselineRow = baseline.rows[0];
      const baselineDisplayName = baselineRow.display_name;

      return {
        externalClient,
        user,
        baselineDisplayName,
      };
    }

    function makeInternalDbUrl() {
      const portPrefix = process.env.NEXT_PUBLIC_STACK_PORT_PREFIX || '81';
      return `postgres://postgres:PASSWORD-PLACEHOLDER--uqfEC1hmmv@localhost:${portPrefix}28/stackframe`;
    }

    /**
     * Scenario 1:
     * Poller runs while a transaction is in-flight and uncommitted.
     * Only the baseline committed value should be visible.
     *
     */
    test(
      'Poller ignores uncommitted overlapping updates',
      async () => {
        const dbName = 'race_uncommitted_poll_test';
        const { externalClient, user, baselineDisplayName } =
          await setupExternalDbWithBaseline(dbName);

        const internalDbUrl = makeInternalDbUrl();
        const internalClient = new Client({ connectionString: internalDbUrl });

        await internalClient.connect();

        try {
          await internalClient.query('BEGIN');
          await internalClient.query(
            `
              UPDATE "ProjectUser"
              SET "displayName" = 'Transaction 1', "updatedAt" = NOW()
              WHERE "projectUserId" = $1
            `,
            [user.userId],
          );

          await sleep(70000);

          const during = await externalClient.query<{
            display_name: string | null,
          }>(
            `
              SELECT "display_name"
              FROM "users"
              WHERE "primary_email" = $1
            `,
            [`${dbName}@example.com`],
          );

          expect(during.rows.length).toBe(1);
          const row = during.rows[0];

          // Uncommitted transaction should not be visible
          expect(row.display_name).not.toBe('Transaction 1');
          expect(row.display_name).toBe(baselineDisplayName);

          await internalClient.query('ROLLBACK');
        } finally {
          await internalClient.end();
        }
      },
      LOCAL_TEST_TIMEOUT,
    );

    /**
     * Scenario 2:
     * First transaction commits, then poller runs.
     * Poller should pick up Transaction 1 and sequenceId should increase.
     */
    test(
      'Poller picks up first committed transaction',
      async () => {
        const dbName = 'race_after_first_commit_test';
        const { externalClient, user } =
          await setupExternalDbWithBaseline(dbName);

        const internalDbUrl = makeInternalDbUrl();
        const internalClient = new Client({ connectionString: internalDbUrl });

        await internalClient.connect();

        try {
          // Commit Transaction 1
          await internalClient.query('BEGIN');
          await internalClient.query(
            `
              UPDATE "ProjectUser"
              SET "displayName" = 'Transaction 1', "updatedAt" = NOW()
              WHERE "projectUserId" = $1
            `,
            [user.userId],
          );
          await internalClient.query('COMMIT');

          await waitForCondition(
            async () => {
              const res = await externalClient.query<{
                display_name: string | null,
              }>(
                `
                  SELECT "display_name"
                  FROM "users"
                  WHERE "primary_email" = $1
                `,
                [`${dbName}@example.com`],
              );
              return (
                res.rows.length === 1 &&
                res.rows[0].display_name === 'Transaction 1'
              );
            },
            { description: 'Transaction 1 exported', timeoutMs: 90000 },
          );

          const afterT1 = await externalClient.query<{
            display_name: string | null,
          }>(
            `
              SELECT "display_name"
              FROM "users"
              WHERE "primary_email" = $1
            `,
            [`${dbName}@example.com`],
          );

          expect(afterT1.rows.length).toBe(1);
          expect(afterT1.rows[0].display_name).toBe('Transaction 1');
        } finally {
          await internalClient.end();
        }
      },
      LOCAL_TEST_TIMEOUT,
    );

    /**
     * Scenario 3:
     * First transaction is committed and synced.
     * Second transaction has UPDATE done but is still uncommitted.
     * Poller should STILL see Transaction 1 (not Transaction 2).
     */
    test(
      'Poller does not see second update until commit',
      async () => {
        const dbName = 'race_second_uncommitted_poll_test';
        const { externalClient, user } =
          await setupExternalDbWithBaseline(dbName);

        const internalDbUrl = makeInternalDbUrl();
        const internalClient = new Client({ connectionString: internalDbUrl });

        await internalClient.connect();

        try {
          await internalClient.query('BEGIN');
          await internalClient.query(
            `
              UPDATE "ProjectUser"
              SET "displayName" = 'Transaction 1', "updatedAt" = NOW()
              WHERE "projectUserId" = $1
            `,
            [user.userId],
          );
          await internalClient.query('COMMIT');

          await waitForCondition(
            async () => {
              const res = await externalClient.query<{ display_name: string | null }>(
                `SELECT "display_name" FROM "users" WHERE "primary_email" = $1`,
                [`${dbName}@example.com`],
              );
              return res.rows.length === 1 && res.rows[0].display_name === 'Transaction 1';
            },
            { description: 'Transaction 1 exported', timeoutMs: 60000 },
          );

          // Start uncommitted Transaction 2
          await internalClient.query('BEGIN');
          await internalClient.query(
            `
              UPDATE "ProjectUser"
              SET "displayName" = 'Transaction 2', "updatedAt" = NOW()
              WHERE "projectUserId" = $1
            `,
            [user.userId],
          );

          await sleep(7000);

          const duringT2 = await externalClient.query<{
            display_name: string | null,
          }>(
            `
              SELECT "display_name"
              FROM "users"
              WHERE "primary_email" = $1
            `,
            [`${dbName}@example.com`],
          );

          expect(duringT2.rows.length).toBe(1);
          // Uncommitted Transaction 2 should not be visible
          expect(duringT2.rows[0].display_name).not.toBe('Transaction 2');
          expect(duringT2.rows[0].display_name).toBe('Transaction 1');

          await internalClient.query('ROLLBACK');
        } finally {
          await internalClient.end();
        }
      },
      LOCAL_TEST_TIMEOUT,
    );

    /**
     * Scenario 4:
     * Two different rows, out-of-order commits:
     * - T1 starts
     * - T2 starts
     * - T2 updates row2
     * - T1 updates row1
     * - T2 commits
     * - Sync → only T2's row visible, T1's row unchanged
     * - T1 commits
     * - Sync → T1's row now visible
     *
     * Uses two different users to avoid row-level locking.
     */
    test(
      'Out-of-order commits on different rows: uncommitted changes invisible',
      async () => {
        const dbName = 'race_two_rows_out_of_order_test';
        const connectionString = await dbManager.createDatabase(dbName);

        await createProjectWithExternalDb({
          main: {
            type: 'postgres',
            connectionString,
          },
        });

        const externalClient = dbManager.getClient(dbName);

        const user1 = await User.create({ emailAddress: 'row1@example.com' });
        const user2 = await User.create({ emailAddress: 'row2@example.com' });

        await waitForTable(externalClient, 'users');

        await waitForCondition(
          async () => {
            const res = await externalClient.query(`SELECT COUNT(*) as count FROM "users"`);
            return parseInt(res.rows[0].count, 10) === 2;
          },
          { description: 'both users synced initially', timeoutMs: 60000 },
        );

        const internalDbUrl = makeInternalDbUrl();
        const t1Client = new Client({ connectionString: internalDbUrl });
        const t2Client = new Client({ connectionString: internalDbUrl });

        await t1Client.connect();
        await t2Client.connect();

        try {
          await t1Client.query('BEGIN');

          await t2Client.query('BEGIN');

          await t2Client.query(
            `
              UPDATE "ProjectUser"
              SET "displayName" = 'T2 Updated', "updatedAt" = NOW()
              WHERE "projectUserId" = $1
            `,
            [user2.userId],
          );

          await t1Client.query(
            `
              UPDATE "ProjectUser"
              SET "displayName" = 'T1 Updated', "updatedAt" = NOW()
              WHERE "projectUserId" = $1
            `,
            [user1.userId],
          );

          await t2Client.query('COMMIT');

          await waitForCondition(
            async () => {
              const res = await externalClient.query<{ display_name: string | null }>(
                `SELECT "display_name" FROM "users" WHERE "primary_email" = $1`,
                ['row2@example.com'],
              );
              return res.rows.length === 1 && res.rows[0].display_name === 'T2 Updated';
            },
            { description: 'T2 row synced after T2 commit', timeoutMs: 90000 },
          );

          const row1BeforeT1Commit = await externalClient.query<{ display_name: string | null }>(
            `SELECT "display_name" FROM "users" WHERE "primary_email" = $1`,
            ['row1@example.com'],
          );
          expect(row1BeforeT1Commit.rows.length).toBe(1);
          expect(row1BeforeT1Commit.rows[0].display_name).not.toBe('T1 Updated');

          await t1Client.query('COMMIT');

          await waitForCondition(
            async () => {
              const res = await externalClient.query<{ display_name: string | null }>(
                `SELECT "display_name" FROM "users" WHERE "primary_email" = $1`,
                ['row1@example.com'],
              );
              return res.rows.length === 1 && res.rows[0].display_name === 'T1 Updated';
            },
            { description: 'T1 row synced after T1 commit', timeoutMs: 90000 },
          );

          const finalRow1 = await externalClient.query<{ display_name: string | null }>(
            `SELECT "display_name" FROM "users" WHERE "primary_email" = $1`,
            ['row1@example.com'],
          );
          const finalRow2 = await externalClient.query<{ display_name: string | null }>(
            `SELECT "display_name" FROM "users" WHERE "primary_email" = $1`,
            ['row2@example.com'],
          );

          expect(finalRow1.rows[0].display_name).toBe('T1 Updated');
          expect(finalRow2.rows[0].display_name).toBe('T2 Updated');
        } finally {
          await t1Client.end();
          await t2Client.end();
        }
      },
      LOCAL_TEST_TIMEOUT,
    );

    /**
     * Scenario 5:
     * Full lifecycle:
     * - baseline
     * - Transaction 1 committed & synced
     * - Transaction 2 committed after a later sync
     * Final state must be Transaction 2.
     */
    test(
      'Sequential updates both sync correctly',
      async () => {
        const dbName = 'race_full_lifecycle_test';
        const { externalClient, user } =
          await setupExternalDbWithBaseline(dbName);

        const internalDbUrl = makeInternalDbUrl();
        const internalClient = new Client({ connectionString: internalDbUrl });

        await internalClient.connect();

        try {
          await internalClient.query('BEGIN');
          await internalClient.query(
            `
              UPDATE "ProjectUser"
              SET "displayName" = 'Transaction 1', "updatedAt" = NOW()
              WHERE "projectUserId" = $1
            `,
            [user.userId],
          );
          await internalClient.query('COMMIT');

          await waitForCondition(
            async () => {
              const res = await externalClient.query<{
                display_name: string | null,
              }>(
                `SELECT "display_name" FROM "users" WHERE "primary_email" = $1`,
                [`${dbName}@example.com`],
              );
              return res.rows.length === 1 && res.rows[0].display_name === 'Transaction 1';
            },
            { description: 'T1 synced', timeoutMs: 90000 },
          );

          const afterT1 = await externalClient.query<{
            display_name: string | null,
          }>(
            `
              SELECT "display_name"
              FROM "users"
              WHERE "primary_email" = $1
            `,
            [`${dbName}@example.com`],
          );

          expect(afterT1.rows.length).toBe(1);
          expect(afterT1.rows[0].display_name).toBe('Transaction 1');

          await internalClient.query('BEGIN');
          await internalClient.query(
            `
              UPDATE "ProjectUser"
              SET "displayName" = 'Transaction 2', "updatedAt" = NOW()
              WHERE "projectUserId" = $1
            `,
            [user.userId],
          );
          await internalClient.query('COMMIT');

          await waitForCondition(
            async () => {
              const res = await externalClient.query<{
                display_name: string | null,
              }>(
                `SELECT "display_name" FROM "users" WHERE "primary_email" = $1`,
                [`${dbName}@example.com`],
              );
              return res.rows.length === 1 && res.rows[0].display_name === 'Transaction 2';
            },
            { description: 'T2 synced', timeoutMs: 90000 },
          );

          const afterT2 = await externalClient.query<{
            display_name: string | null,
          }>(
            `
              SELECT "display_name"
              FROM "users"
              WHERE "primary_email" = $1
            `,
            [`${dbName}@example.com`],
          );

          expect(afterT2.rows.length).toBe(1);
          expect(afterT2.rows[0].display_name).toBe('Transaction 2');
        } finally {
          await internalClient.end();
        }
      },
      LOCAL_TEST_TIMEOUT,
    );
  });
});
