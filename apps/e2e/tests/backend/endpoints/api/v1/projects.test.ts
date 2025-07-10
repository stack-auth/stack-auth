import { isBase64Url } from "@stackframe/stack-shared/dist/utils/bytes";
import { it } from "../../../../helpers";
import { Auth, InternalProjectKeys, Project, backendContext, niceBackendFetch } from "../../../backend-helpers";


// TODO some of the tests here test /api/v1/projects/current, the others test /api/v1/internal/projects/current. We should split them into different test files

it("should not have have access to the project without project keys", async ({ expect }) => {
  backendContext.set({
    projectKeys: 'no-project'
  });
  const response = await niceBackendFetch("/api/v1/internal/projects/current", { accessType: "client" });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ACCESS_TYPE_WITHOUT_PROJECT_ID",
        "details": { "request_type": "client" },
        "error": deindent\`
          The x-stack-access-type header was 'client', but the x-stack-project-id header was not provided.
          
          For more information, see the docs on REST API authentication: https://docs.stack-auth.com/rest-api/overview#authentication
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "ACCESS_TYPE_WITHOUT_PROJECT_ID",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("gets current project (internal)", async ({ expect }) => {
  backendContext.set({ projectKeys: InternalProjectKeys });
  const response = await niceBackendFetch("/api/v1/projects/current", { accessType: "client" });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "config": {
          "allow_team_api_keys": false,
          "allow_user_api_keys": false,
          "client_team_creation_enabled": false,
          "client_user_deletion_enabled": false,
          "credential_enabled": true,
          "enabled_oauth_providers": [
            { "id": "github" },
            { "id": "google" },
            { "id": "microsoft" },
            { "id": "spotify" },
          ],
          "magic_link_enabled": true,
          "passkey_enabled": false,
          "sign_up_enabled": true,
        },
        "display_name": "Stack Dashboard",
        "id": "internal",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("creates and updates the basic project information of a project", async ({ expect }) => {
  await Auth.Otp.signIn();
  const { adminAccessToken } = await Project.createAndGetAdminToken();
  const { updateProjectResponse: response } = await Project.updateCurrent(adminAccessToken, {
    display_name: "Updated Project",
    description: "Updated description",
    is_production_mode: true,
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "config": {
          "allow_localhost": true,
          "allow_team_api_keys": false,
          "allow_user_api_keys": false,
          "client_team_creation_enabled": false,
          "client_user_deletion_enabled": false,
          "create_team_on_sign_up": false,
          "credential_enabled": true,
          "domains": [],
          "email_config": { "type": "shared" },
          "email_theme": "default-light",
          "enabled_oauth_providers": [],
          "magic_link_enabled": false,
          "oauth_account_merge_strategy": "link_method",
          "oauth_providers": [],
          "passkey_enabled": false,
          "sign_up_enabled": true,
          "team_creator_default_permissions": [{ "id": "team_admin" }],
          "team_member_default_permissions": [{ "id": "team_member" }],
          "user_default_permissions": [],
        },
        "created_at_millis": <stripped field 'created_at_millis'>,
        "description": "Updated description",
        "display_name": "Updated Project",
        "id": "<stripped UUID>",
        "is_production_mode": true,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("updates the basic project configuration", async ({ expect }) => {
  await Auth.Otp.signIn();
  const { adminAccessToken } = await Project.createAndGetAdminToken();
  const { updateProjectResponse: response } = await Project.updateCurrent(adminAccessToken, {
    config: {
      allow_localhost: false,
      sign_up_enabled: false,
      credential_enabled: false,
      magic_link_enabled: true,
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "config": {
          "allow_localhost": false,
          "allow_team_api_keys": false,
          "allow_user_api_keys": false,
          "client_team_creation_enabled": false,
          "client_user_deletion_enabled": false,
          "create_team_on_sign_up": false,
          "credential_enabled": false,
          "domains": [],
          "email_config": { "type": "shared" },
          "email_theme": "default-light",
          "enabled_oauth_providers": [],
          "magic_link_enabled": true,
          "oauth_account_merge_strategy": "link_method",
          "oauth_providers": [],
          "passkey_enabled": false,
          "sign_up_enabled": false,
          "team_creator_default_permissions": [{ "id": "team_admin" }],
          "team_member_default_permissions": [{ "id": "team_member" }],
          "user_default_permissions": [],
        },
        "created_at_millis": <stripped field 'created_at_millis'>,
        "description": "",
        "display_name": "New Project",
        "id": "<stripped UUID>",
        "is_production_mode": false,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("updates the project domains configuration", async ({ expect }) => {
  await Auth.Otp.signIn();
  const { adminAccessToken } = await Project.createAndGetAdminToken();
  const { updateProjectResponse: response1 } = await Project.updateCurrent(adminAccessToken, {
    config: {
      domains: [{
        domain: 'https://trusted-domain.stack-test.example.com',
        handler_path: '/handler'
      }]
    },
  });
  expect(response1).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "config": {
          "allow_localhost": true,
          "allow_team_api_keys": false,
          "allow_user_api_keys": false,
          "client_team_creation_enabled": false,
          "client_user_deletion_enabled": false,
          "create_team_on_sign_up": false,
          "credential_enabled": true,
          "domains": [
            {
              "domain": "https://trusted-domain.stack-test.example.com",
              "handler_path": "/handler",
            },
          ],
          "email_config": { "type": "shared" },
          "email_theme": "default-light",
          "enabled_oauth_providers": [],
          "magic_link_enabled": false,
          "oauth_account_merge_strategy": "link_method",
          "oauth_providers": [],
          "passkey_enabled": false,
          "sign_up_enabled": true,
          "team_creator_default_permissions": [{ "id": "team_admin" }],
          "team_member_default_permissions": [{ "id": "team_member" }],
          "user_default_permissions": [],
        },
        "created_at_millis": <stripped field 'created_at_millis'>,
        "description": "",
        "display_name": "New Project",
        "id": "<stripped UUID>",
        "is_production_mode": false,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const { updateProjectResponse: response2 } = await Project.updateCurrent(adminAccessToken, {
    config: {
      domains: [
        {
          domain: 'https://trusted-domain2.stack-test.example.com',
          handler_path: '/handler'
        },
        {
          domain: 'https://trusted-domain3.stack-test.example.com',
          handler_path: '/handler2'
        }
      ]
    },
  });
  expect(response2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "config": {
          "allow_localhost": true,
          "allow_team_api_keys": false,
          "allow_user_api_keys": false,
          "client_team_creation_enabled": false,
          "client_user_deletion_enabled": false,
          "create_team_on_sign_up": false,
          "credential_enabled": true,
          "domains": [
            {
              "domain": "https://trusted-domain2.stack-test.example.com",
              "handler_path": "/handler",
            },
            {
              "domain": "https://trusted-domain3.stack-test.example.com",
              "handler_path": "/handler2",
            },
          ],
          "email_config": { "type": "shared" },
          "email_theme": "default-light",
          "enabled_oauth_providers": [],
          "magic_link_enabled": false,
          "oauth_account_merge_strategy": "link_method",
          "oauth_providers": [],
          "passkey_enabled": false,
          "sign_up_enabled": true,
          "team_creator_default_permissions": [{ "id": "team_admin" }],
          "team_member_default_permissions": [{ "id": "team_member" }],
          "user_default_permissions": [],
        },
        "created_at_millis": <stripped field 'created_at_millis'>,
        "description": "",
        "display_name": "New Project",
        "id": "<stripped UUID>",
        "is_production_mode": false,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should allow insecure HTTP connections if insecureHttp is true", async ({ expect }) => {
  await Auth.Otp.signIn();
  const { adminAccessToken } = await Project.createAndGetAdminToken();
  const { updateProjectResponse: response } = await Project.updateCurrent(adminAccessToken, {
    config: {
      domains: [{
        domain: 'http://insecure-domain.stack-test.example.com',
        handler_path: '/handler'
      }]
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "config": {
          "allow_localhost": true,
          "allow_team_api_keys": false,
          "allow_user_api_keys": false,
          "client_team_creation_enabled": false,
          "client_user_deletion_enabled": false,
          "create_team_on_sign_up": false,
          "credential_enabled": true,
          "domains": [
            {
              "domain": "http://insecure-domain.stack-test.example.com",
              "handler_path": "/handler",
            },
          ],
          "email_config": { "type": "shared" },
          "email_theme": "default-light",
          "enabled_oauth_providers": [],
          "magic_link_enabled": false,
          "oauth_account_merge_strategy": "link_method",
          "oauth_providers": [],
          "passkey_enabled": false,
          "sign_up_enabled": true,
          "team_creator_default_permissions": [{ "id": "team_admin" }],
          "team_member_default_permissions": [{ "id": "team_member" }],
          "user_default_permissions": [],
        },
        "created_at_millis": <stripped field 'created_at_millis'>,
        "description": "",
        "display_name": "New Project",
        "id": "<stripped UUID>",
        "is_production_mode": false,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should not allow protocols other than http(s) in trusted domains", async ({ expect }) => {
  await Auth.Otp.signIn();
  const { adminAccessToken } = await Project.createAndGetAdminToken();
  const { updateProjectResponse: response } = await Project.updateCurrent(adminAccessToken, {
    config: {
      domains: [{
        domain: 'whatever://disallowed-domain.stack-test.example.com',
        handler_path: '/handler'
      }]
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": {
          "message": deindent\`
            Request validation failed on PATCH /api/v1/internal/projects/current:
              - URL must start with http:// or https://
          \`,
        },
        "error": deindent\`
          Request validation failed on PATCH /api/v1/internal/projects/current:
            - URL must start with http:// or https://
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("updates the project email configuration", async ({ expect }) => {
  await Auth.Otp.signIn();
  const { adminAccessToken } = await Project.createAndGetAdminToken();
  const { updateProjectResponse: response1 } = await Project.updateCurrent(adminAccessToken, {
    config: {
      email_config: {
        type: "standard",
        host: "smtp.example.com",
        port: 587,
        username: "test username",
        password: "test password",
        sender_name: "Test Sender",
        sender_email: "test@email.com",
      },
    },
  });
  expect(response1).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "config": {
          "allow_localhost": true,
          "allow_team_api_keys": false,
          "allow_user_api_keys": false,
          "client_team_creation_enabled": false,
          "client_user_deletion_enabled": false,
          "create_team_on_sign_up": false,
          "credential_enabled": true,
          "domains": [],
          "email_config": {
            "host": "smtp.example.com",
            "password": "test password",
            "port": 587,
            "sender_email": "test@email.com",
            "sender_name": "Test Sender",
            "type": "standard",
            "username": "test username",
          },
          "email_theme": "default-light",
          "enabled_oauth_providers": [],
          "magic_link_enabled": false,
          "oauth_account_merge_strategy": "link_method",
          "oauth_providers": [],
          "passkey_enabled": false,
          "sign_up_enabled": true,
          "team_creator_default_permissions": [{ "id": "team_admin" }],
          "team_member_default_permissions": [{ "id": "team_member" }],
          "user_default_permissions": [],
        },
        "created_at_millis": <stripped field 'created_at_millis'>,
        "description": "",
        "display_name": "New Project",
        "id": "<stripped UUID>",
        "is_production_mode": false,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // update standard email config again
  const { updateProjectResponse: response2 } = await Project.updateCurrent(adminAccessToken, {
    config: {
      email_config: {
        type: "standard",
        host: "smtp.example2.com",
        port: 587,
        username: "test username2",
        password: "test password2",
        sender_name: "Test Sender2",
        sender_email: "test@email.com2",
      },
    },
  });
  expect(response2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "config": {
          "allow_localhost": true,
          "allow_team_api_keys": false,
          "allow_user_api_keys": false,
          "client_team_creation_enabled": false,
          "client_user_deletion_enabled": false,
          "create_team_on_sign_up": false,
          "credential_enabled": true,
          "domains": [],
          "email_config": {
            "host": "smtp.example2.com",
            "password": "test password2",
            "port": 587,
            "sender_email": "test@email.com2",
            "sender_name": "Test Sender2",
            "type": "standard",
            "username": "test username2",
          },
          "email_theme": "default-light",
          "enabled_oauth_providers": [],
          "magic_link_enabled": false,
          "oauth_account_merge_strategy": "link_method",
          "oauth_providers": [],
          "passkey_enabled": false,
          "sign_up_enabled": true,
          "team_creator_default_permissions": [{ "id": "team_admin" }],
          "team_member_default_permissions": [{ "id": "team_member" }],
          "user_default_permissions": [],
        },
        "created_at_millis": <stripped field 'created_at_millis'>,
        "description": "",
        "display_name": "New Project",
        "id": "<stripped UUID>",
        "is_production_mode": false,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // switch back to shared email config
  const { updateProjectResponse: response3 } = await Project.updateCurrent(adminAccessToken, {
    config: {
      email_config: {
        type: "shared",
      },
    },
  });
  expect(response3).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "config": {
          "allow_localhost": true,
          "allow_team_api_keys": false,
          "allow_user_api_keys": false,
          "client_team_creation_enabled": false,
          "client_user_deletion_enabled": false,
          "create_team_on_sign_up": false,
          "credential_enabled": true,
          "domains": [],
          "email_config": { "type": "shared" },
          "email_theme": "default-light",
          "enabled_oauth_providers": [],
          "magic_link_enabled": false,
          "oauth_account_merge_strategy": "link_method",
          "oauth_providers": [],
          "passkey_enabled": false,
          "sign_up_enabled": true,
          "team_creator_default_permissions": [{ "id": "team_admin" }],
          "team_member_default_permissions": [{ "id": "team_member" }],
          "user_default_permissions": [],
        },
        "created_at_millis": <stripped field 'created_at_millis'>,
        "description": "",
        "display_name": "New Project",
        "id": "<stripped UUID>",
        "is_production_mode": false,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // update to shared again
  const { updateProjectResponse: response4 } = await Project.updateCurrent(adminAccessToken, {
    config: {
      email_config: {
        type: "shared",
      },
    },
  });
  expect(response4).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "config": {
          "allow_localhost": true,
          "allow_team_api_keys": false,
          "allow_user_api_keys": false,
          "client_team_creation_enabled": false,
          "client_user_deletion_enabled": false,
          "create_team_on_sign_up": false,
          "credential_enabled": true,
          "domains": [],
          "email_config": { "type": "shared" },
          "email_theme": "default-light",
          "enabled_oauth_providers": [],
          "magic_link_enabled": false,
          "oauth_account_merge_strategy": "link_method",
          "oauth_providers": [],
          "passkey_enabled": false,
          "sign_up_enabled": true,
          "team_creator_default_permissions": [{ "id": "team_admin" }],
          "team_member_default_permissions": [{ "id": "team_member" }],
          "user_default_permissions": [],
        },
        "created_at_millis": <stripped field 'created_at_millis'>,
        "description": "",
        "display_name": "New Project",
        "id": "<stripped UUID>",
        "is_production_mode": false,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // check if the second project still has the same email config
  const { updateProjectResponse: response2p2 } = await Project.updateCurrent(adminAccessToken, {
    config: {
      email_config: {
        type: "standard",
        host: "smtp.control-group.com",
        port: 587,
        username: "control group",
        password: "control group",
        sender_name: "Control Group",
        sender_email: "control-group@email.com",
      },
    },
  });
  expect(response2p2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "config": {
          "allow_localhost": true,
          "allow_team_api_keys": false,
          "allow_user_api_keys": false,
          "client_team_creation_enabled": false,
          "client_user_deletion_enabled": false,
          "create_team_on_sign_up": false,
          "credential_enabled": true,
          "domains": [],
          "email_config": {
            "host": "smtp.control-group.com",
            "password": "control group",
            "port": 587,
            "sender_email": "control-group@email.com",
            "sender_name": "Control Group",
            "type": "standard",
            "username": "control group",
          },
          "email_theme": "default-light",
          "enabled_oauth_providers": [],
          "magic_link_enabled": false,
          "oauth_account_merge_strategy": "link_method",
          "oauth_providers": [],
          "passkey_enabled": false,
          "sign_up_enabled": true,
          "team_creator_default_permissions": [{ "id": "team_admin" }],
          "team_member_default_permissions": [{ "id": "team_member" }],
          "user_default_permissions": [],
        },
        "created_at_millis": <stripped field 'created_at_millis'>,
        "description": "",
        "display_name": "New Project",
        "id": "<stripped UUID>",
        "is_production_mode": false,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("does not update project email config to empty host", async ({ expect }) => {
  const { adminAccessToken } = await Project.createAndGetAdminToken();
  const { updateProjectResponse: response } = await Project.updateCurrent(adminAccessToken, {
    config: {
      email_config: {
        type: "standard",
        host: "",
        port: 587,
        username: "test username",
        password: "test password",
        sender_name: "Test Sender",
        sender_email: "test@email.com",
      },
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": {
          "message": deindent\`
            Request validation failed on PATCH /api/v1/internal/projects/current:
              - body.config.email_config.host must not be empty
          \`,
        },
        "error": deindent\`
          Request validation failed on PATCH /api/v1/internal/projects/current:
            - body.config.email_config.host must not be empty
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("updates the project email configuration with invalid parameters", async ({ expect }) => {
  await Auth.Otp.signIn();
  const { adminAccessToken } = await Project.createAndGetAdminToken();
  const { updateProjectResponse: response1 } = await Project.updateCurrent(adminAccessToken, {
    config: {
      email_config: {
        type: "shared",
        client_id: "client_id",
      } as any,
    },
  });
  expect(response1).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": {
          "message": deindent\`
            Request validation failed on PATCH /api/v1/internal/projects/current:
              - body.config.email_config contains unknown properties: client_id
          \`,
        },
        "error": deindent\`
          Request validation failed on PATCH /api/v1/internal/projects/current:
            - body.config.email_config contains unknown properties: client_id
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);

  const response2 = await Project.updateCurrent(adminAccessToken, {
    config: {
      email_config: {
        type: "standard",
      },
    },
  });
  expect(response2).toMatchInlineSnapshot(`
    {
      "updateProjectResponse": NiceResponse {
        "status": 400,
        "body": {
          "code": "SCHEMA_ERROR",
          "details": {
            "message": deindent\`
              Request validation failed on PATCH /api/v1/internal/projects/current:
                - body.config.email_config.host must be defined
                - body.config.email_config.port must be defined
                - body.config.email_config.username must be defined
                - body.config.email_config.password must be defined
                - body.config.email_config.sender_name must be defined
                - body.config.email_config.sender_email must be defined
            \`,
          },
          "error": deindent\`
            Request validation failed on PATCH /api/v1/internal/projects/current:
              - body.config.email_config.host must be defined
              - body.config.email_config.port must be defined
              - body.config.email_config.username must be defined
              - body.config.email_config.password must be defined
              - body.config.email_config.sender_name must be defined
              - body.config.email_config.sender_email must be defined
          \`,
        },
        "headers": Headers {
          "x-stack-known-error": "SCHEMA_ERROR",
          <some fields may have been hidden>,
        },
      },
    }
  `);
});

it("updates the project oauth configuration", async ({ expect }) => {
  await Auth.Otp.signIn();
  const { adminAccessToken } = await Project.createAndGetAdminToken();
  // create google oauth provider with shared type
  const { updateProjectResponse: response1 } = await Project.updateCurrent(adminAccessToken, {
    config: {
      oauth_providers: [{
        id: "google",
        type: "shared",
      }]
    },
  });
  expect(response1).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "config": {
          "allow_localhost": true,
          "allow_team_api_keys": false,
          "allow_user_api_keys": false,
          "client_team_creation_enabled": false,
          "client_user_deletion_enabled": false,
          "create_team_on_sign_up": false,
          "credential_enabled": true,
          "domains": [],
          "email_config": { "type": "shared" },
          "email_theme": "default-light",
          "enabled_oauth_providers": [{ "id": "google" }],
          "magic_link_enabled": false,
          "oauth_account_merge_strategy": "link_method",
          "oauth_providers": [
            {
              "id": "google",
              "type": "shared",
            },
          ],
          "passkey_enabled": false,
          "sign_up_enabled": true,
          "team_creator_default_permissions": [{ "id": "team_admin" }],
          "team_member_default_permissions": [{ "id": "team_member" }],
          "user_default_permissions": [],
        },
        "created_at_millis": <stripped field 'created_at_millis'>,
        "description": "",
        "display_name": "New Project",
        "id": "<stripped UUID>",
        "is_production_mode": false,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // update google oauth provider with shared type again
  const { updateProjectResponse: response2 } = await Project.updateCurrent(adminAccessToken, {
    config: {
      oauth_providers: [{
        id: "google",
        type: "shared",
      }]
    },
  });
  expect(response2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "config": {
          "allow_localhost": true,
          "allow_team_api_keys": false,
          "allow_user_api_keys": false,
          "client_team_creation_enabled": false,
          "client_user_deletion_enabled": false,
          "create_team_on_sign_up": false,
          "credential_enabled": true,
          "domains": [],
          "email_config": { "type": "shared" },
          "email_theme": "default-light",
          "enabled_oauth_providers": [{ "id": "google" }],
          "magic_link_enabled": false,
          "oauth_account_merge_strategy": "link_method",
          "oauth_providers": [
            {
              "id": "google",
              "type": "shared",
            },
          ],
          "passkey_enabled": false,
          "sign_up_enabled": true,
          "team_creator_default_permissions": [{ "id": "team_admin" }],
          "team_member_default_permissions": [{ "id": "team_member" }],
          "user_default_permissions": [],
        },
        "created_at_millis": <stripped field 'created_at_millis'>,
        "description": "",
        "display_name": "New Project",
        "id": "<stripped UUID>",
        "is_production_mode": false,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // switch to standard type
  const { updateProjectResponse: response3 } = await Project.updateCurrent(adminAccessToken, {
    config: {
      oauth_providers: [{
        id: "google",
        type: "standard",
        client_id: "client_id",
        client_secret: "client_secret",
      }]
    },
  });
  expect(response3).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "config": {
          "allow_localhost": true,
          "allow_team_api_keys": false,
          "allow_user_api_keys": false,
          "client_team_creation_enabled": false,
          "client_user_deletion_enabled": false,
          "create_team_on_sign_up": false,
          "credential_enabled": true,
          "domains": [],
          "email_config": { "type": "shared" },
          "email_theme": "default-light",
          "enabled_oauth_providers": [{ "id": "google" }],
          "magic_link_enabled": false,
          "oauth_account_merge_strategy": "link_method",
          "oauth_providers": [
            {
              "client_id": "client_id",
              "client_secret": "client_secret",
              "id": "google",
              "type": "standard",
            },
          ],
          "passkey_enabled": false,
          "sign_up_enabled": true,
          "team_creator_default_permissions": [{ "id": "team_admin" }],
          "team_member_default_permissions": [{ "id": "team_member" }],
          "user_default_permissions": [],
        },
        "created_at_millis": <stripped field 'created_at_millis'>,
        "description": "",
        "display_name": "New Project",
        "id": "<stripped UUID>",
        "is_production_mode": false,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const { updateProjectResponse: response4 } = await Project.updateCurrent(adminAccessToken, {
    config: {
      oauth_providers: [{
        id: "spotify",
        type: "shared",
      }]
    },
  });
  expect(response4).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "config": {
          "allow_localhost": true,
          "allow_team_api_keys": false,
          "allow_user_api_keys": false,
          "client_team_creation_enabled": false,
          "client_user_deletion_enabled": false,
          "create_team_on_sign_up": false,
          "credential_enabled": true,
          "domains": [],
          "email_config": { "type": "shared" },
          "email_theme": "default-light",
          "enabled_oauth_providers": [{ "id": "spotify" }],
          "magic_link_enabled": false,
          "oauth_account_merge_strategy": "link_method",
          "oauth_providers": [
            {
              "id": "spotify",
              "type": "shared",
            },
          ],
          "passkey_enabled": false,
          "sign_up_enabled": true,
          "team_creator_default_permissions": [{ "id": "team_admin" }],
          "team_member_default_permissions": [{ "id": "team_member" }],
          "user_default_permissions": [],
        },
        "created_at_millis": <stripped field 'created_at_millis'>,
        "description": "",
        "display_name": "New Project",
        "id": "<stripped UUID>",
        "is_production_mode": false,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // add another oauth provider
  const { updateProjectResponse: response5 } = await Project.updateCurrent(adminAccessToken, {
    config: {
      oauth_providers: [
        {
          id: "spotify",
          type: "shared",
        },
        {
          id: "google",
          type: "shared",
        }
      ]
    },
  });
  expect(response5).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "config": {
          "allow_localhost": true,
          "allow_team_api_keys": false,
          "allow_user_api_keys": false,
          "client_team_creation_enabled": false,
          "client_user_deletion_enabled": false,
          "create_team_on_sign_up": false,
          "credential_enabled": true,
          "domains": [],
          "email_config": { "type": "shared" },
          "email_theme": "default-light",
          "enabled_oauth_providers": [
            { "id": "google" },
            { "id": "spotify" },
          ],
          "magic_link_enabled": false,
          "oauth_account_merge_strategy": "link_method",
          "oauth_providers": [
            {
              "id": "google",
              "type": "shared",
            },
            {
              "id": "spotify",
              "type": "shared",
            },
          ],
          "passkey_enabled": false,
          "sign_up_enabled": true,
          "team_creator_default_permissions": [{ "id": "team_admin" }],
          "team_member_default_permissions": [{ "id": "team_member" }],
          "user_default_permissions": [],
        },
        "created_at_millis": <stripped field 'created_at_millis'>,
        "description": "",
        "display_name": "New Project",
        "id": "<stripped UUID>",
        "is_production_mode": false,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // disable one of the oauth providers
  const { updateProjectResponse: response6 } = await Project.updateCurrent(adminAccessToken, {
    config: {
      oauth_providers: [
        {
          id: "spotify",
          type: "shared",
        },
        {
          id: "google",
          type: "shared",
        }
      ]
    },
  });
  expect(response6).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "config": {
          "allow_localhost": true,
          "allow_team_api_keys": false,
          "allow_user_api_keys": false,
          "client_team_creation_enabled": false,
          "client_user_deletion_enabled": false,
          "create_team_on_sign_up": false,
          "credential_enabled": true,
          "domains": [],
          "email_config": { "type": "shared" },
          "email_theme": "default-light",
          "enabled_oauth_providers": [
            { "id": "google" },
            { "id": "spotify" },
          ],
          "magic_link_enabled": false,
          "oauth_account_merge_strategy": "link_method",
          "oauth_providers": [
            {
              "id": "google",
              "type": "shared",
            },
            {
              "id": "spotify",
              "type": "shared",
            },
          ],
          "passkey_enabled": false,
          "sign_up_enabled": true,
          "team_creator_default_permissions": [{ "id": "team_admin" }],
          "team_member_default_permissions": [{ "id": "team_member" }],
          "user_default_permissions": [],
        },
        "created_at_millis": <stripped field 'created_at_millis'>,
        "description": "",
        "display_name": "New Project",
        "id": "<stripped UUID>",
        "is_production_mode": false,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("fails when trying to update OAuth provider with empty client_secret", async ({ expect }) => {
  await Project.createAndSwitch();
  const response = await niceBackendFetch(`/api/v1/internal/projects/current`, {
    accessType: "admin",
    method: "PATCH",
    body: {
      config: {
        oauth_providers: [{
          id: "google",
          type: "standard",
          client_id: "client_id",
          client_secret: ""
        }]
      }
    }
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": {
          "message": deindent\`
            Request validation failed on PATCH /api/v1/internal/projects/current:
              - body.config.oauth_providers[0].client_secret must not be empty
          \`,
        },
        "error": deindent\`
          Request validation failed on PATCH /api/v1/internal/projects/current:
            - body.config.oauth_providers[0].client_secret must not be empty
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("deletes a project with admin access", async ({ expect }) => {
  await Auth.Otp.signIn();
  const { adminAccessToken } = await Project.createAndGetAdminToken();

  // Delete the project
  const deleteResponse = await niceBackendFetch(`/api/v1/internal/projects/current`, {
    accessType: "admin",
    method: "DELETE",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    }
  });

  expect(deleteResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("deletes a project with server access", async ({ expect }) => {
  await Auth.Otp.signIn();
  const { adminAccessToken } = await Project.createAndGetAdminToken();

  // Delete the project
  const deleteResponse = await niceBackendFetch(`/api/v1/internal/projects/current`, {
    accessType: "server",
    method: "DELETE",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    }
  });

  expect(deleteResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 401,
      "body": {
        "code": "INSUFFICIENT_ACCESS_TYPE",
        "details": {
          "actual_access_type": "server",
          "allowed_access_types": ["admin"],
        },
        "error": "The x-stack-access-type header must be 'admin', but was 'server'.",
      },
      "headers": Headers {
        "x-stack-known-error": "INSUFFICIENT_ACCESS_TYPE",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("deletes a project with users, teams, and permissions", async ({ expect }) => {
  await Auth.Otp.signIn();
  const { adminAccessToken, createProjectResponse } = await Project.createAndGetAdminToken({
    config: {
      magic_link_enabled: true,
      oauth_providers: [
        {
          id: "google",
          type: "shared",
        },
        {
          id: "spotify",
          type: "standard",
          client_id: "client_id",
          client_secret: "client_secret",
        }
      ]
    }
  });

  // Create a user
  const userResponse = await niceBackendFetch(`/api/v1/users`, {
    accessType: "server",
    method: "POST",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
    body: {
      primary_email: "test@test.com",
      password: "testing",
      primary_email_auth_enabled: true,
    }
  });
  expect(userResponse.status).toBe(201);

  // Create a team
  const teamResponse = await niceBackendFetch(`/api/v1/teams`, {
    accessType: "server",
    method: "POST",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
    body: {
      display_name: "Test Team",
    }
  });
  expect(teamResponse.status).toBe(201);

  // create a team permission
  const teamPermissionResponse = await niceBackendFetch(`/api/v1/team-permission-definitions`, {
    accessType: "admin",
    method: "POST",
    body: {
      id: 'p1'
    },
    headers: {
      'x-stack-admin-access-token': adminAccessToken
    },
  });
  expect(teamPermissionResponse.status).toBe(201);

  // Delete the project
  const deleteResponse = await niceBackendFetch(`/api/v1/internal/projects/current`, {
    accessType: "admin",
    method: "DELETE",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    }
  });

  expect(deleteResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("makes sure user have the correct managed project ID after project creation", async ({ expect }) => {
  backendContext.set({ projectKeys: InternalProjectKeys });
  const { creatorUserId, projectId } = await Project.createAndGetAdminToken();

  backendContext.set({ projectKeys: InternalProjectKeys });
  const userResponse = await niceBackendFetch(`/api/v1/users/${creatorUserId}`, {
    accessType: "server",
    method: "GET",
  });
  const projectIds = userResponse.body.server_metadata.managedProjectIds;
  expect(projectIds.length).toBe(1);
  expect(projectIds[0]).toBe(projectId);
});

it("makes sure user don't have managed project ID after project deletion", async ({ expect }) => {
  backendContext.set({ projectKeys: InternalProjectKeys });
  const { creatorUserId, adminAccessToken } = await Project.createAndGetAdminToken();

  // Delete the project
  const deleteResponse = await niceBackendFetch(`/api/v1/internal/projects/current`, {
    accessType: "admin",
    method: "DELETE",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    }
  });

  expect(deleteResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  backendContext.set({ projectKeys: InternalProjectKeys });

  const userResponse = await niceBackendFetch(`/api/v1/users/${creatorUserId}`, {
    accessType: "server",
    method: "GET",
  });
  const projectIds = userResponse.body.server_metadata.managedProjectIds;
  expect(projectIds.length).toBe(0);
});

it("makes sure other users are not affected by project deletion", async ({ expect }) => {
  backendContext.set({ projectKeys: InternalProjectKeys });
  const { creatorUserId, projectId } = await Project.createAndGetAdminToken();

  backendContext.set({ projectKeys: InternalProjectKeys });
  const { adminAccessToken } = await Project.createAndGetAdminToken();

  // Delete the project
  await niceBackendFetch(`/api/v1/internal/projects/current`, {
    accessType: "admin",
    method: "DELETE",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    }
  });

  backendContext.set({ projectKeys: InternalProjectKeys });
  const userResponse1 = await niceBackendFetch(`/api/v1/users/${creatorUserId}`, {
    accessType: "server",
    method: "GET",
  });
  const projectIds1 = userResponse1.body.server_metadata.managedProjectIds;
  expect(projectIds1.length).toBe(1);
  expect(projectIds1[0]).toBe(projectId);
});

it("has a correctly formatted JWKS endpoint", async ({ expect }) => {
  const response = await niceBackendFetch("/api/v1/projects/internal/.well-known/jwks.json");
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).includes("application/json");
  expect(response.body).toEqual({
    keys: [
      {
        alg: "ES256",
        crv: "P-256",
        kid: expect.any(String),
        kty: "EC",
        x: expect.toSatisfy(isBase64Url),
        y: expect.toSatisfy(isBase64Url),
      },
    ],
  });
});

it("should increment and decrement userCount when a user is added to a project", async ({ expect }) => {
  const { adminAccessToken } = await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    }
  });
  const initialProjectResponse = await niceBackendFetch("/api/v1/internal/projects/current", { accessType: "admin" });
  expect(initialProjectResponse.status).toBe(200);


  // Create a new user in the project
  await Auth.Password.signUpWithEmail();

  // Check that the userCount has been incremented
  const updatedProjectResponse = await niceBackendFetch("/api/v1/internal/projects/current", { accessType: "admin" });
  expect(updatedProjectResponse.status).toBe(200);
  expect(updatedProjectResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "config": {
          "allow_localhost": true,
          "allow_team_api_keys": false,
          "allow_user_api_keys": false,
          "client_team_creation_enabled": false,
          "client_user_deletion_enabled": false,
          "create_team_on_sign_up": false,
          "credential_enabled": true,
          "domains": [],
          "email_config": { "type": "shared" },
          "email_theme": "default-light",
          "enabled_oauth_providers": [],
          "magic_link_enabled": true,
          "oauth_account_merge_strategy": "link_method",
          "oauth_providers": [],
          "passkey_enabled": false,
          "sign_up_enabled": true,
          "team_creator_default_permissions": [{ "id": "team_admin" }],
          "team_member_default_permissions": [{ "id": "team_member" }],
          "user_default_permissions": [],
        },
        "created_at_millis": <stripped field 'created_at_millis'>,
        "description": "",
        "display_name": "New Project",
        "id": "<stripped UUID>",
        "is_production_mode": false,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Delete the user
  const deleteRes = await niceBackendFetch("/api/v1/users/me", {
    accessType: "admin",
    method: "DELETE",
  });
  expect(deleteRes.status).toBe(200);

  // Check that the userCount has been decremented
  const finalProjectResponse = await niceBackendFetch("/api/v1/internal/projects/current", { accessType: "admin" });
  expect(finalProjectResponse.status).toBe(200);
});
