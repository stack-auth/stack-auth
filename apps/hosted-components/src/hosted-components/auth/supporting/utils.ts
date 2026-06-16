import { useEffect, useState } from "react";

export function getSearchParams(): Partial<Record<string, string>> {
  if (typeof window === "undefined") {
    return {};
  }

  const params: Partial<Record<string, string>> = {};
  new URLSearchParams(window.location.search).forEach((value, key) => {
    params[key] = value;
  });
  return params;
}

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function useInIframe() {
  const [inIframe, setInIframe] = useState(false);

  useEffect(() => {
    setInIframe(window.self !== window.top);
  }, []);

  return inIframe;
}
