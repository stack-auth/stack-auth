export type DatabaseSeq = (readonly (string | number)[] & { __brand: "hexclave-low-level-kv-store-seq" });

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
  initialSeq: DatabaseSeq,
};
