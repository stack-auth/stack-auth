import { RefObject, useEffect, useRef } from "react";

export function useMutationObserver(
  targetRef: RefObject<Node | null>,
  callback: (mutations: MutationRecord[] | "init") => void,
  options: MutationObserverInit,
) {
  const { ...observerOptions } = options;
  const observerOptionsStringified = JSON.stringify(observerOptions);

  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (targetRef.current !== null) {
      const observer = new MutationObserver(callbackRef.current);
      const observerOptionsParsed = JSON.parse(observerOptionsStringified);
      observer.observe(targetRef.current, observerOptionsParsed);
      callbackRef.current("init");
      return () => observer.disconnect();
    }
  }, [targetRef, observerOptionsStringified]);
}
