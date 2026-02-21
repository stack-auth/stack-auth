import { describe, expect, it } from 'vitest';
import { computeLedgerBalanceAtNow, type LedgerTransaction } from './algo';

function tx(amount: number, grantTime: string, expirationTime: string = '9999-01-01'): LedgerTransaction {
  return { amount, grantTime: new Date(grantTime), expirationTime: new Date(expirationTime) };
}

describe('computeLedgerBalanceAtNow', () => {
  it('returns 0 for empty transactions', () => {
    expect(computeLedgerBalanceAtNow([], new Date())).toBe(0);
  });

  it('sums a single positive grant', () => {
    expect(computeLedgerBalanceAtNow([tx(10, '2025-01-01')], new Date('2025-02-01'))).toBe(10);
  });

  it('sums multiple positive grants', () => {
    expect(computeLedgerBalanceAtNow([
      tx(5, '2025-01-01'),
      tx(3, '2025-01-02'),
    ], new Date('2025-02-01'))).toBe(8);
  });

  it('ignores future grants (grantTime > now)', () => {
    expect(computeLedgerBalanceAtNow([
      tx(10, '2025-03-01'),
    ], new Date('2025-02-01'))).toBe(0);
  });

  it('subtracts negative amounts (usage)', () => {
    expect(computeLedgerBalanceAtNow([
      tx(10, '2025-01-01'),
      tx(-3, '2025-01-02'),
    ], new Date('2025-02-01'))).toBe(7);
  });

  it('handles expiration: expired positive grants reduce balance', () => {
    expect(computeLedgerBalanceAtNow([
      tx(10, '2025-01-01', '2025-01-15'),
    ], new Date('2025-02-01'))).toBe(0);
  });

  it('non-expired positive grant keeps its value', () => {
    expect(computeLedgerBalanceAtNow([
      tx(10, '2025-01-01', '2025-03-01'),
    ], new Date('2025-02-01'))).toBe(10);
  });

  it('expired grant absorbs negatives', () => {
    const result = computeLedgerBalanceAtNow([
      tx(10, '2025-01-01', '2025-01-15'),
      tx(5, '2025-01-02'),
      tx(-3, '2025-01-03'),
    ], new Date('2025-02-01'));
    expect(result).toBe(5);
  });

  it('multiple expired and active grants with negatives', () => {
    const result = computeLedgerBalanceAtNow([
      tx(10, '2025-01-01', '2025-01-31'),
      tx(11, '2025-01-02'),
      tx(-3, '2025-01-03'),
      tx(-2, '2025-01-04', '2025-01-05'),
    ], new Date('2025-02-01'));
    expect(result).toBe(11);
  });

  it('negative at exact grant time', () => {
    expect(computeLedgerBalanceAtNow([
      tx(10, '2025-01-01'),
      tx(-10, '2025-01-01'),
    ], new Date('2025-02-01'))).toBe(0);
  });

  it('grant at exact now boundary is included', () => {
    expect(computeLedgerBalanceAtNow([
      tx(5, '2025-02-01'),
    ], new Date('2025-02-01'))).toBe(5);
  });

  it('expiration at exact now boundary means expired', () => {
    expect(computeLedgerBalanceAtNow([
      tx(5, '2025-01-01', '2025-02-01'),
    ], new Date('2025-02-01'))).toBe(0);
  });

  it('handles many transactions at the same timestamp', () => {
    expect(computeLedgerBalanceAtNow([
      tx(1, '2025-01-01'),
      tx(2, '2025-01-01'),
      tx(3, '2025-01-01'),
      tx(-1, '2025-01-01'),
    ], new Date('2025-02-01'))).toBe(5);
  });

  it('all negative amounts with no positive: balance goes negative', () => {
    expect(computeLedgerBalanceAtNow([
      tx(-5, '2025-01-01'),
      tx(-3, '2025-01-02'),
    ], new Date('2025-02-01'))).toBe(-8);
  });

  it('expired negative is ignored', () => {
    expect(computeLedgerBalanceAtNow([
      tx(10, '2025-01-01'),
      tx(-3, '2025-01-02', '2025-01-03'),
    ], new Date('2025-02-01'))).toBe(10);
  });
});
