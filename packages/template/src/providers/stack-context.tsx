"use client";

import React from "react";
import type { StackClientApp } from "../lib/stack-app/apps/interfaces/client-app";

export const StackContext = React.createContext<null | {
  app: StackClientApp<true>,
}>(null);
