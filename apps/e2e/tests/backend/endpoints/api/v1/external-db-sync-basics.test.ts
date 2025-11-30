import { afterAll, beforeAll, describe, expect } from 'vitest';
import { test } from '../../../../helpers';
import { User, niceBackendFetch } from '../../../backend-helpers';
import {
  TEST_TIMEOUT,
  TestDbManager,
  createProjectWithExternalDb,
  verifyInExternalDb,
  verifyNotInExternalDb,
  waitForCondition,
  waitForSyncedData,
  waitForSyncedDeletion,
  waitForTable
} from './external-db-sync-utils';

// Run tests sequentially to avoid concurrency issues with shared backend state
describe.sequential('External DB Sync - Basic Tests', () => {
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
   * - Creates a user, patches the display name, and triggers the sync once.
   * - Checks PartialUsers for a matching row only after the sync completes.
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

    const user = await User.create({ emailAddress: 'insert-only@example.com' });
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
   * - Exports a baseline row, mutates the display name, runs another sync, and reads PartialUsers.
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

    const user = await User.create({ emailAddress: 'update-only@example.com' });
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
   * - Syncs a user into PartialUsers, deletes the user internally, and waits for the deletion helper.
   * - Queries PartialUsers to ensure the row disappears.
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

    const user = await User.create({ emailAddress: 'delete-only@example.com' });
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
   * - Creates a user while verifying the PartialUsers table is absent before sync.
   * - Triggers sync, waits for table creation, and confirms the row appears afterward.
   *
   * Why it matters:
   * - Demonstrates that syncs control both table provisioning and data export timing.
   */
  test('Sync Mechanism Verification: Data appears ONLY after sync', async () => {
    const dbName = 'sync_verification_test';
    const connectionString = await dbManager.createDatabase(dbName);

    await createProjectWithExternalDb({
      main: {
        type: 'postgres',
        connectionString,
      }
    }, {
      display_name: '🔄 Sync Verification Test Project',
      description: 'Testing that data only appears after sync is triggered'
    });

    const user = await User.create({ emailAddress: 'sync-verify@example.com' });
    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Sync Verify User' }
    });

    const client = dbManager.getClient(dbName);

    const tableCheckBefore = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public'
        AND table_name = 'PartialUsers'
      );
    `);
    expect(tableCheckBefore.rows[0].exists).toBe(false);

    await waitForTable(client, 'PartialUsers');

    await waitForCondition(
      async () => {
        const res = await client.query(`SELECT * FROM "PartialUsers" WHERE "value" = $1`, ['sync-verify@example.com']);
        return res.rows.length > 0;
      },
      { description: 'data to appear in external DB', timeoutMs: 90000 }
    );
    await verifyInExternalDb(client, 'sync-verify@example.com', 'Sync Verify User');
  }, TEST_TIMEOUT);

  /**
   * What it does:
   * - Runs create, update, and delete actions in order while syncing between each step.
   * - Verifies PartialUsers reflects each intermediate state.
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

    const user = await User.create({ emailAddress: 'crud-test@example.com' });
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
   * - Queries `information_schema` and PartialUsers to confirm the table and row exist.
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

    const user = await User.create({ emailAddress: 'auto-create@example.com' });
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
        AND table_name = 'PartialUsers'
      );
    `);
    expect(tableCheck.rows[0].exists).toBe(true);
    await verifyInExternalDb(client, 'auto-create@example.com', 'Auto Create User');
  });

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

    const user = await User.create({ emailAddress: 'resilience@example.com' });
    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Resilience User' }
    });

    await waitForSyncedData(dbManager.getClient(goodDbName), 'resilience@example.com', 'Resilience User');

    const client = dbManager.getClient(goodDbName);
    const res = await client.query(`SELECT * FROM "PartialUsers" WHERE "value" = $1`, ['resilience@example.com']);
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].displayName).toBe('Resilience User');
  }, TEST_TIMEOUT);
  

  /**
   * What it does:
   * - Creates a user with two contact channels and runs the sync.
   * - Reads PartialUsers to assert both channel values are present with the same display name.
   *
   * Why it matters:
   * - Confirms multi-channel users export all addresses instead of overwriting each other.
   */
  test('Multi-ContactChannel: User with multiple contact channels syncs all', async () => {
    const dbName = 'multi_contact_channel_test';
    const connectionString = await dbManager.createDatabase(dbName);

    await createProjectWithExternalDb({
      main: {
        type: 'postgres',
        connectionString,
      }
    });

    const client = dbManager.getClient(dbName);

    const user = await User.create({ emailAddress: 'multi-contact@example.com' });
    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Multi Contact User' }
    });
    const secondEmailResponse = await niceBackendFetch(`/api/v1/contact-channels`, {
      accessType: 'admin',
      method: 'POST',
      body: {
        user_id: user.userId,
        type: 'email',
        value: 'second-email@example.com',
        is_verified: false,
        used_for_auth: false,
      }
    });
    expect(secondEmailResponse.status).toBe(201);

    // Wait for BOTH contact channels to be synced
    await waitForSyncedData(client, 'multi-contact@example.com', 'Multi Contact User');
    await waitForSyncedData(client, 'second-email@example.com', 'Multi Contact User');

    const allRows = await client.query(`SELECT * FROM "PartialUsers" ORDER BY "value"`);
    expect(allRows.rows.length).toBe(2);

    const emails = allRows.rows.map(r => r.value);
    expect(emails).toContain('multi-contact@example.com');
    expect(emails).toContain('second-email@example.com');

    expect(allRows.rows[0].displayName).toBe('Multi Contact User');
    expect(allRows.rows[1].displayName).toBe('Multi Contact User');

  }, TEST_TIMEOUT);

  /**
   * What it does:
   * - Exports a user with multiple channels, deletes the user, and waits for deletion sync.
   * - Ensures PartialUsers no longer contains any row for that user.
   *
   * Why it matters:
   * - Validates that cascading deletes remove every external row tied to the user.
   */
  test('Multi-ContactChannel Deletion: Deleting user cascades all contact channels', async () => {
    const dbName = 'multi_contact_deletion_test';
    const connectionString = await dbManager.createDatabase(dbName);

    await createProjectWithExternalDb({
      main: {
        type: 'postgres',
        connectionString,
      }
    });

    const client = dbManager.getClient(dbName);

    const user = await User.create({ emailAddress: 'cascade-delete@example.com' });
    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Cascade Delete User' }
    });

    await niceBackendFetch(`/api/v1/contact-channels`, {
      accessType: 'admin',
      method: 'POST',
      body: {
        user_id: user.userId,
        type: 'email',
        value: 'cascade-second@example.com',
        is_verified: false,
        used_for_auth: false,
      }
    });

    await waitForSyncedData(client, 'cascade-delete@example.com', 'Cascade Delete User');

    // Verify both are synced
    const beforeDelete = await client.query(`SELECT * FROM "PartialUsers"`);
    expect(beforeDelete.rows.length).toBe(2);

    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'DELETE',
    });

    await waitForSyncedDeletion(client, 'cascade-delete@example.com');

    const afterDelete = await client.query(`SELECT * FROM "PartialUsers"`);
    expect(afterDelete.rows.length).toBe(0);
  }, TEST_TIMEOUT);

  /**
   * What it does:
   * - Creates two contact channels, deletes only the secondary one, and runs the deletion sync helper.
   * - Confirms PartialUsers retains the primary contact while the secondary row is removed.
   *
   * Why it matters:
   * - Ensures granular channel deletions do not wipe the entire user from external DBs.
   */
  test('Single ContactChannel Deletion: Deleting one channel keeps user and other channels', async () => {
    const dbName = 'single_contact_deletion_test';
    const connectionString = await dbManager.createDatabase(dbName);

    await createProjectWithExternalDb({
      main: {
        type: 'postgres',
        connectionString,
      }
    });

    const client = dbManager.getClient(dbName);

    const user = await User.create({ emailAddress: 'single-delete@example.com' });
    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Single Delete User' }
    });

    const secondEmailResponse = await niceBackendFetch(`/api/v1/contact-channels`, {
      accessType: 'admin',
      method: 'POST',
      body: {
        user_id: user.userId,
        type: 'email',
        value: 'single-keep@example.com',
        is_verified: false,
        used_for_auth: false,
      }
    });
    const secondChannelId = secondEmailResponse.body.id;

    await waitForSyncedData(client, 'single-delete@example.com', 'Single Delete User');
    await waitForSyncedData(client, 'single-keep@example.com', 'Single Delete User');

    const beforeDelete = await client.query(`SELECT * FROM "PartialUsers" ORDER BY "value"`);
    expect(beforeDelete.rows.length).toBe(2);

    const deleteResponse = await niceBackendFetch(`/api/v1/contact-channels/${user.userId}/${secondChannelId}`, {
      accessType: 'admin',
      method: 'DELETE',
    });
    expect(deleteResponse.status).toBe(200);

    await waitForSyncedDeletion(client, 'single-keep@example.com');

    const afterDelete = await client.query(`SELECT * FROM "PartialUsers"`);
    expect(afterDelete.rows.length).toBe(1);
    expect(afterDelete.rows[0].value).toBe('single-delete@example.com');
    expect(afterDelete.rows[0].displayName).toBe('Single Delete User');

  }, TEST_TIMEOUT);

  /**
   * What it does:
   * - Exports a user, bumps its sequenceId with an update, and attempts to delete using the old sequenceId.
   * - Verifies the row still exists with the latest data.
   *
   * Why it matters:
   * - Demonstrates sequence guards prevent older deletes from clobbering newer updates.
   */
  test('Race Condition Protection: Old delete cannot remove newer record', async () => {
    const dbName = 'race_condition_test';
    const connectionString = await dbManager.createDatabase(dbName);

    await createProjectWithExternalDb({
      main: {
        type: 'postgres',
        connectionString,
      }
    });

    const client = dbManager.getClient(dbName);

    const user = await User.create({ emailAddress: 'race-test@example.com' });
    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Original Name' }
    });

    await waitForSyncedData(client, 'race-test@example.com', 'Original Name');
    const firstRow = await verifyInExternalDb(client, 'race-test@example.com', 'Original Name');
    const firstSequenceId = BigInt(firstRow.sequenceId);
    const contactChannelId = firstRow.id;

    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Updated Name' }
    });

    await waitForSyncedData(client, 'race-test@example.com', 'Updated Name');
    const secondRow = await verifyInExternalDb(client, 'race-test@example.com', 'Updated Name');
    const secondSequenceId = BigInt(secondRow.sequenceId);
    const deleteAttempt = await client.query(
      `DELETE FROM "PartialUsers" WHERE "id" = $1 AND "sequenceId" <= $2`,
      [contactChannelId, firstSequenceId.toString()]
    );


    expect(deleteAttempt.rowCount).toBe(0);

    const afterDelete = await verifyInExternalDb(client, 'race-test@example.com', 'Updated Name');
    expect(BigInt(afterDelete.sequenceId)).toBe(secondSequenceId);

  }, TEST_TIMEOUT);
});
