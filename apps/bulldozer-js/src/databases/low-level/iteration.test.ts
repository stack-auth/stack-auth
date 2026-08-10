import { describe, expect, it } from "vitest";
import { declareInMemoryLowLevelDatabase } from "./implementations/in-memory.js";

const encoder = new TextEncoder();
const text = (value: ArrayBuffer) => new TextDecoder().decode(value);
const buffer = (value: string) => encoder.encode(value).buffer;

async function readAll(store: ReturnType<ReturnType<typeof declareInMemoryLowLevelDatabase>["declareKvStore"]>, limit: number) {
  const values: string[] = [];
  let afterKey: ArrayBuffer | undefined;
  while (true) {
    const page = await store.iterateEntries({ afterKey, limit });
    values.push(...page.entries.map(entry => text(entry.value)));
    if (page.nextAfterKey === null) return values;
    afterKey = page.nextAfterKey;
  }
}

describe("bounded low-level iteration", () => {
  it("handles empty stores and exclusive paging boundaries", async () => {
    const db = declareInMemoryLowLevelDatabase(crypto.randomUUID());
    const store = db.declareKvStore("iteration");
    expect(await store.iterateEntries({ limit: 2 })).toEqual({ entries: [], nextAfterKey: null });
    await store.setAll([
      { key: buffer("a"), value: buffer("first") },
      { key: buffer("b"), value: buffer("second") },
      { key: buffer("c"), value: buffer("third") },
    ]);
    expect(await readAll(store, 2)).toEqual(["first", "second", "third"]);
    const firstPage = await store.iterateEntries({ limit: 2 });
    const secondPage = await store.iterateEntries({ afterKey: firstPage.nextAfterKey ?? undefined, limit: 2 });
    expect(secondPage.entries.map(entry => text(entry.value))).toEqual(["third"]);
    expect(await store.iterateEntries({ afterKey: secondPage.entries[0].key, limit: 2 })).toEqual({ entries: [], nextAfterKey: null });
  });
});
