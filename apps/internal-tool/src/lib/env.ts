const IS_DEV = process.env.NODE_ENV === "development";
const PLACEHOLDER = "REPLACE_ME";

/**
 * In dev, fall back to a seeded local default when an env var is missing or
 * still holds the `REPLACE_ME` placeholder. In prod, missing/placeholder values
 * are a deployment misconfiguration and throw immediately so requests don't
 * silently go out with empty auth headers or a blank base URL.
 */
export function envOrDevDefault(value: string | undefined, devDefault: string, name: string): string {
  if (!value || value === PLACEHOLDER) {
    if (IS_DEV) return devDefault;
    throw new Error(`${name} is not configured. Set the NEXT_PUBLIC_STACK_* vars in .env.local or the hosting platform env.`);
  }
  return value;
}
