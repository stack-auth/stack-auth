'use client';
import { StackTheme } from "@hexclave/next";

export default function Provider({ children }) {
  return (
    <StackTheme>
      {children}
    </StackTheme>
  );
}
