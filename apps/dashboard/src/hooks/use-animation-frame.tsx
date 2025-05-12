import { isBrowserLike } from "@stackframe/stack-shared/dist/utils/env";
import { useLayoutEffect, useRef } from "react";

export function useAnimationFrame(callback: FrameRequestCallback) {
  const actualCallbackRef = useRef(callback);
  actualCallbackRef.current = callback;

  useLayoutEffect(() => {
    // check if we're in a browser environment
    if (!isBrowserLike()) return () => {};

    let handle = -1;
    const newCallback: FrameRequestCallback = (...args) => {
      actualCallbackRef.current(...args);
      handle = requestAnimationFrame(newCallback);
    };
    handle = requestAnimationFrame(newCallback);
    return () => cancelAnimationFrame(handle);
  }, [actualCallbackRef]);
}
