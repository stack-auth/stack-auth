# Stack Auth Development Container

This development container provides a standardized development environment for working on Stack Auth.

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

For more information, read the README.md in the root of the repository.

