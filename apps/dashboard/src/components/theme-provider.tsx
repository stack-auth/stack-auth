'use client';

import { ThemeProvider as NextThemeProvider } from "next-themes";

export function ThemeProvider(props: { children: React.ReactNode }) {
  return (
    <NextThemeProvider attribute="class">
      {props.children}
    </NextThemeProvider>
  );
}
