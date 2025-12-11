import { afterAll, beforeAll, describe } from 'vitest';
import { test } from '../../../../helpers';
import { User, niceBackendFetch } from '../../../backend-helpers';
import {
  ClickhouseTestDbManager,
  TEST_TIMEOUT,
  createProjectWithExternalDb,
  waitForClickhouseDeletion,
  waitForClickhouseUser,
} from './external-db-sync-utils';

describe.sequential('External DB Sync - ClickHouse', () => {
  let dbManager: ClickhouseTestDbManager;

  beforeAll(async () => {
    dbManager = new ClickhouseTestDbManager();
    await dbManager.init();
  });

  afterAll(async () => {
    await dbManager.cleanup();
  });

  test('Syncs user lifecycle to ClickHouse', async () => {
    const { databaseName, connectionString } = await dbManager.createDatabase('clickhouse_basic');

    await createProjectWithExternalDb({
      analytics: {
        type: 'clickhouse',
        connectionString,
      }
    }, {
      display_name: 'ClickHouse Sync Project',
      description: 'Ensures external DB sync supports ClickHouse targets',
    });

    const user = await User.create({ emailAddress: 'clickhouse-sync@example.com' });
    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'ClickHouse User' }
    });

    await waitForClickhouseUser(databaseName, 'clickhouse-sync@example.com', 'ClickHouse User');

    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'PATCH',
      body: { display_name: 'Updated ClickHouse User' }
    });

    await waitForClickhouseUser(databaseName, 'clickhouse-sync@example.com', 'Updated ClickHouse User');

    await niceBackendFetch(`/api/v1/users/${user.userId}`, {
      accessType: 'admin',
      method: 'DELETE',
    });

    await waitForClickhouseDeletion(databaseName, 'clickhouse-sync@example.com');
  }, TEST_TIMEOUT);
});
