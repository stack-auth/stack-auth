import * as yup from "yup";
import * as schemaFields from "../schema-fields";
import { yupBoolean, yupObject, yupRecord, yupString, yupUnion } from "../schema-fields";

type EnvMode = 'undefined' | 'optional' | 'defined';

const configRecord = (schema: yup.AnySchema) => yupRecord(schema, (key) => key.match(/^[a-zA-Z0-9_$-]+$/) !== null);

const envSchema = <T extends yup.AnySchema>(mode: EnvMode, schema: T): T => {
  switch (mode) {
    case 'undefined': {
      return schema;
    }
    case 'optional': {
      return schema.nullable().optional();
    }
    case 'defined': {
      return schema;
    }
  }
};

export const getConfigSchema = (mode: EnvMode) => yupObject({
  createTeamOnSignUp: yupBoolean().defined().meta({ startLevel: 'project', endLevel: 'organization' }),
  clientTeamCreationEnabled: yupBoolean().defined(),
  clientUserDeletionEnabled: yupBoolean().defined(),
  signUpEnabled: yupBoolean().defined(),
  legacyGlobalJwtSigning: yupBoolean().defined(),
  isProductionMode: envSchema(mode, yupBoolean().defined()),
  allowLocalhost: envSchema(mode, yupBoolean().defined()),

  // keys to the permissions/permission definitions are hex encoded ids.
  teamCreateDefaultSystemPermissions: configRecord(yupObject({
    id: yupString().defined(),
  })).defined(),
  teamMemberDefaultSystemPermissions: configRecord(yupObject({
    id: yupString().defined(),
  })).defined(),
  permissionDefinitions: configRecord(yupObject({
    id: yupString().defined(),
    description: yupString().defined(),
    // keys to the contained permissions are the ids of the permissions.
    containedPermissions: yupRecord(yupObject({
      id: yupString().defined(),
    })).defined(),
  })).defined(),

  // keys to the oauth providers are the provider ids.
  oauthProviders: configRecord(yupObject({
    id: yupString().defined(),
    type: envSchema(mode, yupString().oneOf(['shared', 'standard']).defined()),
    clientId: envSchema(mode, schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.oauthClientIdSchema, { type: 'standard', enabled: true })),
    clientSecret: envSchema(mode, schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.oauthClientSecretSchema, { type: 'standard', enabled: true })),
    facebookConfigId: envSchema(mode, schemaFields.oauthFacebookConfigIdSchema.optional()),
    microsoftTenantId: envSchema(mode, schemaFields.oauthMicrosoftTenantIdSchema.optional()),
  })).defined(),

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
  )).defined(),

  // keys to the domains are the hex encoded domains
  domains: envSchema(mode, yupRecord(yupObject({
    domain: schemaFields.urlSchema.defined(),
    handlerPath: schemaFields.handlerPathSchema.defined(),
  }), (key) => key.match(/^[a-zA-Z0-9_]+$/) !== null)),

  emailConfig: envSchema(mode, yupObject({
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
  })),
});
