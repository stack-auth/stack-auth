"use client";

import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import i18next, { i18n as I18nInstance } from "i18next";
import { createContext, useContext, useEffect, useMemo } from "react";
import { locales, SupportedLocale, supportedLocales } from "../locales";

export type TranslationContextValue = {
  i18n: I18nInstance,
  locale: SupportedLocale,
};

export const TranslationContext = createContext<TranslationContextValue | null>(null);

export function useTranslationContext(): TranslationContextValue | null {
  return useContext(TranslationContext);
}

/**
 * Translation provider that wraps the application with i18next translations.
 *
 * @param lang - The locale to use for translations (e.g., "en-US", "de-DE")
 * @param translationOverrides - Optional key-value pairs to override specific translations
 * @param children - Child components
 */
export function TranslationProvider({
  children,
  lang,
  translationOverrides,
}: {
  children: React.ReactNode,
  lang: SupportedLocale | undefined,
  translationOverrides?: Record<string, string>,
}) {
  const effectiveLocale = lang && supportedLocales.includes(lang) ? lang : "en-US";

  // Create a new i18n instance for this provider
  // We use a separate instance to avoid conflicts with other StackProviders
  const i18n = useMemo(() => {
    const instance = i18next.createInstance();

    // Get base translations for the locale
    const baseTranslations = locales[effectiveLocale];

    // Merge with overrides
    const translations = {
      ...baseTranslations,
      ...translationOverrides,
    };

    // init() is synchronous when initImmediate: false and resources are provided inline
    // The returned promise resolves immediately
    runAsynchronously(instance.init({
      initImmediate: false,
      lng: effectiveLocale,
      fallbackLng: "en-US",
      interpolation: {
        escapeValue: false, // React already escapes values
        prefix: "{",
        suffix: "}",
      },
      resources: {
        [effectiveLocale]: {
          translation: translations,
        },
        // Also load English as fallback if different from current locale
        ...(effectiveLocale !== "en-US" && {
          "en-US": {
            translation: locales["en-US"],
          },
        }),
      },
    }));

    return instance;
  }, [effectiveLocale, translationOverrides]);

  // Update translations when locale or overrides change
  useEffect(() => {
    if (i18n.language !== effectiveLocale) {
      const baseTranslations = locales[effectiveLocale];
      const translations = {
        ...baseTranslations,
        ...translationOverrides,
      };

      i18n.addResourceBundle(effectiveLocale, "translation", translations, true, true);
      runAsynchronously(i18n.changeLanguage(effectiveLocale));
    }
  }, [i18n, effectiveLocale, translationOverrides]);

  const contextValue = useMemo(
    () => ({
      i18n,
      locale: effectiveLocale,
    }),
    [i18n, effectiveLocale]
  );

  return (
    <TranslationContext.Provider value={contextValue}>
      {children}
    </TranslationContext.Provider>
  );
}
