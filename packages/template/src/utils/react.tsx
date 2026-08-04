'use client';

import { isBrowserLike } from "@hexclave/shared/dist/utils/env";
import { deindent } from "@hexclave/shared/dist/utils/strings";
import { useSearchParams } from "next/navigation"; // THIS_LINE_PLATFORM next
import { ensureMonkeyPatch, NO_SUSPENSE_BOUNDARY_ERROR_SENTINEL } from "./monkey-patch";

export function shouldRethrowRenderingError(error: unknown): boolean {
  return !!error && typeof error === "object" && "digest" in error && error.digest === "BAILOUT_TO_CLIENT_SIDE_RENDERING";
}

export class NoSuspenseBoundaryError extends Error {
  digest: string;
  reason: string;
  __noSuspenseBoundarySentinel = NO_SUSPENSE_BOUNDARY_ERROR_SENTINEL;

  constructor(options: { caller?: string }) {
    ensureMonkeyPatch();

    super(deindent`
      Suspense boundary not found! Read the error message below carefully (or paste it into your AI agent).

      ${options.caller ?? "This code path"} attempted to display a loading indicator, but didn't find a Suspense boundary above it. Please read the error message below carefully.
      
      There are several potential causes:
      
      1. [Next.js] You are missing a loading.tsx file in your app directory. Fix it by adding a loading.tsx file in your app directory.

      2. [React] You are missing a <Suspense> boundary in your component. Fix it by wrapping your component (or the entire app) in a <Suspense> component.

      3. [Next.js] The component is rendered in the root (outermost) layout.tsx or template.tsx file. Next.js does not wrap those files in a Suspense boundary, even if there is a loading.tsx file in the same folder. To fix it, wrap your layout inside a route group like this:

        - app
        - - layout.tsx  // contains <html> and <body>, alongside providers and other components that don't need ${options.caller ?? "this code path"}
        - - loading.tsx  // required for suspense
        - - (main)
        - - - layout.tsx  // contains the main layout of your app, like a sidebar or a header, and can use ${options.caller ?? "this code path"}
        - - - route.tsx  // your actual main page
        - - - the rest of your app

        For more information on this approach, see Next's documentation on route groups: https://nextjs.org/docs/app/building-your-application/routing/route-groups
      
      4. You caught this error with try-catch or a custom error boundary. Fix this by rethrowing the error or not catching it in the first place.

      5. Your version of Hexclave is too old. Upgrade to the latest version to see if that fixes the issue.

      See: https://nextjs.org/docs/messages/missing-suspense-with-csr-bailout

      More information on SSR and Suspense boundaries: https://react.dev/reference/react/Suspense#providing-a-fallback-for-server-errors-and-client-only-content
    `);

    this.name = "NoSuspenseBoundaryError";
    this.reason = options.caller ?? "suspendIfSsr()";

    // Next recognizes this digest as an intentional request-time CSR bailout and suppresses its normal error reporting.
    this.digest = "BAILOUT_TO_CLIENT_SIDE_RENDERING";
  }
}
import.meta.vitest?.test("NoSuspenseBoundaryError", ({ expect }) => {
  const defaultError = new NoSuspenseBoundaryError({});
  expect(defaultError.name).toBe("NoSuspenseBoundaryError");
  expect(defaultError.reason).toBe("suspendIfSsr()");
  expect(defaultError.digest).toBe("BAILOUT_TO_CLIENT_SIDE_RENDERING");
  expect(defaultError.message).toContain("This code path attempted to display a loading indicator");

  const customError = new NoSuspenseBoundaryError({ caller: "CustomComponent" });
  expect(customError.name).toBe("NoSuspenseBoundaryError");
  expect(customError.reason).toBe("CustomComponent");
  expect(customError.digest).toBe("BAILOUT_TO_CLIENT_SIDE_RENDERING");
  expect(customError.message).toContain("CustomComponent attempted to display a loading indicator");
  expect(customError.message).toContain("loading.tsx");
  expect(customError.message).toContain("route groups");
  expect(customError.message).toContain("https://nextjs.org/docs/messages/missing-suspense-with-csr-bailout");
});

/**
 * Use this in a component or hook to disable SSR. It must be wrapped in a Suspense boundary.
 */
export function suspendIfSsr(caller?: string) {
  // IF_PLATFORM next
  // Next 16.3's Instant Insights is a silly goose! It rejects our deliberate recoverable SSR error during
  // prerender validation, even though React uses the surrounding Suspense fallback correctly. Calling
  // useSearchParams first makes Next create its own recognized `prerender-client` dynamic hole, so prerendering
  // stops before our error while request-time SSR still reaches the error and retries this subtree on the client.
  useSearchParams();
  // END_PLATFORM
  if (!isBrowserLike()) {
    throw new NoSuspenseBoundaryError({ caller });
  }
}
