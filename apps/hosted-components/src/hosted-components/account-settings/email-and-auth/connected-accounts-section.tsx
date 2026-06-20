import { ReactElement } from "react";
import { useStackApp, useUser } from "@hexclave/react";

import { Button } from "~/components/ui";
import { getProviderStyle } from "../../auth/supporting/oauth-button";
import { getOutlineButtonClassName, useDesign } from "../design-context";
import { Section } from "../section";

type SectionProvider = { id: string, displayName?: string, iconUrl?: string };

export function ConnectedAccountsSection(props?: {
  mockMode?: boolean,
}) {
  const isInMockMode = !!props?.mockMode;
  const user = useUser({ or: isInMockMode ? 'return-null' : "redirect" });
  const stackApp = useStackApp();
  const project = stackApp.useProject();

  if (isInMockMode && !user) {
    return (
      <Section
        title="Connected accounts"
        description="Connected account management is not available in demo mode."
      >
        <span className="text-sm text-muted-foreground">Connected account management is not available in demo mode.</span>
      </Section>
    );
  }

  if (!user) {
    return null;
  }

  const providers = project.config.oauthProviders;
  if (providers.length === 0) {
    return null;
  }

  return <ConnectedAccountsSectionInner user={user} providers={providers} />;
}

function ProviderInfo({ provider }: { provider: SectionProvider }) {
  const style = getProviderStyle(provider.id);
  const name = provider.displayName || style.name;
  const icon: ReactElement | null = provider.iconUrl
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={provider.iconUrl} alt="" width={20} height={20} className="object-contain" />
    : style.icon;

  return (
    <div className="flex items-center gap-3 min-w-0">
      <span className="flex h-5 w-5 items-center justify-center shrink-0">{icon}</span>
      <span className="text-sm truncate">{name}</span>
    </div>
  );
}

function ConnectedAccountsSectionInner({ user, providers }: { user: any, providers: readonly SectionProvider[] }) {
  const design = useDesign();
  const connectedAccounts = user.useConnectedAccounts();
  const connectedProviderIds = new Set<string>(connectedAccounts.map((account: any) => account.provider));

  // The provider list can contain duplicates if the same id appears twice; dedupe by id.
  const uniqueProviders = providers.filter((provider, index, arr) => arr.findIndex((other) => other.id === provider.id) === index);

  return (
    <Section title="Connected accounts" description="Link accounts from other providers to sign in faster.">
      <div className="flex w-full flex-col gap-2 md:w-[350px]">
        {uniqueProviders.map((provider) => {
          const isConnected = connectedProviderIds.has(provider.id);
          return (
            <div key={provider.id} className="flex items-center justify-between gap-3">
              <ProviderInfo provider={provider} />
              {isConnected ? (
                <span className="text-xs font-medium text-muted-foreground shrink-0">Connected</span>
              ) : (
                <Button
                  variant="outline"
                  onClick={async () => {
                    await user.linkConnectedAccount(provider.id);
                  }}
                  className={getOutlineButtonClassName(design, "px-3 py-1.5 text-xs shrink-0")}
                >
                  Connect
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}
