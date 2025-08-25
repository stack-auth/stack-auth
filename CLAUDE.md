# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Essential Commands
- **Install dependencies**: `pnpm install`
- **Run tests**: `pnpm test run` (uses Vitest). You can filter with `pnpm test run <file-filters>`. The `run` is important to not trigger watch mode
- **Lint code**: `pnpm lint`. `pnpm lint --fix` will fix some of the linting errors, prefer that over fixing them manually.
- **Type check**: `pnpm typecheck`

#### Extra commands
These commands are usually already called by the user, but you can remind them to run it for you if they forgot to.
- **Build packages**: `pnpm build:packages`
- **Generate code**: `pnpm codegen`
- **Start dependencies**: `pnpm restart-deps` (resets & restarts Docker containers for DB, Inbucket, etc. Usually already called by the user)
- **Run development**: `pnpm dev` (starts all services on different ports. Usually already started by the user in the background)
- **Run minimal dev**: `pnpm dev:basic` (only backend and dashboard for resource-limited systems)

### Testing
You should ALWAYS add new E2E tests when you change the API or SDK interface. Generally, err on the side of creating too many tests; it is super important that our codebase is well-tested, due to the nature of the industry we're building in.
- **Run all tests**: `pnpm test run`
- **Run some tests**: `pnpm test run <file-filters>`

### Database Commands
- **Generate migration**: `pnpm db:migration-gen`
- **Reset database** (rarely used): `pnpm db:reset`
- **Seed database** (rarely used): `pnpm db:seed`
- **Initialize database** (rarely used): `pnpm db:init`
- **Run migrations** (rarely used): `pnpm db:migrate`

## Architecture Overview

Stack Auth is a monorepo using Turbo for build orchestration. The main components are:

### Apps (`/apps`)
- **backend** (`/apps/backend`): Next.js API backend running on port 8102
  - Main API routes in `/apps/backend/src/app/api/latest`
  - Database models using Prisma
- **dashboard** (`/apps/dashboard`): Admin dashboard on port 8101
- **dev-launchpad**: Development portal on port 8100
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
- Environment variables are pre-configured in `.env.development` files
- Always run typecheck, lint, and test to make sure your changes are working as expected. You can save time by only linting and testing the files you've changed (and/or related E2E tests).
- The project uses a custom route handler system in the backend for consistent API responses
- Sometimes, the typecheck will give errors along the line of "Cannot assign Buffer to Uint8Array" or similar, on changes that are completely unrelated to your own changes. If that happens, stop and tell the user to run `pnpm clean && pnpm i && pnpm run codegen && pnpm build:packages`, and restart the dev server (you cannot run this yourself). After that's done, the typecheck should pass.
- Whenever you learn something new, or at the latest right before you call the `Stop` tool, write whatever you learned into the .claude/CLAUDE-KNOWLEDGE.md file, in the Q&A format in there. You will later be able to look up knowledge from there (based on the question you asked). Note that it's not 100% accurate and you may have to update it later if you find that something is wrong.

### Code-related
- Use ES6 maps instead of records wherever you can.

### Testing-related
- When writing tests, prefer .toMatchInlineSnapshot over other matchers, if possible. You can check (and modify) the snapshot-serializer.ts file to see how the snapshots are formatted and how non-deterministic values are handled.
