import { it } from "../../../../../../helpers";
import { Auth, Project, niceBackendFetch } from "../../../../../backend-helpers";

it("list domains", async ({ expect }) => {
  await Auth.Otp.signIn();
  const { adminAccessToken } = await Project.createAndGetAdminToken();
  const response = await niceBackendFetch("/api/v1/integrations/neon/domains", {
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": false,
        "items": [],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("creates domains for internal project", async ({ expect }) => {
  await Auth.Otp.signIn();
  const { adminAccessToken } = await Project.createAndGetAdminToken();
  const response = await niceBackendFetch("/api/v1/integrations/neon/domains", {
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
    method: "POST",
    body: {
      domain: "https://test-domain.example.com",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 201,
      "body": { "domain": "https://test-domain.example.com" },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("adds two different domains", async ({ expect }) => {
  await Auth.Otp.signIn();
  const { adminAccessToken } = await Project.createAndGetAdminToken();

  // Add first domain
  await niceBackendFetch("/api/v1/integrations/neon/domains", {
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
    method: "POST",
    body: {
      domain: "https://first-domain.example.com",
    },
  });

  // Add second domain
  await niceBackendFetch("/api/v1/integrations/neon/domains", {
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
    method: "POST",
    body: {
      domain: "https://second-domain.example.com",
    },
  });

  // List domains to verify both were added
  const listResponse = await niceBackendFetch("/api/v1/integrations/neon/domains", {
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
  });

  expect(listResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": false,
        "items": [
          { "domain": "https://first-domain.example.com" },
          { "domain": "https://second-domain.example.com" },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("adds two domains and deletes one", async ({ expect }) => {
  await Auth.Otp.signIn();
  const { adminAccessToken } = await Project.createAndGetAdminToken();

  // Add first domain
  await niceBackendFetch("/api/v1/integrations/neon/domains", {
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
    method: "POST",
    body: {
      domain: "https://domain-to-keep.example.com",
    },
  });

  // Add second domain
  await niceBackendFetch("/api/v1/integrations/neon/domains", {
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
    method: "POST",
    body: {
      domain: "https://domain-to-delete.example.com",
    },
  });

  // Delete the second domain
  const deleteResponse = await niceBackendFetch(`/api/v1/integrations/neon/domains/${encodeURIComponent("https://domain-to-delete.example.com")}`, {
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
    method: "DELETE",
  });

  expect(deleteResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // List domains to verify only one remains
  const listResponse = await niceBackendFetch("/api/v1/integrations/neon/domains", {
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
  });

  expect(listResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": false,
        "items": [{ "domain": "https://domain-to-keep.example.com" }],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});
