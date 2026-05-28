import React, { Suspense } from 'react';
import { StackAdminApp, StackClientApp, StackServerApp, stackAppInternalsSymbol } from '../lib/stack-app';
import { StackProviderClient } from './stack-provider-client';
import { TranslationProvider } from './translation-provider';

// IF_PLATFORM next
function NextStackProvider({
  children,
  app,
  lang,
  translationOverrides,
}: {
  lang?: React.ComponentProps<typeof TranslationProvider>['lang'],
  /**
   * A mapping of English translations to translated equivalents.
   *
   * These will take priority over the translations from the language specified in the `lang` property. Note that the
   * keys are case-sensitive.
   */
  translationOverrides?: Record<string, string>,
  children: React.ReactNode,
  // list all three types of apps even though server and admin are subclasses of client so it's clear that you can pass any
  app: StackClientApp<true> | StackServerApp<true> | StackAdminApp<true>,
}) {
  return (
    <StackProviderClient app={app[stackAppInternalsSymbol].toClientJson()} serialized={true}>
      <Suspense fallback={null} />
      <TranslationProvider lang={lang} translationOverrides={translationOverrides}>
        {children}
      </TranslationProvider>
    </StackProviderClient>
  );
}
// ELSE_IF_PLATFORM tanstack-start
function TanStackStartStackProvider({
  children,
  app,
  lang,
  translationOverrides,
}: {
  lang?: React.ComponentProps<typeof TranslationProvider>['lang'],
  /**
   * A mapping of English translations to translated equivalents.
   *
   * These will take priority over the translations from the language specified in the `lang` property. Note that the
   * keys are case-sensitive.
   */
  translationOverrides?: Record<string, string>,
  children: React.ReactNode,
  // list all three types of apps even though server and admin are subclasses of client so it's clear that you can pass any
  app: StackClientApp<true>,
}) {
  return (
    <StackProviderClient app={app} serialized={false}>
      <TranslationProvider lang={lang} translationOverrides={translationOverrides}>
        <Suspense fallback={null}>
          {children}
        </Suspense>
      </TranslationProvider>
    </StackProviderClient>
  );
}
// ELSE_PLATFORM
function ReactStackProvider({
  children,
  app,
  lang,
  translationOverrides,
}: {
  lang?: React.ComponentProps<typeof TranslationProvider>['lang'],
  /**
   * A mapping of English translations to translated equivalents.
   *
   * These will take priority over the translations from the language specified in the `lang` property. Note that the
   * keys are case-sensitive.
   */
  translationOverrides?: Record<string, string>,
  children: React.ReactNode,
  // list all three types of apps even though server and admin are subclasses of client so it's clear that you can pass any
  app: StackClientApp<true>,
}) {
  return (
    <StackProviderClient app={app as any} serialized={false}>
      <Suspense fallback={null} />
      <TranslationProvider lang={lang} translationOverrides={translationOverrides}>
        {children}
      </TranslationProvider>
    </StackProviderClient>
  );
}
// END_PLATFORM

// Pick the platform-appropriate provider implementation. Only the active branch's
// line is preserved by the platform-stripping script when generating per-platform SDKs.
// The /* ... */ block hides the inactive branches from the template's TypeScript compiler.
// IF_PLATFORM next
const ActiveProvider = NextStackProvider;
/* ELSE_IF_PLATFORM tanstack-start
const ActiveProvider = TanStackStartStackProvider;
ELSE_PLATFORM
const ActiveProvider = ReactStackProvider;
END_PLATFORM */

// Named exports live outside the platform conditional so the @deprecated JSDoc can
// use a /** ... */ block without colliding with the outer comment terminator.
export const HexclaveProvider = ActiveProvider;
/** @deprecated Use `HexclaveProvider` from the `@hexclave/*` package instead — same symbol, new brand name. See https://docs.hexclave.com/migration. */
export const StackProvider = ActiveProvider;
export default ActiveProvider;
