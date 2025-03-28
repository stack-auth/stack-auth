module.exports = {
  extends: ["../../eslint-configs/defaults.js", "../../eslint-configs/next.js"],
  ignorePatterns: ["/*", "!/src"],
  rules: {
    "@typescript-eslint/no-misused-promises": [0],
    "@typescript-eslint/no-floating-promises": [0],
    "@typescript-eslint/member-delimiter-style": "off",
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
