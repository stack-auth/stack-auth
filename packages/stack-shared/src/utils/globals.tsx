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
