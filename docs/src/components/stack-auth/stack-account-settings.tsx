import { AccountSettings } from '@stackframe/stack';
import * as React from 'react';
import { StackContainer } from '../mdx';

export function AccountSettingsStackAuth() {
  return (
    <StackContainer color="amber" size="full">
      <React.Suspense fallback={
        <div className="flex items-center justify-center p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600"></div>
        </div>
      }>
        <AccountSettings
          mockProject={{
            config: {
              allowUserApiKeys: true,
              clientTeamCreationEnabled: true,
            },
          }}
          mockUser={{
            displayName: "John Doe",
            profileImageUrl: undefined,
          }}
          mockApiKeys={[
            {
              id: 'key-1',
              description: 'Development Key',
              createdAt: '2024-01-15T10:30:00.000Z', // Fixed date for consistency
              expiresAt: undefined,
              manuallyRevokedAt: undefined,
            },
            {
              id: 'key-2',
              description: 'Production Key',
              createdAt: '2024-01-08T14:22:00.000Z', // One week before the first key
              expiresAt: '2024-02-17T14:22:00.000Z', // 30 days after creation
              manuallyRevokedAt: undefined,
            }
          ]}
        />
      </React.Suspense>
    </StackContainer>
  );
}
