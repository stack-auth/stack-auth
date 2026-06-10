import { useSyncExternalStore } from "react";
import { suspendIfSsr } from "../utils/react";

export const useHash = () => {
  suspendIfSsr("useHash");
  return useSyncExternalStore(
    (onChange) => {
      const interval = setInterval(() => onChange(), 10);
      return () => clearInterval(interval);
    },
    () => window.location.hash.substring(1)
  );
};

