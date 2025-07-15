'use client';

import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import Color from "color";
import React from "react";
import { globalCSS } from "../generated/global-css";
import { BrowserScript } from "../utils/browser-script";
import { DEFAULT_THEME } from "../utils/constants";

type Colors = {
  background: string,
  foreground: string,
  card: string,
  cardForeground: string,
  popover: string,
  popoverForeground: string,
  primary: string,
  primaryForeground: string,
  secondary: string,
  secondaryForeground: string,
  muted: string,
  mutedForeground: string,
  accent: string,
  accentForeground: string,
  destructive: string,
  destructiveForeground: string,
  border: string,
  input: string,
  ring: string,
}

export type Theme = {
  light: Colors,
  dark: Colors,
  radius: string,
};

type ThemeConfig = {
  light?: Partial<Colors>,
  dark?: Partial<Colors>,
} & Partial<Omit<Theme, 'light' | 'dark'>>;

function convertColorToCSSVars(obj: Record<string, string>) {
  return Object.fromEntries(Object.entries(obj).map(([key, value]) => {
    const color = Color(value).hsl().array();
    return [
      // Convert camelCase key to dash-case
      key.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`),
      // Convert color to CSS HSL string
      `${color[0]} ${color[1]}% ${color[2]}%`
    ];
  }));
}

function convertColorsToCSS(theme: Theme) {
  const { dark, light, ...rest } = theme;
  const colors = {
    light: { ...convertColorToCSSVars(light), ...rest },
    dark: convertColorToCSSVars(dark),
  };

  function colorsToCSSVars(colors: Record<string, string>) {
    return Object.entries(colors).map((params) => {
      return `--${params[0]}: ${params[1]};\n`;
    }).join('');
  }

  return deindent`
    .stack-scope {
      ${colorsToCSSVars(colors.light)}
    }
    html:has(head > [data-stack-theme="dark"]) .stack-scope { 
      ${colorsToCSSVars(colors.dark)}
    }
  `;
}


export function StackTheme({
  theme,
  children,
  nonce,
} : {
  theme?: ThemeConfig,
  children?: React.ReactNode,
  nonce?: string,
}) {
  const themeValue: Theme = {
    ...DEFAULT_THEME,
    ...theme,
    dark: { ...DEFAULT_THEME.dark, ...theme?.dark },
    light: { ...DEFAULT_THEME.light, ...theme?.light },
  };

  return (
    <>
      <BrowserScript nonce={nonce} />
      <style
        suppressHydrationWarning // we need this since the nonce can differ between client and server
        nonce={nonce}
        dangerouslySetInnerHTML={{
          __html: globalCSS + "\n" + convertColorsToCSS(themeValue),
        }}
      />
      {children}
    </>
  );
}
