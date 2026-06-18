export const REFUND_TXN_PREFIX = "refund:";

export function parseRefundTxnId(txnId: string): { sourceTxnId: string, uuid: string } | null {
  if (!txnId.startsWith(REFUND_TXN_PREFIX)) return null;
  const rest = txnId.slice(REFUND_TXN_PREFIX.length);
  const lastColon = rest.lastIndexOf(":");
  if (lastColon < 0) return null;
  const sourceTxnId = rest.slice(0, lastColon);
  const uuid = rest.slice(lastColon + 1);
  if (sourceTxnId.length === 0 || uuid.length === 0) return null;
  return { sourceTxnId, uuid };
}
