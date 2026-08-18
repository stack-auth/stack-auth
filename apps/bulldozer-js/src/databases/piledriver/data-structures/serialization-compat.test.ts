import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SerializationDump, computeQueries, treeFromDump } from "./__fixtures__/serialization-fixture-utils.js";

// Golden serialization fixtures. Each file freezes the persisted shape of an AugmentedTreeMap for a
// given node format version. Loading them with the *current* code proves that data written by older
// builds (already deployed to prod) still deserialises and behaves identically. If a change to the
// node (de)serialisation format breaks reading old data, these tests fail. Regenerate/add fixtures
// with `__fixtures__/generate-serialization-fixtures.ts` — never hand-edit existing ones.
const here = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): SerializationDump {
  // Boundary parse of a checked-in fixture file; the shape is exercised by every assertion below.
  return JSON.parse(readFileSync(join(here, "__fixtures__", `${name}.json`), "utf8")) as SerializationDump;
}

describe("augmented tree map serialization compatibility", () => {
  // v0 = pre-versioning nodes (no `version`/`entryAugmentations`); v1 = current format.
  for (const version of ["v0", "v1"] as const) {
    it(`reads golden fixture ${version} with the current code`, async () => {
      const fixture = loadFixture(version);
      // Deserialising the frozen graph and recomputing every query must reproduce exactly what the
      // writer observed — including the v0 path where augmentations are recomputed, not trusted.
      expect(await computeQueries(treeFromDump(fixture))).toEqual(fixture.queries);
    });

    it(`mutates a tree loaded from golden fixture ${version} into a valid current-format tree`, async () => {
      const fixture = loadFixture(version);
      const updated = await treeFromDump(fixture).set(10, 999);
      expect(await updated.get(10)).toBe(999);
      expect(await updated.getAugmentation({})).toBe(fixture.queries.augmentationAll - 20 + 999);
    });
  }
});
