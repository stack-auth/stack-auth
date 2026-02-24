# AGENTS.md

This file provides guidance to coding agents when working with code in this repository.

## Development Commands

### Essential Commands
- **Install dependencies**: `pnpm install`
- **Run tests**: `pnpm test run` (uses Vitest). You can filter with `pnpm test run <file-filters>`. The `run` is important to not trigger watch mode
- **Lint code**: `pnpm lint`. `pnpm lint --fix` will fix some of the linting errors, prefer that over fixing them manually.
- **Type check**: `pnpm typecheck`

#### Extra commands
These commands are usually already called by the user, but you can remind them to run it for you if they forgot to.
- **Build packages**: NEVER DO THIS YOURSELF — ASK THE USER TO DO IT FOR YOU!
- **Start dependencies**: `pnpm restart-deps` (resets & restarts Docker containers for DB, Inbucket, etc. Usually already called by the user)
- **Run development**: Already called by the user in the background. You don't need to do this. This will also watch for changes and rebuild packages, codegen, etc. Do NOT call build:packages, dev, codegen, or anything like that yourself, as the dev is already running it.
- **Run minimal dev**: `pnpm dev:basic` (only backend and dashboard for resource-limited systems)

### Testing
You should ALWAYS add new E2E tests when you change the API or SDK interface. Generally, err on the side of creating too many tests; it is super important that our codebase is well-tested, due to the nature of the industry we're building in.
- **Run all tests**: `pnpm test run`
- **Run some tests**: `pnpm test run <file-filters>`

### Database Commands
- **Generate migration**: `pnpm db:migration-gen` — NOTE: don't forget to create tests for the migrations!
- **Reset database** (rarely used): `pnpm db:reset`
- **Seed database** (rarely used): `pnpm db:seed`
- **Initialize database** (rarely used): `pnpm db:init`
- **Run migrations** (rarely used): `pnpm db:migrate`

## Architecture Overview

Stack Auth is a monorepo using Turbo for build orchestration. The main components are:

### Apps (`/apps`)
- **backend** (`/apps/backend`): Next.js API backend running on port `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}02` (defaults to 8102)
  - Main API routes in `/apps/backend/src/app/api/latest`
  - Database models using Prisma
- **dashboard** (`/apps/dashboard`): Admin dashboard on port `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}01` (defaults to 8101)
- **dev-launchpad**: Development portal on port `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}00` (defaults to 8100)
- **e2e**: End-to-end tests

### Packages (`/packages`)
- **stack** (`/packages/stack`): Main Next.js SDK
- **stack-shared** (`/packages/stack-shared`): Shared utilities and types
- **stack-ui** (`/packages/stack-ui`): UI components
- **react** (`/packages/react`): React SDK
- **js** (`/packages/js`): JavaScript SDK

### Key Technologies
- **Framework**: Next.js (with App Router)
- **Database**: PostgreSQL with Prisma ORM
- **Testing**: Vitest
- **Package Manager**: pnpm with workspaces
- **Build Tool**: Turbo
- **TypeScript**: Used throughout
- **Styling**: Tailwind CSS

### API Structure
The API follows a RESTful design with routes organized by resource type:
- Auth endpoints: `/api/latest/auth/*`
- User management: `/api/latest/users/*`
- Team management: `/api/latest/teams/*`
- OAuth providers: `/api/latest/oauth-providers/*`

### Development Ports
To see all development ports, refer to the index.html of `apps/dev-launchpad/public/index.html`.

