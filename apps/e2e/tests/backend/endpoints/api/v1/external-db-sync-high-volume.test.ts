import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { test } from '../../../../helpers';
import { backendContext } from '../../../backend-helpers';
import {
  HIGH_VOLUME_TIMEOUT,
  POSTGRES_HOST,
  POSTGRES_PASSWORD,
  POSTGRES_USER,
  TestDbManager,
  createProjectWithExternalDb as createProjectWithExternalDbRaw,
  waitForCondition,
  waitForTable,
} from './external-db-sync-utils';

// Run tests sequentially to avoid concurrency issues with shared backend state
describe.sequential('External DB Sync - High Volume Tests', () => {
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
   * - Creates 1500 users directly in the internal database using SQL (much faster than API)
   * - Waits for all of them to sync to the external database
   *
   * Why it matters:
   * - Ensures that when more than 1000 rows accumulate (e.g., external DB was down),
   *   the sync process loops and syncs all rows, not just the first 1000.
   * - This tests the pagination logic in syncMapping()
   */
  test('High Volume: Syncs more than 1000 users', async () => {
    const dbName = 'high_volume_test';
    const externalConnectionString = await dbManager.createDatabase(dbName);

    // Create project with external DB config (this also tracks for cleanup)
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

    const userCount = 1500;
    console.log(`Inserting ${userCount} users directly into internal database...`);

    try {
      // First, get the tenancy ID for this project
      const tenancyRes = await internalClient.query(
        `SELECT id FROM "Tenancy" WHERE "projectId" = $1 AND "branchId" = 'main' LIMIT 1`,
        [projectId]
      );
      if (tenancyRes.rows.length === 0) {
        throw new Error(`Tenancy not found for project ${projectId}`);
      }
      const tenancyId = tenancyRes.rows[0].id;
      console.log(`Found tenancy ID: ${tenancyId}`);

      // Insert users in batches using SQL
      // This mimics what the users/crud.tsx does but without password hashing
      const batchSize = 500;
      for (let batch = 0; batch < userCount; batch += batchSize) {
        const batchCount = Math.min(batchSize, userCount - batch);
        const startIdx = batch + 1;

        await internalClient.query(`
          WITH generated AS (
            SELECT
              $1::uuid AS tenancy_id,
              $2::uuid AS project_id,
              gen_random_uuid() AS project_user_id,
              gen_random_uuid() AS contact_id,
              (gs + $3::int - 1) AS idx,
              now() AS ts
            FROM generate_series(1, $4::int) AS gs
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
        `, [tenancyId, projectId, startIdx, batchCount]);

        console.log(`Inserted batch ${batch / batchSize + 1}: users ${startIdx} to ${startIdx + batchCount - 1}`);
      }

      // Verify users were actually inserted
      const verifyRes = await internalClient.query(
        `SELECT COUNT(*) as count FROM "ProjectUser" WHERE "tenancyId" = $1::uuid`,
        [tenancyId]
      );
      console.log(`Verified ${verifyRes.rows[0].count} users in internal DB`);

      console.log(`Waiting for sync...`);

      await waitForTable(externalClient, 'users');

      // Wait for all users to appear in the external DB
      await waitForCondition(
        async () => {
          const res = await externalClient.query(`SELECT COUNT(*) as count FROM "users"`);
          const count = parseInt(res.rows[0].count, 10);
          console.log(`Synced ${count}/${userCount} users`);
          return count >= userCount;
        },
        {
          description: `all ${userCount} users to sync to external DB`,
          timeoutMs: 480000, // 8 minutes
          intervalMs: 5000, // Check every 5 seconds
        }
      );

      // Verify the final count
      const finalRes = await externalClient.query(`SELECT COUNT(*) as count FROM "users"`);
      const finalCount = parseInt(finalRes.rows[0].count, 10);
      expect(finalCount).toBeGreaterThanOrEqual(userCount);

      // Spot-check a few specific users exist
      const firstUser = await externalClient.query(`SELECT * FROM "users" WHERE "primary_email" = $1`, ['hv-user-1@test.example.com']);
      expect(firstUser.rows).toHaveLength(1);

      const middleUser = await externalClient.query(`SELECT * FROM "users" WHERE "primary_email" = $1`, ['hv-user-750@test.example.com']);
      expect(middleUser.rows).toHaveLength(1);

      const lastUser = await externalClient.query(`SELECT * FROM "users" WHERE "primary_email" = $1`, [`hv-user-${userCount}@test.example.com`]);
      expect(lastUser.rows).toHaveLength(1);

      console.log(`Successfully synced all ${userCount} users!`);
    } finally {
      await internalClient.end();
    }
  }, HIGH_VOLUME_TIMEOUT);
});
