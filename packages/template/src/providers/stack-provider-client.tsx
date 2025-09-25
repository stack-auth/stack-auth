"use client";

import { CurrentUserCrud } from "@stackframe/stack-shared/dist/interface/crud/current-user";
import { globalVar } from "@stackframe/stack-shared/dist/utils/globals";
import React, { useEffect } from "react";
import { useStackApp } from "..";
import { StackClientApp, StackClientAppJson, stackAppInternalsSymbol } from "../lib/stack-app";

export const StackContext = React.createContext<null | {
  app: StackClientApp<true>,
}>(null);

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
