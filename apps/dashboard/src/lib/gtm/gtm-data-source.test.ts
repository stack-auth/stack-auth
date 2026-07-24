import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadGtmDataset } from "./gtm-api";
import { getGtmDemoDataset, resolveGtmDataset } from "./gtm-data-source";

vi.mock("./gtm-api", () => ({
  loadGtmDataset: vi.fn(),
}));

const mockLoadGtmDataset = vi.mocked(loadGtmDataset);

describe("resolveGtmDataset", () => {
  beforeEach(() => {
    mockLoadGtmDataset.mockReset();
  });

  it("returns deterministic fixtures without making a real API request in demo mode", async () => {
    await expect(resolveGtmDataset({}, true)).resolves.toEqual(getGtmDemoDataset());
    expect(mockLoadGtmDataset).not.toHaveBeenCalled();
  });

  it("loads stored records in real mode", async () => {
    const stored = { insights: [], actions: [], notes: [], radar: null };
    mockLoadGtmDataset.mockResolvedValue(stored);

    await expect(resolveGtmDataset({}, false)).resolves.toBe(stored);
    expect(mockLoadGtmDataset).toHaveBeenCalledOnce();
  });
});
