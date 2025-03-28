# Stack Auth Development Container

This development container provides a standardized development environment for working on Stack Auth.

## What's Included

- Node.js 22
- pnpm 9
- Docker for running dependencies
- PostgreSQL client tools
- VS Code extensions for development

## Getting Started

1. Open this folder in VS Code with the Dev Containers extension installed
2. VS Code will prompt you to "Reopen in Container"
3. Once the container is built and started, the following commands will be run automatically:
   - `pnpm install`
   - `pnpm build:packages`
   - `pnpm codegen`

4. Start the dependencies and development server with:
   ```
   pnpm restart-deps
   pnpm dev
   ```

5. You can now access the dev launchpad at http://localhost:8100

## Ports

The following ports are forwarded to your local machine:
- 8100: Dev launchpad
- 8101: Dashboard
- 8102: API
- 8103: Demo
- 8104: Docs
- 8105: Inbucket (e-mails)
- 8106: Prisma Studio
- and more development services
