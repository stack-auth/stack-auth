import { describe, expect, it } from 'vitest';
import { parseAndValidateConfig } from './route';

describe('parseAndValidateConfig', () => {
  it('should parse a single entry with probability 1', () => {
    const result = parseAndValidateConfig({
      "1": ["https://api.stack-auth.com"],
    });
    expect(result).toEqual([
      { probability: 1, urls: ["https://api.stack-auth.com"] },
    ]);
  });

  it('should parse multiple entries', () => {
    const result = parseAndValidateConfig({
      "0.7": ["https://api.stack-auth.com", "https://api2.stack-auth.com"],
      "0.3": ["https://api2.stack-auth.com", "https://api.stack-auth.com"],
    });
    expect(result).toEqual([
      { probability: 0.7, urls: ["https://api.stack-auth.com", "https://api2.stack-auth.com"] },
      { probability: 0.3, urls: ["https://api2.stack-auth.com", "https://api.stack-auth.com"] },
    ]);
  });

  it('should allow probabilities summing to less than 1', () => {
    const result = parseAndValidateConfig({
      "0.5": ["https://api.stack-auth.com"],
      "0.3": ["https://api2.stack-auth.com"],
    });
    expect(result).toHaveLength(2);
  });

  it('should reject non-object input', () => {
    expect(() => parseAndValidateConfig("string")).toThrow("must be a JSON object");
    expect(() => parseAndValidateConfig(null)).toThrow("must be a JSON object");
    expect(() => parseAndValidateConfig([])).toThrow("must be a JSON object");
    expect(() => parseAndValidateConfig(42)).toThrow("must be a JSON object");
  });

  it('should reject empty object', () => {
    expect(() => parseAndValidateConfig({})).toThrow("at least one entry");
  });

  it('should reject invalid probability keys', () => {
    expect(() => parseAndValidateConfig({ "abc": ["https://a.com"] })).toThrow("must be a number between 0 and 1");
    expect(() => parseAndValidateConfig({ "-0.1": ["https://a.com"] })).toThrow("must be a number between 0 and 1");
    expect(() => parseAndValidateConfig({ "1.5": ["https://a.com"] })).toThrow("must be a number between 0 and 1");
  });

  it('should reject probabilities summing to more than 1', () => {
    expect(() => parseAndValidateConfig({
      "0.6": ["https://api.stack-auth.com"],
      "0.5": ["https://api2.stack-auth.com"],
    })).toThrow("exceeds 1");
  });

  it('should reject invalid URL values', () => {
    expect(() => parseAndValidateConfig({ "1": ["not-a-url"] })).toThrow();
  });

  it('should reject empty URL arrays', () => {
    expect(() => parseAndValidateConfig({ "1": [] })).toThrow();
  });

  it('should reject non-array values', () => {
    expect(() => parseAndValidateConfig({ "1": "https://api.stack-auth.com" })).toThrow();
  });
});
