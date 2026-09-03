import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";

const IS_DEV = process.env.NODE_ENV === "development";
const PLACEHOLDER = "REPLACE_ME";

export function envOrDevDefault(value: string | undefined, devDefault: string, name: string): string {
  if (!value || value === PLACEHOLDER) {
    if (IS_DEV) return devDefault;
    throw new HexclaveAssertionError(`${name} is not configured. Set the NEXT_PUBLIC_HEXCLAVE_* vars in .env.local or the hosting platform env.`);
  }
  return value;
}

const DEFAULT_API_URL = "https://api.hexclave.com";
export function hexclaveApiUrl(): string {
  const value = process.env.NEXT_PUBLIC_HEXCLAVE_API_URL;
  if (!value || value === PLACEHOLDER) return DEFAULT_API_URL;
  return value;
}
