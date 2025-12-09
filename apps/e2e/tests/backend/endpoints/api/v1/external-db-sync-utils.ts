import { Client, ClientConfig } from 'pg';
import { expect } from 'vitest';
import { niceFetch, STACK_BACKEND_BASE_URL } from '../../../../helpers';
import { Project } from '../../../backend-helpers';


const PORT_PREFIX = process.env.NEXT_PUBLIC_STACK_PORT_PREFIX || '81';
export const POSTGRES_HOST = process.env.EXTERNAL_DB_TEST_HOST || `localhost:${PORT_PREFIX}28`;
export const POSTGRES_USER = process.env.EXTERNAL_DB_TEST_USER || 'postgres';
export const POSTGRES_PASSWORD = process.env.EXTERNAL_DB_TEST_PASSWORD || 'PASSWORD-PLACEHOLDER--uqfEC1hmmv';
export const TEST_TIMEOUT = 120000;
export const HIGH_VOLUME_TIMEOUT = 600000; // 10 minutes for 1500+ users

const CLICKHOUSE_BASE_HOST = process.env.EXTERNAL_CLICKHOUSE_TEST_HOST || `http://localhost:${PORT_PREFIX}33`;
export const CLICKHOUSE_USER = process.env.EXTERNAL_CLICKHOUSE_TEST_USER || 'stackframe';
export const CLICKHOUSE_PASSWORD = process.env.EXTERNAL_CLICKHOUSE_TEST_PASSWORD || 'PASSWORD-PLACEHOLDER--9gKyMxJeMx';

// Connection settings to prevent connection leaks
const CLIENT_CONFIG: Partial<ClientConfig> = {
  // Timeout for connecting (10 seconds)
  connectionTimeoutMillis: 10000,
  // Timeout for queries (30 seconds)
  query_timeout: 30000,
  // Timeout for idle connections (60 seconds)
  idle_in_transaction_session_timeout: 60000,
};

// Track all projects created with external DB configs for cleanup
type ProjectContext = {
  projectId: string,
  adminAccessToken: string,
};
const createdProjects: ProjectContext[] = [];

/**
 * Helper class to manage external test databases
 */
export class TestDbManager {
  private setupClient: Client | null = null;
  private databases: Map<string, Client> = new Map();
  private databaseNames: Set<string> = new Set();

  async init() {
    this.setupClient = new Client({
      connectionString: `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}/postgres`,
      ...CLIENT_CONFIG,
    });
    await this.setupClient.connect();
  }

