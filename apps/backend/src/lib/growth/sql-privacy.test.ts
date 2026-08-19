import { describe, expect, it } from "vitest";
import { buildIdentifyingColumnsError, findIdentifyingColumns } from "./sql-privacy";

describe("findIdentifyingColumns", () => {
  it("allows the aggregate shapes growth analysis actually needs", () => {
    expect(findIdentifyingColumns([
      { signup_day: "2026-08-01", signups: 412 },
      { signup_day: "2026-08-02", signups: 388 },
    ])).toEqual([]);
  });

  it("allows an aggregate over an identifier, since the person is removed by the aggregation", () => {
    // This is the rewrite the error message steers the agent toward, so it must actually pass.
    expect(findIdentifyingColumns([
      { signup_domain: "acme.com", users: 31 },
      { signup_domain: "gmail.com", users: 204 },
    ])).toEqual([]);
  });

  it("blocks raw identifier columns", () => {
    expect(findIdentifyingColumns([
      { id: "u_1", primary_email: "jane@acme.com", display_name: "Jane Doe" },
    ])).toEqual(["display_name", "primary_email"]);
  });

  it("blocks contact_channels.value, which is the address itself", () => {
    expect(findIdentifyingColumns([{ type: "email", value: "jane@acme.com" }])).toEqual(["value"]);
  });

  it("blocks the customer-controlled metadata blobs, which may hold anything", () => {
    expect(findIdentifyingColumns([{ id: "u_1", client_metadata: "{\"ssn\":\"...\"}" }]))
      .toEqual(["client_metadata"]);
  });

  // The column-name list alone is trivially evaded, which is the whole reason for the value scan.
  it("blocks an identifier hidden behind an alias", () => {
    expect(findIdentifyingColumns([{ x: "jane@acme.com", n: 3 }])).toEqual(["x"]);
  });

  it("blocks an address concatenated into a larger string", () => {
    expect(findIdentifyingColumns([{ label: "Jane Doe <jane@acme.com>" }])).toEqual(["label"]);
  });

  it("does not flag a column merely because it is a string", () => {
    expect(findIdentifyingColumns([{ status: "delivered", subject: "Welcome aboard" }])).toEqual([]);
  });

  it("unions keys across rows, so a column that is null in the first row is still caught", () => {
    // ClickHouse omits nothing today, but reading only row 0 would make that a load-bearing detail.
    expect(findIdentifyingColumns([
      { id: "u_1" },
      { id: "u_2", primary_email: "jane@acme.com" },
    ])).toEqual(["primary_email"]);
  });

  it("returns nothing for an empty result set", () => {
    expect(findIdentifyingColumns([])).toEqual([]);
  });

  it("is case-insensitive on column names, since SQL aliases are not case-normalised", () => {
    expect(findIdentifyingColumns([{ Primary_Email: null }])).toEqual(["Primary_Email"]);
  });
});

describe("buildIdentifyingColumnsError", () => {
  it("names the offending columns and gives a runnable aggregate rewrite", () => {
    const message = buildIdentifyingColumnsError(["display_name", "primary_email"]);
    expect(message).toContain("display_name, primary_email");
    expect(message).toContain("GROUP BY");
    // Filtering/joining on identifiers stays legal; only returning them is blocked. Saying so keeps
    // the agent from concluding the columns are unusable and abandoning the analysis entirely.
    expect(message).toContain("safe to filter and join on");
  });
});
