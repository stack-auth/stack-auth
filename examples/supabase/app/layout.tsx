import { StackProvider, StackTheme } from "@hexclave/next";
import { hexclaveServerApp } from "../hexclave";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-background text-foreground">
        <StackProvider app={hexclaveServerApp}>
          <StackTheme>
            {children}
          </StackTheme>
        </StackProvider>
      </body>
    </html>
  );
}
