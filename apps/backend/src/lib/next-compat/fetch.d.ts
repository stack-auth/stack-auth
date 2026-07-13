export { };

declare global {
  // RequestInit is defined as an interface by lib.dom; interface merging is the
  // TypeScript mechanism for adding Next's fetch metadata option.
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface RequestInit {
    next?: {
      revalidate?: number | false,
      tags?: string[],
    },
  }
}
