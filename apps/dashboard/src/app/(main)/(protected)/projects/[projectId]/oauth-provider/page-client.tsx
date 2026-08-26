"use client";

import { useUpdateConfig } from "@/components/config-update";
import { DesignAlert, DesignCard, DesignInput } from "@/components/design-components";
import { Button, Label, Switch, Typography } from "@/components/ui";
import { getPublicEnvVar } from "@/lib/env";
import { getOAuthIssuerUrl } from "@hexclave/next/mcp";
import { useAdminApp } from "../use-admin-app";
import { PageLayout } from "../page-layout";
import { generateUuid } from "@hexclave/shared/dist/utils/uuids";
import type { CompleteConfig, BranchConfigOverrideOverride } from "@hexclave/shared/dist/config/schema";
import { canonicalizeResourceUri, isValidHostname } from "@hexclave/shared/dist/utils/urls";
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { CheckIcon, CopyIcon, GlobeIcon, LinkIcon, SlidersHorizontalIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";

type OAuthProviderConfig = CompleteConfig["oauthProvider"];
type ResourceConfig = OAuthProviderConfig["resources"][string];
type ClientConfig = OAuthProviderConfig["clients"][string];

type EditableResource = ResourceConfig & { id: string };
type EditableClient = ClientConfig & { id: string, redirectUris: Record<string, { url?: string }> };
type EditableDomain = { id: string, domain?: string };

class OAuthProviderValidationError extends Error {}

function optional(value: string | undefined): string | null {
  return value === undefined || value.trim() === "" ? null : value;
}

function toResources(value: OAuthProviderConfig["resources"]): EditableResource[] {
  return Object.entries(value).map(([id, resource]) => ({ id, ...resource }));
}

function toClients(value: OAuthProviderConfig["clients"]): EditableClient[] {
  return Object.entries(value).map(([id, client]) => ({ id, ...client }));
}

export default function PageClient() {
  const app = useAdminApp();
  const project = app.useProject();
  const config = project.useConfig();
  const updateConfig = useUpdateConfig();
  const oauth = config.oauthProvider;
  const { required: consentDefault } = oauth.consent;
  const [resources, setResources] = useState(() => toResources(oauth.resources));
  const [clients, setClients] = useState(() => toClients(oauth.clients));
  const [domains, setDomains] = useState<EditableDomain[]>(() =>
    Object.entries(oauth.clientIdMetadataDocuments.allowedDomains).map(([id, value]) => ({ id, ...value })),
  );
  const [dcrEnabled, setDcrEnabled] = useState(oauth.dynamicClientRegistration.enabled);
  const [cimdEnabled, setCimdEnabled] = useState(oauth.clientIdMetadataDocuments.enabled);
  const [consentRequired, setConsentRequired] = useState(consentDefault);
  const [error, setError] = useState<string | null>(null);

  const apiBaseUrl = getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL") ?? throwErr("NEXT_PUBLIC_STACK_API_URL is required to build OAuth issuer URLs");
  const issuer = getOAuthIssuerUrl({ projectId: project.id, baseUrl: apiBaseUrl });
  const discovery = `${issuer}/.well-known/openid-configuration`;
  const hasChanges = useMemo(() =>
    JSON.stringify({ resources, clients, domains, dcrEnabled, cimdEnabled, consentRequired })
    !== JSON.stringify({
      resources: toResources(oauth.resources),
      clients: toClients(oauth.clients),
      domains: Object.entries(oauth.clientIdMetadataDocuments.allowedDomains).map(([id, value]) => ({ id, ...value })),
      dcrEnabled: oauth.dynamicClientRegistration.enabled,
      cimdEnabled: oauth.clientIdMetadataDocuments.enabled,
      consentRequired: consentDefault,
    }), [clients, cimdEnabled, consentDefault, consentRequired, dcrEnabled, domains, oauth, resources]);

  const save = async () => {
    setError(null);
    try {
      const resourceUris = resources.map(resource => resource.uri ?? "").filter(uri => uri !== "");
      let canonicalUris: string[];
      try {
        canonicalUris = resourceUris.map(uri => canonicalizeResourceUri(uri));
      } catch {
        throw new OAuthProviderValidationError("Resource URIs must be valid URLs without query strings or fragments.");
      }
      if (new Set(canonicalUris).size !== resourceUris.length) {
        throw new OAuthProviderValidationError("Resource URIs must be unique after removing trailing slashes.");
      }
      for (const domain of domains) {
        if (domain.domain != null && domain.domain !== "" && !isValidHostname(domain.domain)) {
          throw new OAuthProviderValidationError("Allowed domains must be valid hostnames, without a scheme, port, or path (e.g. client.example.com).");
        }
      }
      const update: BranchConfigOverrideOverride = {
        "oauthProvider.dynamicClientRegistration.enabled": dcrEnabled,
        "oauthProvider.clientIdMetadataDocuments.enabled": cimdEnabled,
        "oauthProvider.consent.required": consentRequired,
      };
      for (const id of Object.keys(oauth.resources)) {
        if (!resources.some(resource => resource.id === id)) update[`oauthProvider.resources.${id}`] = null;
      }
      for (const id of Object.keys(oauth.clients)) {
        if (!clients.some(client => client.id === id)) update[`oauthProvider.clients.${id}`] = null;
      }
      for (const id of Object.keys(oauth.clientIdMetadataDocuments.allowedDomains)) {
        if (!domains.some(domain => domain.id === id)) update[`oauthProvider.clientIdMetadataDocuments.allowedDomains.${id}`] = null;
      }
      for (const resource of resources) {
        update[`oauthProvider.resources.${resource.id}`] = {
          displayName: optional(resource.displayName),
          uri: optional(resource.uri),
        };
      }
      for (const client of clients) {
        update[`oauthProvider.clients.${client.id}`] = {
          displayName: optional(client.displayName),
          trusted: client.trusted,
          redirectUris: Object.fromEntries(
            Object.entries(client.redirectUris).map(([redirectId, redirect]) => [
              redirectId,
              { url: optional(redirect.url) },
            ]),
          ),
        };
      }
      for (const domain of domains) {
        update[`oauthProvider.clientIdMetadataDocuments.allowedDomains.${domain.id}`] = {
          domain: optional(domain.domain),
        };
      }
      await updateConfig({ adminApp: app, configUpdate: update, pushable: false });
    } catch (saveError) {
      if (!(saveError instanceof OAuthProviderValidationError)) throw saveError;
      setError(saveError.message);
    }
  };

  return (
    <PageLayout title="OAuth Provider" description="Let external apps and AI agents ask your users for permission to access your APIs.">
      <DesignAlert
        variant="info"
        title="Getting started"
        description={(
          <div className="space-y-2">
            <p>
              Your project acts as its own OAuth provider: external apps — including AI agents connecting to an MCP
              server you host — send your users through a sign-in and approval flow, then receive an access token for
              your APIs. Paste these two URLs into the app or MCP client you want to connect:
            </p>
            <CopyableValue label="Issuer" value={issuer} />
            <CopyableValue label="Discovery" value={discovery} />
          </div>
        )}
      />
      {error != null && <DesignAlert variant="error" title="Unable to save changes" description={error} />}
      <DesignCard title="Provider behavior" subtitle="What happens when an app requests access." icon={SlidersHorizontalIcon} glassmorphic>
        <div className="grid gap-4 sm:grid-cols-2">
          <Toggle
            label="Require consent"
            description="Show users an approval screen listing what an app is asking for, before it gets access. When off, apps get access silently as soon as the user signs in."
            value={consentRequired}
            onChange={setConsentRequired}
          />
          <Toggle
            label="Dynamic client registration"
            description="Let apps register themselves automatically instead of being added by you under OAuth clients below. Most MCP clients need this to connect. When off, unknown apps are rejected."
            value={dcrEnabled}
            onChange={setDcrEnabled}
          />
        </div>
      </DesignCard>
      <DesignCard title="Client ID metadata documents" subtitle="Let apps identify themselves with a URL they control." icon={GlobeIcon} glassmorphic>
        <Toggle
          label="Enable client ID metadata documents"
          description="Accept apps whose client ID is an HTTPS URL serving the app's own OAuth metadata (name, redirect URIs, etc.). A newer alternative to dynamic client registration that the MCP spec is moving towards. When off, such apps are rejected."
          value={cimdEnabled}
          onChange={setCimdEnabled}
        />
        <div className={cimdEnabled ? "mt-4 space-y-3" : "mt-4 space-y-3 opacity-50"}>
          <Typography className="text-sm text-muted-foreground">
            {cimdEnabled
              ? domains.length === 0
                ? "Currently, an app on any domain can identify itself this way. Add a domain below to restrict it to hosts you trust — once the list is non-empty, all other domains are rejected."
                : "Only apps whose metadata document is hosted on one of these domains are accepted. Remove all entries to allow any domain."
              : "Enable client ID metadata documents to restrict which domains may host metadata documents."}
          </Typography>
          {domains.map(item => (
            <div key={item.id} className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <Field
                  label="Hostname"
                  placeholder="client.example.com"
                  hint="Exact hostname only — no https://, port, path, or wildcards. Subdomains are not included automatically."
                  value={item.domain ?? ""}
                  disabled={!cimdEnabled}
                  onChange={domain => setDomains(current => current.map(existing => existing.id === item.id ? { ...existing, domain } : existing))}
                />
              </div>
              <Button className="mt-6" variant="secondary" disabled={!cimdEnabled} onClick={() => setDomains(current => current.filter(existing => existing.id !== item.id))}>Remove</Button>
            </div>
          ))}
          <Button variant="secondary" disabled={!cimdEnabled} onClick={() => setDomains(current => [...current, { id: generateUuid(), domain: "" }])}>Add allowed domain</Button>
        </div>
      </DesignCard>
      <EditableList
        icon={LinkIcon}
        title="Resource servers"
        subtitle="The APIs that this provider issues access tokens for."
        intro="A resource server is an API you protect with this provider — typically an MCP server you host. Connecting apps name the resource they want by its URI, and your server verifies that incoming tokens were issued for it."
        empty="No resource servers yet. Add one so apps have an API they can request access to."
        addLabel="Add resource server"
        items={resources}
        onAdd={() => setResources(current => [...current, { id: generateUuid(), displayName: "", uri: "" }])}
        onChange={setResources}
        render={(item, update) => (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Display name"
              placeholder="My MCP Server"
              hint="Shown to users on the consent screen."
              value={item.displayName ?? ""}
              onChange={value => update({ displayName: value })}
            />
            <Field
              label="URI"
              placeholder="https://mcp.example.com/mcp"
              hint="The exact URL of the API, without query string or fragment. Wildcards are not supported; trailing slashes are ignored."
              value={item.uri ?? ""}
              onChange={value => update({ uri: value })}
            />
          </div>
        )}
      />
      <EditableList
        icon={UsersThreeIcon}
        title="OAuth clients"
        subtitle="Apps that are allowed to request access."
        intro="Clients you register here by hand. Apps that register themselves through dynamic client registration or metadata documents don't appear in this list — you only need entries here for apps you manage yourself, or apps you want to mark as trusted."
        empty="No manually registered clients. If dynamic client registration is enabled above, apps can still connect by registering themselves."
        addLabel="Add OAuth client"
        items={clients}
        onAdd={() => setClients(current => [...current, { id: generateUuid(), displayName: "", type: "public", trusted: false, redirectUris: {} }])}
        onChange={setClients}
        render={(item, update) => (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Display name"
                placeholder="My App"
                hint="Shown to users on the consent screen."
                value={item.displayName ?? ""}
                onChange={value => update({ displayName: value })}
              />
              <Toggle
                label="Trusted client"
                description="Skips the consent screen even when consent is required, because the app is first-party. Only enable this for apps you own."
                value={item.trusted === true}
                onChange={trusted => update({ trusted })}
              />
            </div>
            <StableList
              label="Redirect URIs"
              description="Where users may be sent back to after approving access. The app's callback URL must match one of these exactly, character for character — wildcards and patterns are not supported."
              placeholder="https://myapp.example.com/oauth/callback"
              addLabel="Add redirect URI"
              values={Object.entries(item.redirectUris).map(([id, value]) => ({ id, value: value.url ?? "" }))}
              onChange={values => update({ redirectUris: Object.fromEntries(values.map(value => [value.id, { url: value.value }])) })}
            />
          </div>
        )}
      />
      <div className="flex justify-end">
        <Button disabled={!hasChanges} onClick={save}>Save changes</Button>
      </div>
    </PageLayout>
  );
}

function Field(props: { label: string, value: string, disabled?: boolean, placeholder?: string, hint?: string, onChange: (value: string) => void }) {
  return (
    <label className="block space-y-1">
      <Label>{props.label}</Label>
      <DesignInput disabled={props.disabled} placeholder={props.placeholder} value={props.value} onChange={event => props.onChange(event.target.value)} />
      {props.hint != null && <Typography className="text-xs text-muted-foreground">{props.hint}</Typography>}
    </label>
  );
}

function StableList(props: {
  label: string,
  description?: string,
  placeholder?: string,
  addLabel?: string,
  values: { id: string, value: string }[],
  onChange: (values: { id: string, value: string }[]) => void,
}) {
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label>{props.label}</Label>
        {props.description != null && <Typography className="text-xs text-muted-foreground">{props.description}</Typography>}
      </div>
      {props.values.map(item => (
        <div key={item.id} className="flex gap-2">
          <DesignInput placeholder={props.placeholder} value={item.value} onChange={event => props.onChange(props.values.map(value => value.id === item.id ? { ...value, value: event.target.value } : value))} />
          <Button variant="secondary" onClick={() => props.onChange(props.values.filter(value => value.id !== item.id))}>Remove</Button>
        </div>
      ))}
      <Button variant="secondary" onClick={() => props.onChange([...props.values, { id: generateUuid(), value: "" }])}>{props.addLabel ?? "Add"}</Button>
    </div>
  );
}

