# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Essential Commands
- **Install dependencies**: `pnpm install`
- **Build packages**: `pnpm build:packages`
- **Generate code**: `pnpm codegen`
- **Start dependencies**: `pnpm restart-deps` (resets & restarts Docker containers for DB, Inbucket, etc. Usually already called by the user)
- **Run development**: `pnpm dev` (starts all services on different ports. Usually already started by the user in the background)
- **Run minimal dev**: `pnpm dev:basic` (only backend and dashboard for resource-limited systems)
- **Run tests**: `pnpm test --no-watch` (uses Vitest). You can filter with `pnpm test --no-watch <file-filters>`
- **Lint code**: `pnpm lint`
- **Type check**: `pnpm typecheck`

### Testing
- **Run all tests**: `pnpm test --no-watch`
- **Run some tests**: `pnpm test --no-watch <file-filters>`

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
- 8100: Dev launchpad
- 8101: Dashboard
- 8102: Backend API
- 8103: Demo app
- 8104: Documentation
- 8105: Inbucket (email testing)
- 8106: Prisma Studio

## Important Notes
- Environment variables are pre-configured in `.env.development` files
- Code generation (`pnpm codegen`) must be run after schema changes
- The project uses a custom route handler system in the backend for consistent API responses
