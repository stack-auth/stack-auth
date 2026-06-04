import { useEffect, useState } from "react";
import { AsyncResult } from "../utils/results";

export function useAsyncExternalStore<T>(
  subscribe: (callback: (t: T) => void) => (() => void),
): AsyncResult<T, never> & { status: "ok" | "pending" } {
  // sure, the "sync" in useSyncExternalStore refers to "synchronize a store" and not "sync/async", but it's too good of a name to pass up on

  const [isAvailable, setIsAvailable] = useState(false);
  const [value, setValue] = useState<T>();
  useEffect(() => {
    const unsubscribe = subscribe((value: T) => {
      setValue(() => value);
      setIsAvailable(() => true);
    });
    return unsubscribe;
  }, [subscribe]);

  if (isAvailable) {
    return AsyncResult.ok(value as T);
  } else {
    return AsyncResult.pending();
  }
}
