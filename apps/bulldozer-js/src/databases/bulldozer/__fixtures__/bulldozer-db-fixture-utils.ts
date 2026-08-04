/**
 * Shared helpers for the whole-database (server-level) serialization compatibility checks. These
 * complement the augmented-tree-map fixtures (which pin a single tree's shape) by freezing an entire
 * persisted Bulldozer database — every derived table, its groups and rows — as it is actually written
 * to the low-level KV backend, then proving that the current code reads the complete database back
 * consistently.
 *
 * Two things are frozen for each fixture:
 *   - the low-level KV contents (`stores`/`dumps`): the exact key/value bytes the piledriver layer
 *     persists, base64-encoded. This is the on-disk output of the database (what an LMDB `data.mdb`
 *     stores as its values); keeping it as portable base64 KV pairs — rather than a raw `.mdb` binary
 *     — makes the fixture diffable, platform-independent, and decoupled from third-party LMDB file
 *     format quirks, while still exercising our own value (de)serialization end-to-end.
 *   - the `readModel`: the full logical state of the database (all tables → groups → rows), which a
 *     reader must reproduce exactly after deserializing the KV contents.
 *
 * Everything here depends only on the long-stable public Bulldozer/piledriver API plus the checked-in
 * `exampleFungibleLedgerMigrations`, so this module also imports cleanly under older checkouts of the
 * repo (which the cross-version CI job relies on when running against the base branch).
 */
import { decodeBase64, encodeBase64 } from "@hexclave/shared/dist/utils/bytes";
import { DatabaseSeq } from "../../index.js";
import { LowLevelDatabase, LowLevelDatabaseDebugSnapshot, LowLevelKvDump, LowLevelKvStore } from "../../low-level/index.js";
import { PiledriverObject, declarePiledriverDatabase, isPiledriverHeapObjectSymbol } from "../../piledriver/index.js";
import { BulldozerDatabase, declareBulldozerDatabase } from "../index.js";
import { exampleFungibleLedgerMigrations } from "../example-schema.js";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

// A single persisted key/value pair, encoded so the fixture is a plain, diffable JSON document.
export type KvEntry = { keyBase64: string, valueBase64: string };

// The full logical state of the database, table by table. Reproducing this exactly after loading the
// KV contents is the consistency check.
export type ReadModelRow = { rowIdentifier: string, rowSortKey: Json, rowData: Json };
export type ReadModelGroup = { groupKey: Json, rows: ReadModelRow[] };
export type ReadModelTable = { tableId: string, groups: ReadModelGroup[] };
export type BulldozerReadModel = ReadModelTable[];

// A self-describing whole-database dump: the persisted KV contents plus the read model the writer
// observed. A reader passes iff, after loading the KV contents, it reproduces the read model.
export type BulldozerDbDump = {
  stores: Record<string, KvEntry[]>,
  dumps: Record<string, KvEntry[]>,
  readModel: BulldozerReadModel,
};

const storedTableId = "ledgerEntries";

// The deterministic workload every writer applies, so dumps from different code versions are directly
// comparable. Kept inline (rather than imported from example-schema) so the module stays self-contained
// when overlaid onto an older checkout that predates any change to the shared example rows.
const fixtureLedgerRows: Record<string, PiledriverObject> = {
  "entry-001": { accountId: "acct-alice", asset: "USD", amount: "1200", side: "credit", txHash: "0xaaa001", blockNumber: 100, timestamp: "2026-01-01T00:00:00.000Z", counterparty: "acct-bob", memo: "invoice payment" },
  "entry-002": { accountId: "acct-alice", asset: "USD", amount: "250", side: "debit", txHash: "0xaaa002", blockNumber: 104, timestamp: "2026-01-01T00:02:00.000Z", counterparty: "acct-carol", memo: "vendor payout" },
  "entry-003": { accountId: "acct-bob", asset: "ETH", amount: "2.5", side: "credit", txHash: "0xbbb001", blockNumber: 108, timestamp: "2026-01-01T00:04:00.000Z", counterparty: "acct-alice", memo: "bridge settlement" },
  "entry-004": { accountId: "acct-carol", asset: "USD", amount: "1800", side: "debit", txHash: "0xccc001", blockNumber: 111, timestamp: "2026-01-01T00:06:00.000Z", counterparty: "acct-alice", memo: "treasury move" },
  "entry-005": { accountId: "acct-bob", asset: "USD", amount: "90", side: "debit", txHash: "0xbbb002", blockNumber: 115, timestamp: "2026-01-01T00:08:00.000Z", counterparty: null, memo: "fee" },
  "entry-006": { accountId: "acct-alice", asset: "ETH", amount: "4.0", side: "debit", txHash: "0xaaa003", blockNumber: 120, timestamp: "2026-01-01T00:10:00.000Z", counterparty: "acct-bob", memo: "rebalance" },
};

