import { describe, expect, it } from "vitest";
import { branchPaymentsSchema } from "./schema";

describe("branchPaymentsSchema", () => {
  it("accepts partial payments config without products", async () => {
    await expect(branchPaymentsSchema.validate({
      blockNewPurchases: true,
    })).resolves.toMatchObject({
      blockNewPurchases: true,
    });
  });

  it("accepts product lines without products", async () => {
    await expect(branchPaymentsSchema.validate({
      productLines: {
        pro: {
          displayName: "Pro",
          customerType: "user",
        },
      },
    })).resolves.toMatchObject({
      productLines: {
        pro: {
          displayName: "Pro",
          customerType: "user",
        },
      },
    });
  });

  it("rejects a product that references a missing product line", async () => {
    await expect(branchPaymentsSchema.validate({
      products: {
        pro: {
          customerType: "user",
          productLineId: "missing-line",
        },
      },
    })).rejects.toThrow('Product "pro" specifies product line ID "missing-line", but that product line does not exist');
  });

  it("rejects a product whose customer type differs from its product line", async () => {
    await expect(branchPaymentsSchema.validate({
      productLines: {
        teamLine: {
          customerType: "team",
        },
      },
      products: {
        pro: {
          customerType: "user",
          productLineId: "teamLine",
        },
      },
    })).rejects.toThrow('Product "pro" has customer type "user" but its product line "teamLine" has customer type "team"');
  });
});