## Important Notes
- NEVER UPDATE packages/stack OR packages/js. Instead, update packages/template, as the others are simply copies of that package.
- For blocking alerts and errors, never use `toast`, as they are easily missed by the user. Instead, use alerts.
- Environment variables are pre-configured in `.env.development` files
- Always run typecheck, lint, and test to make sure your changes are working as expected. You can save time by only linting and testing the files you've changed (and/or related E2E tests).
- The project uses a custom route handler system in the backend for consistent API responses
- When writing tests, prefer .toMatchInlineSnapshot over other selectors, if possible. You can check (and modify) the snapshot-serializer.ts file to see how the snapshots are formatted and how non-deterministic values are handled.
- Whenever you learn something new, or at the latest right before you call the `Stop` tool, write whatever you learned into the ./claude/CLAUDE-KNOWLEDGE.md file, in the Q&A format in there. You will later be able to look up knowledge from there (based on the question you asked).
- Animations: Keep hover/click transitions snappy and fast. Don't delay the action with a pre-transition (e.g. no fade-in when hovering a button) — it makes the UI feel sluggish. Instead, apply transitions after the action, like a smooth fade-out when the hover ends.
- Whenever you make changes in the dashboard, provide the user with a deep link to the dashboard page that you've just changed. Usually, this takes the form of `http://localhost:<whatever-is-in-$NEXT_PUBLIC_STACK_PORT_PREFIX>01/projects/-selector-/...`, although sometimes it's different. If $NEXT_PUBLIC_STACK_PORT_PREFIX is set to 91, 92, or 93, use `a.localhost`, `b.localhost`, and `c.localhost` for the domains, respectively.
- To update the list of apps available, edit `apps-frontend.tsx` and `apps-config.ts`. When you're tasked to implement a new app or a new page, always check existing apps for inspiration on how you could implement the new app or page.
- NEVER use Next.js dynamic functions if you can avoid them. Instead, prefer using a client component to make sure the page remains static (eg. prefer `usePathname` instead of `await params`).
- Whenever you make backwards-incompatible changes to the config schema, you must update the migration functions in `packages/stack-shared/src/config/schema.ts`!
- NEVER try-catch-all, NEVER void a promise, and NEVER .catch(console.error) (or similar). In most cases you don't actually need to be asynchronous, especially when UI is involved (instead, use a loading indicator! eg. our <Button> component already takes an async callback for onClick and sets its loading state accordingly — if whatever component doesn't do that, update the component instead). If you really do need things to be asynchronous, use `runAsynchronously` or `runAsynchronouslyWithAlert` instead as it deals with error logging.
- WHENEVER you create hover transitions, avoid hover-enter transitions, and just use hover-exit transitions. For example, `transition-colors hover:transition-none`.
- Any environment variables you create should be prefixed with `STACK_` (or NEXT_PUBLIC_STACK_ if they are public). This ensures that their changes are picked up by Turborepo (and helps readability).
- NEVER just silently use fallback values or whatever when you don't know how to fix type errors. If there is a state that should never happen because of higher-level logic, and the type system doesn't represent that, either update the types or throw an error. Stuff like `?? 0` or `?? ""` is often code smell when `?? throwErr("this should never happen because XYZ")` would be better.
- Code defensively. Prefer `?? throwErr(...)` over non-null assertions, with good error messages explicitly stating the assumption that must've been violated for the error to be thrown.
- Try to avoid the `any` type. Whenever you need to use `any`, leave a comment explaining why you're using it (optimally it explains why the type system fails here, and how you can be certain that any errors in that code path would still be flagged at compile-, test-, or runtime).
- Don't use Date.now() for measuring elapsed (real) time, instead use `performance.now()`
- Use urlString`` or encodeURIComponent() instead of normal string interpolation for URLs, for consistency even if it's not strictly necessary.
- When making config updates, use path notation (`{ "path.to.field": my-value }`) to avoid overwriting sibling properties
- IMPORTANT: Any assumption you make should either be validated through type system (preferred), assertions, or tests. Optimally, two out of three.
- If there is an external browser tool connected, use it to test changes you make to the frontend when possible.
- Whenever you update an SDK implementation in `sdks/implementations`, make sure to update the specs accordingly in `sdks/specs` such that if you reimplemented the entire SDK from the specs again, you would get the same implementation. (For example, if the specs are not precise enough to describe a change you made, make the specs more precise.)
- When building internal tools for Stack Auth developers (eg. internal interfaces like the WAL info log etc.): Make the interfaces look very concise, assume the user is a pro-user. This only applies to internal tools that are used primarily by Stack Auth developers.
- The dev server already builds the packages in the background whenever you update a file. If you run into issues with typechecking or linting in a dependency after updating something in a package, just wait a few seconds, and then try again, and they will likely be resolved.
- When asked to review PR comments, you can use `gh pr status` to get the current pull request you're working on.
- NEVER EVER AUTOMATICALLY COMMIT OR STAGE ANY CHANGES — DON'T MODIFY GIT WITHOUT USER CONSENT!
- When building frontend or React code for the dashboard, refer to DESIGN-GUIDE.md.
- NEVER implement a hacky solution without EXPLICIT approval from the user. Always go the extra mile to make sure the solution is clean, maintainable, and robust.
- Fail early, fail loud. Fail fast with an error instead of silently continuing.
- Do NOT use `as`/`any`/type casts or anything else like that to bypass the type system unless you specifically asked the user about it. Most of the time a place where you would use type casts is not one where you actually need them. Avoid wherever possible.
- When writing database migration files, assume that we have >1,000,000 rows in every table (unless otherwise specified). This means you may have to use CONDITIONALLY_REPEAT_MIGRATION_SENTINEL to avoid running the migration and things like concurrent index builds; see the existing migrations for examples. One common pattern is to add a temporary index or extra boolean column marking whether the row has already been migrated (then deleting the column at the end).
- Each migration file runs in its own transaction with a relatively short timeout. Split long-running operations into separate migration files to avoid timeouts. For example, when adding CHECK constraints, use `NOT VALID` in one migration, then `VALIDATE CONSTRAINT` in a separate migration file.
- Note that each database migration file is executed in a single transaction. Even with the run-outside-transaction sentinel, the transaction will still continue during the entire migration file. If you want to split things up into multiple transactions, put it into their own migration files.
- When writing database migration files, ALWAYS ALWAYS add tests for all the potential edge cases! See the folder structure of the other migrations to see how that works.
- **When building frontend code, always carefully deal with loading and error states.** Be very explicit with these; some components make this easy, eg. the button onClick already takes an async callback for loading state, but make sure this is done everywhere, and make sure errors are NEVER just silently swallowed.
- Any design components you add or modify in the dashboard, update the Playground page accordingly to showcase the changes.
- Unless very clearly equivalent from types, prefer explicit null/undefinedness checks over boolean checks, eg. `foo == null` instead of `!foo`.
- Ensure **aggressively** that all code has low coupling and high cohesion. This is really important as it makes sure our code remains consistent and maintainable. Eagerly refactor things into better abstractions and look out for them actively.

