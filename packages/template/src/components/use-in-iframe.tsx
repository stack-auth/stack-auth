'use client';
import { useEffect, useState } from "react";

export function useInIframe() {
  const [isIframe, setIsIframe] = useState(false);
  useEffect(() => {
    if (window.self !== window.top) {
      setIsIframe(true);
    }
  }, []);

  return isIframe;
}
