import { StackProvider, StackTheme } from '@stackframe/stack';
import { RootProvider } from 'fumadocs-ui/provider';
import { Inter } from 'next/font/google';
import { stackServerApp } from '../stack';
import './global.css';

const inter = Inter({
  subsets: ['latin'],
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <head>
      </head>
      <body className="flex flex-col min-h-screen">
        <StackProvider app={stackServerApp}>
          <StackTheme>
            <RootProvider
              search={{
                enabled: false, // Completely disable fumadocs search
              }}
            >
              {children}
            </RootProvider>
          </StackTheme>
        </StackProvider>
      </body>
    </html>
  );
}
