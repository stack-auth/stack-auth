import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/*',
  'apps/*',
  '!apps/hosted-components',
  'docs',
  'examples/*',
]);