  async createDatabase(dbName: string): Promise<string> {
    if (!this.setupClient) throw new Error('TestDbManager not initialized');

    const uniqueDbName = `${dbName}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await this.setupClient.query(`CREATE DATABASE "${uniqueDbName}"`);
    const connectionString = `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}/${uniqueDbName}`;
    const client = new Client({
      connectionString,
      ...CLIENT_CONFIG,
    });
    await client.connect();

    this.databases.set(dbName, client);
    this.databaseNames.add(uniqueDbName);
    return connectionString;
  }

  getClient(dbName: string): Client {
    const client = this.databases.get(dbName);
    if (!client) throw new Error(`Database ${dbName} not found`);
    return client;
  }

  async cleanup() {
    // First, clean up all project configs to stop the sync cron from trying to connect
    await cleanupAllProjectConfigs();

    // Close all tracked database clients
    const closePromises = Array.from(this.databases.values()).map(async (client) => {
      try {
        await Promise.race([
          client.end(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Client close timeout')), 5000)),
        ]);
      } catch (err) {
        // Ignore errors when closing clients - they may already be closed or timed out
      }
    });
    await Promise.all(closePromises);
    this.databases.clear();

    if (this.setupClient) {
      // Terminate all connections and drop databases
      for (const dbName of this.databaseNames) {
        try {
          // Forcefully terminate ALL connections to this database
          await this.setupClient.query(`
            SELECT pg_terminate_backend(pg_stat_activity.pid)
            FROM pg_stat_activity
            WHERE pg_stat_activity.datname = $1
              AND pid <> pg_backend_pid()
          `, [dbName]);

          // Small delay to ensure connections are terminated
          await new Promise(r => setTimeout(r, 100));

          await this.setupClient.query(`DROP DATABASE IF EXISTS "${dbName}"`);
        } catch (err) {
          console.warn(`Failed to drop database ${dbName}:`, err);
        }
      }
      this.databaseNames.clear();

      try {
        await this.setupClient.end();
      } catch (err) {
        // Ignore errors when closing setup client
      }
      this.setupClient = null;
    }
  }
}


/**
 * Wait for a condition to be true by polling, with timeout
 */
export async function waitForCondition(
  checkFn: () => Promise<boolean>,
  options: { timeoutMs?: number, intervalMs?: number, description?: string } = {}
): Promise<void> {
  const { timeoutMs = 10000, intervalMs = 100, description = 'condition' } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      if (await checkFn()) {
        return;
      }
    } catch (err: any) {
      // If the error is a connection error, wait and retry
      if (err?.code === '57P01' || err?.code === '08006' || err?.code === '53300') {
        // Connection terminated, connection failure, or too many clients
        await new Promise(r => setTimeout(r, intervalMs));
        continue;
      }
      throw err;
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }

  throw new Error(`Timeout waiting for ${description} after ${timeoutMs}ms`);
}

/**
 * Wait for data to appear in external DB (relies on automatic cron job)
 */
export async function waitForSyncedData(client: Client, email: string, expectedName?: string) {

  await waitForCondition(
    async () => {
      let res;
      try {
        res = await client.query(`SELECT * FROM "users" WHERE "primary_email" = $1`, [email]);
      } catch (err: any) {
        if (err && err.code === '42P01') {
          return false;
        }
        throw err;
      }
      if (res.rows.length === 0) {
        return false;
      }
      if (expectedName && res.rows[0].display_name !== expectedName) {
        return false;
      }
      return true;
    },
    {
      description: `data for ${email} to appear in external DB`,
      timeoutMs: 120000,
      intervalMs: 500,
    }
  );
}

/**
 * Wait for data to be removed from external DB (relies on automatic cron job)
 */
export async function waitForSyncedDeletion(client: Client, email: string) {
  await waitForCondition(
    async () => {
      let res;
      try {
        res = await client.query(`SELECT * FROM "users" WHERE "primary_email" = $1`, [email]);
      } catch (err: any) {
        if (err && err.code === '42P01') {
          return false;
        }
        throw err;
      }
      return res.rows.length === 0;
    },
    {
      description: `data for ${email} to be removed from external DB`,
      timeoutMs: 120000,
      intervalMs: 500,
    }
  );
}

/**
 * Wait for table to be created (relies on automatic cron job)
 */
export async function waitForTable(client: Client, tableName: string) {
  await waitForCondition(
    async () => {
      const res = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public'
          AND table_name = $1
        );
      `, [tableName]);
      const exists = res.rows[0].exists;
      return exists;
    },
    {
      description: `table ${tableName} to be created`,
      timeoutMs: 120000,
      intervalMs: 500,
    }
  );
}

/**
 * Helper to verify data does NOT exist in external DB
 */
export async function verifyNotInExternalDb(client: Client, email: string) {
  const res = await client.query(`SELECT * FROM "users" WHERE "primary_email" = $1`, [email]);
  expect(res.rows.length).toBe(0);
}

/**
 * Helper to verify data DOES exist in external DB
 */
export async function verifyInExternalDb(client: Client, email: string, expectedName?: string) {
  const res = await client.query(`SELECT * FROM "users" WHERE "primary_email" = $1`, [email]);
  expect(res.rows.length).toBe(1);
  if (expectedName) {
    expect(res.rows[0].display_name).toBe(expectedName);
  }
  return res.rows[0];
}

/**
 * Helper to count total users in external DB
 */
export async function countUsersInExternalDb(client: Client): Promise<number> {
  try {
    const res = await client.query(`SELECT COUNT(*) FROM "users"`);
    return parseInt(res.rows[0].count, 10);
  } catch (err: any) {
    if (err && err.code === '42P01') {
      return 0;
    }
    throw err;
  }
}

const CLICKHOUSE_BASE_URL = CLICKHOUSE_BASE_HOST.startsWith('http')
  ? CLICKHOUSE_BASE_HOST
  : `http://${CLICKHOUSE_BASE_HOST}`;

function getClickhouseBaseUrl() {
  try {
    return new URL(CLICKHOUSE_BASE_URL);
  } catch (err) {
    throw new Error(`Invalid ClickHouse base URL: ${CLICKHOUSE_BASE_URL}`);
  }
}

