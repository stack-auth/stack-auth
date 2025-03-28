/** @type {import('eslint').Linter.Config} */
module.exports = {
  extends: [
    "../../eslint-configs/defaults.js"
  ],
  rules: {
    "@typescript-eslint/member-delimiter-style": "off"
  },
  ignorePatterns: ["dist/**/*"]
};