### Code-related
- Use ES6 maps instead of records wherever you can.

## Cursor Cloud specific instructions

### Prerequisites
- **Docker** must be available (used for PostgreSQL, ClickHouse, Inbucket, Svix, S3 mock, LocalStack, QStash, and other infrastructure).
- **Node.js >= 20** and **pnpm 10.23.0** (specified via `packageManager` in root `package.json`).

### Starting the environment
1. Start Docker infrastructure: `pnpm start-deps` (or `pnpm restart-deps` for a full reset). This starts ~18 Docker containers and runs `db:init` (migrations + seed).
2. Before `db:init` can succeed, packages must be built: `pnpm build:packages && pnpm codegen`. On subsequent runs after the update script, this is usually already done.
3. Start dev servers: `pnpm dev:basic` (backend on port 8102, dashboard on 8101, mock-oauth on 8114). Use `pnpm dev` for the full dev experience including docs, examples, and SDK watcher.

### Gotchas
- `pnpm start-deps` calls `db:init`, which requires `@/generated` (Prisma client). If packages haven't been built and codegen hasn't run, `db:init` will fail with `ERR_MODULE_NOT_FOUND`. Fix: run `pnpm build:packages && pnpm codegen` first, then `pnpm db:init`.
- The full test suite (`pnpm test run`) runs ~196 test files. Many are E2E tests that require the backend (port 8102) to be running. If the dev server dies during tests, restart with `pnpm dev:basic`.
- To sign in to the dashboard in dev mode: use OTP with `admin@example.com`. The OTP code is captured by Inbucket at `http://localhost:8105`.
- The `pnpm install` step may warn about "Ignored build scripts" for Prisma, esbuild, etc. Running `pnpm install --config.ignore-scripts=false` allows them to run. Prisma client generation is also handled by `pnpm codegen`.
- Lint and typecheck commands: `pnpm lint` and `pnpm typecheck` (see AGENTS.md essential commands above).
