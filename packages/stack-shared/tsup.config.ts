import { defineConfig, Options } from 'tsup';
import { stackTsupDefaultConfig } from '../../configs/tsup';

const config: Options = {
  ...stackTsupDefaultConfig,
  outDir: 'dist',
};

export default defineConfig(config);
