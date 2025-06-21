"use client";

import { isBrowserLike } from "@stackframe/stack-shared/dist/utils/env";
import { useToast } from "@stackframe/stack-ui";
import { useEffect } from "react";

const neverNotify = [
  "Failed to fetch RSC payload",
  "[Fast Refresh] performing full",
];

let callbacks: ((prop: string, args: any[]) => void)[] = [];

if (process.env.NODE_ENV === 'development' && isBrowserLike()) {
  for (const prop of ["error"] as const) {
    const original = console[prop];
    console[prop] = (...args) => {
      original(...args);
      if (!neverNotify.some((msg) => args.some((arg) => `${arg}`.includes(msg)))) {
        callbacks.forEach((cb) => cb(prop, args));
      }
    };
  }
}

export function DevErrorNotifier() {
  const toast = useToast();

  useEffect(() => {
    const cb = (prop: string, args: any[]) => {
      setTimeout(() => {
        toast.toast({
          title: `[DEV] console.${prop} called!`,
          description: `Please check the browser console. ${args.join(" ").slice(0, 100)}...`,
          variant: "destructive",
        });
      });
    };
    callbacks.push(cb);

    return () => {
      callbacks = callbacks.filter((c) => c !== cb);
    };
  }, [toast]);

  return null;
}