function Toggle(props: { label: string, description?: string, value: boolean, onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-start justify-between gap-4 rounded-xl border border-black/[0.08] p-3 dark:border-white/[0.12]">
      <div className="min-w-0 space-y-0.5">
        <Typography className="text-sm font-medium">{props.label}</Typography>
        {props.description != null && <Typography className="text-xs text-muted-foreground">{props.description}</Typography>}
      </div>
      <Switch className="mt-0.5 shrink-0" checked={props.value} onCheckedChange={props.onChange} />
    </label>
  );
}

function CopyableValue(props: { label: string, value: string }) {
  const [copied, setCopied] = useState(false);
  const resetTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <button
      type="button"
      className="group flex w-full items-center gap-2 text-left text-xs transition-colors hover:transition-none"
      onClick={() => {
        runAsynchronously(navigator.clipboard.writeText(props.value));
        setCopied(true);
        if (resetTimeout.current != null) clearTimeout(resetTimeout.current);
        resetTimeout.current = setTimeout(() => setCopied(false), 1500);
      }}
    >
      <span className="font-semibold">{props.label}:</span>
      <code className="min-w-0 truncate">{props.value}</code>
      {copied
        ? <span className="flex shrink-0 items-center gap-1 text-emerald-600 dark:text-emerald-400"><CheckIcon size={12} /> Copied</span>
        : <span className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-hover:transition-none"><CopyIcon size={12} /> Copy</span>}
    </button>
  );
}

