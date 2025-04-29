const defaults = require("../../configs/eslint/defaults.js");
const publicVars = require("../../configs/eslint/extra-rules.js");

module.exports = {
  extends: ["../../configs/eslint/defaults.js", "../../configs/eslint/next.js"],
  ignorePatterns: ["/*", "!/src", "!/prisma"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["next/navigation", "next/router"],
            importNames: ["useRouter"],
            message:
              "Importing useRouter from next/navigation or next/router is not allowed. Use our custom useRouter instead.",
          },
          {
            group: ["next/link"],
            message:
              "Importing Link from next/link is not allowed. use our custom Link instead.",
          },
        ],
      },
    ],
    "no-restricted-syntax": [
      ...defaults.rules["no-restricted-syntax"].filter(e => typeof e !== "object" || !e.message.includes("yupXyz")),
      publicVars['no-next-public-env']
    ],
  },
};
