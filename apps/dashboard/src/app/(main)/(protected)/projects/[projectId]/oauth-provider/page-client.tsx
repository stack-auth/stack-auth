"use client";

import { useUpdateConfig } from "@/components/config-update";
import { DesignAlert, DesignCard } from "@/components/design-components";
import { Button, Input, Label, Switch, Typography } from "@/components/ui";
import { useAdminApp } from "../use-admin-app";
import { PageLayout } from "../page-layout";
import { generateUuid } from "@hexclave/shared/dist/utils/uuids";
import type { CompleteConfig, BranchConfigOverrideOverride } from "@hexclave/shared/dist/config/schema";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { GearSixIcon } from "@phosphor-icons/react";
import { useMemo, useState, type ReactNode } from "react";

type OAuthProviderConfig = CompleteConfig["oauthProvider"];
type ScopeConfig = OAuthProviderConfig["scopes"][string];
type ResourceConfig = OAuthProviderConfig["resources"][string];
type ClientConfig = OAuthProviderConfig["clients"][string];

type EditableScope = ScopeConfig & { id: string };
type EditableResource = ResourceConfig & { id: string, scopes: Record<string, { scope?: string }> };
type EditableClient = ClientConfig & { id: string, redirectUris: Record<string, { url?: string }> };
type EditableDomain = { id: string, domain?: string };

function toScopes(value: OAuthProviderConfig["scopes"]): EditableScope[] {
  return Object.entries(value).map(([id, scope]) => ({ id, ...scope }));
}

function toResources(value: OAuthProviderConfig["resources"]): EditableResource[] {
  return Object.entries(value).map(([id, resource]) => ({ id, ...resource, scopes: resource.scopes }));
}

function toClients(value: OAuthProviderConfig["clients"]): EditableClient[] {
  return Object.entries(value).map(([id, client]) => ({ id, ...client, redirectUris: client.redirectUris }));
}

