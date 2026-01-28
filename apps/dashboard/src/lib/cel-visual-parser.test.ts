import { describe, it, expect } from 'vitest';
import { visualTreeToCel, parseCelToVisualTree, createEmptyCondition } from './cel-visual-parser';

describe('cel-visual-parser', () => {
  describe('CEL string escaping', () => {
    it('should escape double quotes in condition values', () => {
      const condition = {
        ...createEmptyCondition(),
        field: 'email' as const,
        operator: 'contains' as const,
        value: 'test"value',
      };

      const cel = visualTreeToCel(condition);
      // Should escape the quote
      expect(cel).toBe('email.contains("test\\"value")');
      // Should NOT contain unescaped quote that would break CEL
      expect(cel).not.toMatch(/contains\("test"value"\)/);
    });

    it('should escape backslashes in condition values', () => {
      const condition = {
        ...createEmptyCondition(),
        field: 'email' as const,
        operator: 'contains' as const,
        value: 'test\\value',
      };

      const cel = visualTreeToCel(condition);
      // Should escape the backslash
      expect(cel).toBe('email.contains("test\\\\value")');
    });

    it('should escape both quotes and backslashes together', () => {
      const condition = {
        ...createEmptyCondition(),
        field: 'email' as const,
        operator: 'equals' as const,
        value: 'test\\"value',
      };

      const cel = visualTreeToCel(condition);
      // Backslash escaped first, then quote
      expect(cel).toBe('email == "test\\\\\\"value"');
    });

    it('should prevent CEL injection via malicious value', () => {
      // Attacker tries: test" || true || "
      // Without escaping this becomes: email == "test" || true || ""
      // Which would always be true due to || true
      const condition = {
        ...createEmptyCondition(),
        field: 'email' as const,
        operator: 'equals' as const,
        value: 'test" || true || "',
      };

      const cel = visualTreeToCel(condition);
      // Should escape quotes, preventing injection
      expect(cel).toBe('email == "test\\" || true || \\""');
      // Should NOT allow the injection pattern
      expect(cel).not.toContain('" || true || "');
    });

    it('should escape values in all operator types', () => {
      const maliciousValue = 'inject"attack';

      // Test equals
      expect(visualTreeToCel({
        ...createEmptyCondition(),
        field: 'email' as const,
        operator: 'equals' as const,
        value: maliciousValue,
      })).toContain('\\"');

      // Test not_equals
      expect(visualTreeToCel({
        ...createEmptyCondition(),
        field: 'email' as const,
        operator: 'not_equals' as const,
        value: maliciousValue,
      })).toContain('\\"');

      // Test matches
      expect(visualTreeToCel({
        ...createEmptyCondition(),
        field: 'email' as const,
        operator: 'matches' as const,
        value: maliciousValue,
      })).toContain('\\"');

      // Test ends_with
      expect(visualTreeToCel({
        ...createEmptyCondition(),
        field: 'email' as const,
        operator: 'ends_with' as const,
        value: maliciousValue,
      })).toContain('\\"');

      // Test starts_with
      expect(visualTreeToCel({
        ...createEmptyCondition(),
        field: 'email' as const,
        operator: 'starts_with' as const,
        value: maliciousValue,
      })).toContain('\\"');

      // Test contains
      expect(visualTreeToCel({
        ...createEmptyCondition(),
        field: 'email' as const,
        operator: 'contains' as const,
        value: maliciousValue,
      })).toContain('\\"');
    });

    it('should escape values in in_list operator', () => {
      const condition = {
        ...createEmptyCondition(),
        field: 'emailDomain' as const,
        operator: 'in_list' as const,
        value: ['safe.com', 'inject"attack.com', 'also\\bad.com'],
      };

      const cel = visualTreeToCel(condition);
      expect(cel).toContain('inject\\"attack.com');
      expect(cel).toContain('also\\\\bad.com');
    });
  });

  describe('CEL to visual tree parsing', () => {
    it('should parse simple equality condition', () => {
      const result = parseCelToVisualTree('email == "test@example.com"');
      expect(result).toBeDefined();
      if (result?.type === 'condition') {
        expect(result.field).toBe('email');
        expect(result.operator).toBe('equals');
        expect(result.value).toBe('test@example.com');
      }
    });

    it('should parse endsWith condition', () => {
      const result = parseCelToVisualTree('email.endsWith("@gmail.com")');
      expect(result).toBeDefined();
      if (result?.type === 'condition') {
        expect(result.field).toBe('email');
        expect(result.operator).toBe('ends_with');
        expect(result.value).toBe('@gmail.com');
      }
    });
  });
});
