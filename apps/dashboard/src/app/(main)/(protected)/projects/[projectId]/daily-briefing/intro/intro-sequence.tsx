"use client";

// Placeholder — replaced by the cinematic intro overlay. Immediately finishes
// so the page is usable while the real sequence is being built.
import { useEffect } from "react";

export function IntroSequence({ onFinish }: { onFinish: () => void }) {
  useEffect(() => {
    onFinish();
  }, [onFinish]);
  return null;
}
