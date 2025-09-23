import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/*',
  'apps/*',
  'docs',
  // 'examples/*', there is an issue with examples/convex causing vitest to stall
]);
