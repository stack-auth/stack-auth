import React, { SetStateAction } from "react";
import { isBrowserLike } from "./env";
import { neverResolve } from "./promises";
import { deindent } from "./strings";

export function componentWrapper<
  C extends React.ComponentType<any> | keyof React.JSX.IntrinsicElements,
  ExtraProps extends {} = {}
>(displayName: string, render: React.ForwardRefRenderFunction<RefFromComponent<C>, React.ComponentPropsWithRef<C> & ExtraProps>) {
  const Component = forwardRefIfNeeded(render);
  Component.displayName = displayName;
  return Component;
}
type RefFromComponent<C extends React.ComponentType<any> | keyof React.JSX.IntrinsicElements> = NonNullable<RefFromComponentDistCond<React.ComponentPropsWithRef<C>["ref"]>>;
type RefFromComponentDistCond<A> = A extends React.RefObject<infer T> ? T : never;  // distributive conditional type; see https://www.typescriptlang.org/docs/handbook/2/conditional-types.html#distributive-conditional-types

export function forwardRefIfNeeded<T, P = {}>(render: React.ForwardRefRenderFunction<T, P>): React.FC<P & { ref?: React.Ref<T> }> {
  // TODO: when we drop support for react 18, remove this

  const version = React.version;
  const major = parseInt(version.split(".")[0]);
  if (major < 19) {
    return React.forwardRef<T, P>(render as any) as any;
  } else {
    return ((props: P) => render(props, (props as any).ref)) as any;
  }
}

export function getNodeText(node: React.ReactNode): string {
  if (["number", "string"].includes(typeof node)) {
    return `${node}`;
  }
  if (!node) {
    return "";
  }
  if (Array.isArray(node)) {
    return node.map(getNodeText).join("");
  }
  if (typeof node === "object" && "props" in node) {
    return getNodeText(node.props.children);
  }
  throw new Error(`Unknown node type: ${typeof node}`);
}
import.meta.vitest?.test("getNodeText", ({ expect }) => {
  // Test with string
  expect(getNodeText("hello")).toBe("hello");

  // Test with number
  expect(getNodeText(42)).toBe("42");

  // Test with null/undefined
  expect(getNodeText(null)).toBe("");
  expect(getNodeText(undefined)).toBe("");

  // Test with array
  expect(getNodeText(["hello", " ", "world"])).toBe("hello world");
  expect(getNodeText([1, 2, 3])).toBe("123");

  // Test with mixed array
  expect(getNodeText(["hello", 42, null])).toBe("hello42");

  // Test with React element (mocked)
  const mockElement = {
    props: {
      children: "child text"
    }
  } as React.ReactElement;
  expect(getNodeText(mockElement)).toBe("child text");

  // Test with nested React elements
  const nestedElement = {
    props: {
      children: {
        props: {
          children: "nested text"
        }
      } as React.ReactElement
    }
  } as React.ReactElement;
  expect(getNodeText(nestedElement)).toBe("nested text");

  // Test with array of React elements
  const arrayOfElements = [
    { props: { children: "first" } } as React.ReactElement,
    { props: { children: "second" } } as React.ReactElement
  ];
  expect(getNodeText(arrayOfElements)).toBe("firstsecond");
});

/**
 * Suspends the currently rendered component indefinitely. Will not unsuspend unless the component rerenders.
 *
 * You can use this to translate older query- or AsyncResult-based code to new the Suspense system, for example: `if (query.isLoading) suspend();`
 */
export function suspend(): never {
  React.use(neverResolve());
  throw new Error("Somehow a Promise that never resolves was resolved?");
}

export function mapRef<T, R>(ref: ReadonlyRef<T>, mapper: (value: T) => R): ReadonlyRef<R> {
  let last: [T, R] | null = null;
  return {
    get current() {
      const input = ref.current;
      if (last === null || input !== last[0]) {
        last = [input, mapper(input)];
      }
      return last[1];
    },
  };
}

export type ReadonlyRef<T> = {
  readonly current: T,
};

export type RefState<T> = ReadonlyRef<T> & {
  set: (updater: SetStateAction<T>) => void,
};

/**
 * Like useState, but its value is immediately available on refState.current after being set.
 *
 * Like useRef, but setting the value will cause a rerender.
 *
 * Note that useRefState returns a new object every time a rerender happens due to a value change, which is intentional
 * as it allows you to specify it in a dependency array like this:
 *
 * ```tsx
 * useEffect(() => {
 *   // do something with refState.current
 * }, [refState]);  // instead of refState.current
 * ```
 *
 * If you don't want this, you can wrap the result in a useMemo call.
 */
