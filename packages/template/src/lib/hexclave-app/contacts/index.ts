import type { ContactsCrud } from "@hexclave/shared/dist/interface/crud/contacts";
import type {
  ContactChannel as ContactChannelCrud,
  ContactChannelUpdate as ContactChannelUpdateCrud,
  ContactChannelWrite as ContactChannelCreateCrud,
} from "@hexclave/shared/dist/interface/comms";
import type { ReadonlyJson } from "@hexclave/shared/dist/utils/json";

type ServerCommunicationChannelBase = {
  id: string,
  contactId: string,
  value: string,
  displayValue: string,
  isPrimary: boolean,
  isVerified: boolean,
  verifiedAt: Date | null,
  metadata: ReadonlyJson,
  createdAt: Date,
  updatedAt: Date,

  update(data: ServerCommunicationChannelUpdateOptions): Promise<void>,
  delete(): Promise<void>,
};

export type ServerCommunicationChannel =
  | (ServerCommunicationChannelBase & { type: "email" })
  | (ServerCommunicationChannelBase & { type: "phone", extension: string | null })
  | (ServerCommunicationChannelBase & { type: "discord" })
  | (ServerCommunicationChannelBase & { type: "slack", workspaceId: string })
  | (ServerCommunicationChannelBase & {
    type: "push",
    provider: "apns" | "fcm",
    appId: string,
    environment: "development" | "production",
  });

type ServerCommunicationChannelCreateOptionsBase = {
  value: string,
  isPrimary?: boolean,
  isVerified?: boolean,
  metadata?: ReadonlyJson,
};

export type ServerCommunicationChannelCreateOptions =
  | (ServerCommunicationChannelCreateOptionsBase & { type: "email" })
  | (ServerCommunicationChannelCreateOptionsBase & { type: "phone", extension?: string | null })
  | (ServerCommunicationChannelCreateOptionsBase & { type: "discord" })
  | (ServerCommunicationChannelCreateOptionsBase & { type: "slack", workspaceId: string })
  | (ServerCommunicationChannelCreateOptionsBase & {
    type: "push",
    provider: "apns" | "fcm",
    appId: string,
    environment: "development" | "production",
  });

export type ServerCommunicationChannelUpdateOptions = {
  isPrimary?: boolean,
  isVerified?: boolean,
  metadata?: ReadonlyJson,
  extension?: string | null,
};

export type ServerContact = {
  id: string,
  displayName: string | null,
  profileImageUrl: string | null,
  clientMetadata: ReadonlyJson,
  clientReadOnlyMetadata: ReadonlyJson,
  serverMetadata: ReadonlyJson,
  mergedIntoContactId: string | null,
  mergedAt: Date | null,
  isUserBacked: boolean,
  contactChannels: ServerCommunicationChannel[],
  createdAt: Date,
  updatedAt: Date,

  update(data: ServerContactUpdateOptions): Promise<void>,
  delete(): Promise<void>,
  mergeInto(options: ServerContactMergeOptions): Promise<ServerContactMergeResult>,
  listContactChannels(): Promise<ServerCommunicationChannel[]>,
  createContactChannel(data: ServerCommunicationChannelCreateOptions): Promise<ServerCommunicationChannel>,
};

export type ServerContactCreateOptions = {
  id?: string,
  displayName?: string | null,
  profileImageUrl?: string | null,
  clientMetadata?: ReadonlyJson,
  clientReadOnlyMetadata?: ReadonlyJson,
  serverMetadata?: ReadonlyJson,
  contactChannels?: ServerCommunicationChannelCreateOptions[],
};

export type ServerContactUpdateOptions = {
  displayName?: string | null,
  profileImageUrl?: string | null,
  clientMetadata?: ReadonlyJson,
  clientReadOnlyMetadata?: ReadonlyJson,
  serverMetadata?: ReadonlyJson,
};

export type ServerContactListOptions = {
  cursor?: string,
  limit?: number,
  includeMerged?: boolean,
};

export type ServerContactMergeOptions = {
  targetContactId: string,
  idempotencyKey: string,
  actorUserId?: string | null,
  reason?: string | null,
  metadata?: ReadonlyJson,
};

export type ServerContactMergeResult = {
  operationId: string,
  replayed: boolean,
  contact: ServerContact,
};

