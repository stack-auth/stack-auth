import { useEffect, useState } from "react";

export function useWaitForIdle(min = 0, max = 5000) {
  const [hasWaited, setHasWaited] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setTimeout(() => {
      requestIdleCallback(() => {
        if (cancelled) return;
        setHasWaited(true);
      }, { timeout: max - min });
    }, min);
    return () => {
      cancelled = true;
    };
  }, [min, max]);
  return hasWaited;
}
