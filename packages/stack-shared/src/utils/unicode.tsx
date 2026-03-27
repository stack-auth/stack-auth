import { isValidCountryCode, normalizeCountryCode } from "./country-codes";
import { StackAssertionError } from "./errors";

export function getFlagEmoji(twoLetterCountryCode: string) {
  if (!isValidCountryCode(twoLetterCountryCode)) throw new StackAssertionError("Country code must be two alphabetical letters");
  const codePoints = normalizeCountryCode(twoLetterCountryCode)
    .split('')
    .map(char => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}
import.meta.vitest?.test("getFlagEmoji", ({ expect }) => {
  // Test with valid country codes
  expect(getFlagEmoji("US")).toBe("🇺🇸");
  expect(getFlagEmoji("us")).toBe("🇺🇸");
  expect(getFlagEmoji("GB")).toBe("🇬🇧");
  expect(getFlagEmoji("JP")).toBe("🇯🇵");

  // Test with invalid country codes
  expect(() => getFlagEmoji("")).toThrow("Country code must be two alphabetical letters");
  expect(() => getFlagEmoji("A")).toThrow("Country code must be two alphabetical letters");
  expect(() => getFlagEmoji("ABC")).toThrow("Country code must be two alphabetical letters");
  expect(() => getFlagEmoji("12")).toThrow("Country code must be two alphabetical letters");
  expect(() => getFlagEmoji("A1")).toThrow("Country code must be two alphabetical letters");
});
