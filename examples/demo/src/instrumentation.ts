import type { HexclaveNextInstrumentation } from "@hexclave/next/next";

// Next.js builds instrumentation for both Node.js and Edge. Keep the runtime
// check inline (`process.env.NEXT_RUNTIME`, not a helper) so the Edge bundle
// does not follow these Node-only imports — a wrapped read is invisible to
// Next's define-plugin and pulls `async_hooks` / OpenTelemetry into Edge.
let hexclaveNextInstrumentationPromise: Promise<HexclaveNextInstrumentation | null> | undefined;

function getHexclaveNextInstrumentation(): Promise<HexclaveNextInstrumentation | null> {
  hexclaveNextInstrumentationPromise ??= (async () => {
    if (process.env.NEXT_RUNTIME !== "nodejs") return null;
    const [{ hexclaveInstrumentation }, { hexclaveServerApp }] = await Promise.all([
      import("@hexclave/next/next"),
      import("./hexclave"),
    ]);
    return hexclaveInstrumentation(hexclaveServerApp);
  })();
  return hexclaveNextInstrumentationPromise;
}

export async function register() {
  const instrumentation = await getHexclaveNextInstrumentation();
  await instrumentation?.register();
}

export async function onRequestError(
  ...args: Parameters<HexclaveNextInstrumentation["onRequestError"]>
): Promise<void> {
  const instrumentation = await getHexclaveNextInstrumentation();
  if (instrumentation === null) return;
  await instrumentation.onRequestError(...args);
}
