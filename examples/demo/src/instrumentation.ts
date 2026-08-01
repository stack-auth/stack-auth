import type { HexclaveNextInstrumentation } from "@hexclave/next/next";

// Next builds instrumentation for both Node.js and Edge. Resolve lazily so the
// Edge bundle never follows the Node-only `server-only` import in ./hexclave.
//
// Read NEXT_RUNTIME via globalThis instead of a bare `process` identifier:
// this file is sometimes typechecked outside the demo tsconfig (inferred
// project), where `@types/node` is not loaded even though it is installed.
function getNextRuntime(): string | undefined {
  const runtimeProcess = (globalThis as { process?: { env?: { NEXT_RUNTIME?: string } } }).process;
  return runtimeProcess?.env?.NEXT_RUNTIME;
}

let hexclaveNextInstrumentationPromise: Promise<HexclaveNextInstrumentation | null> | undefined;

function getHexclaveNextInstrumentation(): Promise<HexclaveNextInstrumentation | null> {
  hexclaveNextInstrumentationPromise ??= (async () => {
    if (getNextRuntime() !== "nodejs") return null;
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
