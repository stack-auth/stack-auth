import { describe, expect, it } from 'vitest';
import { createEmptyCondition, parseCelToVisualTree, visualTreeToCel } from './cel-visual-parser';

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

    it('should serialize numeric risk score comparisons', () => {
      const greaterThan = visualTreeToCel({
        ...createEmptyCondition(),
        field: 'riskScores.bot' as const,
        operator: 'greater_than' as const,
        value: 80,
      });
      const lessOrEqual = visualTreeToCel({
        ...createEmptyCondition(),
        field: 'riskScores.free_trial_abuse' as const,
        operator: 'less_or_equal' as const,
        value: 40,
      });

      expect(greaterThan).toBe('riskScores.bot > 80');
      expect(lessOrEqual).toBe('riskScores.free_trial_abuse <= 40');
    });

    it('should normalize country code values to uppercase', () => {
      expect(visualTreeToCel({
        ...createEmptyCondition(),
        field: 'countryCode' as const,
        operator: 'equals' as const,
        value: 'us',
      })).toBe('countryCode == "US"');

      expect(visualTreeToCel({
        ...createEmptyCondition(),
        field: 'countryCode' as const,
        operator: 'in_list' as const,
        value: ['us', 'ca'],
      })).toBe('countryCode in ["US", "CA"]');
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

    it('should parse escaped quotes in string values', () => {
      const result = parseCelToVisualTree('email.contains("test\\"value")');
      expect(result).toBeDefined();
      if (result?.type === 'condition') {
        expect(result.operator).toBe('contains');
        expect(result.value).toBe('test"value');
      }
    });

    it('should parse escaped backslashes in string values', () => {
      const result = parseCelToVisualTree('email.contains("test\\\\value")');
      expect(result).toBeDefined();
      if (result?.type === 'condition') {
        expect(result.operator).toBe('contains');
        expect(result.value).toBe('test\\value');
      }
    });

    it('should parse numeric risk score comparisons', () => {
      const result = parseCelToVisualTree('riskScores.bot >= 75');
      expect(result).toBeDefined();
      if (result?.type === 'condition') {
        expect(result.field).toBe('riskScores.bot');
        expect(result.operator).toBe('greater_or_equal');
        expect(result.value).toBe(75);
      }
    });

    it('should parse country code equality condition', () => {
      const result = parseCelToVisualTree('countryCode == "US"');
      expect(result).toBeDefined();
      if (result?.type === 'condition') {
        expect(result.field).toBe('countryCode');
        expect(result.operator).toBe('equals');
        expect(result.value).toBe('US');
      }
    });

    it('should parse country code in_list condition', () => {
      const result = parseCelToVisualTree('countryCode in ["US", "CA"]');
      expect(result).toBeDefined();
      if (result?.type === 'condition') {
        expect(result.field).toBe('countryCode');
        expect(result.operator).toBe('in_list');
        expect(result.value).toEqual(['US', 'CA']);
      }
    });
  });

});
