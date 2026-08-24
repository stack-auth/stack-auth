"use client";

import { DesignAlert, DesignButton, DesignCard } from "@/components/design-components";
import { runGrowthAdminManualStep, type GrowthAdminManualStep } from "@/lib/growth/growth-api";
import { typedKeys } from "@hexclave/shared/dist/utils/objects";
import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { GearSixIcon } from "@phosphor-icons/react";
import { useState } from "react";

type RunState = { status: "idle" } | { status: "running", step: GrowthAdminManualStep } | { status: "success", step: GrowthAdminManualStep, didWork: boolean } | { status: "error", message: string };

const stepLabels: Record<GrowthAdminManualStep, string> = {
  analysis_tick: "Advance selected analysis",
  project_recovery: "Repair selected project",
};

export function GrowthAdminRunNowCard(props: { app: object, projectId: string, projectName: string, onCompleted: () => Promise<void> }) {
  const [state, setState] = useState<RunState>({ status: "idle" });

  const runStep = (step: GrowthAdminManualStep) => {
    setState({ status: "running", step });
    runAsynchronouslyWithAlert(async () => {
      const result = await runGrowthAdminManualStep(props.app, props.projectId, step);
      await props.onCompleted();
      setState({ status: "success", step, didWork: result.didWork });
    }, {
      onError: error => setState({ status: "error", message: error instanceof Error ? error.message : String(error) }),
    });
  };

  const runningStep = state.status === "running" ? state.step : null;
  return (
    <DesignCard title={`Manual scheduler · ${props.projectName}`} subtitle="Run a server-side step for this project when Preview has no scheduled Cron invocation" icon={GearSixIcon} gradient="cyan">
      <div className="space-y-3">
        {state.status === "error" && <DesignAlert variant="error">{state.message}</DesignAlert>}
        {state.status === "success" && <DesignAlert variant="info">{stepLabels[state.step]} completed{state.didWork ? " and processed work." : ", but found no work to process."}</DesignAlert>}
        <div className="flex flex-wrap gap-2">
          {typedKeys(stepLabels).map((step) => (
            <DesignButton key={step} variant="outline" size="sm" disabled={runningStep != null} loading={runningStep === step} onClick={() => runStep(step)}>
              {stepLabels[step]}
            </DesignButton>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Both actions target only this selected project. The internal admin session is used; the cron secret is not exposed.</p>
      </div>
    </DesignCard>
  );
}
