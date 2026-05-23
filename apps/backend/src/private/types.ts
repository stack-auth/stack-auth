export type SmtpEgressPolicyViolation = {
  reason: "disallowed-port" | "internal-ip-literal" | "internal-resolved-address" | "no-dns-addresses" | "dns-lookup-failed",
  host: string,
  port: number,
  addresses?: string[],
  cause?: unknown,
};

export type SmtpEgressPolicyResult =
  | { status: "ok", addresses: string[] }
  | { status: "error", violation: SmtpEgressPolicyViolation };
