import { describe, expect, it } from 'vitest';
import { getDefaultEntriesForRequest, parseAndValidateConfig } from './route';

function reqForHost(host: string, forwardedHost?: string) {
  return {
    headers: {
      host: [host],
      ...(forwardedHost ? { "x-forwarded-host": [forwardedHost] } : {}),
    },
  };
}

describe('parseAndValidateConfig', () => {
  it('should parse a single entry with probability 1', () => {
    const result = parseAndValidateConfig({
      "1": ["https://api.hexclave.com"],
    });
    expect(result).toEqual([
      { probability: 1, urls: ["https://api.hexclave.com"] },
    ]);
  });

  it('should parse multiple entries', () => {
    const result = parseAndValidateConfig({
      "0.7": ["https://api.hexclave.com", "https://api2.hexclave.com"],
      "0.3": ["https://api2.hexclave.com", "https://api.hexclave.com"],
    });
    expect(result).toEqual([
      { probability: 0.7, urls: ["https://api.hexclave.com", "https://api2.hexclave.com"] },
      { probability: 0.3, urls: ["https://api2.hexclave.com", "https://api.hexclave.com"] },
    ]);
  });

  it('should allow probabilities summing to less than 1', () => {
    const result = parseAndValidateConfig({
      "0.5": ["https://api.hexclave.com"],
      "0.3": ["https://api2.hexclave.com"],
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
      "0.6": ["https://api.hexclave.com"],
      "0.5": ["https://api2.hexclave.com"],
    })).toThrow("exceeds 1");
  });

  it('should reject invalid URL values', () => {
    expect(() => parseAndValidateConfig({ "1": ["not-a-url"] })).toThrow();
  });

  it('should reject empty URL arrays', () => {
    expect(() => parseAndValidateConfig({ "1": [] })).toThrow();
  });

  it('should reject non-array values', () => {
    expect(() => parseAndValidateConfig({ "1": "https://api.hexclave.com" })).toThrow();
  });
});

describe('getDefaultEntriesForRequest', () => {
  it('keeps legacy Stack Auth requests on Stack Auth API fallbacks', () => {
    expect(getDefaultEntriesForRequest(reqForHost("api.stack-auth.com"))).toEqual([
      {
        probability: 1,
        urls: [
          "https://api.stack-auth.com",
          "https://api1.stack-auth.com",
          "https://api2.stack-auth.com",
        ],
      },
    ]);
  });

  it('keeps Hexclave requests on Hexclave API fallbacks', () => {
    expect(getDefaultEntriesForRequest(reqForHost("api.hexclave.com"))).toEqual([
      {
        probability: 1,
        urls: [
          "https://api.hexclave.com",
          "https://api1.hexclave.com",
          "https://api2.hexclave.com",
        ],
      },
    ]);
  });

  it('maps fallback hosts back to the same brand canonical API host', () => {
    expect(getDefaultEntriesForRequest(reqForHost("api2.stack-auth.com"))[0].urls[0]).toBe("https://api.stack-auth.com");
    expect(getDefaultEntriesForRequest(reqForHost("api2.hexclave.com"))[0].urls[0]).toBe("https://api.hexclave.com");
  });

  it('prefers x-forwarded-host over host when selecting the brand', () => {
    expect(getDefaultEntriesForRequest(reqForHost("api.stack-auth.com", "api.hexclave.com"))[0].urls).toEqual([
      "https://api.hexclave.com",
      "https://api1.hexclave.com",
      "https://api2.hexclave.com",
    ]);
  });
});
