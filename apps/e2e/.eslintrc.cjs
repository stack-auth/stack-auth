module.exports = {
  "extends": [
    "../../configs/eslint/defaults.js",
  ],
  "ignorePatterns": ['/*', '!/tests'],
  "rules": {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["vitest"],
            importNames: ["test", "it"],
            message: "Use test or it from helpers instead.",
          },
        ],
      },
    ],
  }
};
