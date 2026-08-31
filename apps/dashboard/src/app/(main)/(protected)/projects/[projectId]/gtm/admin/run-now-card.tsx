"use client";

import { DesignAlert, DesignButton, DesignCard } from "@/components/design-components";
import { runGrowthAdminSchedulerStep, type GrowthAdminSchedulerResult } from "@/lib/growth/growth-api";
import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { GearSixIcon } from "@phosphor-icons/react";
import { useState } from "react";

type RunState = { status: "idle" } | { status: "running" } | { status: "success", result: GrowthAdminSchedulerResult } | { status: "error", message: string };

export function GrowthAdminRunNowCard(props: { app: object, projectId: string, projectName: string, onCompleted: () => Promise<void> }) {
  const [state, setState] = useState<RunState>({ status: "idle" });

  const runScheduler = () => {
    setState({ status: "running" });
    runAsynchronouslyWithAlert(async () => {
      const result = await runGrowthAdminSchedulerStep(props.app, props.projectId);
      await props.onCompleted();
      setState({ status: "success", result });
    }, {
      onError: error => setState({ status: "error", message: error instanceof Error ? error.message : String(error) }),
    });
  };

  return (
    <DesignCard title={`Manual scheduler · ${props.projectName}`} subtitle="Run one scheduler pass for this project when no Cron invocation is driving the engine" icon={GearSixIcon} gradient="cyan">
      <div className="space-y-3">
        {state.status === "error" && <DesignAlert variant="error">{state.message}</DesignAlert>}
        {/* Three outcomes, not two. `legStarted === false` is the one that used to be reported as
          * success: the boundary event is durably queued but its workflow leg did not come up inside
          * the request's budget, so the run has NOT started and pressing again is the right move. */}
        {state.status === "success" && (
          state.result.legStarted === false
            ? <DesignAlert variant="warning">Work is queued, but the analysis leg did not start within the time limit. Nothing is lost — run it again.</DesignAlert>
            : <DesignAlert variant="info">Scheduler pass completed{state.result.didWork ? " and moved this project forward." : ", but found no work to process."}</DesignAlert>
        )}
        <div className="flex flex-wrap gap-2">
          <DesignButton variant="outline" size="sm" loading={state.status === "running"} onClick={runScheduler}>
            Run scheduler for this project
          </DesignButton>
        </div>
        <p className="text-xs text-muted-foreground">Targets only this selected project — it never advances anyone else&apos;s workflows. The internal admin session is used; the cron secret is not exposed.</p>
      </div>
    </DesignCard>
  );
}
