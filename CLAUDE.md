# Development Guidelines for Stack Auth

## Build/Test/Lint Commands
- Build: `pnpm build` (all), `pnpm build:packages` (packages only), `pnpm build:backend` (backend)
- Lint: `pnpm lint` (zero warnings allowed)
- Typecheck: `pnpm typecheck`
- Test: `pnpm test` (all), `pnpm test:unit` (unit tests), `pnpm test:e2e` (e2e tests)
- Run single test: `pnpm test path/to/test.test.ts` or `pnpm test -t "test name pattern"`
- Start dependencies: `pnpm start-deps` (DB, services), `pnpm stop-deps` (shutdown)
- Dev mode: `pnpm dev` (all services) or `pnpm dev:basic` (backend+dashboard)
- Prisma CLI: `pnpm prisma` (use instead of the `prisma` command)

## Coding Guidelines
- TypeScript with strict types, prefer `type` over `interface`
- Avoid casting to `any`; Prefer making changes to the API so that `any` casts are unnecessary to access a property or method
- 2-space indentation, spaces in braces, semicolons required
- Return promises with `return await`, no floating promises
- Proper error handling for async code with try/catch
- Use helper functions: `yupXyz()` for validation, `getPublicEnvVar()` for env
- Switch cases must use blocks
- React Server Components preferred where applicable
- No direct 'use' imports from React (use React.use instead)
- Follow existing file structure and naming patterns

## Testing Guidelines
- Import test utilities from `/apps/e2e/test/helpers.ts`
- Prefer inline snapshot testing with `expect(response).toMatchInlineSnapshot(...)`

## Monorepo Structure
Managed with Turbo and pnpm workspaces. Core packages in `packages/`, apps in `apps/`.
`packages/stack` is generated and will not be committed into the repository; change the files in `packages/template` instead.
