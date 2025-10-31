// This file exists solely so the following old, deprecated code from when StackHandler used to still take props:
//     <StackHandler app={stackServerApp} routeProps={props} />
// does not throw the following error:
//     Only plain objects, and a few built-ins, can be passed to Client Components from Server Components. Classes or null prototypes are not supported.
// This file exists as a component that can be both client and server, ignores its parameters, and returns <StackHandler />

import { BaseHandlerProps, StackHandlerClient } from "./stack-handler-client";

export default function StackHandler({ app, routeProps, params, searchParams, ...props }: BaseHandlerProps & { location?: string } & {
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
}) {
  return <StackHandlerClient {...props} />;
}
