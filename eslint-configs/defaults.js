module.exports = {
  extends: [],
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  parserOptions: {
    // use the package folder as the root for the TS ESLint plugin
    project: "./tsconfig.json",
    tsconfigRootDir: process.cwd(),
  },
  rules: {
    "no-unused-expressions": ["error", { enforceForJSX: true }],
    "no-trailing-spaces": "warn",
    "eol-last": "error",
    "key-spacing": "error",
    "object-curly-spacing": ["error", "always"],
    indent: [
      "error",
      2,
      {
        SwitchCase: 1,
        ignoredNodes: [
          "TSIntersectionType",
          "TSTypeParameter",
          "TSTypeParameterDeclaration",
          "TSTypeParameterInstantiation",
          "TSUnionType",
          "ConditionalType",
          "TSConditionalType",
          "FunctionDeclaration",
          "CallExpression",
          "TemplateLiteral *",
        ],
      },
    ],
    "keyword-spacing": "warn",
    "block-spacing": "warn",
    "max-statements-per-line": "warn",
    semi: ["error", "always"],
    "no-fallthrough": "error",
    "@typescript-eslint/switch-exhaustiveness-check": "error",
    "@typescript-eslint/no-floating-promises": [
      "error",
      {
        ignoreVoid: false,
      },
    ],
    "no-return-await": "off",
    "@typescript-eslint/return-await": ["error", "always"],
    "no-multiple-empty-lines": "warn",
    "@typescript-eslint/await-thenable": "error",
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
    "@typescript-eslint/no-unnecessary-condition": [
      "error",
      { allowConstantLoopConditions: true },
    ],
    "no-restricted-syntax": [
      "error",
      {
        selector: 'SwitchCase > *.consequent[type!="BlockStatement"]',
        message: "Switch cases without blocks are disallowed.",
      },
      {
        selector: "CallExpression[callee.property.name='catch'] > MemberExpression[object.name='console'][property.name='error']",
        message: "Don't do .catch(console.error). Please handle errors explicitly, eg. with runAsynchronously<WithAlert> or process.exit(1).",
      },
      {
        selector:
          "MemberExpression:has(Identifier[name='yupString']) > Identifier[name='url']",
        message:
          "Use urlSchema from schema-fields.tsx instead of yupString().url().",
      },
      {
        selector:
          "CallExpression > MemberExpression > Identifier[name='required']",
        message:
          `Use .defined(), .nonNullable(), or .nonEmpty() instead of .required(), as the latter has inconsistent/unexpected behavior on strings.`,
      },
      {
        selector:
          "CallExpression > MemberExpression:has(Identifier[name='yupString']) > Identifier[name='email']",
        message:
          `Use emailSchema instead of yupString().email().`,
      },
      {
        selector:
          "MemberExpression:has(Identifier[name='yup']):has(Identifier[name='string'], Identifier[name='number'], Identifier[name='boolean'], Identifier[name='array'], Identifier[name='object'], Identifier[name='tuple'], Identifier[name='date'], Identifier[name='mixed'])",
        message: "Use yupXyz() from schema-fields.tsx instead of yup.xyz().",
      },
      {
        selector:
          "Identifier[name='localeCompare']",
        message: "Use stringCompare() from utils/strings.tsx instead of String.prototype.localeCompare.",
      },
    ],
    "@typescript-eslint/no-misused-promises": [
      "error",
      {
        checksConditionals: true,
      },
    ],
    "@typescript-eslint/require-array-sort-compare": "error",
    "@typescript-eslint/consistent-type-definitions": ["error", "type"],
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["react"],
            importNames: ["use"],
            message:
              'Directly importing "use" from react will cause next.js middlewares to break on compile time. do import React from "react" and use React.use instead.',
          },
        ],
        patterns: [
          {
            group: ["@vercel/functions"],
            importNames: ["waitUntil"],
            message:
              'Use runAsynchronouslyAndWaitUntil instead.',
          },
        ],
      },
    ],
  },
};
