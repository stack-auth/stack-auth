'use client';

import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { CreateApiKeyDialog, ShowApiKeyDialog } from "../supporting/api-key-dialogs";
import { ApiKeyTable } from "../supporting/api-key-table";
import { useStackApp, useUser, Team } from "@hexclave/next";
import { Section } from "../section";

export function TeamApiKeysSection(props: { team: Team }) {
  const user = useUser({ or: 'redirect' });
  const team = user.useTeam(props.team.id);
  const stackApp = useStackApp();
  const project = stackApp.useProject();
  const manageApiKeysPermission = user.usePermission(props.team, '$manage_api_keys');

  if (!team) {
    throw new HexclaveAssertionError("Team not found");
  }

  const teamApiKeysEnabled = project.config.allowTeamApiKeys;
  if (!manageApiKeysPermission || !teamApiKeysEnabled) {
    return null;
  }

  return <TeamApiKeysSectionInner team={props.team} />;
}

function TeamApiKeysSectionInner(props: { team: Team }) {
  const [isNewApiKeyDialogOpen, setIsNewApiKeyDialogOpen] = useState(false);
  const [returnedApiKey, setReturnedApiKey] = useState<any | null>(null);

  const apiKeys = props.team.useApiKeys();

  const CreateDialog = CreateApiKeyDialog<"team">;
  const ShowDialog = ShowApiKeyDialog<"team">;

  return (
    <>
      <Section
        title="API Keys"
        description="API keys grant programmatic access to your team."
      >
        <Button
          onClick={() => setIsNewApiKeyDialogOpen(true)}
          className="bg-black text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200 rounded-xl px-4 py-2 w-full md:w-auto transition-colors duration-150"
        >
          Create API Key
        </Button>
      </Section>
      <div className="border border-black/[0.06] dark:border-white/[0.06] rounded-xl overflow-hidden shadow-sm">
        <ApiKeyTable apiKeys={apiKeys as any} />
      </div>

      <CreateDialog
        open={isNewApiKeyDialogOpen}
        onOpenChange={setIsNewApiKeyDialogOpen}
        onKeyCreated={setReturnedApiKey}
        createApiKey={async (data) => {
          const apiKey = await props.team.createApiKey(data as any);
          return apiKey as any;
        }}
      />
      <ShowDialog
        apiKey={returnedApiKey}
        onClose={() => setReturnedApiKey(null)}
      />
    </>
  );
}
