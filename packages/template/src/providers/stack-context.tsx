"use client";

import React from "react";
import { createGlobal } from "@hexclave/shared/dist/utils/globals";
import type { StackClientApp } from "../lib/stack-app/apps/interfaces/client-app";

type StackContextValue = {
  app: StackClientApp<true>,
};

export const StackContext = createGlobal<React.Context<StackContextValue | null>>(
  "StackContext",
  () => React.createContext<StackContextValue | null>(null),
);
StackContext.displayName ??= "StackContext";
