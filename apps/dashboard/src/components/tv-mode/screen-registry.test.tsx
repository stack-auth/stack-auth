import { describe, expect, it } from "vitest";
import { formatTvExactUsd, formatTvSignedPercent } from "./screen-registry";

describe("formatTvExactUsd", () => {
  it("keeps cents for amounts that are not whole dollars", () => {
    expect(formatTvExactUsd(123456)).toBe("$1,234.56");
    expect(formatTvExactUsd(1)).toBe("$0.01");
  });

  it("stays compact for whole-dollar amounts", () => {
    expect(formatTvExactUsd(123400)).toBe("$1,234");
    expect(formatTvExactUsd(0)).toBe("$0");
  });
});

describe("formatTvSignedPercent", () => {
  it("points the arrow in the direction of the change", () => {
    expect(formatTvSignedPercent(18.3)).toBe("↑ 18.3%");
    expect(formatTvSignedPercent(-12)).toBe("↓ 12%");
  });

  it("omits the arrow when there is no change", () => {
    expect(formatTvSignedPercent(0)).toBe("0%");
  });
});
