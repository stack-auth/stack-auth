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
  },
};
