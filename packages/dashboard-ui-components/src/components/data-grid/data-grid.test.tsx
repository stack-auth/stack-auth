// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultDataGridState,
  DataGrid,
  type DataGridColumnDef,
} from "./index";

type Row = {
  id: string,
  name: string,
};

const columns: DataGridColumnDef<Row>[] = [
  {
    id: "name",
    header: "Name",
    accessor: (row) => row.name,
    width: 160,
    minWidth: 80,
    sortable: true,
    type: "string",
  },
];

type ObserverRecord = {
  options?: IntersectionObserverInit,
};

let intersectionObserverRecords: ObserverRecord[] = [];

class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null;
  readonly rootMargin: string;
  readonly thresholds: ReadonlyArray<number>;
  private readonly callback: IntersectionObserverCallback;
  private readonly record: ObserverRecord;

  constructor(
    callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) {
    this.callback = callback;
    this.root = options?.root ?? null;
    this.rootMargin = options?.rootMargin ?? "";
    this.thresholds = Array.isArray(options?.threshold)
      ? options.threshold
      : [options?.threshold ?? 0];
    this.record = { options };
    intersectionObserverRecords.push(this.record);
  }

  disconnect() {}
  observe() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  unobserve() {}

  trigger(entry: Partial<IntersectionObserverEntry> = {}) {
    this.callback(
      [
        {
          boundingClientRect: {} as DOMRectReadOnly,
          intersectionRatio: 1,
          intersectionRect: {} as DOMRectReadOnly,
          isIntersecting: true,
          rootBounds: null,
          target: document.createElement("div"),
          time: 0,
          ...entry,
        },
      ],
      this,
    );
  }
}

class MockResizeObserver implements ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
}

function DataGridHarness(props: { fillHeight?: boolean }) {
  const [state, setState] = useState(() => createDefaultDataGridState(columns));

  return (
    <div style={{ height: 400 }}>
      <DataGrid<Row>
        columns={columns}
        rows={[{ id: "row-1", name: "Row 1" }]}
        getRowId={(row) => row.id}
        state={state}
        onChange={setState}
        paginationMode="infinite"
        hasMore
        fillHeight={props.fillHeight}
      />
    </div>
  );
}

describe("DataGrid infinite scroll observer", () => {
  beforeEach(() => {
    intersectionObserverRecords = [];

    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function getBoundingClientRect() {
        return {
          x: 0,
          y: 0,
          width: 320,
          height: 44,
          top: 0,
          left: 0,
          right: 320,
          bottom: 44,
          toJSON() {
            return this;
          },
        } as DOMRect;
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("observes against the grid body when the grid owns vertical scrolling", async () => {
    const { container } = render(<DataGridHarness fillHeight />);

    await waitFor(() => {
      expect(intersectionObserverRecords.length).toBeGreaterThan(0);
    });

    const grid = container.querySelector('[role="grid"]');
    expect(grid).not.toBeNull();
    const scrollContainer = grid?.children.item(1);

    expect(intersectionObserverRecords.at(-1)?.options?.root).toBe(scrollContainer);
  });

  it("falls back to the viewport when the page owns vertical scrolling", async () => {
    render(<DataGridHarness fillHeight={false} />);

    await waitFor(() => {
      expect(intersectionObserverRecords.length).toBeGreaterThan(0);
    });

    expect(intersectionObserverRecords.at(-1)?.options?.root ?? null).toBeNull();
  });
});
