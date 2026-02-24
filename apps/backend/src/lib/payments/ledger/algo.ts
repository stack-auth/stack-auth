export type LedgerTransaction = {
  amount: number,
  grantTime: Date,
  expirationTime: Date,
};

export function computeLedgerBalanceAtNow(transactions: LedgerTransaction[], now: Date): number {
  const grantedAt = new Map<number, number>();
  const expiredAt = new Map<number, number>();
  const usedAt = new Map<number, number>();
  const timeSet = new Set<number>();

  for (const t of transactions) {
    const grantTime = t.grantTime.getTime();
    if (t.grantTime <= now && t.amount < 0 && t.expirationTime > now) {
      usedAt.set(grantTime, (-1 * t.amount) + (usedAt.get(grantTime) ?? 0));
    }
    if (t.grantTime <= now && t.amount > 0) {
      grantedAt.set(grantTime, (grantedAt.get(grantTime) ?? 0) + t.amount);
    }
    if (t.expirationTime <= now && t.amount > 0) {
      const time2 = t.expirationTime.getTime();
      expiredAt.set(time2, (expiredAt.get(time2) ?? 0) + t.amount);
      timeSet.add(time2);
    }
    timeSet.add(grantTime);
  }
  const times = Array.from(timeSet.values()).sort((a, b) => a - b);
  if (times.length === 0) {
    return 0;
  }

  let grantedSum = 0;
  let expiredSum = 0;
  let usedSum = 0;
  let usedOrExpiredSum = 0;
  for (const t of times) {
    const g = grantedAt.get(t) ?? 0;
    const e = expiredAt.get(t) ?? 0;
    const u = usedAt.get(t) ?? 0;
    grantedSum += g;
    expiredSum += e;
    usedSum += u;
    usedOrExpiredSum = Math.max(usedOrExpiredSum + u, expiredSum);
  }
  return grantedSum - usedOrExpiredSum;
}
