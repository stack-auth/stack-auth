import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  // Priority order:
  // 1. Locale from request (if provided by middleware)
  // 2. Locale from cookie (user preference)
  // 3. Default locale

  let locale = await requestLocale;

  if (!locale) {
    const cookieStore = await cookies();
    const localeCookie = cookieStore.get('NEXT_LOCALE');
    if (localeCookie && routing.locales.includes(localeCookie.value as any)) {
      locale = localeCookie.value;
    }
  }

  // Ensure that a valid locale is used
  if (!locale || !routing.locales.includes(locale as any)) {
    locale = routing.defaultLocale;
  }

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default
  };
});

