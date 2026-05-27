import type { Metadata } from 'next';
import React from 'react';
import '../polyfills';

export const metadata: Metadata = {
  title: 'Hexclave API',
  description: 'API endpoint of Hexclave.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode,
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
