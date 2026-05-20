import { StyleLink } from '@/components/style-link';
import { cn } from '@/components/ui';
import { getPublicEnvVar } from '@/lib/env';
import { getEnvVariable, getNodeEnvironment } from '@stackframe/stack-shared/dist/utils/env';
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from 'geist/font/sans';
import type { Metadata } from 'next';
import { Inter as FontSans } from "next/font/google";
import React from 'react';
import '../polyfills';
import './globals.css';
import { LayoutClient } from './layout-client';

const apiUrl = getPublicEnvVar('NEXT_PUBLIC_STACK_API_URL');

export const metadata: Metadata = {
  ...apiUrl ? { metadataBase: new URL(apiUrl) } : {},
  title: {
    default: 'Stack Auth Dashboard',
    template: '%s | Stack Auth',
  },
  description: 'Stack Auth is the open-source Auth0 alternative, and the fastest way to add authentication to your web app.',
  openGraph: {
    title: 'Stack Auth Dashboard',
    description: 'Stack Auth is the open-source Auth0 alternative, and the fastest way to add authentication to your web app.',
    ...apiUrl ? { images: [`${apiUrl}/open-graph-image.png`] } : {},
  },
  twitter: {
    title: 'Stack Auth Dashboard',
    description: 'Stack Auth is the open-source Auth0 alternative, and the fastest way to add authentication to your web app.',
    ...apiUrl ? { images: [`${apiUrl}/open-graph-image.png`] } : {},
  },
};

const fontSans = FontSans({
  subsets: ["latin"],
  variable: "--font-sans",
});

type TagConfigJson = {
  tagName: string,
  attributes: { [key: string]: string },
  innerHTML?: string,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode,
}) {
  const headTags: TagConfigJson[] = JSON.parse(getEnvVariable('NEXT_PUBLIC_STACK_HEAD_TAGS', '[]'));
  const translationLocale = getEnvVariable('STACK_DEVELOPMENT_TRANSLATION_LOCALE', "") || undefined;
  if (translationLocale !== undefined && getNodeEnvironment() !== 'development') {
    throw new Error(`STACK_DEVELOPMENT_TRANSLATION_LOCALE can only be used in development mode (found: ${JSON.stringify(translationLocale)})`);
  }

  const enableReactScanInDevelopment = getPublicEnvVar('NEXT_PUBLIC_STACK_ENABLE_REACT_SCAN_IN_DEVELOPMENT') === 'true';

  return (
    <html suppressHydrationWarning lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <head>
        <link rel="preconnect" href="https://fonts.gstatic.com" />
        <StyleLink href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded&display=block" />
        <StyleLink defer href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.css" integrity="sha384-OH8qNTHoMMVNVcKdKewlipV4SErXqccxxlg6HC9Cwjr5oZu2AdBej1TndeCirael" crossOrigin="anonymous" />

        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        {process.env.NODE_ENV === 'development' && enableReactScanInDevelopment && <script
          crossOrigin="anonymous"
          src="//unpkg.com/react-scan/dist/auto.global.js"
        />}

        {headTags.map((tag, index) => {
          const { tagName, attributes, innerHTML } = tag;
          return React.createElement(tagName, {
            key: index,
            dangerouslySetInnerHTML: { __html: innerHTML ?? "" },
            ...attributes,
          });
        })}

        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script dangerouslySetInnerHTML={{ __html: getPublicEnvVar("NEXT_PUBLIC_STACK_IS_PREVIEW") === "true"
          ? "(function(){try{var t=localStorage.getItem('theme');var d=document.documentElement;var r=t==='dark'||t==='light'?t:'light';d.classList.add(r);d.style.colorScheme=r}catch(e){}})()"
          : "(function(){try{var t=localStorage.getItem('theme');var d=document.documentElement;var r=t==='dark'||t==='light'?t:window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';d.classList.add(r);d.style.colorScheme=r}catch(e){}})()"
        }} />
      </head>
      <body
        className={cn(
            "min-h-screen bg-background font-sans antialiased",
            fontSans.variable
          )}
        suppressHydrationWarning
      >
        <Analytics />
        <SpeedInsights />
        <LayoutClient translationLocale={translationLocale}>
          {children}
        </LayoutClient>
      </body>
    </html>
  );
}
