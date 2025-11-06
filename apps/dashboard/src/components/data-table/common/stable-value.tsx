"use client";

import { useRef } from "react";

export function useStableValue<T>(value: T, fingerprint: string): T {
  const previousRef = useRef<{ fingerprint: string, value: T }>();
  if (previousRef.current && previousRef.current.fingerprint === fingerprint) {
    return previousRef.current.value;
  }
  previousRef.current = { fingerprint, value };
  return value;
}

