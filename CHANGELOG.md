# Stack Auth - Consolidated Changelog

This changelog contains all changes across all packages and applications in the Stack Auth monorepo.

> NOTE: Releases before ***2.8.44*** were never documented in this file. Check git history or individual commits if you need earlier details.

## 2.8.44

### Minor Changes

#### @stackframe/stack-shared

- Reworked apps config and URL helpers to support the new dashboard Apps experience
- Tightened client retry logic around 429 responses for more resilient rate limiting

#### @stackframe/stack-backend

- Checks Stripe connected accounts for charges_enabled before issuing purchase flows
- Added dev-only 429 simulation plus smarter retry metadata to exercise rate-limit handling

#### @stackframe/stack-dashboard

- Rebuilt the project Apps hub with a launch checklist plus modal detail views and refreshed visuals
- Removed runtime StackProvider fetching to make the dashboard static and simplify Suspense boundaries
- Improved loading states and navigation with tailored skeletons and broader page prefetching
- Surfaced project access summaries pending invitations and clearer payments warnings across settings

#### @stackframe/stack-docs

- Merged our docs into a single source of truth with new layout primitives and platform aware components
- Corrected inaccurate content and refreshed code blocks for payments and platform guides

#### @stackframe/e2e-tests

- Extended payments validation coverage and added Stack app inheritance tests

#### @stackframe/init-stack

- Generates server Stack apps that inherit from the client instance when both are scaffolded

#### @stackframe/stack-ui

- Added optional close-less dialogs to support new full screen flows
- Updated skeleton and typography components for tighter spacing in dashboard loaders

#### @stackframe/template

- StackProvider now skips runtime user fetching so dashboard templates render statically
- Stack app templates wire inheritFrom between client and server apps and update convex docs

#### @stackframe/convex-example

- Expanded example with action routes and server helpers to inspect and update user metadata
