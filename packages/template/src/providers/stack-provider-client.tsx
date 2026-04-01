"use client";

import { CurrentUserCrud } from "@stackframe/stack-shared/dist/interface/crud/current-user";
import { globalVar } from "@stackframe/stack-shared/dist/utils/globals";
import React, { useEffect } from "react";
import { useStackApp } from "..";
import { StackClientApp, StackClientAppJson, stackAppInternalsSymbol } from "../lib/stack-app";
// IF_PLATFORM js-like
import { mountDevTool } from "../dev-tool";
// END_PLATFORM

export const StackContext = React.createContext<null | {
  app: StackClientApp<true>,
}>(null);

// IF_PLATFORM js-like
function DevToolMount({ app }: { app: StackClientApp<true> }) {
  useEffect(() => {
    return mountDevTool(app);
  }, [app]);
  return null;
}
// END_PLATFORM

export function StackProviderClient(props: {
  app: StackClientAppJson<true, string> | StackClientApp<true>,
  serialized: boolean,
  children?: React.ReactNode,
}) {
  const app = props.serialized
    ? StackClientApp[stackAppInternalsSymbol].fromClientJson(props.app as StackClientAppJson<true, string>)
    : props.app as StackClientApp<true>;
  globalVar.__STACK_AUTH__ = { app };

  return (
    <StackContext.Provider value={{ app }}>
      {props.children}
      {/* IF_PLATFORM js-like */}
      <DevToolMount app={app} />
      {/* END_PLATFORM */}
    </StackContext.Provider>
  );
}

export function UserSetter(props: { userJsonPromise: Promise<CurrentUserCrud['Client']['Read'] | null> }) {
  const app = useStackApp();
  useEffect(() => {
    const promise = (async () => await props.userJsonPromise)();  // there is a Next.js bug where Promises passed by server components return `undefined` as their `then` value, so wrap it in a normal promise
    app[stackAppInternalsSymbol].setCurrentUser(promise);
  }, []);
  return null;
}
