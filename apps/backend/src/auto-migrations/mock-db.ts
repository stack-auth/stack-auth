import { PGlite } from '@electric-sql/pglite';
import net from 'node:net';
import { Client } from 'pg';
import { fromNodeSocket } from 'pg-gateway/node';

async function getUnusedRandomPort() {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        const port = address.port;
        server.close(() => {
          resolve(port);
        });
      } else {
        server.close();
        reject(new Error('Failed to get server address'));
      }
    });

    server.on('error', (err) => {
      reject(err);
    });
  });
}

export const createMockDb = async (port?: number) => {
  const db = new PGlite();

  const server = net.createServer((async (socket: any) => {
    let activeDb: PGlite;

    await fromNodeSocket(socket, {
      serverVersion: '16.3',

      auth: {
        // No password required
        method: 'trust',
      },

      async onStartup({ clientParams }) {
        // If the DB is the Prisma shadow DB, create a temp in-memory instance
        if (clientParams?.database === 'prisma-shadow') {
          activeDb = new PGlite();
        } else {
          activeDb = db;
        }

        // Wait for PGlite to be ready before further processing
        await activeDb.waitReady;
      },

      async onMessage(data, { isAuthenticated }) {
        if (!isAuthenticated) {
          // currently we have no authentication, but let's keep it for the future
          return;
        }

        // Forward raw message to PGlite and send response to client
        return await activeDb.execProtocolRaw(data);
      },
    });
  }) as any);

  if (!port) {
    port = await getUnusedRandomPort();
  }

  server.listen(port);

  return {
    db,
    server,
    port,
  };
};


import.meta.vitest?.test("connects to DB", async ({ expect }) => {
  const { server, port } = await createMockDb();

  const client = new Client({
    host: 'localhost',
    port: port,
    database: 'test',
  });

  await client.connect();
  const result = await client.query('SELECT 1 as test');
  expect(result.rows[0].test).toBe(1);
  await client.end();

  server.close();
});
