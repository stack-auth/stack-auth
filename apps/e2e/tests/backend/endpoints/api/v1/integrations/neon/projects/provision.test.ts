import { it } from "../../../../../../../helpers";
import { backendContext, niceBackendFetch } from "../../../../../../backend-helpers";

export async function provisionProject() {
  return await niceBackendFetch("/api/v1/integrations/neon/projects/provision", {
    method: "POST",
    body: {
      display_name: "Test project",
    },
    headers: {
      "Authorization": "Basic bmVvbi1sb2NhbDpuZW9uLWxvY2FsLXNlY3JldA==",
    },
  });
}

it("should be able to provision a new project if neon client details are correct", async ({ expect }) => {
  const response = await provisionProject();
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "project_id": "<stripped UUID>",
        "super_secret_admin_key": <stripped field 'super_secret_admin_key'>,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);


  // test API keys
  backendContext.set({
    projectKeys: {
      projectId: response.body.project_id,
      superSecretAdminKey: response.body.super_secret_admin_key,
    },
  });
  const project = await niceBackendFetch(`/api/v1/projects/current`, {
    method: "GET",
    accessType: "admin",
  });
  expect(project).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "config": {
          "allow_localhost": true,
          "client_team_creation_enabled": false,
          "client_user_deletion_enabled": false,
          "create_team_on_sign_up": false,
          "credential_enabled": true,
          "domains": [],
          "email_config": { "type": "shared" },
          "enabled_oauth_providers": [
            { "id": "github" },
            { "id": "google" },
          ],
          "id": "<stripped UUID>",
          "magic_link_enabled": false,
          "oauth_account_merge_strategy": "link_method",
          "oauth_providers": [
            {
              "enabled": true,
              "id": "github",
              "type": "shared",
            },
            {
              "enabled": true,
              "id": "google",
              "type": "shared",
            },
          ],
          "passkey_enabled": false,
          "sign_up_enabled": true,
          "team_creator_default_permissions": [{ "id": "admin" }],
          "team_member_default_permissions": [{ "id": "member" }],
        },
        "created_at_millis": <stripped field 'created_at_millis'>,
        "description": "Created with Neon",
        "display_name": "Test project",
        "id": "<stripped UUID>",
        "is_production_mode": false,
        "user_count": 0,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should fail if the neon client details are incorrect", async ({ expect }) => {
  const response = await niceBackendFetch("/api/v1/integrations/neon/projects/provision", {
    method: "POST",
    body: {
      display_name: "Test project",
    },
    headers: {
      "Authorization": "Basic bmVvbi1sb2NhbDpuZW9uLWxvY2FsLXMlY3JldA==",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": {
          "message": deindent\`
            Request validation failed on POST /api/v1/integrations/neon/projects/provision:
              - Invalid client_id:client_secret values; did you use the correct values for the Neon integration?
          \`,
        },
        "error": deindent\`
          Request validation failed on POST /api/v1/integrations/neon/projects/provision:
            - Invalid client_id:client_secret values; did you use the correct values for the Neon integration?
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});


it("should fail if the neon client details are missing", async ({ expect }) => {
  const response = await niceBackendFetch("/api/v1/integrations/neon/projects/provision", {
    method: "POST",
    body: {
      display_name: "Test project",
    },
  });
  expect(response).toMatchInlineSnapshot(`
  NiceResponse {
    "status": 400,
    "body": {
      "code": "SCHEMA_ERROR",
      "details": {
        "message": deindent\`
          Request validation failed on POST /api/v1/integrations/neon/projects/provision:
            - headers.authorization must be defined
        \`,
      },
      "error": deindent\`
        Request validation failed on POST /api/v1/integrations/neon/projects/provision:
          - headers.authorization must be defined
      \`,
    },
    "headers": Headers {
      "x-stack-known-error": "SCHEMA_ERROR",
      <some fields may have been hidden>,
    },
  }
`);
});
