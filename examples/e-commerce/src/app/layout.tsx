import type { Metadata } from "next";
import { StackProvider, StackTheme } from "@hexclave/next";
import { Inter } from "next/font/google";
import { stackServerApp } from "../hexclave";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "E-Commerce Example with Hexclave",
  description: "Created with Hexclave",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode,
}>) {
  return (
    <html lang="en">
      <body className={inter.className}><StackProvider app={stackServerApp}><StackTheme>
        <main style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "stretch" }}>
          <h1>Hexclave - E-Commerce Example</h1>
          {children}
        </main>
      </StackTheme></StackProvider></body>
    </html>
  );
}
