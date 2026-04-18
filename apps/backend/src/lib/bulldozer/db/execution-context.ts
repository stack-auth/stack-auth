export type BulldozerExecutionContext = {
  /**
   * Deterministically returns a new unique suffix each time it is called.
   * Given the same invocation count, this returns the same string.
   */
  generateDeterministicUniqueString: () => string,
};

export function createBulldozerExecutionContext(options: {
  initialInvocationCount?: number,
} = {}): BulldozerExecutionContext {
  let invocationCount = options.initialInvocationCount ?? 0;
  return {
    generateDeterministicUniqueString: () => {
      const value = invocationCount.toString(36).padStart(10, "0");
      invocationCount++;
      return value;
    },
  };
}

export function getBulldozerExecutionContext(ctx: BulldozerExecutionContext): BulldozerExecutionContext {
  return ctx;
}
