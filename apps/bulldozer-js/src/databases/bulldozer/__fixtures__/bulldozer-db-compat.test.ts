import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BulldozerDbDump, computeReadModel, restoreBulldozerDatabase } from "./bulldozer-db-fixture-utils.js";

// Golden whole-database serialization fixtures. Each file freezes an entire persisted Bulldozer
// database (every derived table, group and row) as written to the low-level backend for a given node
// format version. Loading them with the *current* code proves that a complete database written by an
// older build (already deployed to prod) still deserializes and reads back consistently — not just a
// single tree, but the full derived-table graph. Regenerate/add fixtures with
// `generate-bulldozer-db-fixtures.ts`; never hand-edit existing ones.
const here = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): BulldozerDbDump {
  // Boundary parse of a checked-in fixture file; every assertion below exercises the shape.
  return JSON.parse(readFileSync(join(here, `${name}.json`), "utf8")) as BulldozerDbDump;
}

describe("bulldozer whole-database serialization compatibility", () => {
  // v0 = pre-versioning nodes (no `version`/`entryAugmentations`); v1 = current format.
  for (const version of ["db-v0", "db-v1"] as const) {
    it(`reads the entire database from golden fixture ${version} with the current code`, async () => {
      const fixture = loadFixture(version);
      // Deserializing the whole persisted database and re-reading every table must reproduce exactly
      // the logical state its writer observed — including the v0 path where augmentations are
      // recomputed, not trusted.
      expect(await computeReadModel(restoreBulldozerDatabase(fixture))).toEqual(fixture.readModel);
    });

    it(`mutates a database loaded from golden fixture ${version} into valid current-format state`, async () => {
      const fixture = loadFixture(version);
      const db = restoreBulldozerDatabase(fixture);
      await db.withSnapshotReplicated(async snapshot =>
        (await snapshot.setOrDeleteRow({
          tableId: "ledgerEntries",
          rowIdentifier: "entry-900",
          newRowData: { accountId: "acct-alice", asset: "USD", amount: "500", side: "credit", txHash: "0xfff900", blockNumber: 200, timestamp: "2026-01-02T00:00:00.000Z", counterparty: "acct-bob", memo: "post-load write" },
        })).newSnapshot,
      );
      const { snapshot } = await db.getSnapshot();
      const rows = [];
      for await (const row of snapshot.listRowsInGroup({ tableId: "entriesByAccount", groupKey: "acct-alice", range: {} })) {
        rows.push(row.rowIdentifier);
      }
      expect(rows).toContain("entry-900");
    });
  }
});
