import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { test } from '../../../../helpers';
import { Project, User, niceBackendFetch } from '../../../backend-helpers';
import {
  HIGH_VOLUME_TIMEOUT,
  TEST_TIMEOUT,
  TestDbManager,
  createProjectWithExternalDb as createProjectWithExternalDbRaw,
  verifyInExternalDb,
  verifyNotInExternalDb,
  waitForCondition,
  waitForSyncedData,
  waitForSyncedDeletion,
  waitForTable
} from './external-db-sync-utils';

async function runQueryForCurrentProject(body: { query: string, params?: Record<string, string>, timeout_ms?: number }) {
  return await niceBackendFetch("/api/v1/internal/analytics/query", {
    method: "POST",
    accessType: "admin",
    body,
  });
}

async function waitForClickhouseUser(email: string, expectedDisplayName: string) {
  const timeoutMs = 600_000;
  const intervalMs = 2_000;
  const start = performance.now();

  while (performance.now() - start < timeoutMs) {
    const response = await runQueryForCurrentProject({
      query: "SELECT primary_email, display_name FROM users WHERE primary_email = {email:String}",
      params: {
        email,
      },
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

async function waitForClickhouseUserDeletion(email: string) {
  const timeoutMs = 600_000;
  const intervalMs = 2_000;
  const start = performance.now();

  while (performance.now() - start < timeoutMs) {
    const response = await runQueryForCurrentProject({
      query: "SELECT primary_email FROM users WHERE primary_email = {email:String}",
      params: {
        email,
      },
    });
    if (
      response.status === 200
      && Array.isArray(response.body?.result)
      && response.body.result.length === 0
    ) {
      return;
    }
    await wait(intervalMs);
  }

  throw new StackAssertionError(`Timed out waiting for ClickHouse user ${email} to be deleted.`);
}

// Run tests sequentially to avoid concurrency issues with shared backend state
describe.sequential('External DB Sync - Basic Tests', () => {
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

  test("Updates to user are synced to ClickHouse", async ({ expect }) => {
    await Project.createAndSwitch({ config: { magic_link_enabled: true } });

    const user = await User.create({ primary_email: "clickhouse-update@example.com" });
    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: "admin",
      method: "PATCH",
      body: { display_name: "Before CH Update" },
    });

    await waitForClickhouseUser("clickhouse-update@example.com", "Before CH Update");

    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: "admin",
      method: "PATCH",
      body: { display_name: "After CH Update" },
    });

    const response = await waitForClickhouseUser("clickhouse-update@example.com", "After CH Update");
    expect(response.status).toBe(200);
    expect(response.body?.result?.[0]).toMatchObject({
      display_name: "After CH Update",
      primary_email: "clickhouse-update@example.com",
    });
  }, HIGH_VOLUME_TIMEOUT);

  test("Deleted user is removed from ClickHouse view", async ({ expect }) => {
    await Project.createAndSwitch({ config: { magic_link_enabled: true } });

    const user = await User.create({ primary_email: "clickhouse-delete@example.com" });
    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: "admin",
      method: "PATCH",
      body: { display_name: "CH Delete User" },
    });

    await waitForClickhouseUser("clickhouse-delete@example.com", "CH Delete User");

    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: "admin",
      method: "DELETE",
    });

    await waitForClickhouseUserDeletion("clickhouse-delete@example.com");
  }, HIGH_VOLUME_TIMEOUT);

  test("Syncs users to ClickHouse by default", async ({ expect }) => {
    await Project.createAndSwitch({ config: { magic_link_enabled: true } });

    const user = await User.create({ primary_email: "clickhouse-sync@example.com" });
    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: "admin",
      method: "PATCH",
      body: { display_name: "ClickHouse Sync User" },
    });

    const response = await waitForClickhouseUser("clickhouse-sync@example.com", "ClickHouse Sync User");
    expect(response.status).toBe(200);
    expect(response.body?.result?.[0]).toMatchObject({
      display_name: "ClickHouse Sync User",
      primary_email: "clickhouse-sync@example.com",
    });
  }, TEST_TIMEOUT);

  /**
   * What it does:
   * - Creates a user, patches the display name, and triggers the sync once.
   * - Checks the users table for a matching row only after the sync completes.
   *
   * Why it matters:
   * - Ensures inserts never appear externally until the sync pipeline runs.
   */
  test('Insert: New user is synced to external DB', async () => {
    const dbName = 'insert_only_test';
    const connectionString = await dbManager.createDatabase(dbName);

    await createProjectWithExternalDb({
      main: {
        type: 'postgres',
        connectionString,
      }
    });

    const client = dbManager.getClient(dbName);

    const user = await User.create({ primary_email: 'insert-only@example.com' });
    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Insert Only User' }
    });

    await waitForSyncedData(client, 'insert-only@example.com', 'Insert Only User');

    await verifyInExternalDb(client, 'insert-only@example.com', 'Insert Only User');
  }, TEST_TIMEOUT);

  /**
   * What it does:
   * - Exports a baseline row, mutates the display name, runs another sync, and reads users table.
   * - Compares the stored display name to guarantee it reflects the latest mutation.
   *
   * Why it matters:
   * - Proves updates propagate to the external DB instead of leaving stale data.
   */
  test('Update: Existing user changes are reflected in external DB', async () => {
    const dbName = 'update_only_test';
    const connectionString = await dbManager.createDatabase(dbName);

    await createProjectWithExternalDb({
      main: {
        type: 'postgres',
        connectionString,
      }
    });

    const client = dbManager.getClient(dbName);

    const user = await User.create({ primary_email: 'update-only@example.com' });
    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Before Update' }
    });

    await waitForSyncedData(client, 'update-only@example.com', 'Before Update');

    await verifyInExternalDb(client, 'update-only@example.com', 'Before Update');

    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'After Update' }
    });

    await waitForSyncedData(client, 'update-only@example.com', 'After Update');

    await verifyInExternalDb(client, 'update-only@example.com', 'After Update');
  }, TEST_TIMEOUT);

  /**
   * What it does:
   * - Syncs a user into the users table, deletes the user internally, and waits for the deletion helper.
   * - Queries users table to ensure the row disappears.
   *
   * Why it matters:
   * - Validates deletion events propagate and prevent orphaned rows in external DBs.
   */
  test('Delete: Deleted user is removed from external DB', async () => {
    const dbName = 'delete_only_test';
    const connectionString = await dbManager.createDatabase(dbName);

    await createProjectWithExternalDb({
      main: {
        type: 'postgres',
        connectionString,
      }
    }, {
      display_name: '🗑️ Delete Test Project',
      description: 'Testing deletion sync to external database'
    });

    const client = dbManager.getClient(dbName);

    const user = await User.create({ primary_email: 'delete-only@example.com' });
    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Delete Only User' }
    });

    await waitForSyncedData(client, 'delete-only@example.com', 'Delete Only User');

    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'DELETE',
    });
    const deletedUserResponse = await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'GET',
    });
    expect(deletedUserResponse.status).toBe(404);

    await waitForSyncedDeletion(client, 'delete-only@example.com');
    await verifyNotInExternalDb(client, 'delete-only@example.com');
  }, TEST_TIMEOUT);

  /**
   * What it does:
   * - Creates a user while verifying the users table is absent before sync.
   * - Triggers sync, waits for table creation, and confirms the row appears afterward.
   *
   * Why it matters:
   * - Demonstrates that syncs control both table provisioning and data export timing.
   */
  test('Sync Mechanism Verification: Data appears ONLY after sync', async () => {
    const dbName = 'sync_verification_test';
    const connectionString = await dbManager.createDatabase(dbName);

    const client = dbManager.getClient(dbName);

    // Verify the fresh database has no users table BEFORE we configure sync
    const tableCheckBefore = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public'
        AND table_name = 'users'
      );
    `);
    expect(tableCheckBefore.rows[0].exists).toBe(false);

    // Now configure the external DB - this will trigger sync
    await createProjectWithExternalDb({
      main: {
        type: 'postgres',
        connectionString,
      }
    }, {
      display_name: '🔄 Sync Verification Test Project',
      description: 'Testing that data only appears after sync is triggered'
    });

    const user = await User.create({ primary_email: 'sync-verify@example.com' });
    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Sync Verify User' }
    });

    // Wait for sync to create the table and populate data
    await waitForTable(client, 'users');

    await waitForSyncedData(client, 'sync-verify@example.com', 'Sync Verify User');
    await verifyInExternalDb(client, 'sync-verify@example.com', 'Sync Verify User');
  }, TEST_TIMEOUT);

  /**
   * What it does:
   * - Runs create, update, and delete actions in order while syncing between each step.
   * - Verifies the users table reflects each intermediate state.
   *
   * Why it matters:
   * - Confirms the sync handles the entire lifecycle without leaving stale records.
   */
  test('Full CRUD Lifecycle: Create, Update, Delete', async () => {
    const dbName = 'crud_lifecycle_test';
    const connectionString = await dbManager.createDatabase(dbName);

    await createProjectWithExternalDb({
      main: {
        type: 'postgres',
        connectionString,
      }
    });

    const client = dbManager.getClient(dbName);

    const user = await User.create({ primary_email: 'crud-test@example.com' });
    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Original Name' }
    });

    await waitForSyncedData(client, 'crud-test@example.com', 'Original Name');

    await verifyInExternalDb(client, 'crud-test@example.com', 'Original Name');

    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Updated Name' }
    });

    await waitForSyncedData(client, 'crud-test@example.com', 'Updated Name');
    await verifyInExternalDb(client, 'crud-test@example.com', 'Updated Name');

    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'DELETE',
    });

    await waitForSyncedDeletion(client, 'crud-test@example.com');

    await verifyNotInExternalDb(client, 'crud-test@example.com');
  }, TEST_TIMEOUT);

  /**
   * What it does:
   * - Syncs a user into an empty database to trigger table auto-creation.
   * - Queries `information_schema` and users table to confirm the table and row exist.
   *
   * Why it matters:
   * - Ensures mappings can provision their own schema without manual migrations.
   */
  test('Automatic Table Creation', async () => {
    const dbName = 'auto_table_creation_test';
    const connectionString = await dbManager.createDatabase(dbName);

    await createProjectWithExternalDb({
      main: {
        type: 'postgres',
        connectionString,
      }
    });

    const user = await User.create({ primary_email: 'auto-create@example.com' });
    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Auto Create User' }
    });

    const client = dbManager.getClient(dbName);

    await waitForSyncedData(client, 'auto-create@example.com', 'Auto Create User');

    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public'
        AND table_name = 'users'
      );
    `);
    expect(tableCheck.rows[0].exists).toBe(true);
    await verifyInExternalDb(client, 'auto-create@example.com', 'Auto Create User');
  }, TEST_TIMEOUT);

  /**
   * What it does:
   * - Configures one valid and one invalid external DB mapping for the same project.
   * - Runs sync and verifies the healthy DB still receives the exported row.
   *
   * Why it matters:
   * - Shows a failing database connection does not block successful targets.
   */
  test('Resilience: One bad DB should not crash the sync', async () => {
    const goodDbName = 'resilience_good_db';
    const goodConnectionString = await dbManager.createDatabase(goodDbName);
    const badConnectionString = 'postgresql://invalid:invalid@invalid:5432/invalid';

    await createProjectWithExternalDb({
      good_db: {
        type: 'postgres',
        connectionString: goodConnectionString,
      },
      bad_db: {
        type: 'postgres',
        connectionString: badConnectionString,
      }
    });

    const user = await User.create({ primary_email: 'resilience@example.com' });
    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Resilience User' }
    });

    await waitForSyncedData(dbManager.getClient(goodDbName), 'resilience@example.com', 'Resilience User');

    const client = dbManager.getClient(goodDbName);
    const res = await client.query(`SELECT * FROM "users" WHERE "primary_email" = $1`, ['resilience@example.com']);
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].display_name).toBe('Resilience User');
  }, TEST_TIMEOUT);

  /**
   * What it does:
   * - Creates a user with a primary email and adds a secondary email.
   * - Verifies only one user row exists (the new schema is user-centric, not channel-centric).
   * - Confirms the primary_email field contains the primary email.
   *
   * Why it matters:
   * - Validates that the new user-centric schema syncs users, not individual contact channels.
   */
  test('User with multiple emails: Only one row synced with primary email', async () => {
    const dbName = 'multi_email_test';
    const connectionString = await dbManager.createDatabase(dbName);

    await createProjectWithExternalDb({
      main: {
        type: 'postgres',
        connectionString,
      }
    });

    const client = dbManager.getClient(dbName);

    const user = await User.create({ primary_email: 'primary@example.com' });
    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Multi Email User' }
    });

    // Add a secondary email
    const secondEmailResponse = await niceBackendFetch(`/api/v1/contact-channels`, {
      accessType: 'admin',
      method: 'POST',
      body: {
        user_id: user.userId,
        type: 'email',
        value: 'secondary@example.com',
        is_verified: false,
        used_for_auth: false,
      }
    });
    expect(secondEmailResponse.status).toBe(201);

    await waitForSyncedData(client, 'primary@example.com', 'Multi Email User');

    // Should only have ONE row per user (the new schema is user-centric)
    const allRows = await client.query(`SELECT * FROM "users"`);
    expect(allRows.rows.length).toBe(1);

    // The row should have the primary email
    expect(allRows.rows[0].primary_email).toBe('primary@example.com');
    expect(allRows.rows[0].display_name).toBe('Multi Email User');
  }, TEST_TIMEOUT);

  /**
   * What it does:
   * - Creates a user, updates it multiple times, verifies each update is reflected.
   * - Checks that the metadata table tracks the last synced sequence_id.
   *
   * Why it matters:
   * - Demonstrates that updates are properly synced and metadata tracking works.
   */
  test('Updates are synced correctly and metadata tracks progress', async () => {
    const dbName = 'update_tracking_test';
    const connectionString = await dbManager.createDatabase(dbName);

    await createProjectWithExternalDb({
      main: {
        type: 'postgres',
        connectionString,
      }
    });

    const client = dbManager.getClient(dbName);

    const user = await User.create({ primary_email: 'update-test@example.com' });
    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Original Name' }
    });

    await waitForSyncedData(client, 'update-test@example.com', 'Original Name');
    await verifyInExternalDb(client, 'update-test@example.com', 'Original Name');

    // Check metadata table exists and has a positive sequence_id
    const metadata1 = await client.query(
      `SELECT "last_synced_sequence_id" FROM "_stack_sync_metadata" WHERE "mapping_name" = 'users'`
    );
    expect(metadata1.rows.length).toBe(1);
    const seq1 = Number(metadata1.rows[0].last_synced_sequence_id);
    expect(seq1).toBeGreaterThan(0);

    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Updated Name' }
    });

    await waitForSyncedData(client, 'update-test@example.com', 'Updated Name');
    await verifyInExternalDb(client, 'update-test@example.com', 'Updated Name');

    // Metadata should have advanced
    const metadata2 = await client.query(
      `SELECT "last_synced_sequence_id" FROM "_stack_sync_metadata" WHERE "mapping_name" = 'users'`
    );
    const seq2 = Number(metadata2.rows[0].last_synced_sequence_id);
    expect(seq2).toBeGreaterThan(seq1);
  }, TEST_TIMEOUT);


  /**
   * What it does:
   * - Reads the external DB sync fusebox settings.
   * - Writes the same values back to confirm the update endpoint.
   *
   * Why it matters:
   * - Ensures internal fusebox controls are reachable and validated.
   */
  test('Fusebox endpoint returns and accepts enablement flags', async () => {
    const getResponse = await niceBackendFetch('/api/latest/internal/external-db-sync/fusebox', {
      accessType: 'admin',
    });

    expect(getResponse.status).toBe(200);
    expect(getResponse.body).toMatchObject({
      ok: true,
      sequencer_enabled: expect.any(Boolean),
      poller_enabled: expect.any(Boolean),
    });

    const postResponse = await niceBackendFetch('/api/latest/internal/external-db-sync/fusebox', {
      accessType: 'admin',
      method: 'POST',
      body: {
        sequencer_enabled: getResponse.body.sequencer_enabled,
        poller_enabled: getResponse.body.poller_enabled,
      },
    });

    expect(postResponse.status).toBe(200);
    expect(postResponse.body).toMatchObject({
      ok: true,
      sequencer_enabled: getResponse.body.sequencer_enabled,
      poller_enabled: getResponse.body.poller_enabled,
    });
  }, TEST_TIMEOUT);

});


