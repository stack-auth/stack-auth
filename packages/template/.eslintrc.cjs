const defaults = require("../../configs/eslint/defaults.js");

module.exports = {
  "extends": [
    "../../configs/eslint/defaults.js",
  ],
  "ignorePatterns": ['/*', '!/src'],
  "rules": {
    "no-restricted-syntax": [
      ...defaults.rules["no-restricted-syntax"],
    ],
    "no-restricted-properties": [
      "error",
      {
        "object": "process",
        "property": "env",
        "message": "Use envVars from src/lib/env.ts instead of reading process.env directly.",
      },
    ],
  },
  "overrides": [
    {
      "files": ["src/lib/env.ts"],
      "rules": {
        "no-restricted-properties": "off",
      },
    },
  ],
};
