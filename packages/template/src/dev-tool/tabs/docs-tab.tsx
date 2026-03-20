"use client";

import React from "react";
import { IframeTab } from "../iframe-tab";

// IF_PLATFORM react-like

export function DocsTab() {
  return (
    <IframeTab
      src="https://docs.stack-auth.com"
      title="Stack Auth Documentation"
      loadingMessage="Loading documentation…"
      errorMessage="Unable to load documentation"
    />
  );
}

// END_PLATFORM
