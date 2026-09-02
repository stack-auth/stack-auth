/**
 * JSON.parse, minus the silent precision loss.
 *
 * Convex versions every document with `ts`, a nanosecond timestamp — around
 * 1.79e18 today, which is 200 times larger than `Number.MAX_SAFE_INTEGER`.
 * `JSON.parse` rounds those to the nearest representable double, so
 * 1788367987801277866 comes back as 1788367987801278000. That number is the
 * destination's `_hexclave_version`: two mutations landing inside the same
 * ~256ns rounding window would tie or invert, and ReplacingMergeTree would then
 * keep whichever row it liked rather than the newer one. Customer Int64 fields
 * are corrupted the same way, just less visibly.
 *
 * So integers too large to survive a double are turned into strings before
 * parsing, and everything downstream — `versionFromCursorValue`, ClickHouse's
 * Int64 reader — already accepts a decimal string. Floats are left alone:
 * `_creationTime` is genuinely a double and quoting it would change its type.
 */

/** Matches a JSON number token: optional sign, integer part, optional fraction/exponent. */
const NUMBER = /-?\d+(\.\d+)?([eE][+-]?\d+)?/y;

export function parseJsonPreservingBigIntegers(text: string): unknown {
  let out = "";
  let copiedTo = 0;
  let inString = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      // A backslash escapes the next character, including a closing quote.
      if (char === "\\") i++;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    // A number token can only start where a value can start, and the character
    // before it is always structural — never part of an identifier — so a digit
    // here is unambiguously the head of a number.
    if (char !== "-" && (char < "0" || char > "9")) continue;

    NUMBER.lastIndex = i;
    const match = NUMBER.exec(text);
    if (match == null) continue;
    const token = match[0];
    i = NUMBER.lastIndex - 1;

    // Only lossy integers are rewritten. A float is already approximate and
    // quoting it would turn a number into a string for no gain.
    //
    // Integer-ness is decided from the text, which relies on Convex always
    // spelling a float with a `.` or an `e` — serde_json does, which is why
    // `_creationTime` arrives as `1788367966967.3257`. If that ever changed, a
    // whole-numbered float above 2^53 would be quoted and its column would take
    // a string instead of a number.
    const isInteger = !/[.eE]/.test(token);
    if (!isInteger || Number.isSafeInteger(Number(token))) continue;

    out += text.slice(copiedTo, match.index) + '"' + token + '"';
    copiedTo = NUMBER.lastIndex;
  }

  return JSON.parse(copiedTo === 0 ? text : out + text.slice(copiedTo));
}

/**
 * Reads a value that should be an integer however it arrived — a JS number for
 * anything small, or a string once the parser above has protected it.
 */
export function toBigInt(value: unknown, what: string): bigint {
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
  throw new Error(`Convex returned a ${what} that is not an integer: ${JSON.stringify(value)}`);
}
