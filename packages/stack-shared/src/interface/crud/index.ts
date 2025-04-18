// Export all crud interfaces

// Import api-keys if it exists
import { existsSync } from 'fs';
import { resolve } from 'path';

export * from './contact-channels';
export * from './current-user';
export * from './email-templates';
export * from './emails';
export * from './internal-api-keys';
export * from './oauth';
export * from './project-api-keys';
export * from './project-permissions';
export * from './projects';
export * from './purchases';
export * from './sessions';
export * from './subscriptions';
export * from './svix-token';
export * from './team-invitation-details';
export * from './team-invitation';
export * from './team-member-profiles';
export * from './team-memberships';
export * from './team-permissions';
export * from './teams';
export * from './users';

// Conditionally import api-keys if it exists
if (existsSync(resolve(__dirname, './api-keys.ts'))) {
  import('./api-keys');
}
