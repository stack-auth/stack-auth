import { StackProvider, StackTheme } from "@hexclave/next";
import { Metadata } from "next";
import Header from "src/components/header";
import Provider from "src/components/provider";
import { hexclaveServerApp } from "src/hexclave";
import './global.css';

export const metadata: Metadata = {
  title: 'Hexclave Demo',
  description: 'Example of using Hexclave as your authentication system.',
};

export default function RootLayout({
  children,
}: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head />
      <body>
        <StackProvider app={hexclaveServerApp}>
          <StackTheme>
            <Provider>
              <div className="flex flex-col h-screen">
                <Header />
                <div className="flex flex-grow">
                  {children}
                </div>
              </div>
            </Provider>
          </StackTheme>
        </StackProvider>
      </body>
    </html>
  );
}