function escapeClickhouseLiteral(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function clickhouseRequest(
  query: string,
  options: { database?: string, format?: 'JSON' | 'TabSeparated' } = {},
) {
  const url = getClickhouseBaseUrl();
  url.pathname = '/';
  if (options.database) {
    url.searchParams.set('database', options.database);
  }
  url.searchParams.set('default_format', options.format ?? 'JSON');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      Authorization: `Basic ${Buffer.from(`${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}`).toString('base64')}`,
    },
    body: query,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ClickHouse query failed (${response.status}): ${errorText}`);
  }

  if ((options.format ?? 'JSON') === 'JSON') {
    return await response.json();
  }
  return await response.text();
}

function buildClickhouseConnectionString(databaseName: string) {
  const url = getClickhouseBaseUrl();
  url.username = CLICKHOUSE_USER;
  url.password = CLICKHOUSE_PASSWORD;
  url.pathname = `/${databaseName}`;
  return url.toString();
}

export class ClickhouseTestDbManager {
  private databaseNames: Set<string> = new Set();

  async init() {
    await clickhouseRequest('SELECT 1', { database: 'system' });
  }

  async createDatabase(dbName: string): Promise<{ databaseName: string, connectionString: string }> {
    const uniqueDbName = `${dbName}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await clickhouseRequest(`CREATE DATABASE IF NOT EXISTS ${uniqueDbName}`, { database: 'default', format: 'TabSeparated' });
    this.databaseNames.add(uniqueDbName);

    return {
      databaseName: uniqueDbName,
      connectionString: buildClickhouseConnectionString(uniqueDbName),
    };
  }

  async cleanup() {
    await cleanupAllProjectConfigs();

    for (const name of this.databaseNames) {
      try {
        await clickhouseRequest(`DROP DATABASE IF EXISTS ${name}`, { database: 'default', format: 'TabSeparated' });
      } catch (err) {
        console.warn(`Failed to drop ClickHouse database ${name}:`, err);
      }
    }
    this.databaseNames.clear();
  }
}

async function fetchClickhouseUsers(databaseName: string, email: string) {
  const escapedEmail = escapeClickhouseLiteral(email);
  try {
    const result: any = await clickhouseRequest(
      `
      SELECT *
      FROM users FINAL
      WHERE primary_email = '${escapedEmail}' AND is_deleted = 0
      FORMAT JSON
    `,
      { database: databaseName },
    );
    return result?.data ?? [];
  } catch (err: any) {
    if (
      err instanceof Error &&
      (
        err.message.includes('does not exist') ||
        err.message.includes("doesn't exist") ||
        err.message.includes('Unknown table')
      )
    ) {
      return [];
    }
    throw err;
  }
}

export async function waitForClickhouseUser(databaseName: string, email: string, expectedName?: string) {
  await waitForCondition(
    async () => {
      const rows = await fetchClickhouseUsers(databaseName, email);
      if (rows.length === 0) {
        return false;
      }
      if (expectedName && rows[0].display_name !== expectedName) {
        return false;
      }
      return true;
    },
    {
      description: `ClickHouse data for ${email} to appear in external DB`,
      timeoutMs: 120000,
      intervalMs: 500,
    }
  );
}

export async function waitForClickhouseDeletion(databaseName: string, email: string) {
  await waitForCondition(
    async () => {
      const rows = await fetchClickhouseUsers(databaseName, email);
      return rows.length === 0;
    },
    {
      description: `ClickHouse data for ${email} to be removed from external DB`,
      timeoutMs: 120000,
      intervalMs: 500,
    }
  );
}

/**
 * Helper to create a project and update its config with external DB settings.
 * Tracks the project for cleanup later.
 */
export async function createProjectWithExternalDb(externalDatabases: any, projectOptions?: { display_name?: string, description?: string }) {
  const project = await Project.createAndSwitch(projectOptions);
  await Project.updateConfig({
    "dbSync.externalDatabases": externalDatabases
  });

  // Track this project for cleanup
  createdProjects.push({
    projectId: project.projectId,
    adminAccessToken: project.adminAccessToken,
  });

  return project;
}

/**
 * Helper to remove external DB config from current project
 */
export async function cleanupProjectExternalDb() {
  await Project.updateConfig({
    "dbSync.externalDatabases": {}
  });
}

/**
 * Clean up external DB configs for all tracked projects.
 * This prevents the sync cron from trying to connect to deleted databases.
 *
 * Note: This function makes direct HTTP calls instead of using backendContext
 * because it runs in afterAll, which is outside the test context.
 */
export async function cleanupAllProjectConfigs() {
  for (const project of createdProjects) {
    try {
      // Make direct HTTP call to clear the external DB config
      await niceFetch(new URL('/api/latest/internal/config/override', STACK_BACKEND_BASE_URL), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-stack-project-id': project.projectId,
          'x-stack-admin-access-token': project.adminAccessToken,
        },
        body: JSON.stringify({
          config_override_string: JSON.stringify({ "dbSync.externalDatabases": {} })
        }),
      });
    } catch (err) {
      // Ignore errors - project might have been deleted or config update might fail
      console.warn(`Failed to cleanup project ${project.projectId}:`, err);
    }
  }

  // Clear the tracked projects
  createdProjects.length = 0;
}
