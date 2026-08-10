export type DatabaseSeq = readonly (string | number)[];

export function serializeDatabaseSeq(seq: DatabaseSeq): string {
  return JSON.stringify(seq);
}

export function deserializeDatabaseSeq(value: string): DatabaseSeq {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Invalid database sequence");
  }
  if (!Array.isArray(parsed) || !parsed.every(item => typeof item === "string" || typeof item === "number")) {
    throw new Error("Invalid database sequence");
  }
  return parsed;
}

export type Database = {
  getDebugInfo(): any,
  /**
   * Returns a promise that resolves once it is guaranteed that queries made from this database client will see the
   * given seq.
   *
   * This does NOT guarantee that the seq is durable or replicated; a different connection to the database may still see
   * a lower seq, and a crash or infrastructure failure may cause the seq to be lost.
   */
  waitUntilAvailable(seq: DatabaseSeq): Promise<void>,
  /**
   * Returns a promise that resolves once it is guaranteed that in case of a crash, the given seq will be durable and
   * eventually restored.
   *
   * This does NOT guarantee that the seq is available or replicated; it may still not be visible to this or to other
   * clients.
   */
  waitUntilDurable(seq: DatabaseSeq): Promise<void>,
  /**
   * Returns a promise that resolves once it is guaranteed that the given seq is available to all read replicas AND
   * durable.
   *
   * Implicitly implies both `waitUntilAvailable` and `waitUntilDurable`. This is the strongest guarantee that can be
   * achieved, but incurs significantly higher latency.
   */
  waitUntilReplicated(seq: DatabaseSeq): Promise<void>,
  combineSeqs(...seqs: DatabaseSeq[]): DatabaseSeq,
  /**
   * Drains pending writes and releases resources. Calls are idempotent.
   */
  close(): Promise<void>,
  initialSeq: DatabaseSeq,
};
