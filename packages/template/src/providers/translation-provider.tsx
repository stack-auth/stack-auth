import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { quetzalKeys, quetzalLocales } from "../generated/quetzal-translations";
import { TranslationProviderClient } from "./translation-provider-client";

export function TranslationProvider({ lang, translationOverrides, children }: {
  lang: Parameters<typeof quetzalLocales.get>[0] | undefined,
  translationOverrides?: Record<string, string>,
  children: React.ReactNode,
}) {
  const locale = quetzalLocales.get(lang ?? (undefined as never));

  const localeWithOverrides = new Map<string, string>(locale);
  for (const [orig, override] of Object.entries(translationOverrides ?? {})) {
    const key = quetzalKeys.get(orig as never) ?? throwErr(new Error(`Invalid translation override: Original key ${JSON.stringify(orig)} not found. Make sure you are passing the correct values into the translationOverrides property of the component.`));
    localeWithOverrides.set(key, override);
  }

  return <TranslationProviderClient quetzalKeys={quetzalKeys} quetzalLocale={localeWithOverrides}>
    {children}
  </TranslationProviderClient>;
}