export default function PageClient() {
  const app = useAdminApp();
  const project = app.useProject();
  const config = project.useConfig();
  const updateConfig = useUpdateConfig();
  const oauth = config.oauthProvider;
  const [scopes, setScopes] = useState(() => toScopes(oauth.scopes));
  const [resources, setResources] = useState(() => toResources(oauth.resources));
  const [clients, setClients] = useState(() => toClients(oauth.clients));
  const [domains, setDomains] = useState<EditableDomain[]>(() =>
    Object.entries(oauth.clientIdMetadataDocuments.allowedDomains).map(([id, value]) => ({ id, ...value })),
  );
  const [dcrEnabled, setDcrEnabled] = useState(oauth.dynamicClientRegistration.enabled);
  const [cimdEnabled, setCimdEnabled] = useState(oauth.clientIdMetadataDocuments.enabled);
  const [consentRequired, setConsentRequired] = useState<boolean>(oauth.consent["required"]);
  const [optionalScopes, setOptionalScopes] = useState(oauth.consent.allowUserToDeselectOptionalScopes);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const issuer = `${window.location.origin}/api/v1/projects/${project.id}/oidc`;
  const discovery = `${issuer}/.well-known/openid-configuration`;
  const hasChanges = useMemo(() =>
    JSON.stringify({ scopes, resources, clients, domains, dcrEnabled, cimdEnabled, consentRequired, optionalScopes })
    !== JSON.stringify({
      scopes: toScopes(oauth.scopes),
      resources: toResources(oauth.resources),
      clients: toClients(oauth.clients),
      domains: Object.entries(oauth.clientIdMetadataDocuments.allowedDomains).map(([id, value]) => ({ id, ...value })),
      dcrEnabled: oauth.dynamicClientRegistration.enabled,
      cimdEnabled: oauth.clientIdMetadataDocuments.enabled,
      consentRequired: oauth.consent["required"],
      optionalScopes: oauth.consent.allowUserToDeselectOptionalScopes,
    }), [clients, cimdEnabled, consentRequired, dcrEnabled, domains, oauth, optionalScopes, resources, scopes]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const scopePattern = /^[a-z][a-z0-9._:-]*$/;
      if (scopes.some(scope => scope.scope == null || !scopePattern.test(scope.scope) || ["openid", "profile", "email", "phone", "address", "offline_access"].includes(scope.scope))) {
        throw new Error("Scope names must be lowercase custom scopes and cannot use reserved OIDC scopes.");
      }
      const resourceUris = resources.map(resource => resource.uri ?? "");
      if (resourceUris.some(uri => {
        try {
          const parsed = new URL(uri);
          return parsed.search !== "" || parsed.hash !== "";
        } catch {
          return true;
        }
      })) {
        throw new Error("Resource URIs must be valid URLs without query strings or fragments.");
      }
      if (new Set(resourceUris).size !== resourceUris.length) {
        throw new Error("Resource URIs must be unique.");
      }
      for (const domain of domains) {
        if (domain.domain != null && !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(domain.domain)) {
          throw new Error("Allowed domains must be valid hostnames.");
        }
      }
      const update: BranchConfigOverrideOverride = {
        "oauthProvider.dynamicClientRegistration.enabled": dcrEnabled,
        "oauthProvider.clientIdMetadataDocuments.enabled": cimdEnabled,
        "oauthProvider.consent.required": consentRequired,
        "oauthProvider.consent.allowUserToDeselectOptionalScopes": optionalScopes,
      };
      for (const id of Object.keys(oauth.scopes)) {
        if (!scopes.some(scope => scope.id === id)) update[`oauthProvider.scopes.${id}`] = null;
      }
      for (const id of Object.keys(oauth.resources)) {
        if (!resources.some(resource => resource.id === id)) update[`oauthProvider.resources.${id}`] = null;
      }
      for (const id of Object.keys(oauth.clients)) {
        if (!clients.some(client => client.id === id)) update[`oauthProvider.clients.${id}`] = null;
      }
      for (const id of Object.keys(oauth.clientIdMetadataDocuments.allowedDomains)) {
        if (!domains.some(domain => domain.id === id)) update[`oauthProvider.clientIdMetadataDocuments.allowedDomains.${id}`] = null;
      }
      for (const scope of scopes) {
        update[`oauthProvider.scopes.${scope.id}.scope`] = scope.scope ?? "";
        update[`oauthProvider.scopes.${scope.id}.displayName`] = scope.displayName ?? "";
        update[`oauthProvider.scopes.${scope.id}.description`] = scope.description ?? "";
      }
      for (const resource of resources) {
        update[`oauthProvider.resources.${resource.id}.displayName`] = resource.displayName ?? "";
        update[`oauthProvider.resources.${resource.id}.uri`] = resource.uri ?? "";
        for (const [scopeId, value] of Object.entries(resource.scopes)) {
          update[`oauthProvider.resources.${resource.id}.scopes.${scopeId}.scope`] = value.scope ?? "";
        }
      }
      for (const client of clients) {
        update[`oauthProvider.clients.${client.id}.displayName`] = client.displayName ?? "";
        update[`oauthProvider.clients.${client.id}.trusted`] = client.trusted;
        for (const [redirectId, redirect] of Object.entries(client.redirectUris)) {
          update[`oauthProvider.clients.${client.id}.redirectUris.${redirectId}.url`] = redirect.url ?? "";
        }
      }
      for (const domain of domains) {
        update[`oauthProvider.clientIdMetadataDocuments.allowedDomains.${domain.id}.domain`] = domain.domain ?? "";
      }
      await updateConfig({ adminApp: app, configUpdate: update, pushable: false });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save OAuth provider settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageLayout title="OAuth Provider" description="Configure project-scoped OAuth, OIDC, and MCP access.">
      <DesignAlert
        variant="info"
        title="Connect an MCP server"
        description={(
          <div className="space-y-2">
            <p>Use the issuer and discovery URLs below when configuring your OAuth client.</p>
            <CopyableValue label="Issuer" value={issuer} />
            <CopyableValue label="Discovery" value={discovery} />
          </div>
        )}
      />
      {error != null && <DesignAlert variant="error" title="Unable to save changes" description={error} />}
      <DesignCard title="Provider behavior" subtitle="Control registration and consent." icon={GearSixIcon} glassmorphic>
        <div className="grid gap-4 sm:grid-cols-2">
          <Toggle label="Require consent" value={consentRequired} onChange={setConsentRequired} />
          <Toggle label="Allow optional scope deselection" value={optionalScopes} onChange={setOptionalScopes} />
          <Toggle label="Enable dynamic client registration" value={dcrEnabled} onChange={setDcrEnabled} />
          <Toggle label="Enable client ID metadata documents" value={cimdEnabled} onChange={setCimdEnabled} />
        </div>
      </DesignCard>
      <EditableList
        title="Custom scopes"
        items={scopes}
        onAdd={() => setScopes(current => [...current, { id: generateUuid(), scope: "", displayName: "", description: "" }])}
        onChange={setScopes}
        render={(item, update) => (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Scope" value={item.scope ?? ""} onChange={value => update({ scope: value })} />
            <Field label="Display name" value={item.displayName ?? ""} onChange={value => update({ displayName: value })} />
            <Field label="Description" value={item.description ?? ""} onChange={value => update({ description: value })} />
          </div>
        )}
      />
      <EditableList
        title="Allowed domains"
        items={domains}
        onAdd={() => setDomains(current => [...current, { id: generateUuid(), domain: "" }])}
        onChange={setDomains}
        render={(item, update) => (
          <Field label="Hostname" value={item.domain ?? ""} onChange={domain => update({ domain })} />
        )}
      />
      <EditableList
        title="Resource servers"
        items={resources}
        onAdd={() => setResources(current => [...current, { id: generateUuid(), displayName: "", uri: "", scopes: {} }])}
        onChange={setResources}
        render={(item, update) => (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Display name" value={item.displayName ?? ""} onChange={value => update({ displayName: value })} />
              <Field label="URI" value={item.uri ?? ""} onChange={value => update({ uri: value })} />
            </div>
            <Field
              label="Allowed scopes (comma-separated)"
              value={Object.values(item.scopes).map(scope => typeof scope === "string" ? scope : scope.scope ?? "").join(", ")}
              onChange={value => update({ scopes: Object.fromEntries(value.split(",").map(scope => scope.trim()).filter(scope => scope !== "").map(scope => [generateUuid(), { scope }])) })}
            />
          </div>
        )}
      />
      <EditableList
        title="OAuth clients"
        items={clients}
        onAdd={() => setClients(current => [...current, { id: generateUuid(), displayName: "", type: "public", trusted: false, redirectUris: {} }])}
        onChange={setClients}
        render={(item, update) => (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Display name" value={item.displayName ?? ""} onChange={value => update({ displayName: value })} />
              <Toggle label="Trusted client" value={item.trusted === true} onChange={trusted => update({ trusted })} />
            </div>
            <Field
              label="Redirect URIs (comma-separated)"
              value={Object.values(item.redirectUris).map(uri => uri.url ?? "").join(", ")}
              onChange={value => update({ redirectUris: Object.fromEntries(value.split(",").map(url => url.trim()).filter(url => url !== "").map(url => [generateUuid(), { url }])) })}
            />
          </div>
        )}
      />
      <div className="flex justify-end">
        <Button disabled={!hasChanges || saving} onClick={save}>{saving ? "Saving…" : "Save changes"}</Button>
      </div>
    </PageLayout>
  );
}

