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
               createdAt: new Date(Date.now() - 172800000).toISOString(), // 2 days ago
               expiresAt: undefined,
               manuallyRevokedAt: undefined,
             },
             {
               id: 'key-2', 
               description: 'Production Key',
               createdAt: new Date(Date.now() - 604800000).toISOString(), // 1 week ago
               expiresAt: new Date(Date.now() + 2592000000).toISOString(), // 30 days from now
               manuallyRevokedAt: undefined,
             }
           ]}
        />
      </React.Suspense>
    </StackContainer>
  );
}