function EditableList<T extends { id: string }>(props: {
  title: string,
  subtitle: string,
  intro: string,
  empty: string,
  addLabel: string,
  icon: ComponentType<{ size?: number | string }>,
  items: T[],
  onAdd: () => void,
  onChange: (items: T[]) => void,
  render: (item: T, update: (value: Partial<T>) => void) => ReactNode,
}) {
  return (
    <DesignCard title={props.title} subtitle={props.subtitle} icon={props.icon} glassmorphic>
      <div className="space-y-4">
        <Typography className="text-sm text-muted-foreground">{props.intro}</Typography>
        {props.items.length === 0 && (
          <div className="rounded-xl border border-dashed border-black/[0.08] p-4 text-center dark:border-white/[0.12]">
            <Typography className="text-sm text-muted-foreground">{props.empty}</Typography>
          </div>
        )}
        {props.items.map(item => (
          <div key={item.id} className="rounded-xl border border-black/[0.08] p-4 dark:border-white/[0.12]">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                {props.render(item, value => props.onChange(props.items.map(current => current.id === item.id ? { ...current, ...value } : current)))}
              </div>
              <Button variant="secondary" onClick={() => props.onChange(props.items.filter(current => current.id !== item.id))}>Remove</Button>
            </div>
          </div>
        ))}
        <Button variant="secondary" onClick={props.onAdd}>{props.addLabel}</Button>
      </div>
    </DesignCard>
  );
}
