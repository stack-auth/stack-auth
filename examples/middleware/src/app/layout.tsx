import type { Metadata } from "next";
import { StackProvider, StackTheme } from "@hexclave/next";
import { hexclaveServerApp } from "../hexclave";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Hexclave Middleware Demo",
  description: "A demo of Hexclave's middleware capabilities.",
};

type StackThemeChildren = Parameters<typeof StackTheme>[0]["children"];

export default function RootLayout({
  children,
}: Readonly<{
  children: StackThemeChildren,
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <StackProvider app={hexclaveServerApp}>
          <StackTheme>
            {children}
          </StackTheme>
        </StackProvider>
      </body>
    </html>
  );
}
