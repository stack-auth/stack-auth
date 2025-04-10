import { Button } from "@stackframe/stack-ui";
import { useState } from "react";
import { CreateApiKeyDialog, ShowApiKeyDialog } from "../../../components/api-key-dialogs";
import { ApiKeyTable } from "../../../components/api-key-table";
import { useUser } from "../../../lib/hooks";
import { ApiKey, ApiKeyCreationOptions } from "../../../lib/stack-app/api-keys";
import { useTranslation } from "../../../lib/translations";
import { PageLayout } from "../page-layout";


export function ApiKeysPage() {
  const { t } = useTranslation();

  const user = useUser({ or: 'redirect' });
  const apiKeys = user.useApiKeys();

  const [isNewApiKeyDialogOpen, setIsNewApiKeyDialogOpen] = useState(false);
  const [returnedApiKey, setReturnedApiKey] = useState<ApiKey<"user", true>   | null>(null);

  const CreateDialog = CreateApiKeyDialog<"user">;
  const ShowDialog = ShowApiKeyDialog<"user">;

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
        createApiKey={async (data: ApiKeyCreationOptions<"user">) => {
          const apiKey = await user.createApiKey(data);
          return apiKey;
        }}
      />
      <ShowDialog
        apiKey={returnedApiKey}
        onClose={() => setReturnedApiKey(null)}
      />
    </PageLayout>
  );
}
