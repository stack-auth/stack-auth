// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useDataSource } from "./use-data-source";
import type { DataGridColumnDef, DataGridDataSource } from "./types";

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

function DataSourceHarness({ dataSource }: { dataSource: DataGridDataSource<Row> }) {
  const gridData = useDataSource({
    dataSource,
    columns,
    getRowId: (row) => row.id,
    sorting: [],
    quickSearch: "",
    pagination: { pageIndex: 0, pageSize: 25 },
    paginationMode: "infinite",
  });

  return (
    <>
      <button onClick={gridData.loadMore}>Load more</button>
      <span data-testid="row-count">{gridData.rows.length}</span>
    </>
  );
}

afterEach(() => {
  cleanup();
});

describe("useDataSource infinite pagination", () => {
  it("does not start loadMore while the initial fetch is in flight", async () => {
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
    expect(calls).toHaveLength(1);

    await act(async () => {
      resolveInitial();
    });
    await waitFor(() => expect(getByRole("button", { name: "Load more" })).toBeTruthy());
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
