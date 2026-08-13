/**
 * Shared identity for the observability lab's release + source-map fixture.
 *
 * The SDK stamps `telemetry.resource.service.version` onto every `$error`.
 * Symbolication looks up artifacts by that exact release plus the debug ID
 * the injected snippet registers, so these strings must stay in lockstep
 * across the Hexclave app constructor, the upload route, and the served bundle.
 */
export const OBSERVABILITY_DEMO_RELEASE = "observability-demo@1.0.0";
export const OBSERVABILITY_DEMO_ENVIRONMENT = "development";
export const OBSERVABILITY_DEMO_CODE_FILE = "error-tracking-demo/symbolicated/demo-charge.min.js";
export const OBSERVABILITY_DEMO_SOURCE_MAP_FILE = "error-tracking-demo/symbolicated/demo-charge.min.js.map";
export const OBSERVABILITY_DEMO_SOURCE_PATH = "src/demo-charge.ts";
export const OBSERVABILITY_DEMO_BUNDLE_PATH = "/error-tracking-demo/symbolicated/demo-charge.min.js";
export const OBSERVABILITY_DEMO_THROWER_GLOBAL_KEY = "__hexclaveDemoThrowSymbolicatedChargeError";
export const OBSERVABILITY_DEMO_ERROR_MESSAGE = "Symbolicated charge failed: card_declined";
