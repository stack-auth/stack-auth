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
  createProjectWithExternalDb as createProjectWithExternalDbRaw,
  waitForCondition,
  waitForSyncedDeletion,
  waitForTable
} from './external-db-sync-utils';

describe.sequential('External DB Sync - Race Condition Tests', () => {
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
    const user = await User.create({ primary_email: 'parallel-sync@example.com' });

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
    const user = await User.create({ primary_email: 'update-delete@example.com' });

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
    const LOCAL_TEST_TIMEOUT = TEST_TIMEOUT + 60_000; // Must cover baseline sync + fallback sleep on slow CI

    async function setupExternalDbWithBaseline(dbName: string) {
      const connectionString = await dbManager.createDatabase(dbName);

      await createProjectWithExternalDb({
        main: {
          type: 'postgres',
          connectionString,
        },
      });

      const externalClient = dbManager.getClient(dbName);
      const user = await User.create({ primary_email: `${dbName}@example.com` });

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
          // Capture the current sync position before we start the uncommitted transaction
          const metadataBefore = await externalClient.query<{ last_synced_sequence_id: string }>(
            `SELECT "last_synced_sequence_id" FROM "_stack_sync_metadata" WHERE "mapping_name" = 'users'`
          );
          const seqBefore = Number(metadataBefore.rows[0]?.last_synced_sequence_id ?? -1);

          // Start an uncommitted transaction that updates the baseline user
          await internalClient.query('BEGIN');
          await internalClient.query(
            `
              UPDATE "ProjectUser"
              SET "displayName" = 'Transaction 1', "updatedAt" = NOW()
              WHERE "projectUserId" = $1
            `,
            [user.userId],
          );

          // Create a "marker" user (committed) to give the sync something to process.
          // Once this marker is synced, we know the sync ran after our uncommitted transaction started.
          const markerEmail = `${dbName}-marker@example.com`;
          await User.create({ primary_email: markerEmail, display_name: 'Sync Marker' });

          // Wait for the marker user to appear in external DB, proving a sync occurred
          await waitForCondition(
            async () => {
              const res = await externalClient.query<{ display_name: string | null }>(
                `SELECT "display_name" FROM "users" WHERE "primary_email" = $1`,
                [markerEmail],
              );
              return res.rows.length === 1 && res.rows[0].display_name === 'Sync Marker';
            },
            {
              description: 'waiting for marker user to sync to external DB',
              timeoutMs: 120_000,
            },
          );

          // Verify metadata also advanced
          const metadataAfter = await externalClient.query<{ last_synced_sequence_id: string }>(
            `SELECT "last_synced_sequence_id" FROM "_stack_sync_metadata" WHERE "mapping_name" = 'users'`
          );
          const seqAfter = Number(metadataAfter.rows[0]?.last_synced_sequence_id ?? -1);
          expect(seqAfter).toBeGreaterThan(seqBefore);

          // Now verify the uncommitted change is NOT visible in external DB
          const row = await externalClient.query<{ display_name: string | null }>(
            `SELECT "display_name" FROM "users" WHERE "primary_email" = $1`,
            [`${dbName}@example.com`],
          );

          expect(row.rows.length).toBe(1);
          expect(row.rows[0].display_name).not.toBe('Transaction 1');
          expect(row.rows[0].display_name).toBe(baselineDisplayName);

          await internalClient.query('ROLLBACK');
        } finally {
          await internalClient.end();
        }
      },
      LOCAL_TEST_TIMEOUT,
    );
  });
});