export function useRefState<T>(initialValue: T): RefState<T> {
  const [, setState] = React.useState(initialValue);
  const ref = React.useRef(initialValue);
  const setValue = React.useCallback((updater: SetStateAction<T>) => {
    const value: T = typeof updater === "function" ? (updater as any)(ref.current) : updater;
    setState(value);
    ref.current = value;
  }, []);
  const res = React.useMemo(() => ({
    current: ref.current,
    set: setValue,
  }), [ref.current, setValue]);
  return res;
}

export function mapRefState<T, R>(refState: RefState<T>, mapper: (value: T) => R, reverseMapper: (oldT: T, newR: R) => T): RefState<R> {
  let last: [T, R] | null = null;
  return {
    get current() {
      const input = refState.current;
      if (last === null || input !== last[0]) {
        last = [input, mapper(input)];
      }
      return last[1];
    },
    set(updater: SetStateAction<R>) {
      const value: R = typeof updater === "function" ? (updater as any)(this.current) : updater;
      refState.set(reverseMapper(refState.current, value));
    },
  };
}

export class NoSuspenseBoundaryError extends Error {
  digest: string;
  reason: string;

  constructor(options: { caller?: string }) {
    super(deindent`
      ${options.caller ?? "This code path"} attempted to display a loading indicator, but didn't find a Suspense boundary above it. Please read the error message below carefully.
      
      The fix depends on which of the 3 scenarios caused it:
      
      1. You are missing a loading.tsx file in your app directory. Fix it by adding a loading.tsx file in your app directory.

      2. The component is rendered in the root (outermost) layout.tsx or template.tsx file. Next.js does not wrap those files in a Suspense boundary, even if there is a loading.tsx file in the same folder. To fix it, wrap your layout inside a route group like this:

        - app
        - - layout.tsx  // contains <html> and <body>, alongside providers and other components that don't need ${options.caller ?? "this code path"}
        - - loading.tsx  // required for suspense
        - - (main)
        - - - layout.tsx  // contains the main layout of your app, like a sidebar or a header, and can use ${options.caller ?? "this code path"}
        - - - route.tsx  // your actual main page
        - - - the rest of your app

        For more information on this approach, see Next's documentation on route groups: https://nextjs.org/docs/app/building-your-application/routing/route-groups
      
      3. You caught this error with try-catch or a custom error boundary. Fix this by rethrowing the error or not catching it in the first place.

      See: https://nextjs.org/docs/messages/missing-suspense-with-csr-bailout

      More information on SSR and Suspense boundaries: https://react.dev/reference/react/Suspense#providing-a-fallback-for-server-errors-and-client-only-content
    `);

    this.name = "NoSuspenseBoundaryError";
    this.reason = options.caller ?? "suspendIfSsr()";

    // set the digest so nextjs doesn't log the error
    // https://github.com/vercel/next.js/blob/d01d6d9c35a8c2725b3d74c1402ab76d4779a6cf/packages/next/src/shared/lib/lazy-dynamic/bailout-to-csr.ts#L14
    this.digest = "BAILOUT_TO_CLIENT_SIDE_RENDERING";
  }
}
import.meta.vitest?.test("NoSuspenseBoundaryError", ({ expect }) => {
  // Test with default options
  const defaultError = new NoSuspenseBoundaryError({});
  expect(defaultError.name).toBe("NoSuspenseBoundaryError");
  expect(defaultError.reason).toBe("suspendIfSsr()");
  expect(defaultError.digest).toBe("BAILOUT_TO_CLIENT_SIDE_RENDERING");
  expect(defaultError.message).toContain("This code path attempted to display a loading indicator");

  // Test with custom caller
  const customError = new NoSuspenseBoundaryError({ caller: "CustomComponent" });
  expect(customError.name).toBe("NoSuspenseBoundaryError");
  expect(customError.reason).toBe("CustomComponent");
  expect(customError.digest).toBe("BAILOUT_TO_CLIENT_SIDE_RENDERING");
  expect(customError.message).toContain("CustomComponent attempted to display a loading indicator");

  // Verify error message contains all the necessary information
  expect(customError.message).toContain("loading.tsx");
  expect(customError.message).toContain("route groups");
  expect(customError.message).toContain("https://nextjs.org/docs/messages/missing-suspense-with-csr-bailout");
});


/**
 * Use this in a component or a hook to disable SSR. Should be wrapped in a Suspense boundary, or it will throw an error.
 */
export function suspendIfSsr(caller?: string) {
  if (!isBrowserLike()) {
    throw new NoSuspenseBoundaryError({ caller });
  }
}
