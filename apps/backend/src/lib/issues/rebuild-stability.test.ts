import { describe, expect, it } from "vitest";
import {
  TURBOPACK_CHUNK_NAMES_BUILD_A,
  TURBOPACK_CHUNK_NAMES_BUILD_B,
  WEBPACK_CHUNK_NAMES_BUILD_A,
  WEBPACK_CHUNK_NAMES_BUILD_B,
  buildRebuildFixture,
} from "./__fixtures__/bundler-chunks";
import { DEFAULT_GROUPING_CONFIG_ID } from "./grouping-config";
import { computeGrouping } from "./grouping";
import type { GroupingInput } from "./types";

/**
 * ⚠️ SYNTHETIC STAND-IN — see the header of `__fixtures__/bundler-chunks.ts`.
 * The chunk names here were hand-written to the shapes each bundler emits, not
 * captured from two real builds. A real two-build corpus is still owed before
 * the rebuild-stability claim can be called proven.
 */

function ownerHash(input: GroupingInput): string {
  return computeGrouping(input, DEFAULT_GROUPING_CONFIG_ID).ownerHash;
}

describe("rebuild stability", () => {
  it("hashes a webpack build identically before and after a rebuild", () => {
    const buildA = ownerHash(buildRebuildFixture(WEBPACK_CHUNK_NAMES_BUILD_A));
    const buildB = ownerHash(buildRebuildFixture(WEBPACK_CHUNK_NAMES_BUILD_B, { columnOffset: 4096 }));
    expect(buildA).toBe(buildB);
  });

  it("hashes a Turbopack build identically before and after a rebuild", () => {
    const buildA = ownerHash(buildRebuildFixture(TURBOPACK_CHUNK_NAMES_BUILD_A));
    const buildB = ownerHash(buildRebuildFixture(TURBOPACK_CHUNK_NAMES_BUILD_B, { columnOffset: 4096 }));
    expect(buildA).toBe(buildB);
  });

  it("still separates genuinely different errors within one build", () => {
    const hashes = new Set([
      ownerHash(buildRebuildFixture(WEBPACK_CHUNK_NAMES_BUILD_A, { type: "TypeError" })),
      ownerHash(buildRebuildFixture(WEBPACK_CHUNK_NAMES_BUILD_A, { type: "RangeError" })),
      ownerHash(buildRebuildFixture(WEBPACK_CHUNK_NAMES_BUILD_A.slice(0, 2))),
      ownerHash(buildRebuildFixture(TURBOPACK_CHUNK_NAMES_BUILD_A)),
    ]);
    expect(hashes.size).toBe(4);
  });

  it("does not merge webpack and Turbopack builds of the same app", () => {
    // They genuinely are different modules — Turbopack's chunk names encode the
    // source path, webpack's encode a numeric chunk id — so this asserts the
    // normalizer is not over-eager, not that the two *should* differ.
    expect(ownerHash(buildRebuildFixture(WEBPACK_CHUNK_NAMES_BUILD_A)))
      .not.toBe(ownerHash(buildRebuildFixture(TURBOPACK_CHUNK_NAMES_BUILD_A)));
  });

  it("normalizes each build's chunk names to the same modules", () => {
    // The diagnostic behind the two assertions above: if this snapshot changes,
    // the hash equality tests above become meaningless rather than failing.
    const modules = (chunkNames: readonly string[]) =>
      computeGrouping(buildRebuildFixture(chunkNames), DEFAULT_GROUPING_CONFIG_ID).frames.map((frame) => frame.module);
    expect({
      webpackA: modules(WEBPACK_CHUNK_NAMES_BUILD_A),
      webpackB: modules(WEBPACK_CHUNK_NAMES_BUILD_B),
      turbopackA: modules(TURBOPACK_CHUNK_NAMES_BUILD_A),
      turbopackB: modules(TURBOPACK_CHUNK_NAMES_BUILD_B),
    }).toMatchInlineSnapshot(`
      {
        "turbopackA": [
          "_next/static/chunks/node_modules_next_dist_client",
          "_next/static/chunks/[turbopack]_browser_dev_hmr-client_hmr-client_ts",
          "_next/static/chunks/src_app_dashboard_page_tsx",
          "_next/static/chunks/[root-of-the-server]",
        ],
        "turbopackB": [
          "_next/static/chunks/node_modules_next_dist_client",
          "_next/static/chunks/[turbopack]_browser_dev_hmr-client_hmr-client_ts",
          "_next/static/chunks/src_app_dashboard_page_tsx",
          "_next/static/chunks/[root-of-the-server]",
        ],
        "webpackA": [
          "_next/static/_buildManifest",
          "_next/static/chunks/pages/_app",
          "_next/static/chunks/webpack",
          "_next/static/chunks/main-app",
          "_next/static/chunks/app/dashboard/page",
          "_next/static/chunks/4711",
        ],
        "webpackB": [
          "_next/static/_buildManifest",
          "_next/static/chunks/pages/_app",
          "_next/static/chunks/webpack",
          "_next/static/chunks/main-app",
          "_next/static/chunks/app/dashboard/page",
          "_next/static/chunks/4711",
        ],
      }
    `);
  });
});
