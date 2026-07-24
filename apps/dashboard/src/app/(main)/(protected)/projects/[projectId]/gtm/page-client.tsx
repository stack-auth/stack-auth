"use client";

import { AppEnabledGuard } from "../app-enabled-guard";
import { useProjectId } from "../use-admin-app";
import { DesignBadge } from "@/components/design-components";
import { useRouter } from "@/components/router";
import { Switch } from "@/components/ui/switch";
import { GtmDataProvider } from "@/lib/gtm/gtm-data";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { GtmOverview } from "./components/overview";
import { GtmOnboardingGate } from "./components/onboarding-gate";

export default function PageClient() {
  const projectId = useProjectId();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const demo = searchParams.get("demo") !== "false";
  const setDemo = (value: boolean) => {
    const next = new URLSearchParams(searchParams);
    if (value) {
      next.set("demo", "true");
    } else {
      next.set("demo", "false");
    }
    const query = next.toString();
    router.push(query.length === 0 ? pathname : `${pathname}?${query}`);
  };
  const toolbar = (settingsAction?: ReactNode) => (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-foreground/[0.08] bg-foreground/[0.02] px-4 py-3">
      <div className="flex items-center gap-2">
        {demo && <DesignBadge label="Demo mode" color="orange" size="sm" />}
        <span className="text-sm text-muted-foreground">
          {demo ? "You are currently in demo mode." : "You are currently looking at your live GTM workspace."}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Switch checked={demo} onCheckedChange={setDemo} aria-label="Use demo mode" />
          Demo mode
        </label>
        {settingsAction}
      </div>
    </div>
  );
  return (
    <AppEnabledGuard appId="gtm">
      {demo ? (
        <GtmDataProvider demo>
          <GtmOverview toolbar={toolbar()} />
        </GtmDataProvider>
      ) : projectId === "internal" ? (
        <GtmDataProvider demo={false}>
          <GtmOverview toolbar={toolbar()} />
        </GtmDataProvider>
      ) : (
        <GtmDataProvider demo={false}>
          <GtmOnboardingGate>
            {(settingsAction) => <GtmOverview toolbar={toolbar(settingsAction)} />}
          </GtmOnboardingGate>
        </GtmDataProvider>
      )}
    </AppEnabledGuard>
  );
}
