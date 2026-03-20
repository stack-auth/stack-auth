import { describe, expect, it } from "vitest";
import { createEmptyCondition } from "@/lib/cel-visual-parser";
import { isConditionTreeValid } from "./condition-builder";

describe("isConditionTreeValid", () => {
  it("accepts valid country codes", () => {
    expect(isConditionTreeValid({
      ...createEmptyCondition(),
      field: "countryCode",
      operator: "equals",
      value: "us",
    })).toBe(true);
  });

  it("rejects invalid single country codes", () => {
    expect(isConditionTreeValid({
      ...createEmptyCondition(),
      field: "countryCode",
      operator: "equals",
      value: "usa",
    })).toBe(false);
  });

  it("rejects invalid country codes in lists", () => {
    expect(isConditionTreeValid({
      ...createEmptyCondition(),
      field: "countryCode",
      operator: "in_list",
      value: ["US", "USA"],
    })).toBe(false);
  });

  it("rejects empty country code lists", () => {
    expect(isConditionTreeValid({
      ...createEmptyCondition(),
      field: "countryCode",
      operator: "in_list",
      value: [],
    })).toBe(false);
  });
});
