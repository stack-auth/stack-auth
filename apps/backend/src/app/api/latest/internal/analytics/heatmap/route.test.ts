import { describe, expect, it } from "vitest";
import {
  buildHourOfWeekHeatmapCells,
  getSessionReplayHeatmapDeviceFilter,
  getSessionReplayHeatmapReplayFilter,
  getSessionReplayHeatmapRouteFilter,
  getSessionReplayHeatmapUserFilter,
} from "./route";

describe("analytics heatmap helpers", () => {
  it("pads sparse hour-of-week rows into a complete 7x24 grid", () => {
    const cells = buildHourOfWeekHeatmapCells([
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
    const cells = buildHourOfWeekHeatmapCells([
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

  it("omits the device filter when every device is selected", () => {
    expect(getSessionReplayHeatmapDeviceFilter(undefined)).toMatchInlineSnapshot(`""`);
  });

  it("builds the session replay viewport device filter", () => {
    expect(getSessionReplayHeatmapDeviceFilter("mobile")).toMatchInlineSnapshot(`
      "AND multiIf(
          toFloat64OrZero(toString(data.viewport_width)) >= 1920, 'tv',
          toFloat64OrZero(toString(data.viewport_width)) >= 1440, 'widescreen',
          toFloat64OrZero(toString(data.viewport_width)) >= 1200, 'desktop',
          toFloat64OrZero(toString(data.viewport_width)) >= 1024, 'laptop',
          toFloat64OrZero(toString(data.viewport_width)) >= 768, 'tablet',
          'mobile'
        ) = {device:String}"
    `);
  });

  it("prefers a route regex filter over an exact route filter", () => {
    expect(getSessionReplayHeatmapRouteFilter("/projects", "^/projects(/|$)")).toMatchInlineSnapshot(`"AND match(toString(data.path), {routeRegex:String})"`);
  });

  it("falls back to exact route matching when no route regex is present", () => {
    expect(getSessionReplayHeatmapRouteFilter("/projects", undefined)).toMatchInlineSnapshot(`"AND toString(data.path) = {routePath:String}"`);
  });

  it("binds the selected user filter as nullable to match the ClickHouse events schema", () => {
    expect(getSessionReplayHeatmapUserFilter("user-123")).toMatchInlineSnapshot(`"AND user_id = {userId:Nullable(String)}"`);
  });

  it("omits the selected user filter when no user is selected", () => {
    expect(getSessionReplayHeatmapUserFilter(undefined)).toMatchInlineSnapshot(`""`);
  });

  it("binds the selected replay filter as nullable to match the ClickHouse events schema", () => {
    expect(getSessionReplayHeatmapReplayFilter("replay-123")).toMatchInlineSnapshot(`"AND session_replay_id = {replayId:Nullable(String)}"`);
  });

  it("omits the selected replay filter when no replay is selected", () => {
    expect(getSessionReplayHeatmapReplayFilter(undefined)).toMatchInlineSnapshot(`""`);
  });
});
