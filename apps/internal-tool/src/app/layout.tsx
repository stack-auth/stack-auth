"use client";

import { Suspense } from "react";
import { HexclaveProvider, HexclaveTheme } from "@hexclave/next";
import { hexclaveClientApp } from "../hexclave";
import Loading from "./loading";
import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <title>Hexclave — MCP Review Tool</title>
      </head>
      <body>
        <HexclaveProvider app={hexclaveClientApp}>
          <HexclaveTheme>
            <Suspense fallback={<Loading />}>
              {children}
            </Suspense>
          </HexclaveTheme>
        </HexclaveProvider>
      </body>
    </html>
  );
}
