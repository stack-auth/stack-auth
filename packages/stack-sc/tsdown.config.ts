import createJsLibraryTsupConfig from '../../configs/tsdown/js-library.ts';

export default createJsLibraryTsupConfig({
  barrelFiles: [
    "src/index.combined.ts",
    "src/index.default.ts",
    "src/index.react-server.ts",
  ]
});
