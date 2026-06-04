"use client";

import React from "react";
import { createGlobal } from "@hexclave/shared/dist/utils/globals";
import type { StackClientApp } from "../lib/hexclave-app/apps/interfaces/client-app";

type HexclaveContextValue = {
  app: StackClientApp<true>,
};

export const HexclaveContext = createGlobal<React.Context<HexclaveContextValue | null>>(
  "HexclaveContext",
  () => React.createContext<HexclaveContextValue | null>(null),
);
HexclaveContext.displayName ??= "HexclaveContext";
