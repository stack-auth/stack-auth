import { node } from '@elysiajs/node';
import { runAsynchronously } from '@hexclave/shared/dist/utils/promises';
import { Elysia } from 'elysia';
import { createExampleFungibleLedgerDatabase } from './databases/bulldozer/example-schema.js';

const bulldozerDb = await createExampleFungibleLedgerDatabase();

runAsynchronously(async () => {
  while (true) {
    try {
      await bulldozerDb.withSnapshotReplicated(async snapshot => await snapshot.tick(new Date()));
    } catch (error) {
      // TODO use captureError here when we merge this into the main repo
      console.error('Bulldozer tick failed. Continuing.', error);
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
});

const app = new Elysia({ adapter: node() })
  .get('/', () => 'Hello Elysia')
  .get('/bulldozer/tables', () => bulldozerDb.listTables())
  .listen(3000, ({ hostname, port }) => {
    console.log(`Elysia is running at ${hostname}:${port}`);
  });

export type App = typeof app
