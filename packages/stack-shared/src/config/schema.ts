import * as yup from "yup";
import * as schemaFields from "../schema-fields";
import { yupBoolean, yupObject, yupRecord, yupString, yupUnion } from "../schema-fields";
import { validateSchemaLevels } from "./parser";

const configRecord = (schema: yup.AnySchema) => yupRecord(schema, (key) => key.match(/^[a-zA-Z0-9_$-]+$/) !== null);


const projectOrLowerLevels = { startLevel: 'project', endLevel: 'organization' } as const;
const envOrLowerLevels = { startLevel: 'environment', endLevel: 'organization' } as const;

export const getConfigSchema = () => yupObject({
  createTeamOnSignUp: yupBoolean().defined().meta(projectOrLowerLevels),
  clientTeamCreationEnabled: yupBoolean().defined().meta(projectOrLowerLevels),
  clientUserDeletionEnabled: yupBoolean().defined().meta(projectOrLowerLevels),
  signUpEnabled: yupBoolean().defined().meta(projectOrLowerLevels),
  legacyGlobalJwtSigning: yupBoolean().defined().meta(projectOrLowerLevels),
  isProductionMode: yupBoolean().defined().meta(projectOrLowerLevels),
  allowLocalhost: yupBoolean().defined().meta(projectOrLowerLevels),
  oauthAccountMergeStrategy: yupString().oneOf(['LINK_METHOD', 'RAISE_ERROR', 'ALLOW_DUPLICATES']).defined().meta(projectOrLowerLevels),

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
    type: yupString().oneOf(['shared', 'standard']).defined().meta(envOrLowerLevels),
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

  // keys to the domains are the hex encoded domains
  domains: yupRecord(yupObject({
    domain: schemaFields.urlSchema.defined(),
    handlerPath: schemaFields.handlerPathSchema.defined(),
  }), (key) => key.match(/^[a-zA-Z0-9_]+$/) !== null).meta(envOrLowerLevels),

  emailConfig: yupObject({
    type: schemaFields.emailTypeSchema.defined(),
    host: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.emailHostSchema, {
      type: 'standard',
    }),
    port: schemaFields.yupDefinedWhen(schemaFields.emailPortSchema, {
      type: 'standard',
    }),
    username: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.emailUsernameSchema, {
      type: 'standard',
    }),
    password: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.emailPasswordSchema, {
      type: 'standard',
    }),
    sender_name: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.emailSenderNameSchema, {
      type: 'standard',
    }),
    sender_email: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.emailSenderEmailSchema, {
      type: 'standard',
    }),
  }).meta(envOrLowerLevels),
});

import.meta.vitest?.test("makes sure that config is valid", ({ expect }) => {
  validateSchemaLevels(getConfigSchema());
});
