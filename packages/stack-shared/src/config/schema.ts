import * as yup from "yup";
import * as schemaFields from "../schema-fields";
import { yupBoolean, yupObject, yupRecord, yupString, yupUnion } from "../schema-fields";
import { allProviders } from "../utils/oauth";
import { validateSchemaLevels } from "./parser";

const configRecord = (schema: yup.AnySchema) => yupRecord(schema, (key) => key.match(/^[a-zA-Z0-9_$-]+$/) !== null);


const projectOrLowerLevels = { startLevel: 'project', endLevel: 'organization' } as const;
const envOrLowerLevels = { startLevel: 'environment', endLevel: 'organization' } as const;

export const configSchema = yupObject({
  createTeamOnSignUp: yupBoolean().defined().meta(projectOrLowerLevels),
  clientTeamCreationEnabled: yupBoolean().defined().meta(projectOrLowerLevels),
  clientUserDeletionEnabled: yupBoolean().defined().meta(projectOrLowerLevels),
  signUpEnabled: yupBoolean().defined().meta(projectOrLowerLevels),
  legacyGlobalJwtSigning: yupBoolean().defined().meta(projectOrLowerLevels),
  isProductionMode: yupBoolean().defined().meta(projectOrLowerLevels),
  allowLocalhost: yupBoolean().defined().meta(projectOrLowerLevels),
  oauthAccountMergeStrategy: yupString().oneOf(['link_method', 'raise_error', 'allow_duplicates']).defined().meta(projectOrLowerLevels),

  // keys to the permissions/permission definitions are hex encoded ids.
  teamCreateDefaultSystemPermissions: configRecord(yupObject({
    id: yupString().defined(),
  })).defined().meta(projectOrLowerLevels),
  teamMemberDefaultSystemPermissions: configRecord(yupObject({
    id: yupString().defined(),
  })).defined().meta(projectOrLowerLevels),
  permissionDefinitions: configRecord(yupObject({
    id: yupString().defined(),
    description: yupString().defined(),
    // keys to the contained permissions are the ids of the permissions.
    containedPermissions: yupRecord(yupObject({
      id: yupString().defined(),
    })).defined(),
  })).defined().meta(projectOrLowerLevels),

  // keys to the oauth providers are the provider ids.
  oauthProviders: configRecord(yupObject({
    id: yupString().defined(),
    isShared: yupBoolean().defined().meta(envOrLowerLevels),
    type: yupString().oneOf(allProviders).defined().meta(envOrLowerLevels),
    clientId: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.oauthClientIdSchema, { type: 'standard', enabled: true }).meta(envOrLowerLevels),
    clientSecret: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.oauthClientSecretSchema, { type: 'standard', enabled: true }).meta(envOrLowerLevels),
    facebookConfigId: schemaFields.oauthFacebookConfigIdSchema.optional().meta(envOrLowerLevels),
    microsoftTenantId: schemaFields.oauthMicrosoftTenantIdSchema.optional().meta(envOrLowerLevels),
  })).defined().meta(projectOrLowerLevels),

  // keys to the auth methods are the auth method ids.
  authMethods: configRecord(yupUnion(
    yupObject({
      id: yupString().defined(),
      type: yupString().oneOf(['password']).defined(),
    }),
    yupObject({
      id: yupString().defined(),
      type: yupString().oneOf(['otp']).defined(),
    }),
    yupObject({
      id: yupString().defined(),
      type: yupString().oneOf(['passkey']).defined(),
    }),
    yupObject({
      id: yupString().defined(),
      type: yupString().oneOf(['oauth']).defined(),
      oauthProviderId: yupString().defined(),
    }),
  )).defined().meta(projectOrLowerLevels),

  connectedAccounts: yupObject({
    enabled: yupBoolean().defined(),
    oauthProviderId: yupString().defined(),
  }).defined().meta(projectOrLowerLevels),

  // keys to the domains are the hex encoded domains
  domains: yupRecord(yupObject({
    domain: schemaFields.urlSchema.defined(),
    handlerPath: schemaFields.handlerPathSchema.defined(),
  }), (key) => key.match(/^[a-zA-Z0-9_]+$/) !== null).meta(envOrLowerLevels),

  emailConfig: yupObject({
    isShared: yupBoolean().defined(),
    host: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.emailHostSchema, { isShared: false }),
    port: schemaFields.yupDefinedWhen(schemaFields.emailPortSchema, { isShared: false }),
    username: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.emailUsernameSchema, { isShared: false }),
    password: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.emailPasswordSchema, { isShared: false }),
    senderName: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.emailSenderNameSchema, { isShared: false }),
    senderEmail: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.emailSenderEmailSchema, { isShared: false }),
  }).meta(envOrLowerLevels),
});

import.meta.vitest?.test("makes sure that config is valid", ({ expect }) => {
  validateSchemaLevels(configSchema);
});
