"use client";

import React from "react";

// IF_PLATFORM react-like

/** When true, component previews inside the dev tool do not duplicate registry entries. */
const DevToolComponentPreviewContext = React.createContext(false);

export function DevToolComponentPreviewProvider({ children }: { children: React.ReactNode }) {
  return (
    <DevToolComponentPreviewContext.Provider value={true}>
      {children}
    </DevToolComponentPreviewContext.Provider>
  );
}

// END_PLATFORM
