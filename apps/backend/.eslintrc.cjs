const defaults = require("../../configs/eslint/defaults.js");
const publicVars = require("../../configs/eslint/extra-rules.js");

module.exports = {
  extends: ["../../configs/eslint/defaults.js", "../../configs/eslint/next.js"],
  // `/scripts` is linted, except throwaway e2e spikes: they're `.mts` (the only
  // such files in the repo, so the parser isn't set up with extraFileExtensions
  // and typed rules crash on them) and intentionally hit real external services.
  ignorePatterns: ["/*", "!/src", "!/scripts", "!/prisma", "/scripts/spike-*.mts"],
  rules: {
    "no-restricted-syntax": [
      ...defaults.rules["no-restricted-syntax"],
      publicVars['no-next-public-env'],
      {
        selector: "MemberExpression[type=MemberExpression][object.type=MemberExpression][object.object.type=Identifier][object.object.name=process][object.property.type=Identifier][object.property.name=env]",
        message: "Don't use process.env directly in Stack's backend. Use getEnvVariable(...) or getNodeEnvironment() instead.",
      },
    ],
  },
};
