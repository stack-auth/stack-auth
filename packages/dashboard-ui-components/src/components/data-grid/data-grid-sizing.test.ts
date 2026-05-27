import { describe, expect, it } from "vitest";
import { fitColumnsToContainer } from "./data-grid-sizing";
import type { DataGridColumnDef } from "./types";

type Row = { id: string };

describe("fitColumnsToContainer", () => {
  const columns: DataGridColumnDef<Row>[] = [
    { id: "name", header: "Name", width: 320, minWidth: 80, type: "string", accessor: () => "" },
    { id: "email", header: "Email", width: 420, minWidth: 80, type: "string", accessor: () => "" },
  ];

  it("shrinks fixed columns to fit a narrow container", () => {
    const sizes = { name: 320, email: 420 };
    fitColumnsToContainer(sizes, columns, 320, 0);
    expect(sizes.name + sizes.email).toBe(320);
    expect(sizes.name).toBeGreaterThanOrEqual(80);
    expect(sizes.email).toBeGreaterThanOrEqual(80);
  });

  it("does not treat total column width as chrome width", () => {
    const sizes = { name: 200, email: 200 };
    const buggySizes = { name: 200, email: 200 };
    fitColumnsToContainer(sizes, columns, 500, 0);
    // Buggy call passed pre-summed column total as chrome, double-counting widths.
    fitColumnsToContainer(buggySizes, columns, 500, 400);
    expect(sizes.name + sizes.email).toBe(400);
    expect(buggySizes.name + buggySizes.email).toBeLessThan(400);
  });

  it("grows flex columns when the container is wider than the base total", () => {
    const flexColumns: DataGridColumnDef<Row>[] = [
      { id: "name", header: "Name", width: 100, minWidth: 80, flex: 1, type: "string", accessor: () => "" },
      { id: "email", header: "Email", width: 100, minWidth: 80, type: "string", accessor: () => "" },
    ];
    const sizes = { name: 100, email: 100 };
    fitColumnsToContainer(sizes, flexColumns, 400, 0);
    expect(sizes.name + sizes.email).toBe(400);
    expect(sizes.name).toBeGreaterThan(100);
  });
});
