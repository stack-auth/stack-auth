import { describe, expect, it } from "vitest";
import {
  buildClickmapUrlLikePattern,
  buildHourOfWeekClickmapCells,
  clampClickmapSampling,
  getClickmapOriginFilter,
  getClickmapOriginParams,
  getClickmapRouteFilter,
  getClickmapSystemElementFilter,
  getClickmapUserAndReplayFilter,
  getClickmapViewportFilter,
  getDeviceViewportBucket,
} from "./analytics-clickmap-query";

describe("analytics clickmap query helpers", () => {
  it("pads sparse hour-of-week rows into a complete 7x24 grid", () => {
    const cells = buildHourOfWeekClickmapCells([
      { weekday: "1", hour: "0", value: "3" },
      { weekday: 7, hour: 23, value: 9 },
    ]);

    expect(cells).toHaveLength(168);
    expect(cells[0]).toMatchInlineSnapshot(`
      {
        "hour": 0,
        "value": 3,
        "weekday": 1,
      }
    `);
    expect(cells[167]).toMatchInlineSnapshot(`
      {
        "hour": 23,
        "value": 9,
        "weekday": 7,
      }
    `);
    expect(cells[1]).toMatchInlineSnapshot(`
      {
        "hour": 1,
        "value": 0,
        "weekday": 1,
      }
    `);
  });

  it("ignores invalid ClickHouse bucket rows", () => {
    const cells = buildHourOfWeekClickmapCells([
      { weekday: 0, hour: 12, value: 10 },
      { weekday: 1, hour: 24, value: 10 },
      { weekday: 2, hour: 3, value: 4 },
    ]);

    expect(cells.find((cell) => cell.weekday === 2 && cell.hour === 3)).toMatchInlineSnapshot(`
      {
        "hour": 3,
        "value": 4,
        "weekday": 2,
      }
    `);
    expect(cells.filter((cell) => cell.value !== 0)).toHaveLength(1);
  });

  it("returns no viewport bucket when no device is selected", () => {
    expect(getDeviceViewportBucket(undefined)).toBeNull();
    expect(getDeviceViewportBucket("")).toBeNull();
    expect(getDeviceViewportBucket("not-a-device")).toBeNull();
  });

  it("expands device classes into viewport bucket bounds", () => {
    expect(getDeviceViewportBucket("mobile")).toMatchInlineSnapshot(`
      {
        "max": 767,
        "min": 0,
      }
    `);
    expect(getDeviceViewportBucket("widescreen")).toMatchInlineSnapshot(`
      {
        "max": 1919,
        "min": 1440,
      }
    `);
  });

  it("emits a viewport filter only for the bounds that are set", () => {
    expect(getClickmapViewportFilter(undefined, undefined)).toMatchInlineSnapshot(`""`);
    expect(getClickmapViewportFilter(768, undefined)).toMatchInlineSnapshot(`"AND viewport_width >= {viewportWidthMin:UInt32}"`);
    expect(getClickmapViewportFilter(undefined, 1023)).toMatchInlineSnapshot(`"AND viewport_width <= {viewportWidthMax:UInt32}"`);
    expect(getClickmapViewportFilter(768, 1023)).toMatchInlineSnapshot(`"AND viewport_width >= {viewportWidthMin:UInt32} AND viewport_width <= {viewportWidthMax:UInt32}"`);
  });

  it("prefers a route regex over a url pattern over an exact route", () => {
    expect(getClickmapRouteFilter("/x", "^/x", "/x/%")).toMatchInlineSnapshot(`"AND match(path, {routeRegex:String})"`);
    expect(getClickmapRouteFilter("/x", undefined, "/x/%")).toMatchInlineSnapshot(`"AND path LIKE {urlPatternLike:String}"`);
    expect(getClickmapRouteFilter("/x", undefined, null)).toMatchInlineSnapshot(`"AND path = {routePath:String}"`);
    expect(getClickmapRouteFilter(undefined, undefined, null)).toMatchInlineSnapshot(`""`);
  });

  it("translates `*` wildcards into SQL LIKE while escaping `_`/`%`/`\\\\`", () => {
    expect(buildClickmapUrlLikePattern(undefined)).toBeNull();
    expect(buildClickmapUrlLikePattern("")).toBeNull();
    expect(buildClickmapUrlLikePattern("/products/*")).toMatchInlineSnapshot(`"/products/%"`);
    expect(buildClickmapUrlLikePattern("/path%/_*")).toMatchInlineSnapshot(`"/path\\%/\\_%"`);
    expect(buildClickmapUrlLikePattern("/api/v*/users/*")).toMatchInlineSnapshot(`"/api/v%/users/%"`);
  });

  it("binds clickmap user/replay filters as nullable to match the MV schema", () => {
    expect(getClickmapUserAndReplayFilter("user-123", "replay-123")).toMatchInlineSnapshot(`"AND user_id = {userId:Nullable(String)} AND session_replay_id = {replayId:Nullable(String)}"`);
    expect(getClickmapUserAndReplayFilter("user-123", undefined)).toMatchInlineSnapshot(`"AND user_id = {userId:Nullable(String)}"`);
    expect(getClickmapUserAndReplayFilter(undefined, "replay-123")).toMatchInlineSnapshot(`"AND session_replay_id = {replayId:Nullable(String)}"`);
    expect(getClickmapUserAndReplayFilter(undefined, undefined)).toMatchInlineSnapshot(`""`);
  });

  it("scopes public clickmap queries to the exact token origin", () => {
    expect(getClickmapOriginFilter()).toMatchInlineSnapshot(`"AND (url = {origin:String} OR startsWith(url, {originSlashPrefix:String}) OR startsWith(url, {originQueryPrefix:String}) OR startsWith(url, {originHashPrefix:String}))"`);
    expect(getClickmapOriginParams("https://app.example.com")).toMatchInlineSnapshot(`
      {
        "origin": "https://app.example.com",
        "originHashPrefix": "https://app.example.com#",
        "originQueryPrefix": "https://app.example.com?",
        "originSlashPrefix": "https://app.example.com/",
      }
    `);
  });

  it("excludes Hexclave dev tool clicks from clickmap queries", () => {
    expect(getClickmapSystemElementFilter()).toMatchInlineSnapshot(`"AND position(elements_chain, '__hexclave-dev-tool-root') = 0 AND position(elements_chain, 'stack-devtool') = 0 AND position(elements_chain, 'sdt-') = 0 AND position(selector, '#__hexclave-dev-tool-root') = 0 AND position(selector, '.stack-devtool') = 0 AND position(selector, '.sdt-') = 0"`);
  });

  it("clamps sampling to (0, 1] with finite default", () => {
    expect(clampClickmapSampling(undefined)).toBe(1);
    expect(clampClickmapSampling(0)).toBe(0.01);
    expect(clampClickmapSampling(-1)).toBe(0.01);
    expect(clampClickmapSampling(0.25)).toBe(0.25);
    expect(clampClickmapSampling(2)).toBe(1);
    expect(clampClickmapSampling(Number.NaN)).toBe(1);
  });
});