export function serverContactChannelCreateOptionsToCrud(
  options: ServerCommunicationChannelCreateOptions,
): ContactChannelCreateCrud {
  const base = {
    value: options.value,
    is_primary: options.isPrimary,
    is_verified: options.isVerified,
    metadata: options.metadata,
  };
  switch (options.type) {
    case "email":
    case "discord": {
      return { ...base, type: options.type };
    }
    case "phone": {
      return { ...base, type: "phone", extension: options.extension };
    }
    case "slack": {
      return { ...base, type: "slack", workspace_id: options.workspaceId };
    }
    case "push": {
      return {
        ...base,
        type: "push",
        provider: options.provider,
        app_id: options.appId,
        environment: options.environment,
      };
    }
  }
}

export function serverContactChannelUpdateOptionsToCrud(
  options: ServerCommunicationChannelUpdateOptions,
): ContactChannelUpdateCrud {
  return {
    is_primary: options.isPrimary,
    is_verified: options.isVerified,
    metadata: options.metadata,
    extension: options.extension,
  };
}

export function serverContactChannelFromCrud(
  crud: ContactChannelCrud,
  methods: Pick<ServerCommunicationChannelBase, "update" | "delete">,
): ServerCommunicationChannel {
  const base = {
    id: crud.id,
    contactId: crud.contact_id,
    value: crud.value,
    displayValue: crud.display_value,
    isPrimary: crud.is_primary,
    isVerified: crud.is_verified,
    verifiedAt: crud.verified_at_millis == null ? null : new Date(crud.verified_at_millis),
    metadata: crud.metadata,
    createdAt: new Date(crud.created_at_millis),
    updatedAt: new Date(crud.updated_at_millis),
    ...methods,
  };
  switch (crud.type) {
    case "email":
    case "discord": {
      return { ...base, type: crud.type };
    }
    case "phone": {
      return { ...base, type: "phone", extension: crud.extension };
    }
    case "slack": {
      return { ...base, type: "slack", workspaceId: crud.workspace_id };
    }
    case "push": {
      return {
        ...base,
        type: "push",
        provider: crud.provider,
        appId: crud.app_id,
        environment: crud.environment,
      };
    }
  }
}

export function serverContactCreateOptionsToCrud(
  options: ServerContactCreateOptions,
): ContactsCrud["Server"]["Create"] {
  return {
    id: options.id,
    display_name: options.displayName,
    profile_image_url: options.profileImageUrl,
    client_metadata: options.clientMetadata,
    client_read_only_metadata: options.clientReadOnlyMetadata,
    server_metadata: options.serverMetadata,
    channels: options.contactChannels?.map(serverContactChannelCreateOptionsToCrud),
  };
}

export function serverContactUpdateOptionsToCrud(
  options: ServerContactUpdateOptions,
): ContactsCrud["Server"]["Update"] {
  return {
    display_name: options.displayName,
    profile_image_url: options.profileImageUrl,
    client_metadata: options.clientMetadata,
    client_read_only_metadata: options.clientReadOnlyMetadata,
    server_metadata: options.serverMetadata,
  };
}

export function serverContactFromCrud(
  crud: ContactsCrud["Server"]["Read"],
  methods: Pick<
    ServerContact,
    "update" | "delete" | "mergeInto" | "listContactChannels" | "createContactChannel"
  >,
  contactChannels: ServerCommunicationChannel[],
): ServerContact {
  return {
    id: crud.id,
    displayName: crud.display_name,
    profileImageUrl: crud.profile_image_url,
    clientMetadata: crud.client_metadata,
    clientReadOnlyMetadata: crud.client_read_only_metadata,
    serverMetadata: crud.server_metadata,
    mergedIntoContactId: crud.merged_into_contact_id,
    mergedAt: crud.merged_at_millis == null ? null : new Date(crud.merged_at_millis),
    isUserBacked: crud.is_user_backed,
    contactChannels,
    createdAt: new Date(crud.created_at_millis),
    updatedAt: new Date(crud.updated_at_millis),
    update: methods.update,
    delete: methods.delete,
    mergeInto: methods.mergeInto,
    listContactChannels: methods.listContactChannels,
    createContactChannel: methods.createContactChannel,
  };
}
