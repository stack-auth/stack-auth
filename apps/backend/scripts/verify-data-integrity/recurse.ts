export type RecurseFunction = (progressPrefix: string, inner: (recurse: RecurseFunction) => Promise<void>) => Promise<void>;

export function createRecurse(): RecurseFunction {
  let lastProgress = performance.now() - 9999999999;

  const _recurse = async (
    progressPrefix: string | ((...args: any[]) => void),
    inner: Parameters<RecurseFunction>[1],
  ): Promise<void> => {
    const progressFunc = typeof progressPrefix === "function" ? progressPrefix : (...args: any[]) => {
      console.log(`${progressPrefix}`, ...args);
    };
    if (performance.now() - lastProgress > 1000) {
      progressFunc();
      lastProgress = performance.now();
    }
    try {
      return await inner(
        (progressPrefix, inner) => _recurse(
          (...args) => progressFunc(progressPrefix, ...args),
          inner,
        ),
      );
    } catch (error) {
      progressFunc(`\x1b[41mERROR\x1b[0m!`);
      throw error;
    }
  };

  return _recurse;
}

