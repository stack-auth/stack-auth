import { configDefaults, defineConfig, mergeConfig } from "vitest/config";
import sharedConfig from "../../vitest.shared";

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      poolOptions: {
        threads: {
          minThreads: 1,
          maxThreads: 8,
        },
      },
      exclude: [
        ...configDefaults.exclude,
        "dist/**",
        "old-bulldozer-perf-test-file.test.ts",
      ],
    },
  }),
);
