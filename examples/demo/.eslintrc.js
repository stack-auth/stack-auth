module.exports = {
  "extends": [
    "../../eslint-configs/defaults.js",
    "../../eslint-configs/next.js",
  ],
  "ignorePatterns": ['/*', '!/src'],
  rules: {
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
