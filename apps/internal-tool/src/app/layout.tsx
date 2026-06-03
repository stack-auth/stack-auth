"use client";

import { Suspense } from "react";
import { StackProvider, StackTheme } from "@hexclave/next";
import { hexclaveClientApp } from "../stack";
import Loading from "./loading";
import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <title>Hexclave — MCP Review Tool</title>
      </head>
      <body>
        <StackProvider app={hexclaveClientApp}>
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
