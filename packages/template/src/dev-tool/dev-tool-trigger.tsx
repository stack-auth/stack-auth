"use client";

import React from "react";

// IF_PLATFORM react-like

export function DevToolTrigger({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="sdt-trigger"
      onClick={onClick}
      aria-label="Toggle Stack Auth Dev Tools"
      title="Stack Auth Dev Tools"
    >
      <span className="sdt-trigger-logo">S</span>
      <span className="sdt-trigger-text">DEV</span>
    </button>
  );
}

// END_PLATFORM
