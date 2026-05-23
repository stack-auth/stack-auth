// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DataGridColumnDef } from "./types";
import { useDataGridUrlState } from "./use-url-state";

type Row = { id: string };

const columns: DataGridColumnDef<Row>[] = [
  { id: "name", header: "Name", accessor: () => "", width: 160, minWidth: 80, type: "string" },
  { id: "email", header: "Email", accessor: () => "", width: 200, minWidth: 80, type: "string" },
];

function setUrl(search: string) {
  window.history.replaceState(null, "", `/${search ? `?${search}` : ""}`);
}

beforeEach(() => {
  setUrl("");
});

afterEach(() => {
  setUrl("");
});

describe("useDataGridUrlState", () => {
  it("initializes from existing URL params", () => {
    setUrl("grid_w=name:240&grid_h=email");
    const { result } = renderHook(() => useDataGridUrlState(columns));
    const [state] = result.current;
    expect(state.columnWidths.name).toBe(240);
    expect(state.columnVisibility.email).toBe(false);
  });

  it("writes width changes back to the URL (after debounce)", async () => {
    const { result } = renderHook(() => useDataGridUrlState(columns));

    act(() => {
      const [, setState] = result.current;
      setState((prev) => ({
        ...prev,
        columnWidths: { ...prev.columnWidths, name: 250 },
      }));
    });

    // Debounce is 100ms.
    await new Promise((resolve) => setTimeout(resolve, 150));
    const params = new URLSearchParams(window.location.search);
    expect(params.get("grid_w")).toBe("name:250");
  });

  it("resets column widths to defaults when a popstate clears the URL", () => {
    setUrl("grid_w=name:300");
    const { result } = renderHook(() => useDataGridUrlState(columns));
    expect(result.current[0].columnWidths.name).toBe(300);

    act(() => {
      setUrl("");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    // Default for "name" column is its declared width of 160.
    expect(result.current[0].columnWidths.name).toBe(160);
  });

  it("isolates two grids on the same page via paramPrefix", async () => {
    const { result: a } = renderHook(() => useDataGridUrlState(columns, { paramPrefix: "users" }));
    const { result: b } = renderHook(() => useDataGridUrlState(columns, { paramPrefix: "teams" }));

    act(() => {
      a.current[1]((prev) => ({ ...prev, columnWidths: { ...prev.columnWidths, name: 222 } }));
    });
    await new Promise((resolve) => setTimeout(resolve, 150));

    const params = new URLSearchParams(window.location.search);
    expect(params.get("users_w")).toBe("name:222");
    expect(params.get("teams_w")).toBeNull();
    expect(b.current[0].columnWidths.name).toBe(160); // unaffected
  });

  it("ignores malformed entries in the URL param without throwing", () => {
    setUrl("grid_w=:,name:abc,name:240,bogusid:99");
    const { result } = renderHook(() => useDataGridUrlState(columns));
    // Only the well-formed `name:240` should land; junk is dropped silently.
    expect(result.current[0].columnWidths.name).toBe(240);
  });
});
