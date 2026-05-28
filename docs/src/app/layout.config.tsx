import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
/**
 * Shared layout configurations
 *
 * you can customise layouts individually from:
 * Home Layout: app/(home)/layout.tsx
 * Docs Layout: app/docs/layout.tsx
 */
export const baseOptions: BaseLayoutProps = {
  nav: {
    title: (
      <>
        <svg
          width="24"
          height="24"
          viewBox="0 0 48 48"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-label="Hexclave Logo"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinejoin="miter"
        >
          <path d="M 24 4 L 41.32 14 L 41.32 34 L 24 44 L 6.68 34 L 6.68 14 Z"/>
          <path d="M 11 16.87 L 14 15.13 L 14 32.87 L 11 31.13 Z" fill="currentColor" stroke="none"/>
          <path d="M 11 16.87 L 14 15.13 L 14 32.87 L 11 31.13 Z" fill="currentColor" stroke="none" transform="rotate(120 24 24)"/>
          <path d="M 11 16.87 L 14 15.13 L 14 32.87 L 11 31.13 Z" fill="currentColor" stroke="none" transform="rotate(240 24 24)"/>
        </svg>
        Hexclave
      </>
    ),
    transparentMode: "top",
  },
  searchToggle: {
    enabled: false,
  },
  links: [
    {
      type: 'main',
      text: "GitHub",
      url: "https://github.com/hexclave/stack-auth",
      active: "url",
      external: true
    },
    {
      type: 'main',
      text: "Discord",
      url: "https://discord.stack-auth.com",
      active: "url",
      external: true
    }
  ]
};