function Field(props: { label: string, value: string, onChange: (value: string) => void }) {
  return <label className="space-y-1"><Label>{props.label}</Label><Input value={props.value} onChange={event => props.onChange(event.target.value)} /></label>;
}

function Toggle(props: { label: string, value: boolean, onChange: (value: boolean) => void }) {
  return <label className="flex items-center justify-between gap-3 rounded-xl border border-black/[0.08] p-3 dark:border-white/[0.12]"><Typography className="text-sm">{props.label}</Typography><Switch checked={props.value} onCheckedChange={props.onChange} /></label>;
}

function CopyableValue(props: { label: string, value: string }) {
  return <button type="button" className="block w-full text-left text-xs transition-colors hover:transition-none" onClick={() => runAsynchronously(navigator.clipboard.writeText(props.value))}><span className="mr-2 font-semibold">{props.label}:</span><code>{props.value}</code></button>;
}

function EditableList<T extends { id: string }>(props: {
  title: string,
  items: T[],
  onAdd: () => void,
  onChange: (items: T[]) => void,
  render: (item: T, update: (value: Partial<T>) => void) => ReactNode,
}) {
  return (
    <DesignCard title={props.title} icon={GearSixIcon} glassmorphic>
      <div className="space-y-4">
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
        <Button variant="secondary" onClick={props.onAdd}>Add {props.title.slice(0, -1)}</Button>
      </div>
    </DesignCard>
  );
}
