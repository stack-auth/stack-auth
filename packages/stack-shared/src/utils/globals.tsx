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

const stackGlobalsSymbol = Symbol.for('__stack-globals');
globalVar[stackGlobalsSymbol] ??= {};

export function createGlobal<T>(key: string, init: () => T) {
  if (!globalVar[stackGlobalsSymbol][key]) {
    globalVar[stackGlobalsSymbol][key] = init();
  }
  return globalVar[stackGlobalsSymbol][key] as T;
}

/**
 * Like createGlobal, but if the asynchronous initialization fails, the global will be reset and recomputed on the next
 * invocation.
 */
export function createGlobalAsync<T>(key: string, init: () => Promise<T>): Promise<T> {
  let promise: Promise<T> | null = null;
  if (!globalVar[stackGlobalsSymbol][key]) {
    promise = init().catch((e) => {
      delete globalVar[stackGlobalsSymbol][key];
      throw e;
    });
    globalVar[stackGlobalsSymbol][key] = promise;
  }
  return promise ?? globalVar[stackGlobalsSymbol][key] as Promise<T>;
}

export function getGlobal(key: string): any {
  return globalVar[stackGlobalsSymbol][key];
}

export function setGlobal(key: string, value: any) {
  globalVar[stackGlobalsSymbol][key] = value;
}
