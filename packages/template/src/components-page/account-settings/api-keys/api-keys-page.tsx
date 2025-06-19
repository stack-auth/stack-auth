import { Button } from "@stackframe/stack-ui";
import { useState } from "react";
import { CreateApiKeyDialog, ShowApiKeyDialog } from "../../../components/api-key-dialogs";
import { ApiKeyTable } from "../../../components/api-key-table";
import { useUser } from "../../../lib/hooks";
import { ApiKey, ApiKeyCreationOptions } from "../../../lib/stack-app/api-keys";
import { useTranslation } from "../../../lib/translations";
import { PageLayout } from "../page-layout";


export function ApiKeysPage(props?: {
  mockApiKeys?: Array<{
    id: string,
    description: string,
    createdAt: string,
    expiresAt?: string,
    manuallyRevokedAt?: string,
  }>,
  mockMode?: boolean,
}) {
  const { t } = useTranslation();

  // Check if we're in any kind of mock mode first
  const isInMockMode = !!(props?.mockApiKeys || props?.mockMode);

  const userFromHook = useUser({ or: isInMockMode ? 'return-null' : 'redirect' });

  // In mock mode, we don't need a user - just show mock data
  if (isInMockMode && !userFromHook) {
    // This is expected in mock mode, continue with mock data
  }

  // Only return null if we're not in mock mode and don't have a user
  if (!isInMockMode && !userFromHook) {
    return null; // This shouldn't happen due to redirect, but just in case
  }

  // Use mock data if provided
  const mockApiKeysData = props?.mockApiKeys ? props.mockApiKeys.map(mockKey => ({
    id: mockKey.id,
    description: mockKey.description,
    createdAt: new Date(mockKey.createdAt),
    expiresAt: mockKey.expiresAt ? new Date(mockKey.expiresAt) : undefined,
    manuallyRevokedAt: mockKey.manuallyRevokedAt ? new Date(mockKey.manuallyRevokedAt) : null,
    value: {
      lastFour: mockKey.id.slice(-4).padStart(4, '0'), // Use last 4 chars of ID or pad with zeros
    },
    type: 'user' as const,
    userId: 'mock-user-id',
    update: async () => {
      console.log('Mock API key update called');
    },
    revoke: async () => {
      console.log('Mock API key revoke called');
    },
    isValid: () => {
      const now = new Date();
      const isExpired = mockKey.expiresAt ? new Date(mockKey.expiresAt) < now : false;
      const isRevoked = !!mockKey.manuallyRevokedAt;
      return !isExpired && !isRevoked;
    },
    whyInvalid: () => {
      const now = new Date();
      if (mockKey.manuallyRevokedAt) return 'manually-revoked';
      if (mockKey.expiresAt && new Date(mockKey.expiresAt) < now) return 'expired';
      return null;
    },
  })) : [
    {
      id: 'key-1',
      description: 'Development Key',
      createdAt: new Date(Date.now() - 172800000), // 2 days ago
      expiresAt: undefined,
      manuallyRevokedAt: null,
      value: {
        lastFour: 'ey-1'.slice(-4).padStart(4, '0'),
      },
      type: 'user' as const,
      userId: 'mock-user-id',
      update: async () => {
        console.log('Mock API key update called');
      },
      revoke: async () => {
        console.log('Mock API key revoke called');
      },
      isValid: () => true,
      whyInvalid: () => null,
    }
  ];

  // Determine which API keys to use
  let apiKeys: any[];
  if (isInMockMode) {
    apiKeys = mockApiKeysData;
  } else if (userFromHook) {
    apiKeys = userFromHook.useApiKeys();
  } else {
    apiKeys = [];
  }

  const [isNewApiKeyDialogOpen, setIsNewApiKeyDialogOpen] = useState(false);
  const [returnedApiKey, setReturnedApiKey] = useState<ApiKey<"user", true> | null>(null);

  const CreateDialog = CreateApiKeyDialog<"user">;
  const ShowDialog = ShowApiKeyDialog<"user">;

  const handleCreateApiKey = async (data: ApiKeyCreationOptions<"user">) => {
    if (isInMockMode) {
      // Mock API key creation
      const mockApiKey = {
        id: `key-${Date.now()}`,
        description: data.description,
        createdAt: new Date().toISOString(),
        expiresAt: data.expiresAt?.toISOString(),
        value: 'sk_dev_mock_key_' + Math.random().toString(36).substring(2),
        update: async () => {
          console.log('Mock API key update called');
        },
        revoke: async () => {
          console.log('Mock API key revoke called');
        },
        isValid: () => true,
        whyInvalid: () => null,
        type: 'user' as const,
        userId: 'mock-user-id',
      };
      return mockApiKey as any;
    }

    if (!userFromHook) throw new Error('User not available');
    return await userFromHook.createApiKey(data);
  };

  return (
    <PageLayout>
      <Button onClick={() => setIsNewApiKeyDialogOpen(true)}>
        {t("Create API Key")}
      </Button>
      <ApiKeyTable apiKeys={apiKeys} />
      <CreateDialog
        open={isNewApiKeyDialogOpen}
        onOpenChange={setIsNewApiKeyDialogOpen}
        onKeyCreated={setReturnedApiKey}
        createApiKey={handleCreateApiKey}
        mockMode={isInMockMode}
      />
      <ShowDialog
        apiKey={returnedApiKey}
        onClose={() => setReturnedApiKey(null)}
      />
    </PageLayout>
  );
}
