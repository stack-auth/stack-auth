import createJsLibraryTsupConfig from '../../configs/tsdown/js-library.ts';

export default createJsLibraryTsupConfig({
  barrelFiles: ["src/index.ts"],
  onSuccess: "pnpm run build-iife && pnpm run copy-iife",
});
