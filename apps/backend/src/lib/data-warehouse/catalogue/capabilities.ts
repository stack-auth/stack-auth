import type {
  ConnectorConfigField, ConnectorDefinition, ConnectorStream, ConnectorTransport,
  CredentialMode, PullSpec,
} from "./schema";

export type RuntimeSyncMode = "full_refresh" | "incremental";

type SupportedCredentialScheme = Extract<CredentialMode["scheme"], {
  type: "bearer" | "header" | "basic" | "query",
}>;

export type RunnableCredentialMode = CredentialMode & { scheme: SupportedCredentialScheme };

type PrimaryHttpTransport = ConnectorTransport & {
  role: "primary",
  spec: Extract<ConnectorTransport["spec"], { kind: "http" }> & {
    baseUrl:
      | { kind: "constant", value: string }
      | { kind: "template", template: string, placeholders: Record<string, string> },
  },
};

export type RunnableHttpPull = Extract<PullSpec, { kind: "http" }> & {
  path: string,
  paginator: NonNullable<Extract<PullSpec, { kind: "http" }>["paginator"]>,
};

export type RunnableStream = {
  definition: ConnectorStream,
  name: string,
  primaryKey: string[],
  cursorField: string | null,
  supportedSyncModes: RuntimeSyncMode[],
};

export type RunnableConnector = {
  definition: ConnectorDefinition,
  id: string,
  displayName: string,
  description: string,
  category: ConnectorDefinition["category"],
  authTier: ConnectorDefinition["authTierOverall"],
  transport: PrimaryHttpTransport,
  credentialMode: RunnableCredentialMode,
  configFields: ConnectorConfigField[],
  streams: RunnableStream[],
};

export type ConnectorCapability =
  | { status: "supported", runnable: RunnableConnector }
  | { status: "unsupported", reasons: string[] };

function findPrimaryHttpTransport(definition: ConnectorDefinition): PrimaryHttpTransport | null {
  const configFields = new Set(definition.configFields.map(field => field.name));
  for (const transport of definition.transports) {
    if (
      transport.role === "primary"
      && transport.spec.kind === "http"
      && (
        transport.spec.baseUrl?.kind === "constant"
        || (
          transport.spec.baseUrl?.kind === "template"
          && Object.keys(transport.spec.baseUrl.placeholders).every(name => configFields.has(name))
        )
      )
    ) {
      return {
        ...transport,
        role: "primary",
        spec: { ...transport.spec, baseUrl: transport.spec.baseUrl },
      };
    }
  }
  return null;
}

function credentialFieldNames(mode: RunnableCredentialMode): string[] {
  switch (mode.scheme.type) {
    case "bearer":
    case "header":
    case "query": {
      return [mode.scheme.field];
    }
    case "basic": {
      return [
        mode.scheme.usernameField,
        ...mode.scheme.passwordField.startsWith("<none") ? [] : [mode.scheme.passwordField],
      ];
    }
  }
}

function findRunnableCredentialMode(definition: ConnectorDefinition): RunnableCredentialMode | null {
  const fieldNames = new Set(definition.configFields.map(field => field.name));
  for (const mode of definition.credentialModes) {
    if (mode.appliesToTransport !== "primary" || mode.tier !== "T1_SIMPLE") continue;
    if (
      mode.scheme.type !== "bearer"
      && mode.scheme.type !== "header"
      && mode.scheme.type !== "basic"
      && mode.scheme.type !== "query"
    ) continue;
    const runnable = { ...mode, scheme: mode.scheme };
    if (credentialFieldNames(runnable).every(field => fieldNames.has(field))) return runnable;
  }
  return null;
}

