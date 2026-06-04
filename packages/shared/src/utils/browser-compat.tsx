export function getBrowserCompatibilityReport() {
  const test = (snippet: string) => {
    try {
      (0, eval)(snippet);
      return true;
    } catch (e) {
      return `FAILED: ${e}`;
    }
  };

  return {
    optionalChaining: test("({})?.b?.c"),
    nullishCoalescing: test("0 ?? 1"),
    weakRef: test("new WeakRef({})"),
    cryptoUuid: test("crypto.randomUUID()"),
  };
}
