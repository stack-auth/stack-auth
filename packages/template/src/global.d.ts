import type { } from "react/canary";

declare global {
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface ImportMeta {
    readonly env?: Record<string, string | undefined>,
  }
}
