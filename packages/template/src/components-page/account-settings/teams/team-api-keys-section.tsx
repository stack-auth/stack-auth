import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { Button } from "@stackframe/stack-ui";
import { useState } from "react";
import { CreateApiKeyDialog, ShowApiKeyDialog } from "../../../components/api-key-dialogs";
import { ApiKeyTable } from "../../../components/api-key-table";
import { useStackApp, useUser } from "../../../lib/hooks";
import { TeamApiKeyFirstView } from "../../../lib/stack-app/api-keys";
import { Team } from "../../../lib/stack-app/teams";
import { useTranslation } from "../../../lib/translations";
import { Section } from "../section";


export function TeamApiKeysSection(props: { team: Team }) {
  const user = useUser({ or: 'redirect' });
  const team = user.useTeam(props.team.id);
  const stackApp = useStackApp();
  const project = stackApp.useProject();

  if (!team) {
    throw new StackAssertionError("Team not found");
  }

  const teamApiKeysEnabled = project.config.allowTeamApiKeys;
  const manageApiKeysPermission = user.usePermission(props.team, '$manage_api_keys');
  if (!manageApiKeysPermission || !teamApiKeysEnabled) {
    return null;
  }

  return <TeamApiKeysSectionInner team={props.team} />;
}

function TeamApiKeysSectionInner(props: { team: Team }) {
  const { t } = useTranslation();

  const [isNewApiKeyDialogOpen, setIsNewApiKeyDialogOpen] = useState(false);
  const [returnedApiKey, setReturnedApiKey] = useState<TeamApiKeyFirstView | null>(null);

  const apiKeys = props.team.useApiKeys();

  const CreateDialog = CreateApiKeyDialog<"team">;
  const ShowDialog = ShowApiKeyDialog<"team">;

  return (
    <>
      <Section
        title={t("API Keys")}
        description={t("API keys grant programmatic access to your team.")}
      >
        <Button onClick={() => setIsNewApiKeyDialogOpen(true)}>
          {t("Create API Key")}
        </Button>
      </Section>
      <ApiKeyTable apiKeys={apiKeys} />

      <CreateDialog
        open={isNewApiKeyDialogOpen}
        onOpenChange={setIsNewApiKeyDialogOpen}
        onKeyCreated={setReturnedApiKey}
        createApiKey={async (data) => {
          const apiKey = await props.team.createApiKey(data);
          return apiKey;
        }}
      />
      <ShowDialog
        apiKey={returnedApiKey}
        onClose={() => setReturnedApiKey(null)}
      />
    </>
  );
}
