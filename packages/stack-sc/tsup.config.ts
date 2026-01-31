import createJsLibraryTsupConfig from '../../configs/tsup/js-library';

export default createJsLibraryTsupConfig({
  barrelFiles: [
    "src/index.combined.ts",
    "src/index.default.ts",
    "src/index.react-server.ts",
  ]
});
