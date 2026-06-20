import { BrandIcons, Button, Typography } from "@hexclave/ui";
import { useStackApp } from "../../..";
import { useUser } from "../../../lib/hooks";
import { useTranslation } from "../../../lib/translations";
import { Section } from "../section";

export function ConnectedAccountsSection(props?: {
  mockMode?: boolean,
}) {
  const { t } = useTranslation();
  const user = useUser({ or: props?.mockMode ? 'return-null' : "throw" });

  // In mock mode, show a placeholder message
  if (props?.mockMode && !user) {
    return (
      <Section
        title={t("Connected accounts")}
        description={t("Connected account management is not available in demo mode.")}
      >
        <Typography variant='secondary'>{t("Connected account management is not available in demo mode.")}</Typography>
      </Section>
    );
  }

  if (!user) {
    return null; // This shouldn't happen in non-mock mode due to throw
  }
  const hexclaveApp = useStackApp();
  const project = hexclaveApp.useProject();
  const connectedAccounts = user.useConnectedAccounts();

  const providers = project.config.oauthProviders;
  if (providers.length === 0) {
    return null;
  }

  const connectedProviderIds = new Set(connectedAccounts.map(account => account.provider));
  // The provider list can contain duplicates if the same id appears twice; dedupe by id.
  const uniqueProviders = providers.filter((provider, index, arr) => arr.findIndex(other => other.id === provider.id) === index);

  return (
    <Section title={t("Connected accounts")} description={t("Link accounts from other providers to sign in faster.")}>
      <div className='flex flex-col gap-2 w-full md:w-[300px]'>
        {uniqueProviders.map(provider => {
          const isConnected = connectedProviderIds.has(provider.id);
          return (
            <div key={provider.id} className='flex items-center justify-between gap-3'>
              <div className='flex items-center gap-2 min-w-0'>
                {provider.iconUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={provider.iconUrl} alt="" width={20} height={20} style={{ objectFit: 'contain' }} />
                  : <BrandIcons.Mapping provider={provider.id} iconSize={20} />}
                <Typography className='truncate'>{provider.displayName || BrandIcons.toTitle(provider.id)}</Typography>
              </div>
              {isConnected
                ? <Typography variant='secondary' type='label'>{t("Connected")}</Typography>
                : (
                  <Button
                    variant='secondary'
                    onClick={async () => {
                      await user.linkConnectedAccount(provider.id);
                    }}
                  >
                    {t("Connect")}
                  </Button>
                )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}
