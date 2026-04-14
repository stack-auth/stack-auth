"use client";

import { Suspense } from "react";
import { StackProvider, StackTheme } from "@stackframe/stack";
import { stackClientApp } from "../stack";
import Loading from "./loading";
import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <title>Stack Auth — MCP Review Tool</title>
      </head>
      <body>
        <StackProvider app={stackClientApp}>
          <StackTheme>
            <Suspense fallback={<Loading />}>
              {children}
            </Suspense>
          </StackTheme>
        </StackProvider>
      </body>
    </html>
  );
}
