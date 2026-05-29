"use client";

import React from "react";
import { createGlobal } from "@hexclave/shared/dist/utils/globals";

type TranslationContextValue = {
  quetzalKeys: Map<string, string>,
  quetzalLocale: Map<string, string>,
};

export const TranslationContext = createGlobal<React.Context<TranslationContextValue | null>>(
  "TranslationContext",
  () => React.createContext<TranslationContextValue | null>(null),
);
TranslationContext.displayName ??= "TranslationContext";

export function TranslationProviderClient(props: {
  children: React.ReactNode,
  quetzalKeys: Map<string, string>,
  quetzalLocale: Map<string, string>,
}) {
  return (
    <TranslationContext.Provider value={{
      quetzalKeys: props.quetzalKeys,
      quetzalLocale: props.quetzalLocale,
    }}>
      {props.children}
    </TranslationContext.Provider>
  );
}
