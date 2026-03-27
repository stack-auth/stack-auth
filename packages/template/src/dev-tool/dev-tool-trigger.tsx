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
      <span className="sdt-trigger-logo">
        <svg width="14" height="17" viewBox="0 0 131 156" fill="currentColor">
          <path d="M124.447 28.6459L70.1382 1.75616C67.3472 0.374284 64.0715 0.372197 61.279 1.75051L0.740967 31.6281V87.6369L65.7101 119.91L117.56 93.675V112.414L65.7101 138.44L0.740967 106.584V119.655C0.740967 122.359 2.28151 124.827 4.71097 126.015L62.282 154.161C65.0966 155.538 68.3938 155.515 71.1888 154.099L130.47 124.074V79.7105C130.47 74.8003 125.34 71.5769 120.915 73.7077L79.4531 93.675V75.9771L130.47 50.1589V38.3485C130.47 34.2325 128.137 30.4724 124.447 28.6459Z" />
        </svg>
      </span>
      <span className="sdt-trigger-text">DEV</span>
    </button>
  );
}

// END_PLATFORM
