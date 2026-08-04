import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";

const passkeyRpIdSentinel = "THIS_VALUE_WILL_BE_REPLACED.example.com";

export function scopePasskeyRegistrationToHostname(
  options: { rp: { id?: string } },
  hostname: string,
): void {
  if (options.rp.id !== passkeyRpIdSentinel) {
    throw new HexclaveAssertionError(`Expected returned RP ID from server to equal sentinel, but found ${options.rp.id}`);
  }
  options.rp.id = hostname;
}

export function scopePasskeyAuthenticationToHostname(
  options: { rpId?: string },
  hostname: string,
): void {
  if (options.rpId !== passkeyRpIdSentinel) {
    throw new HexclaveAssertionError(`Expected returned RP ID from server to equal sentinel, but found ${options.rpId}`);
  }
  options.rpId = hostname;
}
