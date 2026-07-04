import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { declareLmdbLowLevelDatabase } from "./lmdb.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const buffer = (value: string) => textEncoder.encode(value).buffer;
const text = (value: ArrayBuffer | null) => value === null ? null : textDecoder.decode(value);
const tempLmdbPath = async () => await mkdtemp(join(tmpdir(), "bulldozer-lmdb-"));

describe("LMDB low-level database", () => {
  it("persists store values across database instances and exposes useful debug entries", async () => {
    const path = await tempLmdbPath();
    try {
      const db1 = declareLmdbLowLevelDatabase({ path, dbId: "persist" });
      const store1 = db1.declareKvStore("root");
      const { seq } = await store1.setAll([{ key: buffer("hello"), value: buffer("world") }]);
      await db1.waitUntilAvailable(seq);
      await db1.waitUntilDurable(seq);

      const db2 = declareLmdbLowLevelDatabase({ path, dbId: "persist" });
      const store2 = db2.declareKvStore("root");
      expect(text((await store2.get(buffer("hello"))).buffer)).toBe("world");
      expect(await db2.debugSnapshot!()).toMatchObject({
        stores: {
          root: [{
            keyUtf8: "hello",
            valueUtf8: "world",
            valueByteLength: 5,
          }],
        },
      });
    } finally {
      await rm(path, { recursive: true, force: true });
    }
  });

  it("supports compareAndSet without advancing seq on failed comparisons", async () => {
    const path = await tempLmdbPath();
    try {
      const db = declareLmdbLowLevelDatabase({ path, dbId: "cas" });
      const store = db.declareKvStore("store");
      const first = await store.setAll([{ key: buffer("key"), value: buffer("old") }]);
      const failed = await store.compareAndSet(buffer("key"), buffer("wrong"), buffer("new"));
      expect(failed).toEqual({ wasSet: false, seq: null });
      expect(text((await store.get(buffer("key"))).buffer)).toBe("old");

      const succeeded = await store.compareAndSet(buffer("key"), buffer("old"), buffer("new"), { requiresSeq: first.seq });
      expect(succeeded.wasSet).toBe(true);
      if (succeeded.seq) await db.waitUntilReplicated(succeeded.seq);
      expect(text((await store.get(buffer("key"))).buffer)).toBe("new");
    } finally {
      await rm(path, { recursive: true, force: true });
    }
  });

  it("supports immutable dump inserts", async () => {
    const path = await tempLmdbPath();
    try {
      const db = declareLmdbLowLevelDatabase({ path, dbId: "dump" });
      const dump = db.declareKvDump("heap");
      const { keys: [key], seq } = await dump.insertAll([buffer("payload")]);
      await db.waitUntilDurable(seq);
      expect(key.byteLength).toBe(48);
      expect(text((await dump.get(key)).buffer)).toBe("payload");
    } finally {
      await rm(path, { recursive: true, force: true });
    }
  });

  it("batches store and dump writes", async () => {
    const path = await tempLmdbPath();
    try {
      const db = declareLmdbLowLevelDatabase({ path, dbId: "batch" });
      const store = db.declareKvStore("store");
      const dump = db.declareKvDump("heap");

      const set = await store.setAll([
        { key: buffer("a"), value: buffer("one") },
        { key: buffer("b"), value: buffer("two") },
      ]);
      await db.waitUntilAvailable(set.seq);
      expect(text((await store.get(buffer("a"))).buffer)).toBe("one");
      expect(text((await store.get(buffer("b"))).buffer)).toBe("two");

      const deleted = await store.deleteAll([buffer("a"), buffer("b")]);
      await db.waitUntilAvailable(deleted.seq);
      expect(text((await store.get(buffer("a"))).buffer)).toBe(null);
      expect(text((await store.get(buffer("b"))).buffer)).toBe(null);

      const inserted = await dump.insertAll([buffer("first"), buffer("second")]);
      await db.waitUntilAvailable(inserted.seq);
      expect(inserted.keys).toHaveLength(2);
      expect(text((await dump.get(inserted.keys[0])).buffer)).toBe("first");
      expect(text((await dump.get(inserted.keys[1])).buffer)).toBe("second");
    } finally {
      await rm(path, { recursive: true, force: true });
    }
  });

  it("coalesces independent writes into one delayed transaction", async () => {
    const path = await tempLmdbPath();
    try {
      const db = declareLmdbLowLevelDatabase({ path, dbId: "coalesce" });
      const store = db.declareKvStore("store");
      const beforeVersion = db.getDebugInfo().currentVersion;

      const first = await store.setAll([{ key: buffer("a"), value: buffer("one") }]);
      const second = await store.setAll([{ key: buffer("b"), value: buffer("two") }]);

      expect(db.getDebugInfo().currentVersion).toBe(beforeVersion);
      await db.waitUntilAvailable(db.combineSeqs(first.seq, second.seq));

      expect(db.getDebugInfo().currentVersion).toBe(beforeVersion + 1);
      expect(text((await store.get(buffer("a"))).buffer)).toBe("one");
      expect(text((await store.get(buffer("b"))).buffer)).toBe("two");
    } finally {
      await rm(path, { recursive: true, force: true });
    }
  });

  it("does not deadlock when one queued write requires another queued write", async () => {
    const path = await tempLmdbPath();
    try {
      const db = declareLmdbLowLevelDatabase({ path, dbId: "same-batch-dependency" });
      const store = db.declareKvStore("store");
      const beforeVersion = db.getDebugInfo().currentVersion;

      const first = await store.setAll([{ key: buffer("parent"), value: buffer("first") }]);
      const second = await store.setAll([{ key: buffer("child"), value: buffer("second") }], { requiresSeq: db.combineSeqs(first.seq) });

      await db.waitUntilAvailable(second.seq);
      expect(db.getDebugInfo().currentVersion).toBe(beforeVersion + 1);
      expect(text((await store.get(buffer("parent"))).buffer)).toBe("first");
      expect(text((await store.get(buffer("child"))).buffer)).toBe("second");
    } finally {
      await rm(path, { recursive: true, force: true });
    }
  });
});
