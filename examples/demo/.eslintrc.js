module.exports = {
  "extends": [
    "../../eslint-configs/defaults.js",
    "../../eslint-configs/next.js",
  ],
  "ignorePatterns": ['/*', '!/src'],
  "parser": "@typescript-eslint/parser",
  "plugins": ["@typescript-eslint"],
  rules: {
    "@typescript-eslint/member-delimiter-style": [
      "error",
      {
        multiline: {
          delimiter: "comma",
        },
        singleline: {
          delimiter: "comma",
          requireLast: false,
        },
        multilineDetection: "brackets",
      },
    ],
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
