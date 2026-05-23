import { useEffect, useState } from "react";

export function useWaitForIdle(min = 0, max = 5000) {
  const [hasWaited, setHasWaited] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setTimeout(() => {
      const cb = () => {
        if (cancelled) return;
        setHasWaited(true);
      };
      if (typeof requestIdleCallback === "function") {
        requestIdleCallback(cb, { timeout: max - min });
      } else {
        setTimeout(cb, max - min);
      }
    }, min);
    return () => {
      cancelled = true;
    };
  }, [min, max]);
  return hasWaited;
}
