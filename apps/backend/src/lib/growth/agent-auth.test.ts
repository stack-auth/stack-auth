import { describe, expect, it } from "vitest";
import { checkGrowthAgentSecret } from "./agent-auth";

describe("checkGrowthAgentSecret", () => {
  it("accepts the exact Bearer header for the secret", () => {
    expect(checkGrowthAgentSecret("Bearer mock_growth_agent_secret", "mock_growth_agent_secret")).toBe(true);
  });

  it("rejects a missing header", () => {
    expect(checkGrowthAgentSecret(undefined, "mock_growth_agent_secret")).toBe(false);
  });

  it("rejects the bare secret without the Bearer prefix", () => {
    expect(checkGrowthAgentSecret("mock_growth_agent_secret", "mock_growth_agent_secret")).toBe(false);
  });

  it("rejects a wrong secret of the same length", () => {
    expect(checkGrowthAgentSecret("Bearer mock_growth_agent_secreX", "mock_growth_agent_secret")).toBe(false);
  });

  it("rejects secrets of different lengths without throwing", () => {
    expect(checkGrowthAgentSecret("Bearer short", "mock_growth_agent_secret")).toBe(false);
    expect(checkGrowthAgentSecret("Bearer mock_growth_agent_secret_with_suffix", "mock_growth_agent_secret")).toBe(false);
  });

  it("rejects case and scheme variations", () => {
    expect(checkGrowthAgentSecret("bearer mock_growth_agent_secret", "mock_growth_agent_secret")).toBe(false);
    expect(checkGrowthAgentSecret("Basic mock_growth_agent_secret", "mock_growth_agent_secret")).toBe(false);
  });
});
