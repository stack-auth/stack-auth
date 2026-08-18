/**
 * Replaces the parts of an error message that vary per occurrence with stable
 * placeholders, so that a message-derived hash groups the *shape* of a message
 * rather than one instance of it.
 *
 * This is what stops `User 4f1c…-… not found` from opening a new issue on every
 * request, and it is used in exactly two places: the message grouping variant
 * (fired when no frame contributed anything hashable) and the synthetic rule.
 *
 * Two properties this file must keep:
 *  - **Deterministic.** It participates in `ownerHash`. Changing any pattern
 *    re-groups every message-variant issue, so it may only change together with
 *    a new grouping config id.
 *  - **Bounded.** The input comes off the public ingest endpoint. One compiled
 *    alternation, one pass, a hard input cap.
 */

import { truncateUtf8Bytes } from "@hexclave/shared/dist/utils/analytics-wire";

/**
 * 8 KB, measured in UTF-8 BYTES — the same unit and limit the durable `message`
 * column uses (`TELEMETRY_MAX_LOG_MESSAGE_BYTES`, and the SDK's
 * `ERROR_TEXT_MAX_BYTES`). Bounding in bytes rather than UTF-16 code units
 * keeps the hash input consistent with the stored representation: two messages
 * whose stored (truncated) forms are identical must not group differently based
 * on content that was truncated away before persistence. It doubles as the
 * floor under the regex cost for anything that reaches us by another route.
 */
const MAX_MESSAGE_BYTES = 8 * 1024;

/**
 * One alternation, evaluated left to right, so ORDER IS THE SPEC:
 *  - `url` first, so an id inside a URL never gets replaced twice and the whole
 *    URL collapses to one token.
 *  - `email` before the generic patterns, since the local part is often numeric.
 *  - `uuid` before `hex`, or a uuid would shred into `<hex>-<int>-<int>-…`.
 *  - `date` before `int`, or `2026-08-01` becomes `<int>-<int>-<int>`.
 *  - `ip` before `float`/`int` for the same reason.
 *  - `hex` before `int`, so a long decimal-looking hex run stays one token.
 *  - `float` before `int`, or `1.5` becomes `<int>.<int>`.
 *
 * Every branch is a named group; the replacer picks the placeholder off whichever
 * name is defined, which keeps the mapping from pattern to placeholder in one
 * place instead of a positional index.
 */
const PARAMETERIZE_RE = new RegExp(
  [
    String.raw`(?<url>\b[a-z][a-z0-9+.\-]*:\/\/[^\s"'<>()\[\]]+)`,
    String.raw`(?<email>[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})`,
    String.raw`(?<uuid>\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b)`,
    String.raw`(?<date>\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+\-]\d{2}:?\d{2})?)?)`,
    // Three colon groups minimum, not two: `12:00:00` is a clock, not an
    // address, and would otherwise parameterize as `<ip>`. Compressed forms
    // (`::1`) are deliberately not matched — they are rare in messages and the
    // pattern needed to catch them safely is not worth the false positives.
    String.raw`(?<ipv6>\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b)`,
    String.raw`(?<ipv4>\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b)`,
    // `0x…` at any length, bare hex only from 8 digits up (shorter runs are
    // words far more often than they are ids).
    String.raw`(?<hex>\b(?:0x[0-9a-f]+|[0-9a-f]{8,})\b)`,
    // No trailing `\b` on the numeric branches: a unit suffix must not stop the
    // number from being replaced, or `took 30s` and `took 45s` become two
    // different issues. The LEADING `\b` still protects identifiers — in
    // `utf8` / `abc1` there is no boundary before the digits, so they survive.
    String.raw`(?<float>\b\d+\.\d+)`,
    String.raw`(?<int>\b\d+)`,
  ].join("|"),
  "gi",
);

const PLACEHOLDERS: ReadonlyMap<string, string> = new Map([
  ["url", "<url>"],
  ["email", "<email>"],
  ["uuid", "<uuid>"],
  ["date", "<date>"],
  ["ipv6", "<ip>"],
  ["ipv4", "<ip>"],
  ["hex", "<hex>"],
  ["float", "<float>"],
  ["int", "<int>"],
]);

export function parameterizeMessage(message: string): string {
  const bounded = truncateUtf8Bytes(message, MAX_MESSAGE_BYTES);
  return bounded.replace(PARAMETERIZE_RE, (match, ...args) => {
    // The named-groups object is the last argument when the pattern has named
    // groups. Everything before it is positional and irrelevant here.
    const groups: unknown = args.at(-1);
    if (typeof groups !== "object" || groups === null) return match;
    for (const [name, placeholder] of PLACEHOLDERS) {
      // `groups` is a null-prototype object of `string | undefined`; reading a
      // known key off it is the documented way to tell which branch matched.
      const value: unknown = Reflect.get(groups, name);
      if (typeof value === "string") return placeholder;
    }
    return match;
  });
}
