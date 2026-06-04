import { defineConfig, mergeConfig } from 'vitest/config';
import sharedConfig from '../../vitest.shared';

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      // Override the shared `maxWorkers: 8` — with it set, tinypool defaults
      // minThreads to the host's available parallelism, producing
      // "minThreads/maxThreads must not conflict" on machines with >8 cores.
      poolOptions: {
        threads: {
          minThreads: 1,
          maxThreads: 4,
        },
      },
    },
  }),
);
