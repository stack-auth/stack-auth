import { Client } from 'pg';
import { expect } from 'vitest';
import { Project } from '../../../backend-helpers';


const PORT_PREFIX = process.env.NEXT_PUBLIC_STACK_PORT_PREFIX || '81';
export const POSTGRES_HOST = process.env.EXTERNAL_DB_TEST_HOST || `localhost:${PORT_PREFIX}32`;
export const POSTGRES_USER = process.env.EXTERNAL_DB_TEST_USER || 'postgres';
export const POSTGRES_PASSWORD = process.env.EXTERNAL_DB_TEST_PASSWORD || 'external-db-test-password';
export const TEST_TIMEOUT = 120000;
export const HIGH_VOLUME_TIMEOUT = 240000;

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
    });
    await this.setupClient.connect();
  }

  async createDatabase(dbName: string): Promise<string> {
    if (!this.setupClient) throw new Error('TestDbManager not initialized');

    const uniqueDbName = `${dbName}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;    
    await this.setupClient.query(`CREATE DATABASE "${uniqueDbName}"`);
    const connectionString = `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}/${uniqueDbName}`;
    const client = new Client({ connectionString });
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
    for (const client of this.databases.values()) {
      await client.end();
    }
    this.databases.clear();
    if (this.setupClient) {
      for (const dbName of this.databaseNames) {
        try {
          await this.setupClient.query(`DROP DATABASE IF EXISTS "${dbName}"`);
        } catch (err) {
          console.warn(`Failed to drop database ${dbName}:`, err);
        }
      }
      this.databaseNames.clear();

      await this.setupClient.end();
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
    if (await checkFn()) {
      return;
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
        res = await client.query(`SELECT * FROM "PartialUsers" WHERE "value" = $1`, [email]);
      } catch (err: any) {
        if (err && err.code === '42P01') {
          return false;
        }
        throw err;
      }
      if (res.rows.length === 0) {
        return false;
      }
      if (expectedName && res.rows[0].displayName !== expectedName) {
        return false;
      }
      return true;
    },
    {
      description: `data for ${email} to appear in external DB`,
      timeoutMs: 90000,
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
        res = await client.query(`SELECT * FROM "PartialUsers" WHERE "value" = $1`, [email]);
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
      timeoutMs: 90000,
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
      timeoutMs: 90000,
      intervalMs: 500,
    }
  );
}

/**
 * Helper to verify data does NOT exist in external DB
 */
export async function verifyNotInExternalDb(client: Client, email: string) {
  const res = await client.query(`SELECT * FROM "PartialUsers" WHERE "value" = $1`, [email]);
  expect(res.rows.length).toBe(0);
}

/**
 * Helper to verify data DOES exist in external DB
 */
export async function verifyInExternalDb(client: Client, email: string, expectedName?: string) {
  const res = await client.query(`SELECT * FROM "PartialUsers" WHERE "value" = $1`, [email]);
  expect(res.rows.length).toBe(1);
  if (expectedName) {
    expect(res.rows[0].displayName).toBe(expectedName);
  }
  return res.rows[0];
}

/**
 * Helper to count total users in external DB
 */
export async function countUsersInExternalDb(client: Client): Promise<number> {
  try {
    const res = await client.query(`SELECT COUNT(*) FROM "PartialUsers"`);
    return parseInt(res.rows[0].count, 10);
  } catch (err: any) {
    if (err && err.code === '42P01') {
      return 0;
    }
    throw err;
  }
}

/**
 * Helper to create a project and update its config with external DB settings
 */
export async function createProjectWithExternalDb(externalDatabases: any, projectOptions?: { display_name?: string, description?: string }) {
  const project = await Project.createAndSwitch(projectOptions);
  await Project.updateConfig({
    "dbSync.externalDatabases": externalDatabases
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