// Builds a fresh Bulldozer database (example ledger schema) on top of the given low-level backend,
// applies the migrations, and runs the deterministic workload.
export async function buildFixtureBulldozerDatabase(lowLevel: LowLevelDatabase): Promise<BulldozerDatabase> {
  const db = declareBulldozerDatabase(declarePiledriverDatabase(lowLevel), { migrations: exampleFungibleLedgerMigrations });
  await db.applyRemainingMigrations();
  await db.withSnapshotReplicated(async snapshot => {
    for (const [rowIdentifier, rowData] of Object.entries(fixtureLedgerRows)) {
      snapshot = (await snapshot.setOrDeleteRow({ tableId: storedTableId, rowIdentifier, newRowData: rowData })).newSnapshot;
    }
    return snapshot;
  });
  return db;
}

// Resolves every heap reference into its inline content, producing a plain-JSON view of a persisted
// value. Group keys and row data may contain heap objects, which we must dereference before comparing.
async function resolveHeap(value: PiledriverObject): Promise<Json> {
  if (value === null || typeof value !== "object") return value;
  if (isPiledriverHeapObjectSymbol in value) return await resolveHeap(await value.get());
  if (Array.isArray(value)) return await Promise.all(value.map(resolveHeap));
  const out: { [key: string]: Json } = {};
  for (const [key, child] of Object.entries(value)) out[key] = await resolveHeap(child);
  return out;
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of iterable) result.push(item);
  return result;
}

// Reads the entire database: every table, every group, every row. The result is deterministic (the
// backing B-trees are ordered), so it is a stable attestation of the complete logical state.
export async function computeReadModel(db: BulldozerDatabase): Promise<BulldozerReadModel> {
  const { snapshot } = await db.getSnapshot();
  const tables = db.listTables().map(descriptor => descriptor.tableId).sort();
  const readModel: BulldozerReadModel = [];
  for (const tableId of tables) {
    const groups: ReadModelGroup[] = [];
    for (const { groupKey } of await collect(snapshot.listGroups({ tableId, range: {} }))) {
      const rows: ReadModelRow[] = [];
      for (const row of await collect(snapshot.listRowsInGroup({ tableId, groupKey, range: {} }))) {
        rows.push({
          rowIdentifier: row.rowIdentifier,
          rowSortKey: await resolveHeap(row.rowSortKey),
          rowData: await resolveHeap(row.rowData),
        });
      }
      groups.push({ groupKey: await resolveHeap(groupKey), rows });
    }
    readModel.push({ tableId, groups });
  }
  return readModel;
}

// Serializes a low-level backend's current contents into a portable, base64-encoded KV document.
function kvEntriesFromDebugSnapshot(snapshot: LowLevelDatabaseDebugSnapshot): { stores: Record<string, KvEntry[]>, dumps: Record<string, KvEntry[]> } {
  const map = (entries: LowLevelDatabaseDebugSnapshot["stores"][string]): KvEntry[] =>
    entries.map(entry => ({ keyBase64: entry.keyBase64, valueBase64: entry.valueBase64 }));
  const stores: Record<string, KvEntry[]> = {};
  const dumps: Record<string, KvEntry[]> = {};
  for (const [id, entries] of Object.entries(snapshot.stores)) stores[id] = map(entries);
  for (const [id, entries] of Object.entries(snapshot.dumps)) dumps[id] = map(entries);
  return { stores, dumps };
}

