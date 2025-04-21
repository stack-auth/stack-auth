"use client";


//===========================================
// THIS FILE IS AUTO-GENERATED FROM TEMPLATE. DO NOT EDIT IT DIRECTLY
//===========================================

import { createContext, useContext } from "react";

export const TranslationContext = createContext<null | {
  quetzalKeys: Map<string, string>,
  quetzalLocale: Map<string, string>,
}>(null);

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
