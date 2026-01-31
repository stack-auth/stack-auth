"use client";

import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { useEffect, useRef } from "react";

/**
 * A hook that executes an action after a debounce delay, with proper cancellation.
 *
 * This is designed for use with components that use `key={value}` to reset state,
 * ensuring the action only runs once per mount after the delay.
 *
 * Usage pattern:
 * ```tsx
 * // Wrapper resets inner component on query change
 * function MyComponent({ query }) {
 *   return <MyComponentInner key={query} query={query} />;
 * }
 *
 * function MyComponentInner({ query }) {
 *   useDebouncedAction({
 *     action: async () => { await doSomething(query); },
 *     delayMs: 400,
 *     skip: !query.trim(),
 *   });
 *   // ...
 * }
 * ```
 *
 * @param action - The async action to execute after the delay
 * @param delayMs - The delay in milliseconds before executing (default: 400ms)
 * @param skip - If true, the action will not be executed
 */
export function useDebouncedAction({
  action,
  delayMs = 400,
  skip = false,
}: {
  action: () => Promise<void> | void,
  delayMs?: number,
  skip?: boolean,
}) {
  const hasExecutedRef = useRef(false);
  const actionRef = useRef(action);
  actionRef.current = action;

  useEffect(() => {
    if (skip || hasExecutedRef.current) {
      return;
    }

    let cancelled = false;

    const execute = async () => {
      await wait(delayMs);
      if (cancelled) return;
      if (hasExecutedRef.current) return;

      hasExecutedRef.current = true;
      await actionRef.current();
    };

    execute().catch((error) => {
      // Log but don't throw - the action should handle its own errors
      console.error("useDebouncedAction error:", error);
    });

    return () => {
      cancelled = true;
    };
  }, [delayMs, skip]);
}
