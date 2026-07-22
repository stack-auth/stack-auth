// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useDataSource } from "./use-data-source";
import type { DataGridColumnDef, DataGridDataPaginationMode, DataGridDataSource } from "./types";

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
  },
];

function DataSourceHarness({
  dataSource,
  paginationMode = "infinite",
}: {
  dataSource: DataGridDataSource<Row>,
  paginationMode?: DataGridDataPaginationMode,
}) {
  const gridData = useDataSource({
    dataSource,
    columns,
    getRowId: (row) => row.id,
    sorting: [],
    quickSearch: "",
    pagination: { pageIndex: 0, pageSize: 25 },
    paginationMode,
  });

  return (
    <>
      <button onClick={gridData.loadMore}>Load more</button>
      <span data-testid="row-count">{gridData.rows.length}</span>
      <span data-testid="row-name">{gridData.rows[0]?.name ?? ""}</span>
      <span data-testid="error">{gridData.error?.message ?? ""}</span>
    </>
  );
}

afterEach(() => {
  cleanup();
});

describe("useDataSource infinite pagination", () => {
  it("defers loadMore during the initial fetch and replays it once settled", async () => {
    const calls: Array<{ cursor: unknown }> = [];
    let resolveInitial: (value: void) => void = () => {};
    const initialFetch = new Promise<void>((resolve) => {
      resolveInitial = resolve;
    });
    const dataSource: DataGridDataSource<Row> = async function* (params) {
      calls.push({ cursor: params.cursor });
      if (calls.length === 1) {
        await initialFetch;
        yield {
          rows: [{ id: "row-1", name: "Row 1" }],
          nextCursor: "cursor-1",
          hasMore: true,
        };
        return;
      }
      yield {
        rows: [{ id: "row-2", name: "Row 2" }],
        nextCursor: null,
        hasMore: false,
      };
    };

    const { getByRole } = render(<DataSourceHarness dataSource={dataSource} />);
    await waitFor(() => expect(calls).toHaveLength(1));

    fireEvent.click(getByRole("button", { name: "Load more" }));
    // Not started concurrently — queued behind the in-flight initial fetch.
    expect(calls).toHaveLength(1);

    await act(async () => {
      resolveInitial();
    });
    // The queued loadMore replays automatically with the completed cursor,
    // so a sentinel that fired during the fetch is not silently dropped.
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toEqual({ cursor: "cursor-1" });
  });

  it("keeps the committed cursor when an aborted reset is followed by a skipped refetch", async () => {
    const callsA: Array<{ cursor: unknown }> = [];
    const dataSourceA: DataGridDataSource<Row> = async function* (params) {
      callsA.push({ cursor: params.cursor });
      if (callsA.length === 1) {
        yield {
          rows: [{ id: "row-1", name: "Row 1" }],
          nextCursor: "cursor-1",
          hasMore: true,
        };
        return;
      }
      yield {
        rows: [{ id: "row-2", name: "Row 2" }],
        nextCursor: null,
        hasMore: false,
      };
    };
    // Stays in flight until we resolve it, after the switch back to A has
    // already aborted it.
    let resolveB: (value: void) => void = () => {};
    const dataSourceB: DataGridDataSource<Row> = async function* () {
      await new Promise<void>((resolve) => {
        resolveB = resolve;
      });
    };

    const { getByRole, getByTestId, rerender } = render(
      <DataSourceHarness dataSource={dataSourceA} />,
    );
    await waitFor(() => expect(getByTestId("row-count").textContent).toBe("1"));

    // Unstable dataSource identity flipping away and back to a completed
    // reference: the B reset starts (and used to wipe cursor/pageIndex
    // immediately), then gets aborted; the A effect run matches the
    // completed-fetch key and skips.
    rerender(<DataSourceHarness dataSource={dataSourceB} />);
    rerender(<DataSourceHarness dataSource={dataSourceA} />);
    await act(async () => {
      resolveB();
    });

    fireEvent.click(getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(getByTestId("row-count").textContent).toBe("2"));
    // The append must continue from the committed cursor, not restart from
    // the beginning with cursor === undefined.
    expect(callsA).toEqual([{ cursor: undefined }, { cursor: "cursor-1" }]);
  });

  it("does not treat an aborted zero-yield reset as a completed fetch", async () => {
    const dataSourceA: DataGridDataSource<Row> = async function* () {
      yield {
        rows: [{ id: "row-a", name: "A" }],
        nextCursor: null,
        hasMore: false,
      };
    };
    let bCalls = 0;
    let resolveFirstB: (value: void) => void = () => {};
    const dataSourceB: DataGridDataSource<Row> = async function* () {
      bCalls++;
      if (bCalls === 1) {
        // Aborted before any yield: completing this must not mark B as a
        // successful skip key, or a later render with B would keep A's rows.
        await new Promise<void>((resolve) => {
          resolveFirstB = resolve;
        });
        return;
      }
      yield {
        rows: [{ id: "row-b", name: "B" }],
        nextCursor: null,
        hasMore: false,
      };
    };

    const { getByTestId, rerender } = render(
      <DataSourceHarness dataSource={dataSourceA} />,
    );
    await waitFor(() => expect(getByTestId("row-name").textContent).toBe("A"));

    rerender(<DataSourceHarness dataSource={dataSourceB} />);
    rerender(<DataSourceHarness dataSource={dataSourceA} />);
    await act(async () => {
      resolveFirstB();
    });

    rerender(<DataSourceHarness dataSource={dataSourceB} />);
    await waitFor(() => expect(getByTestId("row-name").textContent).toBe("B"));
    expect(bCalls).toBe(2);
  });

  it("does not replay a deferred loadMore after the in-flight fetch errors", async () => {
    const calls: Array<{ cursor: unknown }> = [];
    let rejectInitial: (err: Error) => void = () => {};
    const initialFetch = new Promise<void>((_resolve, reject) => {
      rejectInitial = reject;
    });
    const dataSource: DataGridDataSource<Row> = async function* (params) {
      calls.push({ cursor: params.cursor });
      await initialFetch;
      yield { rows: [], nextCursor: null, hasMore: false };
    };

    const { getByRole, getByTestId } = render(<DataSourceHarness dataSource={dataSource} />);
    await waitFor(() => expect(calls).toHaveLength(1));

    // Deferred while the (soon-to-fail) fetch is in flight.
    fireEvent.click(getByRole("button", { name: "Load more" }));

    await act(async () => {
      rejectInitial(new Error("fetch failed"));
    });

    // The failed fetch must surface its error and must NOT chain the deferred
    // append (which would fetch against inconsistent state and clear the
    // error again via setError(null)).
    await waitFor(() => expect(getByTestId("error").textContent).toBe("fetch failed"));
    expect(calls).toHaveLength(1);
  });

  it("discards a deferred loadMore when pagination mode leaves infinite", async () => {
    const calls: Array<{ cursor: unknown }> = [];
    let resolveInitial: (value: void) => void = () => {};
    const initialFetch = new Promise<void>((resolve) => {
      resolveInitial = resolve;
    });
    const dataSource: DataGridDataSource<Row> = async function* (params) {
      calls.push({ cursor: params.cursor });
      if (calls.length === 1) {
        await initialFetch;
        yield {
          rows: [{ id: "row-1", name: "Row 1" }],
          nextCursor: "cursor-1",
          hasMore: true,
        };
        return;
      }
      yield {
        rows: [{ id: "row-2", name: "Row 2" }],
        nextCursor: null,
        hasMore: false,
      };
    };

    const { getByRole, rerender } = render(
      <DataSourceHarness dataSource={dataSource} paginationMode="infinite" />,
    );
    await waitFor(() => expect(calls).toHaveLength(1));

    fireEvent.click(getByRole("button", { name: "Load more" }));
    expect(calls).toHaveLength(1);

    rerender(<DataSourceHarness dataSource={dataSource} paginationMode="server" />);

    await act(async () => {
      resolveInitial();
    });

    // Mode left infinite while the deferred loadMore was queued — do not
    // append against server pagination after the fetch settles.
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(calls).toHaveLength(1);
  });

  it("uses the completed page cursor for the next loadMore fetch", async () => {
    const calls: Array<{ cursor: unknown }> = [];
    const dataSource: DataGridDataSource<Row> = async function* (params) {
      calls.push({ cursor: params.cursor });
      if (calls.length === 1) {
        yield {
          rows: [{ id: "row-1", name: "Row 1" }],
          nextCursor: "cursor-1",
          hasMore: true,
        };
        return;
      }
      yield {
        rows: [{ id: "row-2", name: "Row 2" }],
        nextCursor: null,
        hasMore: false,
      };
    };

    const { getByRole, getByTestId } = render(<DataSourceHarness dataSource={dataSource} />);
    await waitFor(() => expect(getByTestId("row-count").textContent).toBe("1"));

    fireEvent.click(getByRole("button", { name: "Load more" }));

    await waitFor(() => expect(getByTestId("row-count").textContent).toBe("2"));
    expect(calls).toEqual([{ cursor: undefined }, { cursor: "cursor-1" }]);
  });
});
