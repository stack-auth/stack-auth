"use client";

import { resetGlobalErrorRecoveryAttempts } from "./global-error-recovery";
import { useEffect } from "react";

export function GlobalErrorRecoveryReset() {
  useEffect(() => {
    resetGlobalErrorRecoveryAttempts();
  }, []);

  return null;
}
