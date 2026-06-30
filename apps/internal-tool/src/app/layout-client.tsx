"use client";

import { Suspense } from "react";
import { StackProvider, StackTheme } from "@hexclave/next";
import { hexclaveClientApp } from "../hexclave";
import Loading from "./loading";

export default function LayoutClient({ children }: { children: React.ReactNode }) {
  return (
    <StackProvider app={hexclaveClientApp}>
      <StackTheme>
        <Suspense fallback={<Loading />}>
          {children}
        </Suspense>
      </StackTheme>
    </StackProvider>
  );
}
