/**
 * INTEGRATION NOTE: replace with app.getFeatureFlagValue / app.captureEvent once the
 * feature-flags SDK ships; the call signatures here match that contract exactly:
 *
 *   app.getFeatureFlagValue(key: string, options: { fallback: T }): Promise<T>  // records an exposure
 *   app.captureEvent(eventName: string, properties?: Record<string, unknown>): Promise<void>
 *
 * Until then, this module feature-detects those methods on the app object at runtime.
 * When they are absent, it does NOT silently pretend the flag SDK exists — it returns a
 * discriminated result (`source: "fallback"` / `delivered: false`) so the UI can surface
 * "you are looking at the explicit fallback value" to the person viewing the demo.
 */

type SdkMethodName = "getFeatureFlagValue" | "captureEvent";

/**
 * A future SDK method after feature detection. Arguments and return value are `unknown`
 * on purpose: the SDK isn't merged yet, so callers must validate the result structurally
 * before trusting it.
 */
type DetectedSdkMethod = (...args: unknown[]) => unknown;

/**
 * Looks up a future SDK method on the app object. Returns `undefined` when the method
 * doesn't exist (i.e. this build predates the feature-flags SDK), or a wrapper that
 * invokes it with `this` bound to the app otherwise.
 */
function detectSdkMethod(app: object, methodName: SdkMethodName): DetectedSdkMethod | undefined {
  const candidate: unknown = Reflect.get(app, methodName);
  if (typeof candidate !== "function") {
    return undefined;
  }
  // This is the single type cast in this module: TypeScript narrows `candidate` to
  // `Function`, which is not callable in a type-safe way. We only widen it to a
  // signature that takes/returns `unknown`, so every result still has to pass the
  // structural runtime validation in the exported functions below before it is used.
  const method = candidate as DetectedSdkMethod;
  return (...args: unknown[]) => Reflect.apply(method, app, args);
}

export type FeatureFlagResult = {
  value: boolean,
  /**
   * "flag": the value came from the (future) feature-flags SDK.
   * "fallback": the SDK method is absent in this build, so this is the explicit
   * fallback the caller passed in. The UI must surface this state — never treat it
   * as a real evaluation.
   */
  source: "flag" | "fallback",
};

export async function getFeatureFlagValue(
  app: object,
  key: string,
  options: { fallback: boolean },
): Promise<FeatureFlagResult> {
  const method = detectSdkMethod(app, "getFeatureFlagValue");
  if (method === undefined) {
    return { value: options.fallback, source: "fallback" };
  }
  const result: unknown = await method(key, { fallback: options.fallback });
  if (typeof result !== "boolean") {
    throw new Error(
      `app.getFeatureFlagValue(${JSON.stringify(key)}) returned a non-boolean value ` +
      `(${typeof result}); the demo-checkout-redesign flag is expected to be a boolean flag. ` +
      `This likely means the feature-flags SDK contract changed — update feature-flag-client.ts.`,
    );
  }
  return { value: result, source: "flag" };
}

export type ConversionEventResult = {
  /**
   * `false` means the (future) `app.captureEvent` method is absent in this build, so
   * the event was NOT sent anywhere. The UI must tell the user instead of silently
   * dropping the conversion.
   */
  delivered: boolean,
};

export async function captureConversionEvent(
  app: object,
  eventName: string,
  properties: Record<string, number | string | boolean>,
): Promise<ConversionEventResult> {
  const method = detectSdkMethod(app, "captureEvent");
  if (method === undefined) {
    return { delivered: false };
  }
  await method(eventName, properties);
  return { delivered: true };
}
