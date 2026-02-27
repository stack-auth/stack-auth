import createJsLibraryTsupConfig from '../../configs/tsdown/js-library';

export default createJsLibraryTsupConfig({ barrelFiles: [
  "src/index.ts", 
  "src/integrations/convex/component/convex.config.ts",
  "src/integrations/convex.ts",
] });
