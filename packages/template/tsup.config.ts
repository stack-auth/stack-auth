import { defineConfig, Options } from 'tsup';
import { stackTsupDefaultConfig } from '../../configs/tsup';

const config: Options = {
  ...stackTsupDefaultConfig,
  outDir: 'dist',
  dts: 'src/index.ts',  // we only generate types for the barrel file because it drastically decreases the memory needed for tsup https://github.com/egoist/tsup/issues/920#issuecomment-2454732254
};

export default defineConfig(config);
