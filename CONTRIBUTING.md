# Contributing to Stack Auth

Welcome to Stack Auth!

Due to the nature of authentication, this may not be the easiest project to contribute to, so if you are looking for projects to help gain programming experience, we may not be a great match. If you're looking for projects for beginners, check out [Awesome First PR Opportunities](https://github.com/MunGell/awesome-for-beginners).

## Table of contents

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

- [How to contribute](#how-to-contribute)
- [Security & bug bounties](#security--bug-bounties)
- [Vibecoding setup](#vibecoding-setup)
- [Before creating a pull request](#before-creating-a-pull-request)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->


## How to contribute

If you think Stack Auth is a good fit for you, follow these steps:

1. Join [our Discord](https://discord.stack-auth.com)
2. [Use Stack Auth](https://docs.stack-auth.com/). The best way to understand the project is to use it. Build an application on top of Stack Auth, and post it on GitHub or write a blog post about how you built it. This also lets us assess your skills and understand where you could best help the project.
3. Give us feedback on Discord or GitHub; let us know where you got stuck, and which things you wish were easier. (We appreciate contributions most when they solve problems the authors encountered themselves in real usage.)
4. Contribute to the [documentation](https://docs.stack-auth.com) and create examples & guides. This way, you can share your knowledge and expertise with everyone else who's just getting started.
5. Only then, start [contributing to the codebase](README.md#-development--contribution). Coordinate with us on Discord beforehand to ensure we are not working on the same thing already, and to make sure a task is not more difficult than it seems.


## Security & bug bounties

For any security-related concerns & bug bounties, please email us at [security@stack-auth.com](mailto:security@stack-auth.com).

## Vibecoding setup

NOTE: Every line of code should be reviewed by a human BEFORE you submit a PR. DO NOT waste our time by creating an AI-generated PR; we won't fall for that.

For vibecoding, it can help to have multiple parallel copies of the codebase open in different windows. For this, you can set the environment variable `NEXT_PUBLIC_STACK_PORT_PREFIX` to a different value (default 81). You may want to do this in your VSCode settings:

```json
{
  "terminal.integrated.env.osx": {
    "NEXT_PUBLIC_STACK_PORT_PREFIX": "181"
  },
  "terminal.integrated.env.linux": {
    "NEXT_PUBLIC_STACK_PORT_PREFIX": "181"
  },
  "terminal.integrated.env.windows": {
    "NEXT_PUBLIC_STACK_PORT_PREFIX": "181"
  },
  "claude-code.environmentVariables": [
    "NEXT_PUBLIC_STACK_PORT_PREFIX=181"
  ]
}
```

When you do this, it is recommended that you give all workspaces a port prefix other than 81, to prevent accidental conflicts when you forgot to make a feature support the $NEXT_PUBLIC_STACK_PORT_PREFIX environment variable. (for example: first workspace at 181, second workspace at 182, etc.)

## Before creating a pull request

Please make sure to:

- Install ESLint in your IDE and follow the code format of the code base (e.g., spaces around `=`, semicolons at the end, etc.).
  - If you are using VSCode, select "Show Recommended Extensions" from the command palette (`Ctrl+Shift+P`) to install the recommended extensions.
- Run `pnpm run test`. All tests should pass.
- If you changed the Prisma schema, make sure you've created a migration file. Create only one DB migration file per PR.
- If you changed the API, make sure you have added endpoint tests in `apps/e2e`.
- Ensure all dependencies are in the correct `package.json` files.
- Ensure the PR is ready for review. If you want to discuss WIP code, mark it as a draft.
