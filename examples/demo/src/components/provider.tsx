'use client';

import React from "react";
import { StackTheme } from "@hexclave/next";
import { ThemeProvider } from "next-themes";

export default function Provider({ children }) {
  return (
    <ThemeProvider>
      {children}
    </ThemeProvider>
  );
}
