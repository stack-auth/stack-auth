// This file exists solely so the following old, deprecated code from when StackHandler used to still take props:
//     <StackHandler app={hexclaveServerApp} routeProps={props} />
// does not throw the following error:
//     Only plain objects, and a few built-ins, can be passed to Client Components from Server Components. Classes or null prototypes are not supported.
// This file exists as a component that can be both client and server, ignores the non-serializable props, and returns <HexclaveHandlerClient />

import { BaseHandlerProps, HexclaveHandlerClient } from "./hexclave-handler-client";

type HexclaveHandlerProps = BaseHandlerProps & { location?: string } & {
  /**
   * @deprecated The app parameter is no longer necessary. You can safely remove it.
   */
  app?: any,

  /**
   * @deprecated The routeProps parameter is no longer necessary. You can safely remove it.
   */
  routeProps?: any,

  /**
   * @deprecated The params parameter is no longer necessary. You can safely remove it.
   */
  params?: any,

  /**
   * @deprecated The searchParams parameter is no longer necessary. You can safely remove it.
   */
  searchParams?: any,
};

function HandlerImpl({ app, routeProps, params, searchParams, ...props }: HexclaveHandlerProps) {
  return <HexclaveHandlerClient {...props} />;
}

// Non-deprecated Hexclave-branded export.
export const HexclaveHandler = HandlerImpl;

/** @deprecated Use `HexclaveHandler` from the `@hexclave/*` package instead — same symbol, new brand name. See https://docs.hexclave.com/migration. */
export const StackHandler = HandlerImpl;

// Default export preserved for backwards compatibility (legacy `as`-rename re-exports).
// Points at the deprecated alias so that `import StackHandler from ".../hexclave-handler"` still
// surfaces the deprecation. Internal re-exports in template/src/index.ts use the named exports.
export default StackHandler;