// Builds a complete whole-database dump (KV contents + read model) from a low-level backend that a
// Bulldozer database was just written to. The backend must expose `debugSnapshot`.
export async function dumpBulldozerDatabase(lowLevel: LowLevelDatabase, db: BulldozerDatabase): Promise<BulldozerDbDump> {
  if (!lowLevel.debugSnapshot) throw new Error("Low-level backend must support debugSnapshot to be dumped");
  const readModel = await computeReadModel(db);
  return { ...kvEntriesFromDebugSnapshot(await lowLevel.debugSnapshot()), readModel };
}

// A read-only-then-writable low-level database seeded from a fixture's KV contents. Reads resolve
// against the frozen bytes; writes (used to prove a loaded database stays mutable) go to fresh
// in-memory entries and never touch the fixture. Keying is by base64 exactly as the real backends do,
// so the piledriver root's heap references resolve to the same objects the writer stored.
function declareSeededLowLevelDatabase(dump: BulldozerDbDump): LowLevelDatabase {
  const seqSentinel: DatabaseSeq = [] as unknown as DatabaseSeq;
  const containers = new Map<string, Map<string, ArrayBuffer>>();
  const seed = (kind: "store" | "dump", byId: Record<string, KvEntry[]>) => {
    for (const [id, entries] of Object.entries(byId)) {
      const map = new Map<string, ArrayBuffer>();
      for (const entry of entries) map.set(entry.keyBase64, decodeBase64(entry.valueBase64).buffer);
      containers.set(`${kind}:${id}`, map);
    }
  };
  seed("store", dump.stores);
  seed("dump", dump.dumps);

  const containerFor = (kind: "store" | "dump", id: string) => {
    const key = `${kind}:${id}`;
    const existing = containers.get(key);
    if (existing) return existing;
    const created = new Map<string, ArrayBuffer>();
    containers.set(key, created);
    return created;
  };

  const declare = (kind: "store" | "dump", id: string): LowLevelKvStore & LowLevelKvDump => {
    const map = containerFor(kind, id);
    return {
      async get(key) {
        return { buffer: map.get(encodeBase64(new Uint8Array(key)))?.slice(0) ?? null, seq: seqSentinel };
      },
      async setAll(entries) {
        for (const { key, value } of entries) map.set(encodeBase64(new Uint8Array(key)), value.slice(0));
        return { seq: seqSentinel };
      },
      async deleteAll(keys) {
        for (const key of keys) map.delete(encodeBase64(new Uint8Array(key)));
        return { seq: seqSentinel };
      },
      async insertAll(values) {
        const keys = values.map(() => crypto.getRandomValues(new Uint8Array(48)).buffer);
        keys.forEach((key, index) => map.set(encodeBase64(new Uint8Array(key)), values[index].slice(0)));
        return { keys, seq: seqSentinel };
      },
      async compareAndSet() {
        throw new Error("compareAndSet is not supported by the seeded fixture low-level database");
      },
    };
  };

  return {
    getDebugInfo() {
      return { backend: "seeded-fixture", containers };
    },
    declareKvStore(id) {
      return declare("store", id);
    },
    declareKvDump(id) {
      return declare("dump", id);
    },
    async waitUntilAvailable() {},
    async waitUntilDurable() {},
    async waitUntilReplicated() {},
    combineSeqs() {
      return seqSentinel;
    },
    initialSeq: seqSentinel,
  };
}

// Restores a Bulldozer database from a whole-database dump, ready to be read (and mutated) by the
// current code.
export function restoreBulldozerDatabase(dump: BulldozerDbDump): BulldozerDatabase {
  return declareBulldozerDatabase(declarePiledriverDatabase(declareSeededLowLevelDatabase(dump)), { migrations: exampleFungibleLedgerMigrations });
}
