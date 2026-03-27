"use client";

import React, { useMemo } from "react";
import { useStackApp } from "../../lib/hooks";
import { resolveDashboardUrl } from "../dev-tool-context";
import { IframeTab } from "../iframe-tab";

// IF_PLATFORM react-like

function isDashboardLocalhost(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

export function DashboardTab() {
  const app = useStackApp();
  const dashboardUrl = useMemo(() => resolveDashboardUrl(app), [app]);
  const isLocal = useMemo(() => isDashboardLocalhost(dashboardUrl), [dashboardUrl]);

  if (!isLocal) {
    return (
      <div className="sdt-iframe-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' }}>
          <div style={{ fontSize: '14px', color: 'var(--sdt-text-secondary)' }}>
            Dashboard embedding is only available on localhost.
          </div>
          <a
            href={dashboardUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="sdt-iframe-error-btn"
            style={{ textDecoration: 'none' }}
          >
            Open Dashboard in New Tab
          </a>
        </div>
      </div>
    );
  }

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
