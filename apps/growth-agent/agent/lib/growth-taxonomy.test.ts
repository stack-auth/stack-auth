import { describe, expect, it } from "vitest";
import { z } from "zod";
import { growthCategorySchema, growthTagsSchema } from "./growth-taxonomy";

describe("Growth agent taxonomy schemas", () => {
  it("accepts only the seven primary categories", () => {
    expect(growthCategorySchema.parse("retention")).toBe("retention");
    expect(() => growthCategorySchema.parse("sales")).toThrow();
    expect(() => growthCategorySchema.parse(["retention"])).toThrow();
  });

  it("keeps tags optional without advertising a provider-facing default", () => {
    expect(growthTagsSchema.parse(undefined)).toBeUndefined();
    expect(growthTagsSchema.parse(["organic-search", "founder-led"])).toEqual(["organic-search", "founder-led"]);
    expect(() => growthTagsSchema.parse("organic-search")).toThrow();
    expect(JSON.stringify(z.toJSONSchema(growthTagsSchema))).not.toContain("\"default\"");
  });
});

