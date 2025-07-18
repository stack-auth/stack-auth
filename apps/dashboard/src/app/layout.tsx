import { DevErrorNotifier } from '@/components/dev-error-notifier';
import { RouterProvider } from '@/components/router';
import { SiteLoadingIndicatorDisplay } from '@/components/site-loading-indicator';
import { StyleLink } from '@/components/style-link';
import { ThemeProvider } from '@/components/theme-provider';
import { getPublicEnvVar } from '@/lib/env';
import { stackServerApp } from '@/stack';
import { StackProvider, StackTheme } from '@stackframe/stack';
import { getEnvVariable, getNodeEnvironment } from '@stackframe/stack-shared/dist/utils/env';
import { Toaster, cn } from '@stackframe/stack-ui';
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from 'geist/font/sans';
import type { Metadata } from 'next';
import { Inter as FontSans } from "next/font/google";
import React from 'react';
import { VersionAlerter } from '../components/version-alerter';
import '../polyfills';
import { BackgroundShine } from './background-shine';
import { ClientPolyfill } from './client-polyfill';
import './globals.css';
import PageView from './pageview';
import { CSPostHogProvider, UserIdentity } from './providers';

export const metadata: Metadata = {
  metadataBase: new URL(getPublicEnvVar('NEXT_PUBLIC_STACK_API_URL') || ''),
  title: {
    default: 'Stack Auth Dashboard',
    template: '%s | Stack Auth',
  },
  description: 'Stack Auth is the open-source Auth0 alternative, and the fastest way to add authentication to your web app.',
  openGraph: {
    title: 'Stack Auth Dashboard',
    description: 'Stack Auth is the open-source Auth0 alternative, and the fastest way to add authentication to your web app.',
    images: [`${getPublicEnvVar('NEXT_PUBLIC_STACK_API_URL')}/open-graph-image.png`]
  },
  twitter: {
    title: 'Stack Auth Dashboard',
    description: 'Stack Auth is the open-source Auth0 alternative, and the fastest way to add authentication to your web app.',
    images: [`${getPublicEnvVar('NEXT_PUBLIC_STACK_API_URL')}/open-graph-image.png`]
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

  return (
    <html suppressHydrationWarning lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} style={{ contain: 'paint' }}>
      <head>
        <link rel="preconnect" href="https://fonts.gstatic.com" />
        <StyleLink href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded&display=block" />
        <StyleLink defer href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.css" integrity="sha384-OH8qNTHoMMVNVcKdKewlipV4SErXqccxxlg6HC9Cwjr5oZu2AdBej1TndeCirael" crossOrigin="anonymous" />

        {headTags.map((tag, index) => {
          const { tagName, attributes, innerHTML } = tag;
          return React.createElement(tagName, {
            key: index,
            dangerouslySetInnerHTML: { __html: innerHTML ?? "" },
            ...attributes,
          });
        })}
      </head>
      <CSPostHogProvider>
        <body
          className={cn(
            "min-h-screen bg-background font-sans antialiased",
            fontSans.variable
          )}
          suppressHydrationWarning
        >
          <Analytics />
          <PageView />
          <SpeedInsights />
          <ThemeProvider>
            <StackProvider app={stackServerApp} lang={translationLocale as any}>
              <StackTheme>
                <ClientPolyfill />
                <RouterProvider>
                  <UserIdentity />
                  <VersionAlerter severeOnly={false} />
                  <BackgroundShine />
                  {children}
                </RouterProvider>
              </StackTheme>
            </StackProvider>
          </ThemeProvider>
          <DevErrorNotifier />
          <Toaster />
          <SiteLoadingIndicatorDisplay />
        </body>
      </CSPostHogProvider>
    </html>
  );
}
