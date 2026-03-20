"use client";

import React, { useMemo } from "react";
import { useStackApp } from "../../lib/hooks";
import { resolveDashboardUrl } from "../dev-tool-context";
import { IframeTab } from "../iframe-tab";

// IF_PLATFORM react-like

export function DashboardTab() {
  const app = useStackApp();
  const dashboardUrl = useMemo(() => resolveDashboardUrl(app), [app]);

  return (
    <IframeTab
      src={dashboardUrl}
      title="Stack Auth Dashboard"
      loadingMessage="Loading dashboard…"
      errorMessage="Unable to load dashboard"
      errorDetail="The dashboard may require authentication or block framing"
    />
  );
}

// END_PLATFORM
