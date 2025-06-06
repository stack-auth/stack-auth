import { useEffect, useState } from "react";

/**
 * Returns the current theme of the page.
 *
 * @returns the current theme and a boolean indicating if the theme has been mounted
 *
 * Note that this doesn't work in the server component. Please use the css variables for server side rendering.
 */
export function useThemeWatcher() {
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('light');

  useEffect(() => {
    setMounted(true);

    const updateTheme = () => {
      const themeEl = document.getElementById('--stack-theme-mode');
      setTheme(themeEl?.getAttribute('data-stack-theme') === 'dark' ? 'dark' : 'light');
    };

    // Watch for theme changes
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-stack-theme') {
          updateTheme();
          break;
        }
      }
    });

    const themeEl = document.getElementById('--stack-theme-mode');
    if (themeEl) {
      updateTheme();
      observer.observe(themeEl, {
        attributes: true,
        attributeFilter: ['data-stack-theme']
      });
    }

    return () => observer.disconnect();
  }, []);

  return { mounted, theme };
}
