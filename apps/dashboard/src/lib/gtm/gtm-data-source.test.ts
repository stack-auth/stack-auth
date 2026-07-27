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
    await expect(resolveGtmDataset({}, true, { kind: "own-project" })).resolves.toEqual(getGtmDemoDataset());
    expect(mockLoadGtmDataset).not.toHaveBeenCalled();
  });

  it("loads stored records in real mode", async () => {
    const stored = { insights: [], actions: [], notes: [], radar: null };
    mockLoadGtmDataset.mockResolvedValue(stored);

    await expect(resolveGtmDataset({}, false, { kind: "own-project" })).resolves.toBe(stored);
    expect(mockLoadGtmDataset).toHaveBeenCalledWith({}, { kind: "own-project" });
  });

  it("passes a managed project through to the API layer", async () => {
    const stored = { insights: [], actions: [], notes: [], radar: null };
    mockLoadGtmDataset.mockResolvedValue(stored);

    await expect(resolveGtmDataset({}, false, { kind: "managed-project", projectId: "project-1" })).resolves.toBe(stored);
    expect(mockLoadGtmDataset).toHaveBeenCalledWith({}, { kind: "managed-project", projectId: "project-1" });
  });
});
