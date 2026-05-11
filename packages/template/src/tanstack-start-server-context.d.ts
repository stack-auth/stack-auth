declare module "@stackframe/tanstack-start/tanstack-start-server-context" {
  type TanStackStartServerContext = typeof import("@tanstack/react-start/server");

  export const deleteCookie: TanStackStartServerContext["deleteCookie"] | undefined;
  export const getCookie: TanStackStartServerContext["getCookie"] | undefined;
  export const getCookies: TanStackStartServerContext["getCookies"] | undefined;
  export const getRequestHeader: TanStackStartServerContext["getRequestHeader"] | undefined;
  export const setCookie: TanStackStartServerContext["setCookie"] | undefined;
}
