import { CodeExample } from '../lib/code-examples';

export const selfHostExamples = {
  'self-host': {
    'docker-postgres': [
      {
        language: 'Shell',
        framework: 'Docker',
        code: `docker run -d --name db -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=password -e POSTGRES_DB=stackframe -p 5432:5432 postgres:latest`,
        highlightLanguage: 'bash',
        filename: 'Terminal'
      }
    ] as CodeExample[],

    'docker-run': [
      {
        language: 'Shell',
        framework: 'Docker',
        code: `docker run --env-file <your-env-file.env> -p 8101:8101 -p 8102:8102 stackauth/server:latest`,
        highlightLanguage: 'bash',
        filename: 'Terminal'
      }
    ] as CodeExample[],

    'git-clone': [
      {
        language: 'Shell',
        framework: 'Git',
        code: `git clone git@github.com:stack-auth/stack-auth.git
cd stack`,
        highlightLanguage: 'bash',
        filename: 'Terminal'
      }
    ] as CodeExample[],

    'local-dev-setup': [
      {
        language: 'Shell',
        framework: 'pnpm',
        code: `pnpm install

# Run build to build everything once
pnpm run build:dev

# reset & start the dependencies (DB, Inbucket, etc.) as Docker containers, seeding the DB with the Prisma schema
pnpm run start-deps
# pnpm run restart-deps
# pnpm run stop-deps

# Start the dev server
pnpm run dev
# For systems with limited resources, you can run a minimal development setup with just the backend and dashboard
# pnpm run dev:basic

# In a different terminal, run tests in watch mode
pnpm run test`,
        highlightLanguage: 'bash',
        filename: 'Terminal'
      }
    ] as CodeExample[],

    'prisma-studio': [
      {
        language: 'Shell',
        framework: 'pnpm',
        code: `pnpm run prisma studio`,
        highlightLanguage: 'bash',
        filename: 'Terminal'
      }
    ] as CodeExample[],

    'backend-build': [
      {
        language: 'Shell',
        framework: 'pnpm',
        code: `pnpm install
pnpm build:backend
pnpm start:backend`,
        highlightLanguage: 'bash',
        filename: 'Terminal'
      }
    ] as CodeExample[],

    'dashboard-build': [
      {
        language: 'Shell',
        framework: 'pnpm',
        code: `pnpm install
pnpm build:dashboard
pnpm start:dashboard`,
        highlightLanguage: 'bash',
        filename: 'Terminal'
      }
    ] as CodeExample[],

    'db-init': [
      {
        language: 'Shell',
        framework: 'pnpm',
        code: `pnpm db:init`,
        highlightLanguage: 'bash',
        filename: 'Terminal'
      }
    ] as CodeExample[],
  }
};
