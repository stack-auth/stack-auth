'use client';

import { Button } from "@/components/ui/button";
import { useState } from "react";
import { CreateApiKeyDialog, ShowApiKeyDialog } from "../supporting/api-key-dialogs";
import { ApiKeyTable } from "../supporting/api-key-table";
import { useUser } from "@hexclave/next";
import { ApiKey, ApiKeyCreationOptions } from "../supporting/types";
import { PageLayout } from "../page-layout";

export function ApiKeysPage({
  mockApiKeys,
  mockMode,
}: {
  mockApiKeys?: Array<{
    id: string,
    description: string,
    createdAt: string,
    expiresAt?: string,
    manuallyRevokedAt?: string,
  }>,
  mockMode?: boolean,
} = {}) {
  const isInMockMode = !!(mockApiKeys || mockMode);
  const user = useUser({ or: isInMockMode ? 'return-null' : 'redirect' });

  if (isInMockMode) {
    return <ApiKeysPageInner user={null} mockApiKeys={mockApiKeys} mockMode={true} />;
  }

  if (!user) {
    return null;
  }

  return <ApiKeysPageInner user={user} mockMode={false} />;
}

function ApiKeysPageInner({
  user,
  mockApiKeys,
  mockMode,
}: {
  user: any;
  mockApiKeys?: any[];
  mockMode: boolean;
}) {
  const mockApiKeysData = mockApiKeys ? mockApiKeys.map(mockKey => ({
    id: mockKey.id,
    description: mockKey.description,
    createdAt: new Date(mockKey.createdAt),
    expiresAt: mockKey.expiresAt ? new Date(mockKey.expiresAt) : undefined,
    manuallyRevokedAt: mockKey.manuallyRevokedAt ? new Date(mockKey.manuallyRevokedAt) : null,
    value: {
      lastFour: mockKey.id.slice(-4).padStart(4, '0'),
    },
    type: 'user' as const,
    userId: 'mock-user-id',
    update: async () => {},
    revoke: async () => {},
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
      createdAt: new Date(Date.now() - 172800000),
      expiresAt: undefined,
      manuallyRevokedAt: null,
      value: {
        lastFour: 'ey-1'.slice(-4).padStart(4, '0'),
      },
      type: 'user' as const,
      userId: 'mock-user-id',
      update: async () => {},
      revoke: async () => {},
      isValid: () => true,
      whyInvalid: () => null,
    }
  ];

  const apiKeys = mockMode ? mockApiKeysData : user.useApiKeys();

  const [isNewApiKeyDialogOpen, setIsNewApiKeyDialogOpen] = useState(false);
  const [returnedApiKey, setReturnedApiKey] = useState<ApiKey<"user", true> | null>(null);

  const CreateDialog = CreateApiKeyDialog<"user">;
  const ShowDialog = ShowApiKeyDialog<"user">;

  const handleCreateApiKey = async (data: ApiKeyCreationOptions<"user">) => {
    if (mockMode) {
      const mockApiKey = {
        id: `key-${Date.now()}`,
        description: data.description,
        createdAt: new Date().toISOString(),
        expiresAt: data.expiresAt?.toISOString(),
        value: 'sk_dev_mock_key_' + Math.random().toString(36).substring(2),
        update: async () => {},
        revoke: async () => {},
        isValid: () => true,
        whyInvalid: () => null,
        type: 'user' as const,
        userId: 'mock-user-id',
      };
      return mockApiKey as any;
    }

    return await user.createApiKey(data as any);
  };

  return (
    <PageLayout>
      <div className="border border-black/[0.08] dark:border-white/[0.08] bg-white/80 dark:bg-background/80 backdrop-blur-xl rounded-2xl p-6 shadow-sm ring-1 ring-black/[0.04] dark:ring-0 flex flex-col gap-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h3 className="font-semibold text-base text-foreground leading-snug">
              User API Keys
            </h3>
            <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
              Create and manage API keys to authenticate your user actions from scripts or backend environments.
            </p>
          </div>
          <Button
            onClick={() => setIsNewApiKeyDialogOpen(true)}
            className="bg-black text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200 rounded-xl px-4 py-2 w-full md:w-auto transition-colors duration-150"
          >
            Create API Key
          </Button>
        </div>

        <div className="border border-black/[0.06] dark:border-white/[0.06] rounded-xl overflow-hidden shadow-sm">
          <ApiKeyTable apiKeys={apiKeys} />
        </div>
      </div>

      <CreateDialog
        open={isNewApiKeyDialogOpen}
        onOpenChange={setIsNewApiKeyDialogOpen}
        onKeyCreated={setReturnedApiKey}
        createApiKey={handleCreateApiKey}
        mockMode={mockMode}
      />
      <ShowDialog
        apiKey={returnedApiKey}
        onClose={() => setReturnedApiKey(null)}
      />
    </PageLayout>
  );
}
