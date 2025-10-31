const defaults = require("../../configs/eslint/defaults.js");
const publicVars = require("../../configs/eslint/extra-rules.js");

module.exports = {
  extends: ["../../configs/eslint/defaults.js", "../../configs/eslint/next.js"],
  ignorePatterns: ["/*", "!/src", "!/prisma"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: [
          ...defaults.rules["no-restricted-imports"][1].paths,
        ],
        patterns: [
          ...defaults.rules["no-restricted-imports"][1].patterns,
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
      publicVars['no-next-public-env'],
      {
        selector: "Program:not(:has(:matches(ExportSpecifier[exported.name=generateStaticParams], VariableDeclaration > VariableDeclarator[id.name=generateStaticParams]))):has(ExportDefaultDeclaration > FunctionDeclaration[id.name=Layout])",
        message: 'Layouts must have a generateStaticParams function to be statically generated. Please add `export { generateStaticParams } from "@/lib/generate-empty-static-params";"` to your layout. For more information, see the comment in generate-empty-static-params.tsx.'
      }
    ],
  },
};
