import { signUpAuthMethodValues } from "./auth-methods";
import { standardProviders } from "./oauth";

// ── Types ──────────────────────────────────────────────────────────────

export type ConditionField =
  | 'email'
  | 'countryCode'
  | 'emailDomain'
  | 'authMethod'
  | 'oauthProvider'
  | 'riskScores.bot'
  | 'riskScores.free_trial_abuse';

export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'greater_than'
  | 'greater_or_equal'
  | 'less_than'
  | 'less_or_equal'
  | 'matches'
  | 'ends_with'
  | 'starts_with'
  | 'contains'
  | 'in_list';

// ── Helpers ────────────────────────────────────────────────────────────

export function isNumericField(field: ConditionField): boolean {
  return field === 'riskScores.bot' || field === 'riskScores.free_trial_abuse';
}

/**
 * Validates a numeric field value is a finite integer within [0, 100].
 * Returns null if valid, or an error message string if invalid.
 */
export function validateNumericFieldValue(field: string, value: string | number): string | null {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) {
    return `Expected a finite number for field "${field}", got "${String(value)}"`;
  }
  if (!Number.isInteger(num)) {
    return `Expected an integer for field "${field}", got "${String(value)}"`;
  }
  if (num < 0 || num > 100) {
    return `Value for field "${field}" must be between 0 and 100, got ${num}`;
  }
  return null;
}

export function escapeCelString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function unescapeCelString(value: string): string {
  return value.replace(/\\\\/g, '\\').replace(/\\"/g, '"');
}

// ── Field metadata ─────────────────────────────────────────────────────

const numericOperators: ConditionOperator[] = ['equals', 'not_equals', 'greater_than', 'greater_or_equal', 'less_than', 'less_or_equal'];
const enumOperators: ConditionOperator[] = ['equals', 'not_equals', 'in_list'];
const stringOperators: ConditionOperator[] = ['equals', 'not_equals', 'contains', 'starts_with', 'ends_with', 'matches', 'in_list'];

export type FieldMetadataEntry = {
  label: string,
  operators: ConditionOperator[],
  predefinedValues?: string[],
};

export const fieldMetadata: Record<ConditionField, FieldMetadataEntry> = {
  email: { label: 'Email', operators: stringOperators },
  countryCode: { label: 'Country Code', operators: enumOperators },
  emailDomain: { label: 'Email Domain', operators: stringOperators },
  authMethod: { label: 'Auth Method', operators: enumOperators, predefinedValues: [...signUpAuthMethodValues] },
  oauthProvider: { label: 'OAuth Provider', operators: enumOperators, predefinedValues: [...standardProviders] },
  'riskScores.bot': { label: 'Risk Score: Bot', operators: numericOperators },
  'riskScores.free_trial_abuse': { label: 'Risk Score: Free Trial Abuse', operators: numericOperators },
};

export const conditionFields = Object.keys(fieldMetadata) as ConditionField[];

export const conditionOperators: ConditionOperator[] = [
  'equals', 'not_equals', 'greater_than', 'greater_or_equal',
  'less_than', 'less_or_equal', 'matches', 'ends_with',
  'starts_with', 'contains', 'in_list',
];

export function getOperatorsForField(field: ConditionField): ConditionOperator[] {
  return fieldMetadata[field].operators;
}
