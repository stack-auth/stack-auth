import { useTranslationContext } from "../providers/translation-provider";

/**
 * Hook for accessing translations.
 *
 * This hook uses i18next for translations. The translation files are located
 * in the src/locales directory and can be edited directly.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { t } = useTranslation();
 *   return <div>{t("Hello, {name}!", { name: "World" })}</div>;
 * }
 * ```
 */
export function useTranslation() {
  const context = useTranslationContext();

  if (!context) {
    throw new Error("Translation context not found; did you forget to wrap your app in a <StackProvider />?");
  }

  return {
    t: (str: string, templateVars?: Record<string, string>) => {
      return context.i18n.t(str, templateVars);
    },
  };
}
