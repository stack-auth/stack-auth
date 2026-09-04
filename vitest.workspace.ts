import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'configs',
  'railway',
  'packages/*',
  'apps/*',
  'docs',
  'examples/*',
]);
