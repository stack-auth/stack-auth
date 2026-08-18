import { GROWTH_PHASES, type GrowthPhase } from "./growth-status";

// Demo mode is an internal-only affordance: it swaps the live Growth workspace for a deterministic fixture
// dataset so we can demo and screenshot every lifecycle state without seeding real records. Customers must
// never see it, so the `demo` query param is ignored outright outside the `internal` project rather than
// just being hidden from the UI — otherwise hand-crafting `?demo=true` would show a customer a fabricated
// analysis that looks like their own data.
export function isGrowthDemoModeAvailable(projectId: string): boolean {
  return projectId === "internal";
}

export function isGrowthDemoMode(projectId: string, demoParam: string | null): boolean {
  if (!isGrowthDemoModeAvailable(projectId)) return false;
  return demoParam !== "false";
}

/**
 * Which lifecycle state the demo fixtures present. Only meaningful while demo mode is on; the param is
 * ignored (steady-state fallback) outside it so the value can never leak fixture UI to a customer.
 */
export function getGrowthDemoPhase(projectId: string, demoPhaseParam: string | null): GrowthPhase {
  if (!isGrowthDemoModeAvailable(projectId)) return "steady-state";
  const match = GROWTH_PHASES.find((phase) => phase === demoPhaseParam);
  return match ?? "steady-state";
}
