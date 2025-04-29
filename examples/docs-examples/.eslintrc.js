module.exports = {
  extends: ["../../configs/eslint/defaults.js", "../../configs/eslint/next.js"],
  ignorePatterns: ["/*", "!/src"],
  rules: {
    "@typescript-eslint/no-misused-promises": [0],
    "@typescript-eslint/no-floating-promises": [0],
    "import/order": [
      1,
      {
        groups: [
          "external",
          "builtin",
          "internal",
          "sibling",
          "parent",
          "index",
        ],
      },
    ],
  },
};
