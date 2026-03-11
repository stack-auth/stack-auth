export const ISO_3166_ALPHA_2_COUNTRY_CODES = [
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT", "AU", "AW", "AX", "AZ",
  "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS", "BT", "BV", "BW", "BY", "BZ",
  "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN", "CO", "CR", "CU", "CV", "CW", "CX", "CY", "CZ",
  "DE", "DJ", "DK", "DM", "DO", "DZ",
  "EC", "EE", "EG", "EH", "ER", "ES", "ET",
  "FI", "FJ", "FK", "FM", "FO", "FR",
  "GA", "GB", "GD", "GE", "GF", "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT", "GU", "GW", "GY",
  "HK", "HM", "HN", "HR", "HT", "HU",
  "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT",
  "JE", "JM", "JO", "JP",
  "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW", "KY", "KZ",
  "LA", "LB", "LC", "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY",
  "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK", "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ",
  "NA", "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ",
  "OM",
  "PA", "PE", "PF", "PG", "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PW", "PY",
  "QA",
  "RE", "RO", "RS", "RU", "RW",
  "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS", "ST", "SV", "SX", "SY", "SZ",
  "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO", "TR", "TT", "TV", "TW", "TZ",
  "UA", "UG", "UM", "US", "UY", "UZ",
  "VA", "VC", "VE", "VG", "VI", "VN", "VU",
  "WF", "WS",
  "YE", "YT",
  "ZA", "ZM", "ZW",
] as const;

export type Iso3166Alpha2CountryCode = typeof ISO_3166_ALPHA_2_COUNTRY_CODES[number];

export const validCountryCodeSet = new Set<string>(ISO_3166_ALPHA_2_COUNTRY_CODES);

export function normalizeCountryCode(countryCode: string): string {
  return countryCode.trim().toUpperCase();
}

export function isValidCountryCode(countryCode: string): boolean {
  return validCountryCodeSet.has(normalizeCountryCode(countryCode));
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
    : "Country code must be a valid ISO 3166-1 alpha-2 code";
}

import.meta.vitest?.test("country codes", ({ expect }) => {
  expect(ISO_3166_ALPHA_2_COUNTRY_CODES).toHaveLength(249);
  expect(normalizeCountryCode(" us ")).toBe("US");
  expect(isValidCountryCode("us")).toBe(true);
  expect(isValidCountryCode("zz")).toBe(false);
  expect(isValidCountryCode("usa")).toBe(false);

  expect(validateCountryCode("US")).toBeNull();
  expect(validateCountryCode("zz")).toBe("Country code must be a valid ISO 3166-1 alpha-2 code");
  expect(validateCountryCode(["US", "CA"])).toBeNull();
  expect(validateCountryCode([])).toBe("At least one country code is required");
  expect(validateCountryCode(["US", "ZZ"])).toBe("Country code must be a valid ISO 3166-1 alpha-2 code");
});
