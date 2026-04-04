export function normalizeCountryCode(countryCode: string): string {
  return countryCode.trim().toUpperCase();
}

export function isValidCountryCode(countryCode: string): boolean {
  const normalized = normalizeCountryCode(countryCode);
  return /^[A-Z]{2}$/.test(normalized);
}

/**
 * Validates and normalizes a country code value (single string or array).
 * Returns null if valid, or an error message string if invalid.
 */
export function validateCountryCode(value: string | string[]): string | null {
  const values = Array.isArray(value) ? value : [value];
  if (values.length === 0) {
    return "At least one country code is required";
  }
  return values.every(v => isValidCountryCode(v))
    ? null
    : "Country code must be a 2-letter code";
}

import.meta.vitest?.test("country codes", ({ expect }) => {
  expect(normalizeCountryCode(" us ")).toBe("US");
  expect(isValidCountryCode("us")).toBe(true);
  expect(isValidCountryCode("US")).toBe(true);
  expect(isValidCountryCode("ZZ")).toBe(true);
  expect(isValidCountryCode("usa")).toBe(false);
  expect(isValidCountryCode("a")).toBe(false);
  expect(isValidCountryCode("")).toBe(false);
  expect(isValidCountryCode("12")).toBe(false);

  expect(validateCountryCode("US")).toBeNull();
  expect(validateCountryCode("zz")).toBeNull();
  expect(validateCountryCode(["US", "CA"])).toBeNull();
  expect(validateCountryCode([])).toBe("At least one country code is required");
  expect(validateCountryCode(["US", "123"])).toBe("Country code must be a 2-letter code");
});
