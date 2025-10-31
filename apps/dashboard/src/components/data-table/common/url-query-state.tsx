"use client";

import { useRouter } from "@/components/router";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { AnyObjectSchema } from "yup";

type Updater<TState> = Partial<TState> | ((prev: TState) => Partial<TState>);

export type UseUrlQueryStateOptions<TState> = {
  schema: AnyObjectSchema,
  defaultState: TState,
  sanitize?: (state: Partial<TState>) => TState,
  serialize?: (state: TState) => URLSearchParams,
  isEqual?: (a: TState, b: TState) => boolean,
};

type UseUrlQueryStateResult<TState> = {
  state: TState,
  setState: (updater: Updater<TState>) => void,
};

export function useUrlQueryState<TState>(options: UseUrlQueryStateOptions<TState>): UseUrlQueryStateResult<TState> {
  const { schema, defaultState, sanitize, serialize, isEqual } = options;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsKey = searchParams.toString();

  const parsedState = useMemo(() => {
    const raw: Record<string, unknown> = {};
    searchParams.forEach((value, key) => {
      raw[key] = value;
    });

    let partial: Partial<TState> = {};
    try {
      const result = schema.validateSync(raw, { abortEarly: false, stripUnknown: true }) as Partial<TState>;
      partial = result;
    } catch {
      partial = {};
    }

    const sanitized = sanitize ? sanitize(partial) : { ...defaultState, ...partial };
    return sanitized as TState;
  }, [schema, sanitize, defaultState, searchParamsKey]);

  const stateRef = useRef(parsedState);
  useEffect(() => {
    stateRef.current = parsedState;
  }, [parsedState]);

  const replaceRef = useRef(router.replace);
  useEffect(() => {
    replaceRef.current = router.replace;
  }, [router.replace]);

  const defaultSerialize = useCallback(
    (state: TState) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(state)) {
        const defaultValue = (defaultState as Record<string, unknown>)[key];
        if (value === undefined || value === null || value === defaultValue) {
          continue;
        }
        params.set(key, String(value));
      }
      return params;
    },
    [defaultState],
  );

  const equalityFn = isEqual ?? ((a, b) => JSON.stringify(a) === JSON.stringify(b));

  const setState = useCallback(
    (updater: Updater<TState>) => {
      const current = stateRef.current;
      const patch = typeof updater === "function" ? updater(current) : updater;
      const merged = { ...current, ...patch };
      const next = sanitize ? sanitize(merged) : ({ ...defaultState, ...merged } as TState);
      if (equalityFn(current, next)) {
        return;
      }
      const params = (serialize ?? defaultSerialize)(next);
      const queryString = params.toString();
      const replace = replaceRef.current;
      replace(queryString.length > 0 ? `${pathname}?${queryString}` : pathname);
    },
    [pathname, sanitize, serialize, defaultSerialize, equalityFn],
  );

  return { state: parsedState, setState };
}
