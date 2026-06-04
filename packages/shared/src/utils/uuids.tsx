import { generateRandomValues } from "./crypto";

export function generateUuid() {
  // crypto.randomUuid is not supported in all browsers, so this is a polyfill
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c =>
    (+c ^ generateRandomValues(new Uint8Array(1))[0] & 15 >> +c / 4).toString(16)
  );
}
import.meta.vitest?.test("generateUuid", ({ expect }) => {
  // Test that the function returns a valid UUID
  const uuid = generateUuid();
  expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

  // Test that multiple calls generate different UUIDs
  const uuid2 = generateUuid();
  expect(uuid).not.toBe(uuid2);

  // Test that the UUID is version 4 (random)
  expect(uuid.charAt(14)).toBe('4');

  // Test that the UUID has the correct variant (8, 9, a, or b in position 19)
  expect('89ab').toContain(uuid.charAt(19));
});

export function isUuid(str: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(str);
}
import.meta.vitest?.test("isUuid", ({ expect }) => {
  // Test with valid UUIDs
  expect(isUuid("123e4567-e89b-42d3-a456-426614174000")).toBe(true);
  expect(isUuid("123e4567-e89b-42d3-8456-426614174000")).toBe(true);
  expect(isUuid("123e4567-e89b-42d3-9456-426614174000")).toBe(true);
  expect(isUuid("123e4567-e89b-42d3-a456-426614174000")).toBe(true);
  expect(isUuid("123e4567-e89b-42d3-b456-426614174000")).toBe(true);

  // Test with invalid UUIDs
  expect(isUuid("")).toBe(false);
  expect(isUuid("not-a-uuid")).toBe(false);
  expect(isUuid("123e4567-e89b-12d3-a456-426614174000")).toBe(false); // Wrong version (not 4)
  expect(isUuid("123e4567-e89b-42d3-c456-426614174000")).toBe(false); // Wrong variant (not 8, 9, a, or b)
  expect(isUuid("123e4567-e89b-42d3-a456-42661417400")).toBe(false); // Too short
  expect(isUuid("123e4567-e89b-42d3-a456-4266141740000")).toBe(false); // Too long
  expect(isUuid("123e4567-e89b-42d3-a456_426614174000")).toBe(false); // Wrong format (underscore instead of dash)

  // Test with uppercase letters (should fail as UUID should be lowercase)
  expect(isUuid("123E4567-E89B-42D3-A456-426614174000")).toBe(false);
});
