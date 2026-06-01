import { branchConfigSchema, getConfigOverrideErrors, getIncompleteConfigWarnings } from "@hexclave/shared/dist/config/schema";
import { describe, expect, it } from "vitest";
import { buildDummyPaymentsSetup } from "./seed-dummy-data";

describe("dummy payments seed config", () => {
  it("is valid branch payments config", async () => {
    const { paymentsBranchOverride } = buildDummyPaymentsSetup();
    const branchConfigOverride = { payments: paymentsBranchOverride };

    expect(await getConfigOverrideErrors(branchConfigSchema, branchConfigOverride)).toMatchInlineSnapshot(`
      {
        "data": null,
        "status": "ok",
      }
    `);
    expect(await getIncompleteConfigWarnings(branchConfigSchema, branchConfigOverride)).toMatchInlineSnapshot(`
      {
        "data": null,
        "status": "ok",
      }
    `);
  });
});
