'use client';

import { ThemeProvider as NextThemeProvider } from "next-themes";
import { useEffect, useState } from "react";

export function ThemeProvider(props: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <>{props.children}</>;
  }

  return (
    <NextThemeProvider attribute="class">
      {props.children}
    </NextThemeProvider>
  );
}
