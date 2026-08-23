import { describe, expect, it } from "vitest";
import { editableActionStatuses } from "./workspace-edit";

// The picker must only offer transitions assertGrowthAdminActionTransition (apps/backend
// src/lib/growth/admin-state.ts) accepts, so an admin click never turns into a server error.
describe("editableActionStatuses", () => {
  it("lets a proposal be activated or dismissed, but never completed", () => {
    expect(editableActionStatuses("proposed")).toMatchInlineSnapshot(`
      [
        "proposed",
        "active",
        "dismissed",
      ]
    `);
  });

  it("only lets an active action be dismissed", () => {
    expect(editableActionStatuses("active")).toMatchInlineSnapshot(`
      [
        "active",
        "dismissed",
      ]
    `);
  });

  it("keeps terminal states terminal", () => {
    expect(editableActionStatuses("completed")).toMatchInlineSnapshot(`
      [
        "completed",
      ]
    `);
    expect(editableActionStatuses("dismissed")).toMatchInlineSnapshot(`
      [
        "dismissed",
      ]
    `);
  });
});
