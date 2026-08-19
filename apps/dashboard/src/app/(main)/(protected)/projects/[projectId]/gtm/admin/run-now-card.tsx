"use client";

import { DesignAlert, DesignButton, DesignCard } from "@/components/design-components";
import { runGrowthAdminManualStep, type GrowthAdminManualStep } from "@/lib/growth/growth-api";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { GearSixIcon } from "@phosphor-icons/react";
import { useState } from "react";

type RunState = { status: "idle" } | { status: "running", step: GrowthAdminManualStep } | { status: "success", step: GrowthAdminManualStep, didWork: boolean } | { status: "error", message: string };

const stepLabels: Record<GrowthAdminManualStep, string> = {
  workflow_engine: "Run workflow step",
  growth_watchdog: "Run watchdog",
};

export function GrowthAdminRunNowCard(props: { app: object }) {
  const [state, setState] = useState<RunState>({ status: "idle" });

  const runStep = async (step: GrowthAdminManualStep) => {
    setState({ status: "running", step });
    try {
      const result = await runGrowthAdminManualStep(props.app, step);
      setState({ status: "success", step, didWork: result.didWork });
    } catch (error) {
      captureError(`growth-admin-${step}`, error);
      setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const runningStep = state.status === "running" ? state.step : null;
  return (
    <DesignCard title="Manual scheduler" subtitle="Run one server-side step when Preview has no scheduled Cron invocation" icon={GearSixIcon} gradient="cyan">
      <div className="space-y-3">
        {state.status === "error" && <DesignAlert variant="error">{state.message}</DesignAlert>}
        {state.status === "success" && <DesignAlert variant="info">{stepLabels[state.step]} completed{state.didWork ? " and processed work." : ", but found no work to process."}</DesignAlert>}
        <div className="flex flex-wrap gap-2">
          {(Object.keys(stepLabels) as GrowthAdminManualStep[]).map((step) => (
            <DesignButton key={step} variant="outline" size="sm" disabled={runningStep != null} loading={runningStep === step} onClick={async () => await runStep(step)}>
              {stepLabels[step]}
            </DesignButton>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">The action uses your internal project admin session. It does not expose or require the cron secret.</p>
      </div>
    </DesignCard>
  );
}
