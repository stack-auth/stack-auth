const globalVar: any =
  typeof globalThis !== 'undefined' ? globalThis :
    typeof global !== 'undefined' ? global :
      typeof window !== 'undefined' ? window :
        typeof self !== 'undefined' ? self :
          {};
export {
  globalVar
};

if (typeof globalThis === 'undefined') {
  (globalVar as any).globalThis = globalVar;
}

// Hexclave rebrand: file-private symbol key, renamed outright (no cross-version compat needed).
const hexclaveGlobalsSymbol = Symbol.for('__hexclave-globals');
globalVar[hexclaveGlobalsSymbol] ??= {};

export function createGlobal<T>(key: string, init: () => T) {
  if (!globalVar[hexclaveGlobalsSymbol][key]) {
    globalVar[hexclaveGlobalsSymbol][key] = init();
  }
  return globalVar[hexclaveGlobalsSymbol][key] as T;
}

/**
 * Like createGlobal, but if the asynchronous initialization fails, the global will be reset and recomputed on the next
 * invocation.
 */
export function createGlobalAsync<T>(key: string, init: () => Promise<T>): Promise<T> {
  let promise: Promise<T> | null = null;
  if (!globalVar[hexclaveGlobalsSymbol][key]) {
    promise = init().catch((e) => {
      delete globalVar[hexclaveGlobalsSymbol][key];
      throw e;
    });
    globalVar[hexclaveGlobalsSymbol][key] = promise;
  }
  return promise ?? globalVar[hexclaveGlobalsSymbol][key] as Promise<T>;
}

export function getGlobal(key: string): any {
  return globalVar[hexclaveGlobalsSymbol][key];
}

export function setGlobal(key: string, value: any) {
  globalVar[hexclaveGlobalsSymbol][key] = value;
}
