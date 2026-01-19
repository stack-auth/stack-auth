import { describe, expect, it } from 'vitest';
import { shouldAllowInsecureRequest } from './http-security';

describe('shouldAllowInsecureRequest', () => {
  describe('localhost HTTP (always allowed)', () => {
    it('should allow http://localhost', () => {
      expect(shouldAllowInsecureRequest('http://localhost')).toBe(true);
    });

    it('should allow http://localhost with port', () => {
      expect(shouldAllowInsecureRequest('http://localhost:8080')).toBe(true);
    });

    it('should allow http://localhost with path', () => {
      expect(shouldAllowInsecureRequest('http://localhost/api/token')).toBe(true);
    });

    it('should allow http://localhost with port and path', () => {
      expect(shouldAllowInsecureRequest('http://localhost:8080/api/token')).toBe(true);
    });

    it('should allow http://127.0.0.1', () => {
      expect(shouldAllowInsecureRequest('http://127.0.0.1')).toBe(true);
    });

    it('should allow http://127.0.0.1 with port', () => {
      expect(shouldAllowInsecureRequest('http://127.0.0.1:8080')).toBe(true);
    });
  });

  describe('localhost HTTPS (allowed, no insecure flag needed)', () => {
    it('should not need insecure flag for https://localhost', () => {
      expect(shouldAllowInsecureRequest('https://localhost')).toBe(false);
    });

    it('should not need insecure flag for https://127.0.0.1', () => {
      expect(shouldAllowInsecureRequest('https://127.0.0.1:8080')).toBe(false);
    });
  });

  describe('non-localhost HTTP (blocked by default)', () => {
    it('should block http://example.com by default', () => {
      expect(shouldAllowInsecureRequest('http://example.com')).toBe(false);
    });

    it('should block http://test.internal:8080 by default', () => {
      expect(shouldAllowInsecureRequest('http://test.internal:8080')).toBe(false);
    });

    it('should block http://192.168.1.1 by default (not 127.0.0.1)', () => {
      expect(shouldAllowInsecureRequest('http://192.168.1.1')).toBe(false);
    });
  });

  describe('non-localhost HTTP with dangerouslyAllowInsecureHttp', () => {
    it('should allow http://example.com when opted in', () => {
      expect(shouldAllowInsecureRequest('http://example.com', true)).toBe(true);
    });

    it('should allow http://test.internal:8080 when opted in', () => {
      expect(shouldAllowInsecureRequest('http://test.internal:8080', true)).toBe(true);
    });

    it('should allow http://192.168.1.1 when opted in', () => {
      expect(shouldAllowInsecureRequest('http://192.168.1.1:8080/api', true)).toBe(true);
    });
  });

  describe('HTTPS (never needs insecure flag)', () => {
    it('should not need insecure flag for https://example.com', () => {
      expect(shouldAllowInsecureRequest('https://example.com')).toBe(false);
    });

    it('should not need insecure flag for https://example.com even with opt-in', () => {
      expect(shouldAllowInsecureRequest('https://example.com', true)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should not match localhost in subdomain (http://localhost.evil.com)', () => {
      expect(shouldAllowInsecureRequest('http://localhost.evil.com')).toBe(false);
    });

    it('should not match 127.0.0.1 prefix (http://127.0.0.100)', () => {
      expect(shouldAllowInsecureRequest('http://127.0.0.100')).toBe(false);
    });

    it('should handle undefined dangerouslyAllowInsecureHttp', () => {
      expect(shouldAllowInsecureRequest('http://example.com', undefined)).toBe(false);
    });

    it('should handle false dangerouslyAllowInsecureHttp', () => {
      expect(shouldAllowInsecureRequest('http://example.com', false)).toBe(false);
    });
  });
});