function isScalarParameter(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/**
 * Whether the current HTTP driver can execute a mined pull shape exactly.
 * Every rejection is based on a declared capability; unknown shapes never
 * degrade to a page-one-only or otherwise silently partial sync.
 */
export function isRunnableHttpPull(pull: PullSpec | null): pull is RunnableHttpPull {
  if (pull == null || pull.kind !== "http") return false;
  if (pull.path == null || pull.paginator == null) return false;
  if (pull.httpMethod !== "GET") return false;
  if (pull.pathPlaceholders != null && Object.keys(pull.pathPlaceholders).length > 0) return false;
  if (pull.params != null && !Object.values(pull.params).every(isScalarParameter)) return false;

  const paginator = pull.paginator;
  if (paginator.tokenFrom === "header" || paginator.tokenFrom === "url_path_segment") return false;
  if (paginator.tokenTo === "header" || paginator.tokenTo === "path_segment" || paginator.tokenTo === "body_field") return false;
  if (paginator.terminateOn === null) return false;
  if (paginator.terminateOn === "explicit_total") return false;

  switch (paginator.type) {
    case "body_cursor": {
      return false;
    }
    case "none":
    case "next_url": {
      return true;
    }
    case "offset": {
      return paginator.limitParam != null;
    }
    case "page": {
      return paginator.limitParam != null && paginator.pageSize != null;
    }
    case "cursor": {
      return paginator.cursorParam != null;
    }
    case "record_cursor": {
      return paginator.hasMorePath != null || paginator.pageSize != null;
    }
  }
}

export function getPullForSyncMode(
  stream: ConnectorStream,
  syncMode: RuntimeSyncMode,
): RunnableHttpPull | null {
  const pull = syncMode === "incremental"
    ? (stream.pull.incremental ?? null)
    : (stream.pull.snapshot ?? stream.pull.backfill ?? null);
  return isRunnableHttpPull(pull) ? pull : null;
}

function referencedPlaceholders(value: string): string[] {
  return [...value.matchAll(/\{(?:config\.|secrets\.)?([A-Za-z0-9_.]+)\}/g)].map(match => match[1]);
}

function pullPlaceholdersAreResolvable(pull: RunnableHttpPull, fields: Set<string>): boolean {
  const values = [
    pull.path,
    pull.recordsPath ?? "",
    ...Object.values(pull.params ?? {}).filter(value => typeof value === "string"),
  ];
  return values.flatMap(referencedPlaceholders).every(name => fields.has(name));
}

function runnableSyncModes(stream: ConnectorStream, fields: Set<string>): RuntimeSyncMode[] {
  const modes: RuntimeSyncMode[] = [];
  const fullRefresh = getPullForSyncMode(stream, "full_refresh");
  if (
    stream.supportedSyncModes.includes("full_refresh")
    && fullRefresh != null
    && pullPlaceholdersAreResolvable(fullRefresh, fields)
  ) {
    modes.push("full_refresh");
  }
  const incremental = getPullForSyncMode(stream, "incremental");
  if (
    stream.supportedSyncModes.includes("incremental")
    && incremental != null
    && pullPlaceholdersAreResolvable(incremental, fields)
  ) {
    modes.push("incremental");
  }
  return modes;
}

function runtimeConfigFields(
  definition: ConnectorDefinition,
  credentialMode: RunnableCredentialMode,
): ConnectorConfigField[] {
  const credentialFields = new Set(credentialFieldNames(credentialMode));
  return definition.configFields.filter(field => {
    if (field.scope === "resource") return false;
    if (field.secret) return credentialFields.has(field.name);
    // Estuary's oneOf discriminator selects a credential branch in its own UI;
    // our selected mode already carries that decision.
    return field.name !== "credentials.credentials_title";
  });
}

export function evaluateConnectorCapability(definition: ConnectorDefinition): ConnectorCapability {
  const reasons: string[] = [];
  if (definition.execution.mode !== "poll") {
    reasons.push("continuous/log execution is not implemented");
  }

  const transport = findPrimaryHttpTransport(definition);
  if (transport == null) reasons.push("the primary transport is not HTTP with a resolvable base URL");

  const credentialMode = findRunnableCredentialMode(definition);
  if (credentialMode == null) reasons.push("no self-serve HTTP credential mode is executable");

  const configFieldNames = new Set(definition.configFields.map(field => field.name));
  const streams = definition.streams.flatMap((stream): RunnableStream[] => {
    if (stream.kind === "archetype") return [];
    const supportedSyncModes = runnableSyncModes(stream, configFieldNames);
    return supportedSyncModes.length === 0 ? [] : [{
      definition: stream,
      name: stream.name,
      primaryKey: stream.primaryKey,
      cursorField: stream.cursorField,
      supportedSyncModes,
    }];
  });
  if (streams.length === 0) reasons.push("no concrete stream has an executable HTTP pull shape");

  if (reasons.length > 0 || transport == null || credentialMode == null) {
    return { status: "unsupported", reasons };
  }
  return {
    status: "supported",
    runnable: {
      definition,
      id: definition.id,
      displayName: definition.displayName,
      description: definition.description,
      category: definition.category,
      authTier: definition.authTierOverall,
      transport,
      credentialMode,
      configFields: runtimeConfigFields(definition, credentialMode),
      streams,
    },
  };
}
