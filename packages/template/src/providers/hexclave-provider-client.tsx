"use client";

import { CurrentUserCrud } from "@hexclave/shared/dist/interface/crud/current-user";
import { globalVar } from "@hexclave/shared/dist/utils/globals";
import React, { useEffect } from "react";
import { useStackApp } from "../lib/hooks";
import { StackClientApp, StackClientAppJson, hexclaveAppInternalsSymbol } from "../lib/hexclave-app";
import { HexclaveContext } from "./hexclave-context";

export function HexclaveProviderClient(props: {
  app: StackClientAppJson<true, string> | StackClientApp<true>,
  serialized: boolean,
  children?: React.ReactNode,
}) {
  const app = props.serialized
    ? StackClientApp[hexclaveAppInternalsSymbol].fromClientJson(props.app as StackClientAppJson<true, string>)
    : props.app as StackClientApp<true>;
  globalVar.__STACK_AUTH__ = { app };

  return (
    <HexclaveContext.Provider value={{ app }}>
      {props.children}
    </HexclaveContext.Provider>
  );
}

export function UserSetter(props: { userJsonPromise: Promise<CurrentUserCrud['Client']['Read'] | null> }) {
  const app = useStackApp();
  useEffect(() => {
    const promise = (async () => await props.userJsonPromise)();  // there is a Next.js bug where Promises passed by server components return `undefined` as their `then` value, so wrap it in a normal promise
    app[hexclaveAppInternalsSymbol].setCurrentUser(promise);
  }, []);
  return null;
}
