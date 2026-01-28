export type RecurseFunction = (progressPrefix: string, inner: (recurse: RecurseFunction) => Promise<void>) => Promise<void>;

export type CollectedError = {
  context: string,
  error: unknown,
};

export function createRecurse(options: { noBail: boolean }): { recurse: RecurseFunction, collectedErrors: CollectedError[] } {
  let lastProgress = performance.now() - 9999999999;
  const collectedErrors: CollectedError[] = [];

  const _recurse = async (
    progressPrefix: string | ((...args: any[]) => void),
    inner: Parameters<RecurseFunction>[1],
    contextPath: string = "",
  ): Promise<void> => {
    const progressFunc = typeof progressPrefix === "function" ? progressPrefix : (...args: any[]) => {
      console.log(`${progressPrefix}`, ...args);
    };
    const currentContext = typeof progressPrefix === "string" ? progressPrefix : contextPath;
    if (performance.now() - lastProgress > 1000) {
      progressFunc();
      lastProgress = performance.now();
    }
    try {
      return await inner(
        (progressPrefix, inner) => _recurse(
          (...args) => progressFunc(progressPrefix, ...args),
          inner,
          `${currentContext} > ${typeof progressPrefix === "string" ? progressPrefix : ""}`,
        ),
      );
    } catch (error) {
      progressFunc(`\x1b[41mERROR\x1b[0m!`);
      if (options.noBail) {
        collectedErrors.push({
          context: currentContext,
          error,
        });
      } else {
        throw error;
      }
    }
  };

  const recurse: RecurseFunction = (progressPrefix, inner) => _recurse(progressPrefix, inner, progressPrefix);

  return { recurse, collectedErrors };
}

