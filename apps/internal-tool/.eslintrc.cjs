module.exports = {
  extends: ["../../configs/eslint/defaults.js"],
  parserOptions: {
    project: "./tsconfig.json",
  },
  ignorePatterns: ["/*", "!/src"],
};
